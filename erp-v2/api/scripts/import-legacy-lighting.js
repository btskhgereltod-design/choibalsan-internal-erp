"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");
const {assigneeReference,recordInitialAssignment}=require("../src/services/work-order-assignment");
const dryRun=process.argv.includes("--dry-run");
const base64Input=process.argv.includes("--base64");
const slug=process.env.IMPORT_ORG_SLUG||"choibalsan-hugjil";
const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>body+=x);process.stdin.on("end",()=>{try{resolve(JSON.parse(base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body))}catch(e){reject(new Error(`Invalid JSON: ${e.message}`))}});process.stdin.on("error",reject)});
const clean=x=>String(x??"").trim();
const integer=x=>Number.isInteger(Number(x))?Number(x):0;
const timestamp=x=>{const value=clean(x);if(!value)return null;const d=new Date(value.includes("T")?value:`${value.replace(" ","T")}Z`);return Number.isNaN(d.valueOf())?null:d.toISOString()};
const statusAsset=x=>{const v=clean(x).toLowerCase();return v.includes("inactive")||v.includes("идэвхгүй")?"inactive":"active"};
const faultStatus=x=>{const v=clean(x).toLowerCase();return v.includes("дуус")||v.includes("хааг")?"resolved":v.includes("явц")?"in_progress":"open"};
const workStatus=x=>{const v=clean(x).toLowerCase();return v.includes("дуус")||v.includes("хааг")?"completed":v.includes("цуц")||v.includes("буца")?"cancelled":v.includes("хүл")?"assigned":"in_progress"};
const legacyAssetTable=x=>{const v=clean(x).toLowerCase();return ["sl_point","sl_points","point","meter_point"].includes(v)?"sl_points":"sl_ger_inventory"};
const serviceAreaCode=value=>({"Авто замын гэрэл":"road-lighting","Гэр хороолол":"ger-area-lighting","Гэр хорооллын гэрэл":"ger-area-lighting","Цамхаг":"tower-lighting","Цамхагийн гэрэл":"tower-lighting","Шит/Самбар":"panel-board","Гэрлэн дохио":"traffic-signal"})[clean(value)]||null;
const legacyPointType=row=>clean(row.code).startsWith("ГТ-")?"lighting_corridor":"legacy_unclassified";
const legacyInventoryQuantities=row=>{
  const total=integer(row.total_count),area=serviceAreaCode(row.category);
  if(area==="tower-lighting")return {poleCount:1,headCountPerPole:total,totalHeadCount:total,lampCount:1,headCount:total};
  if(area==="ger-area-lighting")return {poleCount:total,headCountPerPole:total>0?1:null,totalHeadCount:total,lampCount:total,headCount:total};
  return {poleCount:row.lamp_count??row.total_count??0,headCountPerPole:row.head_count??null,
    totalHeadCount:row.total_heads??row.total_count??0,lampCount:row.lamp_count??row.total_count??0,
    headCount:row.head_count??row.total_heads??0};
};

