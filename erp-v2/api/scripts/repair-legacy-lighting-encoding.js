"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");

const dryRun=process.argv.includes("--dry-run");
const base64Input=process.argv.includes("--base64");
const slug=process.env.IMPORT_ORG_SLUG||"choibalsan-hugjil";
const clean=value=>String(value??"").trim();
const readable=(value,fallback="")=>{const text=clean(value);if(!text.includes("?"))return text||fallback;return text.replace(/\?+/g," ").replace(/\s+/g," ").trim()||fallback};
const integer=value=>Number.isInteger(Number(value))?Number(value):0;
const serviceAreaCode=value=>({"Гэр хороолол":"ger-area-lighting","Гэр хорооллын гэрэл":"ger-area-lighting","Цамхаг":"tower-lighting","Цамхагийн гэрэл":"tower-lighting"})[clean(value)]||null;
const legacyInventoryQuantities=row=>{
  const total=integer(row.total_count),area=serviceAreaCode(row.category);
  if(area==="tower-lighting")return {poleCount:1,headCountPerPole:total,totalHeadCount:total,lampCount:1,headCount:total};
  if(area==="ger-area-lighting")return {poleCount:total,headCountPerPole:total>0?1:null,totalHeadCount:total,lampCount:total,headCount:total};
  return {lampCount:row.lamp_count??row.total_count??0,headCount:row.head_count??row.total_heads??0};
};
const statusAsset=value=>{const text=clean(value).toLowerCase();return text.includes("inactive")||text.includes("идэвхгүй")?"inactive":"active"};
const faultStatus=value=>{const text=clean(value).toLowerCase();return text.includes("дуус")||text.includes("хааг")?"resolved":text.includes("явц")?"in_progress":"open"};
const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{body+=chunk});process.stdin.on("end",()=>{try{resolve(JSON.parse(base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body))}catch(error){reject(new Error(`Invalid JSON: ${error.message}`))}});process.stdin.on("error",reject)});

