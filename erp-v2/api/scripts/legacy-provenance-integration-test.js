"use strict";

if(process.env.RUN_LEGACY_PROVENANCE_INTEGRATION!=="1")module.exports={};
else{
  require("dotenv").config({path:require("node:path").resolve(__dirname,"..","..",".env"),quiet:true});
  const assert=require("node:assert/strict");
  const {randomUUID,createHash}=require("node:crypto");
  const {getPool,closePool,withTenantTransaction}=require("../src/db");
  const {registerProvenanceRecord,reviewProvenanceRecord}=require("../src/services/legacy-provenance");
  const hash=value=>createHash("sha256").update(String(value)).digest("hex");

  async function fixture(pool,suffix){
    const client=await pool.connect();try{await client.query("BEGIN");
      const orgA=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Legacy A ${suffix}`,`legacy-a-${suffix}`])).rows[0].id;
      const orgB=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Legacy B ${suffix}`,`legacy-b-${suffix}`])).rows[0].id;
      const user=async(org,name)=>(await client.query("INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test',$4,'director') RETURNING id,organization_id",[org,`${name}-${suffix}@test.invalid`,`${name}-${suffix}`,name])).rows[0];
      const userA=await user(orgA,"reviewer-a"),userB=await user(orgB,"reviewer-b");
      const department=(await client.query("INSERT INTO departments(organization_id,code,name) VALUES($1,'OPS','Operations') RETURNING id",[orgA])).rows[0].id;
      const job=(await client.query("INSERT INTO jobs(organization_id,code,name) VALUES($1,'ENG','Engineer') RETURNING id",[orgA])).rows[0].id;
      const position=(await client.query("INSERT INTO positions(organization_id,department_id,job_id,code,title) VALUES($1,$2,$3,'ENG','Engineer') RETURNING id",[orgA,department,job])).rows[0].id;
      const employee=(await client.query("INSERT INTO employees(id,organization_id,full_name,department_id,position_id,active) VALUES($4,$1,'Existing Employee',$2,$3,true) RETURNING id",[orgA,department,position,userA.id])).rows[0].id;
      await client.query("UPDATE users SET employee_id=$3 WHERE organization_id=$1 AND id=$2",[orgA,userA.id,employee]);
      await client.query("INSERT INTO employee_profiles(organization_id,user_id,employee_id,legacy_user_id,status_hr) VALUES($1,$2,$2,21,'Active')",[orgA,employee]);
      await client.query("COMMIT");return {orgA,orgB,userA,userB,employee};
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}
  const request=user=>({user:{id:user.id,organization_id:user.organization_id},ip:"127.0.0.1"});
  const source=(id,payload="alpha",classification="REVIEW_REQUIRED",target=null)=>({legacySource:"integration",legacyTable:"legacy_rows",legacyId:String(id),legacyStatus:"legacy_closed",sourceSha256:hash(`source-${payload}`),payloadHash:hash(`payload-${payload}`),sourceSummary:{title:payload},suggestedClassification:classification,classification,targetType:target?.type,targetId:target?.id,duplicateSignals:classification==="REVIEW_REQUIRED"?["TEST_CONFLICT"]:[],conflictReason:"integration evidence"});

  async function main(){
    const pool=getPool(),database=(await pool.query("SELECT current_database() name")).rows[0].name;
    if(!/^overva_test_legacy_provenance_/i.test(database))throw new Error("Disposable overva_test_legacy_provenance_* database required");
    const f=await fixture(pool,randomUUID().slice(0,8)),before=await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows");
    const match=await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:source("employee-21","existing","MATCH_EXISTING",{type:"employee",id:f.employee})});
    assert.equal(match.item.classification,"MATCH_EXISTING");assert.equal(match.item.target_id,f.employee);
    const first=await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:source("review-1")});
    const replay=await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:source("review-1")});assert.equal(replay.replayed,true);
    await assert.rejects(registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:source("review-1","changed")}),e=>e.code==="LEGACY_PAYLOAD_CONFLICT"&&e.status===409);
    await withTenantTransaction(f.orgA,client=>assert.rejects(client.query(`INSERT INTO legacy_provenance_records(organization_id,legacy_source,legacy_table,legacy_id,source_sha256,payload_hash,suggested_classification,classification,created_by) VALUES($1,'integration','legacy_rows','review-1',$2,$3,'REVIEW_REQUIRED','REVIEW_REQUIRED',$4)`,[f.orgA,hash("duplicate"),hash("duplicate"),f.userA.id]),e=>e.code==="23505"));
    const invisible=await withTenantTransaction(f.orgB,client=>client.query("SELECT * FROM legacy_provenance_records WHERE organization_id=$1 AND id=$2",[f.orgB,first.item.id]));assert.equal(invisible.rowCount,0);
    await assert.rejects(reviewProvenanceRecord({req:request(f.userB),provenanceId:first.item.id,expectedVersion:0,idempotencyKey:randomUUID(),classification:"LEGACY_ONLY",reviewStatus:"APPROVED",reason:"wrong tenant"}),e=>e.status===404);
    await assert.rejects(reviewProvenanceRecord({req:request(f.userA),provenanceId:first.item.id,expectedVersion:0,idempotencyKey:randomUUID(),classification:"MATCH_EXISTING",reviewStatus:"APPROVED",targetType:"employee",targetId:randomUUID(),reason:"unknown target"}),e=>e.status===404);
    const key=randomUUID(),decision={req:request(f.userA),provenanceId:first.item.id,expectedVersion:0,idempotencyKey:key,classification:"LEGACY_ONLY",reviewStatus:"APPROVED",reason:"human confirmed",notes:"retain provenance only"};
    const reviewed=await reviewProvenanceRecord(decision);assert.equal(reviewed.item.version,"1");
    const decisionReplay=await reviewProvenanceRecord(decision);assert.equal(decisionReplay.replayed,true);
    await assert.rejects(reviewProvenanceRecord({...decision,notes:"different payload"}),e=>e.code==="LEGACY_IDEMPOTENCY_CONFLICT");
    const concurrent=await Promise.allSettled(["a","b"].map(reason=>reviewProvenanceRecord({...decision,expectedVersion:1,idempotencyKey:randomUUID(),classification:"REVIEW_REQUIRED",reviewStatus:"PENDING",reason})));
    assert.equal(concurrent.filter(x=>x.status==="fulfilled").length,1);assert.equal(concurrent.filter(x=>x.status==="rejected"&&x.reason.code==="LEGACY_VERSION_CONFLICT").length,1);
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_provenance_records SET classification='IMPORT_NEW',version=version+1 WHERE organization_id=$1 AND id=$2",[f.orgA,first.item.id])));
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_provenance_decisions SET notes='tampered' WHERE organization_id=$1 AND provenance_id=$2",[f.orgA,first.item.id])));
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("DELETE FROM legacy_provenance_decisions WHERE organization_id=$1 AND provenance_id=$2",[f.orgA,first.item.id])));
    const audit=await withTenantTransaction(f.orgA,async client=>(await client.query("SELECT id FROM audit_logs WHERE organization_id=$1 AND entity_type='legacy_provenance_record' LIMIT 1",[f.orgA])).rows[0]);assert.ok(audit);
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE audit_logs SET detail='{}' WHERE organization_id=$1 AND id=$2",[f.orgA,audit.id])));
    const after=await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows");
    assert.deepEqual(after.rows[0],before.rows[0],"provenance/review must create no employee or workflow history");
    const rls=(await pool.query("SELECT count(*)::int count FROM pg_class WHERE relname=ANY($1) AND relrowsecurity",[["legacy_provenance_records","legacy_provenance_decisions"]])).rows[0].count;assert.equal(rls,2);
    console.log("Legacy provenance integration passed: source-key idempotency, duplicate rejection, tenant isolation, target validation, version concurrency, append-only decisions/audit, and no employee/workflow creation.");
    await closePool();
  }
  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
