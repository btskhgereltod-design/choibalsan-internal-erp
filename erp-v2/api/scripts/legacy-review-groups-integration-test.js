"use strict";

if(process.env.RUN_LEGACY_REVIEW_GROUPS_INTEGRATION!=="1")module.exports={};
else{
  require("dotenv").config({path:require("node:path").resolve(__dirname,"..","..",".env"),quiet:true});
  const assert=require("node:assert/strict");
  const {randomUUID,createHash}=require("node:crypto");
  const {getPool,closePool,withTenantTransaction}=require("../src/db");
  const {registerProvenanceRecord}=require("../src/services/legacy-provenance");
  const {registerReviewGroup,batchReviewGroups}=require("../src/services/legacy-review-groups");
  const hash=value=>createHash("sha256").update(String(value)).digest("hex");
  const request=user=>({user:{id:user.id,organization_id:user.organization_id},ip:"127.0.0.1"});

  async function fixture(pool,suffix){
    const client=await pool.connect();try{await client.query("BEGIN");
      const orgA=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Group A ${suffix}`,`group-a-${suffix}`])).rows[0].id;
      const orgB=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Group B ${suffix}`,`group-b-${suffix}`])).rows[0].id;
      const user=async(org,name)=>(await client.query("INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test',$4,'director') RETURNING id,organization_id",[org,`${name}-${suffix}@test.invalid`,`${name}-${suffix}`,name])).rows[0];
      const userA=await user(orgA,"group-reviewer-a"),userB=await user(orgB,"group-reviewer-b");
      await client.query("COMMIT");return {orgA,orgB,userA,userB};
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  }
  function evidence(id){return {legacySource:"group-integration",legacyTable:"legacy_rows",legacyId:id,legacyStatus:"old",sourceSha256:hash(`source-${id}`),payloadHash:hash(`payload-${id}`),sourceSummary:{id},suggestedClassification:"REVIEW_REQUIRED",classification:"REVIEW_REQUIRED",duplicateSignals:[],conflictReason:"group fixture"}}
  function group(category,key,recommendation,members,external=false){
    const value={category,groupKey:key,deterministicVersion:"integration-v1",sourceSummary:{key},signals:external?["PRODUCTION_RECONCILIATION_MISSING"]:[],recommendation,recommendationReason:external?"Production comparison required":"Deterministic integration recommendation",confidence:external?"LOW":"HIGH",requiresExternalEvidence:external,externalEvidenceStatus:external?"MISSING":"NOT_REQUIRED",members:members.map((item,index)=>({provenanceId:item.item.id,memberRole:index?"SUPERSEDED_CANDIDATE":"PRIMARY_CANDIDATE",recommendedClassification:recommendation==="IMPORT_NEW"?"IMPORT_NEW":"REVIEW_REQUIRED",recommendationReason:"fixture",sourceOrder:index,sourceSummary:{index}}))};
    value.groupHash=hash(JSON.stringify(value));return value;
  }

  async function main(){
    const pool=getPool(),database=(await pool.query("SELECT current_database() name")).rows[0].name;
    if(!/^overva_test_legacy_review_groups_/i.test(database))throw new Error("Disposable overva_test_legacy_review_groups_* database required");
    const f=await fixture(pool,randomUUID().slice(0,8)),before=await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows,(SELECT count(*)::int FROM documents) documents");
    const safeRows=[];for(const id of ["safe-1","safe-2"])safeRows.push(await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:evidence(id)}));
    const attendanceRows=[];for(const id of ["attendance-1","attendance-2"])attendanceRows.push(await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:evidence(id)}));
    const manualRow=await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:evidence("manual-1")});
    const safeGroup=await registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:group("ORDER_DECISION","safe-order","IMPORT_NEW",safeRows)});
    const safeReplay=await registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:group("ORDER_DECISION","safe-order","IMPORT_NEW",safeRows)});assert.equal(safeReplay.replayed,true);
    await assert.rejects(registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:{...group("ORDER_DECISION","safe-order","IMPORT_NEW",safeRows),groupHash:hash("changed")}}),error=>error.code==="LEGACY_REVIEW_GROUP_CONFLICT");
    const attendanceGroup=await registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:group("ATTENDANCE","21|2026-01-01","RECONCILE_REQUIRED",attendanceRows,true)});
    const manualGroup=await registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:group("DOCUMENT_ATTACHMENT","hash:fixture","MANUAL_REVIEW",[manualRow])});
    const invisible=await withTenantTransaction(f.orgB,client=>client.query("SELECT * FROM legacy_review_groups WHERE organization_id=$1 AND id=$2",[f.orgB,safeGroup.item.id]));assert.equal(invisible.rowCount,0);
    await assert.rejects(batchReviewGroups({req:request(f.userB),idempotencyKey:randomUUID(),action:"APPROVE_RECOMMENDATION",selections:[{groupId:safeGroup.item.id,expectedVersion:0}],note:"wrong tenant"}),error=>error.status===404);
    await assert.rejects(batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"APPROVE_RECOMMENDATION",selections:[{groupId:attendanceGroup.item.id,expectedVersion:0}],note:"must remain blocked"}),error=>error.code==="LEGACY_EXTERNAL_EVIDENCE_REQUIRED");
    await assert.rejects(batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"MARK_LEGACY_ONLY",selections:[{groupId:attendanceGroup.item.id,expectedVersion:0}],note:"must remain blocked"}),error=>['LEGACY_EXTERNAL_EVIDENCE_REQUIRED','LEGACY_ATTENDANCE_FINAL_DECISION_BLOCKED'].includes(error.code));
    const approvalKey=randomUUID(),approval={req:request(f.userA),idempotencyKey:approvalKey,action:"APPROVE_RECOMMENDATION",selections:[{groupId:safeGroup.item.id,expectedVersion:0}],note:"reviewed safe evidence"};
    const simultaneous=await Promise.all([batchReviewGroups(approval),batchReviewGroups(approval)]);
    assert.deepEqual(simultaneous.map(item=>item.replayed).sort(),[false,true]);
    const approved=simultaneous.find(item=>!item.replayed);assert.equal(approved.batch.affected_record_count,2);
    const approvalReplay=await batchReviewGroups(approval);assert.equal(approvalReplay.replayed,true);
    await assert.rejects(batchReviewGroups({...approval,note:"changed payload"}),error=>error.code==="LEGACY_IDEMPOTENCY_CONFLICT");
    const safeState=await withTenantTransaction(f.orgA,client=>client.query("SELECT classification,review_status,imported_at FROM legacy_provenance_records WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id",[f.orgA,safeRows.map(item=>item.item.id)]));
    assert.deepEqual(safeState.rows.map(row=>[row.classification,row.review_status,row.imported_at]),[["IMPORT_NEW","APPROVED",null],["IMPORT_NEW","APPROVED",null]]);
    const attendanceManual=await batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"SEND_MANUAL_REVIEW",selections:[{groupId:attendanceGroup.item.id,expectedVersion:0}],note:"await production evidence"});
    assert.equal(attendanceManual.batch.affected_record_count,0);
    const attendanceState=await withTenantTransaction(f.orgA,client=>client.query("SELECT classification,review_status,imported_at FROM legacy_provenance_records WHERE organization_id=$1 AND id=ANY($2::uuid[])",[f.orgA,attendanceRows.map(item=>item.item.id)]));
    assert.ok(attendanceState.rows.every(row=>row.classification==="REVIEW_REQUIRED"&&row.review_status==="PENDING"&&row.imported_at===null));
    const concurrency=await Promise.allSettled([
      batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"SEND_MANUAL_REVIEW",selections:[{groupId:manualGroup.item.id,expectedVersion:0}],note:"manual a"}),
      batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"MARK_LEGACY_ONLY",selections:[{groupId:manualGroup.item.id,expectedVersion:0}],note:"manual b"}),
    ]);
    assert.equal(concurrency.filter(item=>item.status==="fulfilled").length,1);assert.equal(concurrency.filter(item=>item.status==="rejected"&&["LEGACY_REVIEW_GROUP_VERSION_CONFLICT","LEGACY_REVIEW_GROUP_ALREADY_DECIDED"].includes(item.reason.code)).length,1);
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_review_group_members SET recommendation_reason='tamper' WHERE organization_id=$1 AND group_id=$2",[f.orgA,safeGroup.item.id])));
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_review_group_decisions SET notes='tamper' WHERE organization_id=$1 AND group_id=$2",[f.orgA,safeGroup.item.id])));
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("DELETE FROM legacy_review_batch_commands WHERE organization_id=$1 AND id=$2",[f.orgA,approved.batch.id])));
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_review_groups SET review_status='MANUAL_REVIEW',version=version+1 WHERE organization_id=$1 AND id=$2",[f.orgA,safeGroup.item.id])));
    const after=await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows,(SELECT count(*)::int FROM documents) documents");
    assert.deepEqual(after.rows[0],before.rows[0],"group review must create no employee, document, or workflow history");
    const rls=(await pool.query("SELECT count(*)::int count FROM pg_class WHERE relname=ANY($1) AND relrowsecurity",[["legacy_review_groups","legacy_review_group_members","legacy_review_group_decisions","legacy_review_batch_commands"]])).rows[0].count;assert.equal(rls,4);
    console.log("Legacy review-group integration passed: tenant isolation, evidence gate, group/member version guards, idempotent batch review, append-only history, concurrency, and no domain import.");
    await closePool();
  }
  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
