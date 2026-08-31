"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");
const dryRun=process.argv.includes("--dry-run");
const base64Input=process.argv.includes("--base64");
const slug=process.env.IMPORT_ORG_SLUG||"choibalsan-hugjil";
const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",part=>body+=part);process.stdin.on("end",()=>{try{resolve(JSON.parse(base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body))}catch(error){reject(new Error(`Invalid JSON: ${error.message}`))}});process.stdin.on("error",reject)});
const clean=value=>String(value??"").trim();
const integer=value=>Number.isFinite(Number(value))?Math.trunc(Number(value)):0;
const timestamp=value=>{const text=clean(value);if(!text)return null;const date=new Date(text.includes("T")?text:`${text.replace(" ","T")}Z`);return Number.isNaN(date.valueOf())?null:date.toISOString()};
const dateOnly=value=>/^\d{4}-\d{2}-\d{2}$/.test(clean(value))?clean(value):null;
const cameraStatus=row=>integer(row.camera_broken_count)>0?"repair":"active";
const riskStatus=value=>{const text=clean(value).toLowerCase();return text.includes("хаа")||text.includes("дуус")?"closed":text.includes("арга")||text.includes("явц")?"in_progress":"open"};
const routeStatus=value=>{const text=clean(value).toLowerCase();return text.includes("батлаг")?"approved":text.includes("дуус")?"completed":text.includes("цуц")?"cancelled":"planned"};
const documentStatus=(value,type)=>{const text=clean(value).toLowerCase();if(text.includes("архив"))return"archived";if(text.includes("дуус"))return"completed";if(text.includes("төлөв"))return"planned";return type==="instruction"?"active":"completed"};
const workState=value=>{const text=clean(value).toLowerCase();if(text.includes("хааг"))return{status:"completed",stage:"completed"};if(text.includes("хабэа")&&text.includes("шалг"))return{status:"pending_review",stage:"awaiting_management_completion"};return{status:"in_progress",stage:"execution"}};

