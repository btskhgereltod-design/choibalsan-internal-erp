"use strict";

require("dotenv").config();
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");

const apply=process.argv.includes("--apply");
const slug=process.env.IMPORT_ORG_SLUG||"choibalsan-hugjil";
const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",part=>body+=part);process.stdin.on("end",()=>{try{resolve(Buffer.from(body.trim(),"base64").toString("utf8"))}catch(error){reject(error)}});process.stdin.on("error",reject)});
const routeCode=row=>{
  const category=String(row.category||"").trim();
  if(category.startsWith("Камер"))return"camera-repair";
  if(category.includes("Гэрэл дохио"))return"traffic-signal-repair";
  if(category.includes("Гэрэлтүүлэг"))return"lighting-repair";
  return null;
};
const desiredState=(row,assigned,governed)=>{
  const status=String(row.status||"").trim(),pre=String(row.habea_pre_status||"").trim(),chief=String(row.confirm_status||"").trim();
  if(status==="Хаагдсан")return{status:"completed",stage:governed?"completed":null,lane:"done"};
  if(status==="ХАБЭА шалгасан")return{status:"pending_review",stage:governed?"awaiting_management_completion":null,lane:"chief_acceptance"};
  if(status==="Дууссан"&&chief!=="rejected")return{status:"pending_review",stage:governed?"awaiting_safety_completion":null,lane:governed?"safety_completion":"chief_acceptance"};
  if(status==="Хүлээгдэж байгаа"&&(!pre||chief==="rejected"))return{status:assigned?"assigned":"new",stage:null,lane:"chief_decision"};
  if(!governed)return{status:assigned?"in_progress":"new",stage:null,lane:assigned?"execution":"chief_decision"};
  return{status:assigned?"assigned":"new",stage:assigned?"awaiting_safety_start":null,lane:assigned?"safety_start":"chief_decision"};
};

(async()=>{
  if(apply&&process.env.APPLY_LEGACY_WORK_ORDER_RECONCILIATION!=="1")throw new Error("Apply requires APPLY_LEGACY_WORK_ORDER_RECONCILIATION=1");
  const raw=await read(),data=JSON.parse(raw);
  if(data.format!=="overva.legacy-lighting.v1"||data.sourceSystem!=="choibalsan-legacy-erp")throw new Error("Unsupported legacy source payload");
  if(!Array.isArray(data.work)||data.work.length!==106)throw new Error(`Expected exactly 106 legacy work rows, received ${data.work?.length}`);
  const sourceSha256=crypto.createHash("sha256").update(raw).digest("hex"),client=await getPool().connect();
  const summary={sourceRows:data.work.length,linkedRows:0,changed:0,unchanged:0,lanes:{},workTypes:{},legacyStatuses:{}};
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${slug}:legacy-work-order-flow-v2`]);
    const org=(await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE",[slug])).rows[0];
    if(!org)throw new Error(`Organization not found: ${slug}`);
    const routes=await client.query(`SELECT wt.code,wt.category,wt.id,r.organization_unit_id,r.workflow_policy_id
      FROM organization_work_types wt LEFT JOIN organization_work_type_routes r
        ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true
      WHERE wt.organization_id=$1 AND wt.code=ANY($2::text[])`,[org.id,["camera-repair","traffic-signal-repair","lighting-repair"]]);
    const byCode=new Map(routes.rows.map(row=>[row.code,row]));
    for(const row of data.work){
      const target=(await client.query(`SELECT target_id::uuid AS id FROM source_import_records
        WHERE organization_id=$1 AND source_system='choibalsan-legacy-erp' AND source_table='asset_events'
          AND source_id=$2 AND target_type='work_order'`,[org.id,String(row.id)])).rows[0];
      if(!target)throw new Error(`Legacy work ${row.id} has no canonical Work Order`);
      const current=(await client.query("SELECT * FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org.id,target.id])).rows[0];
      if(!current)throw new Error(`Canonical Work Order missing for legacy work ${row.id}`);
      summary.linkedRows++;
      const code=routeCode(row),route=code?byCode.get(code):null;
      if(code&&!route)throw new Error(`Configured Work Type missing: ${code}`);
      const desired=desiredState(row,Boolean(current.assigned_to),Boolean(route?.workflow_policy_id));
      summary.lanes[desired.lane]=(summary.lanes[desired.lane]||0)+1;
      summary.workTypes[code||"general-unrouted"]=(summary.workTypes[code||"general-unrouted"]||0)+1;
      summary.legacyStatuses[row.status]=(summary.legacyStatuses[row.status]||0)+1;
      const category=code?route.category:String(row.category||"Бусад").trim()||"Бусад";
      const changed=current.status!==desired.status||(current.workflow_stage||null)!==desired.stage||
        (current.work_type_id||null)!==(route?.id||null)||(current.department_id||null)!==(route?.organization_unit_id||null)||
        (current.workflow_policy_id||null)!==(route?.workflow_policy_id||null)||current.category!==category;
      if(!changed){summary.unchanged++;continue}
      const already=await client.query("SELECT 1 FROM work_order_events WHERE organization_id=$1 AND work_order_id=$2 AND detail->>'sourceReconciliation'='legacy-workflow-v2'",[org.id,current.id]);
      if(already.rowCount)throw new Error(`Legacy work ${row.id} was already corrected but current projection diverged`);
      await client.query(`UPDATE work_orders SET work_type_id=$1,department_id=$2,workflow_policy_id=$3,workflow_stage=$4,
        category=$5,status=$6,updated_at=now() WHERE organization_id=$7 AND id=$8`,[route?.id||null,route?.organization_unit_id||null,
        route?.workflow_policy_id||null,desired.stage,category,desired.status,org.id,current.id]);
      await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,note,detail)
        VALUES($1,$2,NULL,'status_changed',$3,$4,$5,$6::jsonb)`,[org.id,current.id,current.status,desired.status,
        "Хуучин ERP-ийн эх төлөв, ангиллаар ажлын урсгалыг засав",JSON.stringify({sourceReconciliation:"legacy-workflow-v2",
          sourceSystem:data.sourceSystem,sourceTable:"asset_events",sourceId:String(row.id),sourceSha256,legacyStatus:row.status,
          legacyCategory:row.category||"",legacyDepartment:row.department||"",fromWorkflowStage:current.workflow_stage,
          toWorkflowStage:desired.stage,workTypeCode:code,lane:desired.lane,approvals:{pre:row.habea_pre_status||"",post:row.habea_post_status||"",chief:row.confirm_status||""}})]);
      summary.changed++;
    }
    if(summary.linkedRows!==106)throw new Error(`Expected 106 canonical links, found ${summary.linkedRows}`);
    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1,NULL,'legacy.work_order_flow.reconcile','organization',$2,$3::jsonb)`,[org.id,String(org.id),JSON.stringify({apply,sourceSha256,summary})]);
    if(apply)await client.query("COMMIT");else await client.query("ROLLBACK");
    console.log(JSON.stringify({apply,organization:slug,sourceSha256,summary},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
})().catch(error=>{console.error(error);process.exitCode=1});