async function main(){
  const data=await read();if(data.format!=="overva.legacy-lighting.v1")throw new Error("Unsupported lighting import format");
  const client=await getPool().connect(),counts={assets:0,incidents:0,repairs:0,workOrders:0,executions:0,skipped:0,warnings:[]};
  try{
    await client.query("BEGIN");
    const orgResult=await client.query("SELECT id FROM organizations WHERE slug=$1",[slug]);if(!orgResult.rowCount)throw new Error(`Organization not found: ${slug}`);const org=orgResult.rows[0].id;
    const areaRows=await client.query("SELECT id,code FROM organization_work_service_areas WHERE organization_id=$1 AND domain='lighting' AND active=true",[org]);
    const serviceAreas=new Map(areaRows.rows.map(x=>[x.code,x.id]));
    const inventoryAreas=new Map((data.inventory||[]).map(row=>[Number(row.id),serviceAreas.get(serviceAreaCode(row.category))||null]));
    const userRows=await client.query(`SELECT ep.legacy_user_id,u.id FROM employee_profiles ep JOIN users u ON u.organization_id=ep.organization_id AND u.id=ep.user_id WHERE ep.organization_id=$1`,[org]);
    const users=new Map(userRows.rows.map(x=>[Number(x.legacy_user_id),x.id]));
    const linked=async(table,id)=>Boolean((await client.query("SELECT 1 FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4",[org,data.sourceSystem,table,String(id)])).rowCount);
    const provenance=async(table,row,type,id,warnings=[])=>client.query(`INSERT INTO source_import_records(organization_id,source_system,source_table,source_id,target_type,target_id,source_snapshot,warnings) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,[org,data.sourceSystem,table,String(row.id),type,String(id),JSON.stringify(row),JSON.stringify(warnings)]);
    const assetIds=new Map();
    for(const [table,prefix,category,rows,nameField] of [["sl_points","SLP","lighting.meter-point",data.points,"name"],["sl_ger_inventory","SLI","lighting.fixture-group",data.inventory,"location_name"]]){
      for(const row of rows||[]){const code=`LEGACY-${prefix}-${row.id}`;let found=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND code=$2",[org,code]);
        const quantities=table==='sl_ger_inventory'?legacyInventoryQuantities(row):{poleCount:row.lamp_count??row.total_count??0,headCountPerPole:row.head_count??null,totalHeadCount:row.total_heads??row.total_count??0,lampCount:row.lamp_count??row.total_count??0,headCount:row.head_count??row.total_heads??0};
        if(!found.rowCount){found=await client.query(`INSERT INTO operational_objects(organization_id,code,name,object_type,domain,status,location,metadata,source_system,source_table,source_id) VALUES($1,$2,$3,$4,'lighting',$5,$6,$7::jsonb,$8,$9,$10) RETURNING id`,[org,code,clean(row[nameField])||code,table==='sl_points'?legacyPointType(row):'lighting_group',statusAsset(row.status),clean(row.location||row.location_name),JSON.stringify({source:data.sourceSystem,legacyId:row.id,legacyCode:clean(row.code)||null,legacyAssetId:row.asset_id??null,bagNo:row.bag_no??null,meterNo:row.meter_no??null,lightType:row.light_type??null,...quantities,replacementPoleCount:row.needs_poles??0,wattagePerLamp:row.wattage_per_lamp??null,gps:{lat:row.gps_lat??null,lng:row.gps_lng??null},notes:row.notes??""}),data.sourceSystem,table,String(row.id)]);counts.assets++}
        assetIds.set(`${table}:${row.id}`,found.rows[0].id);if(!await linked(table,row.id))await provenance(table,row,"operational_object",found.rows[0].id);
      }
    }
    const incidentIds=new Map();
    for(const row of data.faults||[]){if(await linked("sl_faults",row.id)){counts.skipped++;continue}const key=`${legacyAssetTable(row.location_type)}:${row.location_id}`,assetId=assetIds.get(key)||null,affected=Math.max(0,integer(row.broken_count)),resolved=Math.min(affected,Math.max(0,integer(row.fixed_count))),status=affected===resolved?"resolved":faultStatus(row.status);
      const inserted=await client.query(`INSERT INTO operational_incidents(organization_id,domain,operational_object_id,service_area_id,incident_type,title,location,affected_quantity,resolved_quantity,status,reported_at,reported_by,detail,source_system,external_id)
        VALUES($1,'lighting',$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,now()),$11,$12::jsonb,$13,$14) RETURNING id`,[org,assetId,serviceAreas.get(serviceAreaCode(row.category))||null,clean(row.category)||"fault",`${clean(row.category)||"Гэмтэл"} — ${clean(row.location_name)||"Байршил"}`,clean(row.location_name),affected,resolved,status,timestamp(row.report_date||row.created_at),users.get(integer(row.reported_by))||null,JSON.stringify({legacyStatus:row.status,totalHeads:row.total_heads,notes:row.notes||""}),data.sourceSystem,String(row.id)]);
      const id=inserted.rows[0].id;incidentIds.set(Number(row.id),id);await client.query(`INSERT INTO operational_incident_events(organization_id,incident_id,actor_user_id,event_type,quantity,note,occurred_at,detail) VALUES($1,$2,$3,'legacy_import',$4,$5,COALESCE($6::timestamptz,now()),$7::jsonb)`,[org,id,users.get(integer(row.reported_by))||null,affected,clean(row.notes),timestamp(row.created_at),JSON.stringify({sourceStatus:row.status})]);await provenance("sl_faults",row,"operational_incident",id);counts.incidents++;
    }
    for(const row of data.repairs||[]){if(await linked("sl_fault_repairs",row.id)){counts.skipped++;continue}const incidentId=incidentIds.get(Number(row.fault_id))||(await client.query("SELECT target_id FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table='sl_faults' AND source_id=$3",[org,data.sourceSystem,String(row.fault_id)])).rows[0]?.target_id;if(!incidentId){counts.warnings.push(`Repair ${row.id}: fault ${row.fault_id} not found`);continue}
      const event=await client.query(`INSERT INTO operational_incident_events(organization_id,incident_id,actor_user_id,event_type,quantity,note,occurred_at,detail) VALUES($1,$2,$3,'progress',$4,$5,COALESCE($6::timestamptz,now()),$7::jsonb) RETURNING id`,[org,incidentId,users.get(integer(row.repaired_by))||null,Math.max(0,integer(row.heads_fixed)),clean(row.notes),timestamp(row.repair_date||row.created_at),JSON.stringify({source:data.sourceSystem})]);await provenance("sl_fault_repairs",row,"operational_incident_event",event.rows[0].id);counts.repairs++;
    }
    const routeResult=await client.query(`SELECT wt.id work_type_id,r.organization_unit_id,r.workflow_policy_id FROM organization_work_types wt LEFT JOIN organization_work_type_routes r ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true WHERE wt.organization_id=$1 AND wt.code='lighting-repair' LIMIT 1`,[org]);const route=routeResult.rows[0]||{};
    for(const row of data.work||[]){if(await linked("asset_events",row.id)){counts.skipped++;continue}const assetId=assetIds.get(row.sl_point_id?`sl_points:${row.sl_point_id}`:`sl_ger_inventory:${row.ger_inventory_id}`)||null,status=workStatus(row.status),warnings=[];let due=timestamp(row.end_date||row.work_date);const start=timestamp(row.start_date||row.work_date);if(due&&start&&new Date(due)<new Date(start)){warnings.push("End date precedes start date; due date omitted");due=null}if(Number(row.progress)!==0&&Number(row.progress)!==100)warnings.push("Legacy manual progress preserved only in provenance");
      const assignedUserId=users.get(integer(row.assigned_to))||null;
      const serviceAreaId=row.sl_point_id?serviceAreas.get("road-lighting")||null:inventoryAreas.get(Number(row.ger_inventory_id))||null;
      const inserted=await client.query(`INSERT INTO work_orders(organization_id,operational_object_id,work_type_id,department_id,workflow_policy_id,workflow_stage,service_area_id,title,description,category,priority,status,assigned_to,due_at,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'lighting.repair','normal',$10,$11,$12,COALESCE($13::timestamptz,now()),COALESCE($14::timestamptz,now())) RETURNING id`,[org,assetId,route.work_type_id||null,route.organization_unit_id||null,route.workflow_policy_id||null,status==='completed'?'completed':route.workflow_policy_id?'awaiting_safety_start':null,serviceAreaId,clean(row.title)||`Legacy lighting work ${row.id}`,clean(row.description||row.location),status,assignedUserId,due,timestamp(row.created_at),timestamp(row.updated_at)]);
      const id=inserted.rows[0].id;await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status,note,detail,created_at) VALUES($1,$2,$3,'created',$4,$5,$6::jsonb,COALESCE($7::timestamptz,now()))`,[org,id,users.get(integer(row.created_by))||null,status,"Хуучин системээс нотолгоотой импортлов",JSON.stringify({source:data.sourceSystem,legacyId:row.id,legacyStatus:row.status}),timestamp(row.created_at)]);
      await recordInitialAssignment(client,{organizationId:org,workOrderId:id,
        actorUserId:users.get(integer(row.created_by))||null,
        assignee:await assigneeReference(client,org,assignedUserId),status,source:"import",
        reason:"Source assignment observed during import"});
      await provenance("asset_events",row,"work_order",id,warnings);counts.workOrders++;counts.warnings.push(...warnings.map(x=>`Work ${row.id}: ${x}`));
      for(const execution of (data.executions||[]).filter(x=>Number(x.work_log_id)===Number(row.id))){await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,note,detail,created_at) VALUES($1,$2,$3,'note',$4,$5::jsonb,COALESCE($6::timestamptz,now()))`,[org,id,users.get(integer(execution.created_by))||null,clean(execution.note||execution.title)||"Хуучин гүйцэтгэл",JSON.stringify({source:data.sourceSystem,sourceTable:"work_executions",sourceId:execution.id,legacyStatus:execution.status,legacyProgress:execution.progress,workers:execution.workers,startDate:execution.start_date,endDate:execution.end_date,gps:{lat:execution.gps_lat,lng:execution.gps_lng}}),timestamp(execution.created_at)]);counts.executions++}
    }
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");console.log(JSON.stringify({dryRun,organization:slug,counts},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