async function main(){
  const data=await read();
  if(data.format!=="overva.legacy-camera-safety.v1")throw new Error("Unsupported camera/safety import format");
  const counts={cameraObjects:0,cameraComponents:0,cameraIncidents:0,cameraSnapshots:0,cameraWorkLinked:0,workApprovals:0,workApprovalEvents:0,safetyRisks:0,safetyRoutes:0,safetyDocuments:0,safetyAcknowledgements:0,skipped:0,warnings:[]};
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const organization=(await client.query("SELECT id FROM organizations WHERE slug=$1",[slug])).rows[0];
    if(!organization)throw new Error(`Organization not found: ${slug}`);
    const org=organization.id,source=data.sourceSystem;
    const userRows=await client.query(`SELECT ep.legacy_user_id,u.id FROM employee_profiles ep JOIN users u ON u.organization_id=ep.organization_id AND u.id=ep.user_id WHERE ep.organization_id=$1`,[org]);
    const users=new Map(userRows.rows.map(row=>[Number(row.legacy_user_id),row.id]));
    const systemUser=(await client.query("SELECT id FROM users WHERE organization_id=$1 AND can_login=true ORDER BY created_at LIMIT 1",[org])).rows[0]?.id;
    if(!systemUser)throw new Error("No active pilot administrator found");
    const linked=async(table,id)=>Boolean((await client.query("SELECT 1 FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4",[org,source,table,String(id)])).rowCount);
    const provenance=(table,row,type,id,warnings=[])=>client.query(`INSERT INTO source_import_records(organization_id,source_system,source_table,source_id,target_type,target_id,source_snapshot,warnings) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT DO NOTHING`,[org,source,table,String(row.id),type,String(id),JSON.stringify(row),JSON.stringify(warnings)]);
    const assetTarget=async legacyId=>(await client.query("SELECT target_id::uuid id FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table='assets' AND source_id=$3 AND target_type='asset'",[org,source,String(legacyId)])).rows[0]?.id;
    const objectIds=new Map();

    for(const row of data.cameraAssets||[]){
      const assetId=await assetTarget(row.id);
      if(!assetId){counts.warnings.push(`Camera asset ${row.id}: master asset not found`);continue}
      const quantity=Math.max(1,integer(row.camera_count));
      await client.query(`UPDATE assets SET allocatable_quantity=GREATEST(allocatable_quantity,$3),allocation_unit='ш',updated_at=now() WHERE organization_id=$1 AND id=$2`,[org,assetId,quantity]);
      let object=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND source_system=$2 AND source_table='camera_assets' AND source_id=$3",[org,source,String(row.id)]);
      if(!object.rowCount){
        object=await client.query(`INSERT INTO operational_objects(organization_id,code,name,object_type,domain,status,location,metadata,source_system,source_table,source_id,created_at,updated_at)
          VALUES($1,$2,$3,'camera_location','camera',$4,$5,$6::jsonb,$7,'camera_assets',$8,COALESCE($9::timestamptz,now()),COALESCE($10::timestamptz,now())) RETURNING id`,
          [org,`LEGACY-CAM-${row.id}`,clean(row.name)||clean(row.location)||`Камерын цэг ${row.id}`,cameraStatus(row),clean(row.location),JSON.stringify({source,legacyId:row.id,subCategory:row.sub_category||"",cameraCount:quantity,brokenCount:Math.max(0,integer(row.camera_broken_count)),notes:row.notes||""}),source,String(row.id),timestamp(row.created_at),timestamp(row.updated_at)]);
        counts.cameraObjects++;
      }
      const objectId=object.rows[0].id;objectIds.set(Number(row.id),objectId);
      const component=await client.query(`INSERT INTO operational_object_components(organization_id,operational_object_id,asset_id,component_role,quantity,unit,metadata)
        VALUES($1,$2,$3,'camera_device_group',$4,'ш',$5::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[org,objectId,assetId,quantity,JSON.stringify({source,sourceTable:"assets",sourceId:row.id})]);
      if(component.rowCount){counts.cameraComponents++;await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail,created_at) VALUES($1,$2,NULL,'component_assigned','Хуучин системийн камерын хөрөнгийг объектод эх сурвалжтай нь холбов',$3::jsonb,COALESCE($4::timestamptz,now()))`,[org,objectId,JSON.stringify({componentId:component.rows[0].id,assetId,quantity,unit:"ш",source}),timestamp(row.created_at)])}
      const broken=Math.max(0,integer(row.camera_broken_count));
      if(broken>0){const incident=await client.query(`INSERT INTO operational_incidents(organization_id,domain,operational_object_id,incident_type,title,location,affected_quantity,status,reported_at,detail,source_system,external_id)
        VALUES($1,'camera',$2,'device_unavailable',$3,$4,$5,'open',COALESCE($6::timestamptz,now()),$7::jsonb,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,[org,objectId,`${clean(row.name)||clean(row.location)||"Камерын цэг"} — ажиллахгүй камер`,clean(row.location),broken,timestamp(row.updated_at||row.created_at),JSON.stringify({sourceTotal:quantity,sourceBroken:broken,subCategory:row.sub_category||""}),source,`camera-asset:${row.id}`]);if(incident.rowCount)counts.cameraIncidents++}
      if(!await linked("camera_assets",row.id))await provenance("camera_assets",row,"operational_object",objectId);
    }

    const cameraType=(await client.query(`SELECT wt.id,r.organization_unit_id department_id,r.workflow_policy_id FROM organization_work_types wt LEFT JOIN organization_work_type_routes r ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id WHERE wt.organization_id=$1 AND wt.code='camera-repair'`,[org])).rows[0];
    for(const row of data.cameraWork||[]){
      const target=(await client.query(`SELECT target_id::uuid id FROM source_import_records
        WHERE organization_id=$1 AND source_system IN ($2,'choibalsan-legacy-erp')
          AND source_table='asset_events' AND source_id=$3 AND target_type='work_order'
        ORDER BY CASE WHEN source_system=$2 THEN 0 ELSE 1 END LIMIT 1`,[org,source,String(row.id)])).rows[0];
      if(!target){counts.warnings.push(`Camera work ${row.id}: imported work order not found`);continue}
      const objectId=objectIds.get(Number(row.asset_id))||(await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND source_system=$2 AND source_table='camera_assets' AND source_id=$3",[org,source,String(row.asset_id)])).rows[0]?.id||null;
      const current=(await client.query("SELECT status,workflow_stage FROM work_orders WHERE organization_id=$1 AND id=$2",[org,target.id])).rows[0],next=workState(row.status);
      await client.query(`UPDATE work_orders SET operational_object_id=$3,work_type_id=$4,department_id=$5,workflow_policy_id=$6,category='camera.repair',status=$7,workflow_stage=$8,updated_at=now() WHERE organization_id=$1 AND id=$2`,[org,target.id,objectId,cameraType?.id||null,cameraType?.department_id||null,cameraType?.workflow_policy_id||null,next.status,next.stage]);
      if(current&&(current.status!==next.status||current.workflow_stage!==next.stage)){
        const reconciled=await client.query("SELECT 1 FROM work_order_events WHERE organization_id=$1 AND work_order_id=$2 AND detail->>'sourceReconciliation'='camera-status-v1'",[org,target.id]);
        if(!reconciled.rowCount)await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,note,detail,created_at) VALUES($1,$2,NULL,'status_changed',$3,$4,'Хуучин системийн төлөвийг эх сурвалжаас зөв сэргээв',$5::jsonb,COALESCE($6::timestamptz,now()))`,[org,target.id,current.status,next.status,JSON.stringify({sourceReconciliation:"camera-status-v1",source,sourceId:row.id,legacyStatus:row.status,fromWorkflowStage:current.workflow_stage,toWorkflowStage:next.stage}),timestamp(row.updated_at)]);
      }
      counts.cameraWorkLinked++;
      const approvalEvidence=[
        {table:"asset_event_hse_pre",when:row.habea_pre_at,actor:row.habea_pre_by,stage:"awaiting_safety_start",action:"safety_authorize_start",note:clean(row.habea_pre_note),detail:{risks:clean(row.habea_pre_risks),measures:clean(row.habea_pre_measures),legacyStatus:row.habea_pre_status}},
        {table:"asset_event_submission",when:row.submitted_at,actor:row.submitted_by,stage:"execution",action:"submit_completion",note:clean(row.submit_note),detail:{}},
        {table:"asset_event_hse_post",when:row.habea_post_at,actor:row.habea_post_by,stage:"awaiting_safety_completion",action:"safety_accept_completion",note:clean(row.habea_post_note),detail:{legacyStatus:row.habea_post_status}},
        {table:"asset_event_engineer_final",when:row.confirmed_at,actor:row.confirmed_by,stage:"awaiting_management_completion",action:"management_close",note:clean(row.confirm_note),detail:{legacyStatus:row.confirm_status}}
      ];
      for(const evidence of approvalEvidence){
        if(!timestamp(evidence.when))continue;
        const actor=users.get(integer(evidence.actor));
        if(!actor){counts.warnings.push(`${evidence.table} ${row.id}: approving employee not found`);continue}
        const imported=await client.query("SELECT target_id FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4",[org,source,evidence.table,String(row.id)]);
        let approvalId=imported.rows[0]?.target_id;
        if(!approvalId){
          const approval=(await client.query(`INSERT INTO work_order_approvals(organization_id,work_order_id,workflow_stage,action_code,decision,actor_user_id,note,detail,created_at) VALUES($1,$2,$3,$4,'approved',$5,$6,$7::jsonb,$8) RETURNING id`,[org,target.id,evidence.stage,evidence.action,actor,evidence.note,JSON.stringify({source,sourceTable:"asset_events",sourceId:row.id,...evidence.detail}),timestamp(evidence.when)])).rows[0];
          approvalId=String(approval.id);
          await provenance(evidence.table,{id:row.id,workId:row.id,occurredAt:evidence.when,actorLegacyId:evidence.actor,note:evidence.note,...evidence.detail},"work_order_approval",approvalId,["Legacy signature code intentionally excluded"]);
          counts.workApprovals++;
        }
        const eventExists=await client.query("SELECT 1 FROM work_order_events WHERE organization_id=$1 AND work_order_id=$2 AND detail->>'legacyApprovalId'=$3",[org,target.id,approvalId]);
        if(!eventExists.rowCount){await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,note,detail,created_at) VALUES($1,$2,$3,'workflow_action',$4,$5::jsonb,$6)`,[org,target.id,actor,evidence.note,JSON.stringify({action:evidence.action,legacyApprovalId:approvalId,source,sourceTable:"asset_events",sourceId:row.id,...evidence.detail}),timestamp(evidence.when)]);counts.workApprovalEvents++}
      }
    }

    for(const row of data.cameraSnapshots||[]){if(await linked("camera_daily_status",row.id)){counts.skipped++;continue}const inserted=await client.query(`INSERT INTO operational_domain_snapshots(organization_id,domain,snapshot_date,metrics,source_system,source_table,source_id,created_at) VALUES($1,'camera',$2,$3::jsonb,$4,'camera_daily_status',$5,COALESCE($6::timestamptz,now())) RETURNING id`,[org,dateOnly(row.snapshot_date),JSON.stringify({totalPoints:integer(row.total_points),totalCameras:integer(row.total_cameras),brokenCameras:integer(row.broken_cameras),openWork:integer(row.open_work_count),availabilityPct:Number(row.availability_pct)||0,calculationBasis:row.calc_basis||"",source:row.source||""}),source,String(row.id),timestamp(row.created_at)]);await provenance("camera_daily_status",row,"operational_domain_snapshot",inserted.rows[0].id);counts.cameraSnapshots++}

    for(const row of data.safetyReports||[]){if(await linked("safety_reports",row.id)){counts.skipped++;continue}const likelihood=Math.min(5,Math.max(1,integer(row.probability)||1)),severity=Math.min(5,Math.max(1,integer(row.consequence_score)||1));const inserted=await client.query(`INSERT INTO safety_risks(organization_id,reference_no,title,category,location,description,existing_controls,corrective_action,likelihood,severity,status,reported_by,responsible_user_id,due_date,closed_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $11='closed' THEN COALESCE($15::timestamptz,$16::timestamptz,now()) END,COALESCE($16::timestamptz,now()),COALESCE($15::timestamptz,$16::timestamptz,now())) RETURNING id`,[org,`LEG-RSK-${row.id}`,clean(row.title)||`ХАБЭА эрсдэл ${row.id}`,clean(row.risk_type)||clean(row.risk_level)||"Бусад",clean(row.location),clean(row.risk_description)||clean(row.risk_condition)||"Хуучин системийн эрсдэлийн бүртгэл",clean(row.pre_work_note)||clean(row.ppe_checklist),clean(row.action_plan)||clean(row.action_note)||clean(row.action_taken),likelihood,severity,riskStatus(row.workflow_status||row.status),users.get(integer(row.created_by))||systemUser,users.get(integer(row.assigned_to))||null,dateOnly(row.deadline),timestamp(row.updated_at||row.acknowledged_at),timestamp(row.created_at||row.report_date)]);await provenance("safety_reports",row,"safety_risk",inserted.rows[0].id,["GPS and file paths intentionally excluded"]);counts.safetyRisks++}

    for(const row of data.safetyRoutes||[]){if(await linked("safety_route_plans",row.id)){counts.skipped++;continue}const inserted=await client.query(`INSERT INTO safety_route_plans(organization_id,route_date,title,route_type,start_point,end_point,vehicle,driver,workers,risk_points,control_note,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz,now()),COALESCE($15::timestamptz,$14::timestamptz,now())) RETURNING id`,[org,dateOnly(row.route_date),clean(row.title)||`Маршрут ${row.id}`,clean(row.route_type),clean(row.start_point),clean(row.end_point),clean(row.vehicle),clean(row.driver),clean(row.workers),clean(row.risk_points),clean(row.control_note),routeStatus(row.status),users.get(integer(row.created_by))||systemUser,timestamp(row.created_at),timestamp(row.updated_at)]);await provenance("safety_route_plans",row,"safety_route_plan",inserted.rows[0].id);counts.safetyRoutes++}

    const documents=new Map();
    for(const [type,table,rows] of [["instruction","safety_instructions",data.safetyInstructions||[]],["training","safety_trainings",data.safetyTrainings||[]]])for(const row of rows){let target=(await client.query("SELECT target_id::uuid id FROM source_import_records WHERE organization_id=$1 AND source_system=$2 AND source_table=$3 AND source_id=$4",[org,source,table,String(row.id)])).rows[0];if(!target){const effective=dateOnly(type==="instruction"?row.instruction_date:row.training_date)||new Date().toISOString().slice(0,10);target=(await client.query(`INSERT INTO safety_documents(organization_id,document_type,title,content,effective_date,audience,facilitator,participant_count,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()),COALESCE($12::timestamptz,$11::timestamptz,now())) RETURNING id`,[org,type,clean(row.title)||`${type} ${row.id}`,clean(type==="instruction"?row.body:row.topic),effective,clean(type==="instruction"?row.target_scope:row.audience),clean(row.trainer),Math.max(0,integer(row.participant_count)),documentStatus(row.status,type),users.get(integer(row.created_by))||systemUser,timestamp(row.created_at),timestamp(row.updated_at)])).rows[0];await provenance(table,row,"safety_document",target.id,["Legacy file path intentionally excluded"]);counts.safetyDocuments++}documents.set(`${table}:${row.id}`,target.id)}

    for(const [table,documentTable,rows,key] of [["safety_instruction_ack","safety_instructions",data.safetyInstructionAcks||[],"instruction_id"],["safety_training_ack","safety_trainings",data.safetyTrainingAcks||[],"training_id"]])for(const row of rows){if(await linked(table,row.id)){counts.skipped++;continue}const documentId=documents.get(`${documentTable}:${row[key]}`),userId=users.get(integer(row.user_id));if(!documentId||!userId){counts.warnings.push(`${table} ${row.id}: document or employee not found`);continue}const inserted=await client.query(`INSERT INTO safety_acknowledgements(organization_id,safety_document_id,user_id,acknowledged_at,note,source_system,source_table,source_id) VALUES($1,$2,$3,COALESCE($4::timestamptz,now()),$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,[org,documentId,userId,timestamp(row.acknowledged_at||row.created_at),clean(row.note),source,table,String(row.id)]);if(inserted.rowCount){await provenance(table,row,"safety_acknowledgement",inserted.rows[0].id,["Legacy signature code intentionally excluded"]);counts.safetyAcknowledgements++}}

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail) VALUES($1,NULL,'legacy.connected_operations.import','organization',$3,$2::jsonb)`,[org,JSON.stringify({source,counts,dryRun}),String(org)]);
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");
    console.log(JSON.stringify({dryRun,organization:slug,counts},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

main().catch(error=>{console.error(error);process.exitCode=1});
