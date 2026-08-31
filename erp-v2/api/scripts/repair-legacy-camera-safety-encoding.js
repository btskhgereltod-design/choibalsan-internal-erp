"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

const dryRun = process.argv.includes("--dry-run");
const base64Input = process.argv.includes("--base64");
const slug = process.env.IMPORT_ORG_SLUG || "choibalsan-hugjil";
const clean = value => String(value ?? "").trim();
const integer = value => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
const cameraStatus = row => integer(row.camera_broken_count) > 0 ? "repair" : "active";
const riskStatus = value => { const text=clean(value).toLowerCase(); return text.includes("хаа")||text.includes("дуус")?"closed":text.includes("арга")||text.includes("явц")?"in_progress":"open"; };
const routeStatus = value => { const text=clean(value).toLowerCase(); return text.includes("батлаг")?"approved":text.includes("дуус")?"completed":text.includes("цуц")?"cancelled":"planned"; };
const documentStatus = (value,type) => { const text=clean(value).toLowerCase(); if(text.includes("архив"))return"archived"; if(text.includes("дуус"))return"completed"; if(text.includes("төлөв"))return"planned"; return type==="instruction"?"active":"completed"; };
const read = () => new Promise((resolve,reject) => { let body=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",chunk=>{body+=chunk}); process.stdin.on("end",()=>{try{resolve(JSON.parse(base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body))}catch(error){reject(new Error(`Invalid JSON: ${error.message}`))}}); process.stdin.on("error",reject); });

async function main(){
  const data=await read();
  if(data.format!=="overva.legacy-camera-safety.v1")throw new Error("Unsupported camera/safety repair format");
  const counts={cameraObjects:0,cameraIncidents:0,cameraSnapshots:0,approvalEvents:0,safetyRisks:0,safetyRoutes:0,safetyDocuments:0};
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const organization=(await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE",[slug])).rows[0];
    if(!organization)throw new Error(`Organization not found: ${slug}`);
    const org=organization.id,source=data.sourceSystem;

    for(const row of data.cameraAssets||[]){
      const name=clean(row.name)||clean(row.location)||`Камерын цэг ${row.id}`,quantity=Math.max(1,integer(row.camera_count)),broken=Math.max(0,integer(row.camera_broken_count));
      const metadata={source,legacyId:row.id,subCategory:row.sub_category||"",cameraCount:quantity,brokenCount:broken,notes:row.notes||"",encodingCorrectedAt:new Date().toISOString()};
      const object=await client.query(`UPDATE operational_objects SET name=$4,status=$5,location=$6,metadata=metadata||$7::jsonb,updated_at=now()
        WHERE organization_id=$1 AND source_system=$2 AND source_table='camera_assets' AND source_id=$3
          AND (name LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR metadata::text LIKE '%?%') RETURNING id`,[org,source,String(row.id),name,cameraStatus(row),clean(row.location),JSON.stringify(metadata)]);
      counts.cameraObjects+=object.rowCount;
      if(object.rowCount)await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
        VALUES($1,$2,NULL,'note','UTF-8 текстийн дамжуулалтын алдааг эх сангаас сэргээв',$3::jsonb)`,[org,object.rows[0].id,JSON.stringify({source,sourceTable:"assets",sourceId:row.id,encodingCorrection:true})]);
      const incident=await client.query(`UPDATE operational_incidents SET title=$4,location=$5,detail=detail||$6::jsonb,updated_at=now()
        WHERE organization_id=$1 AND source_system=$2 AND external_id=$3
          AND (title LIKE '%?%' OR COALESCE(location,'') LIKE '%?%' OR detail::text LIKE '%?%')`,[org,source,`camera-asset:${row.id}`,`${name} — ажиллахгүй камер`,clean(row.location),JSON.stringify({sourceTotal:quantity,sourceBroken:broken,subCategory:row.sub_category||"",encodingCorrection:true})]);
      counts.cameraIncidents+=incident.rowCount;
    }

    for(const row of data.cameraSnapshots||[]){
      const metrics={totalPoints:integer(row.total_points),totalCameras:integer(row.total_cameras),brokenCameras:integer(row.broken_cameras),openWork:integer(row.open_work_count),availabilityPct:Number(row.availability_pct)||0,calculationBasis:row.calc_basis||"",source:row.source||""};
      const result=await client.query(`UPDATE operational_domain_snapshots d SET metrics=$4::jsonb
        FROM source_import_records s WHERE d.organization_id=$1 AND s.organization_id=d.organization_id
          AND s.source_system=$2 AND s.source_table='camera_daily_status' AND s.source_id=$3
          AND s.target_type='operational_domain_snapshot' AND s.target_id=d.id::text AND d.metrics::text LIKE '%?%'`,[org,source,String(row.id),JSON.stringify(metrics)]);
      counts.cameraSnapshots+=result.rowCount;
    }

    const approvalEvidence=row=>[
      {table:"asset_event_hse_pre",action:"safety_authorize_start",note:clean(row.habea_pre_note),detail:{risks:clean(row.habea_pre_risks),measures:clean(row.habea_pre_measures),legacyStatus:row.habea_pre_status}},
      {table:"asset_event_submission",action:"submit_completion",note:clean(row.submit_note),detail:{}},
      {table:"asset_event_hse_post",action:"safety_accept_completion",note:clean(row.habea_post_note),detail:{legacyStatus:row.habea_post_status}},
      {table:"asset_event_engineer_final",action:"management_close",note:clean(row.confirm_note),detail:{legacyStatus:row.confirm_status}}
    ];
    for(const row of data.cameraWork||[])for(const evidence of approvalEvidence(row)){
      const original=await client.query(`SELECT e.id,e.work_order_id,e.actor_user_id
        FROM source_import_records s JOIN work_order_approvals a ON a.id::text=s.target_id AND a.organization_id=s.organization_id
        JOIN work_order_events e ON e.organization_id=a.organization_id AND e.work_order_id=a.work_order_id AND e.detail->>'legacyApprovalId'=a.id::text
        WHERE s.organization_id=$1 AND s.source_system=$2 AND s.source_table=$3 AND s.source_id=$4
          AND (e.note LIKE '%?%' OR e.detail::text LIKE '%?%')
          AND NOT EXISTS(SELECT 1 FROM work_order_events correction WHERE correction.organization_id=e.organization_id AND correction.detail->>'correctsEventId'=e.id::text)
        ORDER BY e.id LIMIT 1`,[org,source,evidence.table,String(row.id)]);
      if(!original.rowCount)continue;
      const event=original.rows[0],detail={action:evidence.action,source,sourceTable:"asset_events",sourceId:row.id,...evidence.detail,encodingCorrection:true,correctsEventId:String(event.id)};
      await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,note,detail)
        VALUES($1,$2,$3,'workflow_action',$4,$5::jsonb)`,[org,event.work_order_id,event.actor_user_id,evidence.note,JSON.stringify(detail)]);
      counts.approvalEvents++;
    }

    for(const row of data.safetyReports||[]){
      const result=await client.query(`UPDATE safety_risks r SET title=$4,category=$5,location=$6,description=$7,existing_controls=$8,corrective_action=$9,status=$10,updated_at=now()
        FROM source_import_records s WHERE r.organization_id=$1 AND s.organization_id=r.organization_id AND s.source_system=$2
          AND s.source_table='safety_reports' AND s.source_id=$3 AND s.target_type='safety_risk' AND s.target_id=r.id::text
          AND concat_ws('|',r.title,r.category,r.location,r.description,r.existing_controls,r.corrective_action) LIKE '%?%'`,[org,source,String(row.id),clean(row.title)||`ХАБЭА эрсдэл ${row.id}`,clean(row.risk_type)||clean(row.risk_level)||"Бусад",clean(row.location),clean(row.risk_description)||clean(row.risk_condition)||"Хуучин системийн эрсдэлийн бүртгэл",clean(row.pre_work_note)||clean(row.ppe_checklist),clean(row.action_plan)||clean(row.action_note)||clean(row.action_taken),riskStatus(row.workflow_status||row.status)]);
      counts.safetyRisks+=result.rowCount;
    }

    for(const row of data.safetyRoutes||[]){
      const result=await client.query(`UPDATE safety_route_plans r SET title=$4,route_type=$5,start_point=$6,end_point=$7,vehicle=$8,driver=$9,workers=$10,risk_points=$11,control_note=$12,status=$13,updated_at=now()
        FROM source_import_records s WHERE r.organization_id=$1 AND s.organization_id=r.organization_id AND s.source_system=$2
          AND s.source_table='safety_route_plans' AND s.source_id=$3 AND s.target_type='safety_route_plan' AND s.target_id=r.id::text
          AND concat_ws('|',r.title,r.route_type,r.start_point,r.end_point,r.vehicle,r.driver,r.workers,r.risk_points,r.control_note) LIKE '%?%'`,[org,source,String(row.id),clean(row.title)||`Маршрут ${row.id}`,clean(row.route_type),clean(row.start_point),clean(row.end_point),clean(row.vehicle),clean(row.driver),clean(row.workers),clean(row.risk_points),clean(row.control_note),routeStatus(row.status)]);
      counts.safetyRoutes+=result.rowCount;
    }

    for(const [type,table,rows] of [["instruction","safety_instructions",data.safetyInstructions||[]],["training","safety_trainings",data.safetyTrainings||[]]])for(const row of rows){
      const result=await client.query(`UPDATE safety_documents d SET title=$4,content=$5,audience=$6,facilitator=$7,participant_count=$8,status=$9,updated_at=now()
        FROM source_import_records s WHERE d.organization_id=$1 AND s.organization_id=d.organization_id AND s.source_system=$2
          AND s.source_table=$3 AND s.source_id=$10 AND s.target_type='safety_document' AND s.target_id=d.id::text
          AND concat_ws('|',d.title,d.content,d.audience,d.facilitator) LIKE '%?%'`,[org,source,table,clean(row.title)||`${type} ${row.id}`,clean(type==="instruction"?row.body:row.topic),clean(type==="instruction"?row.target_scope:row.audience),clean(row.trainer),Math.max(0,integer(row.participant_count)),documentStatus(row.status,type),String(row.id)]);
      counts.safetyDocuments+=result.rowCount;
    }

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1::uuid,NULL,'legacy_camera_safety.encoding_repair','legacy_import',($1::uuid)::text,$2::jsonb)`,[org,JSON.stringify({sourceSystem:source,dryRun,counts,rule:"repair visible text from read-only base64 UTF-8 source; preserve immutable approval and acknowledgement evidence"})]);
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");
    console.log(JSON.stringify({dryRun,organization:slug,counts},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

main().catch(error=>{console.error(error);process.exitCode=1});