async function main(){
  const data=await read();
  if(data.format!=="overva.legacy-lighting.v1")throw new Error("Unsupported lighting import format");
  const client=await getPool().connect();
  const counts={assets:0,objects:0,incidents:0,workOrders:0,executionNotes:0};
  try{
    await client.query("BEGIN");
    const organization=await client.query("SELECT id FROM organizations WHERE slug=$1",[slug]);
    if(!organization.rowCount)throw new Error(`Organization not found: ${slug}`);
    const organizationId=organization.rows[0].id;

    for(const [table,prefix,category,rows,nameField] of [["sl_points","SLP","lighting.meter-point",data.points,"name"],["sl_ger_inventory","SLI","lighting.fixture-group",data.inventory,"location_name"]]){
      for(const row of rows||[]){
        const quantities=table==="sl_ger_inventory"?legacyInventoryQuantities(row):{lampCount:row.lamp_count??row.total_count??0,headCount:row.head_count??row.total_heads??0};
        const metadata={legacyId:row.id,legacyAssetId:row.asset_id??null,bagNo:row.bag_no??null,meterNo:row.meter_no??null,lightType:row.light_type??null,...quantities,wattagePerLamp:row.wattage_per_lamp??null,gps:{lat:row.gps_lat??null,lng:row.gps_lng??null},notes:row.notes??""};
        const repairedAssets=await client.query(`UPDATE assets SET name=$3,category=$4,status=$5,location=$6,notes=$7,
          metadata=metadata||$8::jsonb,updated_at=now()
          WHERE organization_id=$1 AND code=$2
            AND (name LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR COALESCE(notes,'') LIKE '%?%' OR metadata::text LIKE '%?%')
          RETURNING id`,[organizationId,`LEGACY-${prefix}-${row.id}`,clean(row[nameField])||`Legacy asset ${row.id}`,category,statusAsset(row.status),clean(row.location||row.location_name),clean(row.notes),JSON.stringify(metadata)]);
        for(const asset of repairedAssets.rows)await client.query(`INSERT INTO asset_events(organization_id,asset_id,actor_user_id,event_type,detail)
          VALUES($1,$2,NULL,'updated',$3::jsonb)`,[organizationId,asset.id,JSON.stringify({reason:"legacy UTF-8 transport correction",source:data.sourceSystem,sourceTable:table,sourceId:row.id})]);
        counts.assets+=repairedAssets.rowCount;
        const result=await client.query(`UPDATE operational_objects SET name=$5,location=$6,status=$7,metadata=metadata||$8::jsonb,updated_at=now()
          WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4
            AND (name LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR metadata::text LIKE '%?%' OR NOT (metadata ? 'legacyAssetId'))`,[organizationId,data.sourceSystem,table,String(row.id),clean(row[nameField])||`Legacy object ${row.id}`,clean(row.location||row.location_name),statusAsset(row.status),JSON.stringify(metadata)]);
        counts.objects+=result.rowCount;
      }
    }

    for(const row of data.faults||[]){
      const category=readable(row.category,"Гэмтэл"),location=readable(row.location_name,"Байршил");
      const affected=Math.max(0,integer(row.broken_count)),resolved=Math.min(affected,Math.max(0,integer(row.fixed_count))),status=affected===resolved?"resolved":faultStatus(row.status);
      const detail={legacyStatus:row.status,totalHeads:row.total_heads,notes:row.notes||""};
      const result=await client.query(`UPDATE operational_incidents SET incident_type=$4,title=$5,location=$6,affected_quantity=$7,resolved_quantity=$8,status=$9,detail=detail||$10::jsonb,updated_at=now()
        WHERE organization_id=$1 AND domain='lighting' AND source_system=$2 AND external_id=$3
          AND (title LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR detail::text LIKE '%?%')`,[organizationId,data.sourceSystem,String(row.id),category,`${category} — ${location||"Байршил"}`,location,affected,resolved,status,JSON.stringify(detail)]);
      counts.incidents+=result.rowCount;
    }

    for(const row of data.work||[]){
      const result=await client.query(`UPDATE work_orders w SET title=$4,description=$5,updated_at=now()
        FROM source_import_records s
        WHERE w.organization_id=$1 AND s.organization_id=w.organization_id AND s.target_type='work_order' AND s.target_id=w.id::text
          AND s.source_system=$2 AND s.source_table='asset_events' AND s.source_id=$3
          AND (w.title LIKE '%?%' OR COALESCE(w.description,'') LIKE '%?%')`,[organizationId,data.sourceSystem,String(row.id),clean(row.title)||`Legacy lighting work ${row.id}`,clean(row.description||row.location)]);
      counts.workOrders+=result.rowCount;
    }

    for(const row of data.executions||[]){
      const original=await client.query(`SELECT e.id,e.organization_id,e.work_order_id,e.actor_user_id
        FROM work_order_events e
        WHERE e.organization_id=$1 AND e.event_type='note'
          AND e.detail->>'source'=$2 AND e.detail->>'sourceTable'='work_executions'
          AND e.detail->>'sourceId'=$3 AND COALESCE(e.note,'') LIKE '%?%'
          AND NOT EXISTS(SELECT 1 FROM work_order_events correction
            WHERE correction.organization_id=e.organization_id
              AND correction.detail->>'correctsEventId'=e.id::text)
        ORDER BY e.id LIMIT 1`,[organizationId,data.sourceSystem,String(row.id)]);
      if(!original.rowCount)continue;
      const event=original.rows[0];
      const detail={source:data.sourceSystem,sourceTable:"work_executions",sourceId:row.id,
        encodingCorrection:true,correctsEventId:String(event.id),legacyStatus:row.status,
        legacyProgress:row.progress,workers:row.workers,startDate:row.start_date,endDate:row.end_date,
        gps:{lat:row.gps_lat,lng:row.gps_lng}};
      await client.query(`INSERT INTO work_order_events(
        organization_id,work_order_id,actor_user_id,event_type,note,detail,created_at)
        VALUES($1,$2,$3,'note',$4,$5::jsonb,now())`,[event.organization_id,event.work_order_id,event.actor_user_id,
        readable(row.note||row.title,"Хуучин гүйцэтгэл"),JSON.stringify(detail)]);
      counts.executionNotes+=1;
    }

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1::uuid,NULL,'legacy_lighting.encoding_repair','legacy_import',($1::uuid)::text,$2::jsonb)`,[organizationId,JSON.stringify({sourceSystem:data.sourceSystem,dryRun,counts,rule:"repair targets from read-only UTF-8 source; preserve immutable source provenance"})]);
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");
    process.stdout.write(`${JSON.stringify({dryRun,organization:slug,counts},null,2)}\n`);
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

main().catch(error=>{console.error(error);process.exitCode=1});
