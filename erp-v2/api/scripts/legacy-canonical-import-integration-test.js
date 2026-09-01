"use strict";

if(process.env.RUN_LEGACY_CANONICAL_IMPORT_INTEGRATION!=="1")module.exports={};
else{
  require("dotenv").config({path:require("node:path").resolve(__dirname,"..","..",".env"),quiet:true});
  const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool,withTenantTransaction}=require("../src/db");
  const {registerProvenanceRecord,sha256,sha256Bytes}=require("../src/services/legacy-provenance");
  const {registerReviewGroup,batchReviewGroups}=require("../src/services/legacy-review-groups");
  const {sourceEvidence,planLegacyCanonicalImport,commitLegacyCanonicalImport}=require("../src/services/legacy-canonical-import");
  const request=user=>({user:{...user,permissions:["legacy_migration.import","legacy_migration.review","legacy_migration.read"]},ip:"127.0.0.1"});

  async function fixture(pool,suffix){const client=await pool.connect();try{await client.query("BEGIN");
    const orgA=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Import A ${suffix}`,`import-a-${suffix}`])).rows[0].id;
    const orgB=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Import B ${suffix}`,`import-b-${suffix}`])).rows[0].id;
    const userA=(await client.query("INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test','Importer','director') RETURNING id,organization_id",[orgA,`importer-${suffix}@test.invalid`,`importer-${suffix}`])).rows[0];
    const userB=(await client.query("INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test','Other','director') RETURNING id,organization_id",[orgB,`other-${suffix}@test.invalid`,`other-${suffix}`])).rows[0];
    const employee=(await client.query("INSERT INTO employees(id,organization_id,full_name,active) VALUES($2,$1,'Importer',true) RETURNING id",[orgA,userA.id])).rows[0].id;
    await client.query("UPDATE users SET employee_id=$3 WHERE organization_id=$1 AND id=$2",[orgA,userA.id,employee]);
    await client.query("INSERT INTO employee_profiles(organization_id,user_id,employee_id,legacy_user_id,status_hr) VALUES($1,$2,$2,21,'Active')",[orgA,userA.id]);
    await client.query("COMMIT");return {orgA,orgB,userA,userB,employee};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}

  function source(){const rows=new Map(),files=new Map();return {rows,files,databaseHash:"a".repeat(64),async databaseSha256(){return this.databaseHash},async readRecord(table,id){return rows.get(`${table}:${id}`)||null},async listAttachments(type,id){return files.get(`${type}:${id}`)||[]}}}
  async function stage({f,sourceObject,category,row,attachment}){
    const table=category==="ORDER_DECISION"?"orders_decisions":"correspondence",parentEvidence=sourceEvidence(table,row);
    const parent=await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:{legacySource:"integration-source",legacyTable:table,legacyId:String(row.id),legacyStatus:row.status,sourceSha256:parentEvidence.sourceSha256,payloadHash:parentEvidence.payloadHash,sourceSummary:{documentNo:row.doc_no},suggestedClassification:"REVIEW_REQUIRED",classification:"REVIEW_REQUIRED",duplicateSignals:[]}});
    const fileSha=sha256Bytes(attachment.buffer),attachmentEvidence=sourceEvidence("doc_attachments",attachment.row,fileSha);
    await registerProvenanceRecord({organizationId:f.orgA,actorUserId:f.userA.id,record:{legacySource:"integration-source",legacyTable:"doc_attachments",legacyId:String(attachment.row.id),legacyStatus:null,sourceSha256:attachmentEvidence.sourceSha256,payloadHash:attachmentEvidence.payloadHash,sourceSummary:{fileName:attachment.row.file_name},suggestedClassification:"IMPORT_NEW",classification:"IMPORT_NEW",duplicateSignals:[]}});
    sourceObject.rows.set(`${table}:${row.id}`,row);sourceObject.files.set(`${category==="ORDER_DECISION"?"order":"letter"}:${row.id}`,[attachment]);
    const value={category,groupKey:`${table}:${row.id}`,deterministicVersion:"integration-v1",sourceSummary:{documentNumber:row.doc_no},signals:category==="CORRESPONDENCE"?["NOT_CLASSIFIED_AS_COMPLAINT"]:[],recommendation:"IMPORT_NEW",recommendationReason:"Unique fixture with attachment and stable employee link",confidence:"HIGH",requiresExternalEvidence:false,externalEvidenceStatus:"NOT_REQUIRED",members:[{provenanceId:parent.item.id,memberRole:"PRIMARY_CANDIDATE",recommendedClassification:"IMPORT_NEW",recommendationReason:"fixture",sourceOrder:0,sourceSummary:{legacyId:row.id}}]};value.groupHash=sha256(value);
    const group=await registerReviewGroup({organizationId:f.orgA,actorUserId:f.userA.id,group:value});
    await batchReviewGroups({req:request(f.userA),idempotencyKey:randomUUID(),action:"APPROVE_RECOMMENDATION",selections:[{groupId:group.item.id,expectedVersion:0}],note:"integration approval"});return group;
  }

  async function main(){
    const pool=getPool(),database=(await pool.query("SELECT current_database() name")).rows[0].name;if(!/^overva_test_legacy_canonical_import_/i.test(database))throw new Error("Disposable overva_test_legacy_canonical_import_* database required");
    const f=await fixture(pool,randomUUID().slice(0,8)),legacy=source(),directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),"overva-legacy-import-"));
    const order={id:1,doc_no:"ORD-TEST-1",title:"Approved order",doc_type:"Тушаал",doc_date:"2026-01-02",related_user:21,status:"approved"},orderAttachment={row:{id:101,entity_type:"order",entity_id:1,file_name:"order.pdf",file_url:"order.pdf"},buffer:Buffer.from("order-file")};
    const letter={id:2,doc_no:"IN-TEST-2",doc_type:"Ирсэн",doc_date:"2026-01-03",source_org:"Citizen",subject:"Official request",assigned_to:21,status:"closed"},letterAttachment={row:{id:102,entity_type:"letter",entity_id:2,file_name:"letter.pdf",file_url:"letter.pdf"},buffer:Buffer.from("letter-file")};
    await stage({f,sourceObject:legacy,category:"ORDER_DECISION",row:order,attachment:orderAttachment});await stage({f,sourceObject:legacy,category:"CORRESPONDENCE",row:letter,attachment:letterAttachment});
    const before=(await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows,(SELECT count(*)::int FROM correspondence_events) correspondence_events")).rows[0];
    const originalOrderBytes=orderAttachment.buffer;orderAttachment.buffer=Buffer.from("order-filf");
    const changedFile=await planLegacyCanonicalImport({req:request(f.userA),source:legacy});assert.equal(changedFile.create.documents,1);assert.equal(changedFile.conflicts.length,1);assert.equal(changedFile.conflicts[0].code,"ATTACHMENT_PROVENANCE_CONFLICT");
    orderAttachment.buffer=originalOrderBytes;
    const dry=await planLegacyCanonicalImport({req:request(f.userA),source:legacy});assert.equal(dry.noWrites,true);assert.deepEqual(dry.create,{documents:2,documentVersions:2,correspondence:1});assert.equal(dry.conflicts.length,0);
    const stillEmpty=await withTenantTransaction(f.orgA,async client=>(await client.query("SELECT count(*)::int count FROM documents WHERE organization_id=$1",[f.orgA])).rows[0].count);assert.equal(stillEmpty,0);
    const other=await planLegacyCanonicalImport({req:request(f.userB),source:legacy});assert.equal(other.create.documents,0,"tenant B cannot see tenant A approvals");
    await assert.rejects(planLegacyCanonicalImport({req:{user:{...f.userA,permissions:[]}},source:legacy}),error=>error.status===403);
    process.env.ALLOW_LEGACY_CANONICAL_IMPORT="true";const key=randomUUID(),committed=await commitLegacyCanonicalImport({req:request(f.userA),source:legacy,idempotencyKey:key,allowCommit:true,uploadDirectory:directory});assert.equal(committed.create.documents,2);assert.equal(committed.create.correspondence,1);
    const counts=await withTenantTransaction(f.orgA,async client=>(await client.query(`SELECT (SELECT count(*)::int FROM documents WHERE organization_id=$1) documents,(SELECT count(*)::int FROM document_versions WHERE organization_id=$1) versions,(SELECT count(*)::int FROM correspondence_records WHERE organization_id=$1) correspondence,(SELECT count(*)::int FROM correspondence_events WHERE organization_id=$1) correspondence_events,(SELECT count(*)::int FROM workflow_cases WHERE organization_id=$1) workflows,(SELECT count(*)::int FROM legacy_canonical_import_mappings WHERE organization_id=$1) mappings,(SELECT count(*)::int FROM legacy_canonical_import_events WHERE organization_id=$1) import_events,(SELECT count(*)::int FROM legacy_provenance_records WHERE organization_id=$1 AND imported_at IS NOT NULL) imported`,[f.orgA])).rows[0]);
    assert.deepEqual(counts,{documents:2,versions:2,correspondence:1,correspondence_events:0,workflows:0,mappings:5,import_events:4,imported:4});
    const after=(await pool.query("SELECT (SELECT count(*)::int FROM employees) employees,(SELECT count(*)::int FROM workflow_cases) workflows,(SELECT count(*)::int FROM correspondence_events) correspondence_events")).rows[0];assert.deepEqual(after,before,"master and workflow history stay unchanged");
    const replay=await commitLegacyCanonicalImport({req:request(f.userA),source:legacy,idempotencyKey:key,allowCommit:true,uploadDirectory:directory});assert.equal(replay.replayed,true);
    legacy.databaseHash="b".repeat(64);await assert.rejects(commitLegacyCanonicalImport({req:request(f.userA),source:legacy,idempotencyKey:key,allowCommit:true,uploadDirectory:directory}),error=>error.code==="LEGACY_IDEMPOTENCY_CONFLICT");legacy.databaseHash="a".repeat(64);
    const rollbackRow={id:3,doc_no:"ORD-ROLLBACK",title:"Rollback",doc_type:"Тушаал",doc_date:"2026-01-04",related_user:21,status:"approved"},rollbackAttachment={row:{id:103,entity_type:"order",entity_id:3,file_name:"rollback.pdf",file_url:"rollback.pdf"},buffer:Buffer.from("rollback-file")};await stage({f,sourceObject:legacy,category:"ORDER_DECISION",row:rollbackRow,attachment:rollbackAttachment});
    await assert.rejects(commitLegacyCanonicalImport({req:request(f.userA),source:legacy,idempotencyKey:randomUUID(),allowCommit:true,uploadDirectory:directory,injectFailure:async()=>{throw new Error("INJECTED_FAILURE")}}),/INJECTED_FAILURE/);
    const rollbackCounts=await withTenantTransaction(f.orgA,async client=>(await client.query("SELECT count(*)::int documents FROM documents WHERE organization_id=$1",[f.orgA])).rows[0]);assert.equal(rollbackCounts.documents,2);assert.equal(fs.readdirSync(directory).length,2);
    await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("DELETE FROM legacy_canonical_import_mappings WHERE organization_id=$1",[f.orgA])));await assert.rejects(withTenantTransaction(f.orgA,client=>client.query("UPDATE legacy_canonical_import_events SET evidence='{}' WHERE organization_id=$1",[f.orgA])));
    const rls=(await pool.query("SELECT count(*)::int count FROM pg_class WHERE relname=ANY($1) AND relrowsecurity",[["legacy_canonical_import_runs","legacy_canonical_import_mappings","legacy_canonical_import_events"]])).rows[0].count;assert.equal(rls,3);
    await fs.promises.rm(directory,{recursive:true,force:true});console.log("Legacy canonical import integration passed: dry-run, permission/tenant scope, approval gate, checksums, canonical mapping, no fabricated history, replay, rollback, and immutable evidence.");await closePool();
  }
  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
