"use strict";

if(process.env.RUN_WORKFLOW_FOUNDATION_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config();
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool}=require("../src/db");
  const {
    createWorkflowCase,transitionWorkflowCase,assignWorkflowCase,
    addWorkflowComment,getWorkflowCase,
  }=require("../src/services/workflow-coordination");
  const {recordDocumentLink,listDocumentLinks}=require("../src/services/document-links");

  function request(user,permissions){return {user:{id:user.id,organization_id:user.organization_id,permissions},ip:"127.0.0.1"};}

  async function main(){
    const pool=getPool();
    const databaseName=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)){
      throw new Error("Workflow foundation integration requires a disposable overva_test_* or overva_rehearsal_* database");
    }
    const suffix=randomUUID().slice(0,8);
    const client=await pool.connect();
    let orgA,orgB,userA,userB;
    try{
      await client.query("BEGIN");
      orgA=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Workflow A ${suffix}`,`workflow-a-${suffix}`])).rows[0].id;
      orgB=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Workflow B ${suffix}`,`workflow-b-${suffix}`])).rows[0].id;
      userA=(await client.query(
        `INSERT INTO users(organization_id,email,username,password_hash,full_name,role)
         VALUES($1,$2,$3,'integration-only','Workflow A','director') RETURNING id,organization_id`,
        [orgA,`workflow-a-${suffix}@test.invalid`,`workflow-a-${suffix}`]
      )).rows[0];
      userB=(await client.query(
        `INSERT INTO users(organization_id,email,username,password_hash,full_name,role)
         VALUES($1,$2,$3,'integration-only','Workflow B','director') RETURNING id,organization_id`,
        [orgB,`workflow-b-${suffix}@test.invalid`,`workflow-b-${suffix}`]
      )).rows[0];
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}

    const reqA=request(userA,["workflow.coordinate","documents.manage"]);
    const reqB=request(userB,["workflow.coordinate","documents.manage"]);
    await assert.rejects(
      createWorkflowCase({req:request(userA,[]),workflowType:"integration",subjectType:"fixture",subjectId:suffix,initialState:"open",idempotencyKey:"forbidden"}),
      error=>error.status===403
    );

    const created=await createWorkflowCase({req:reqA,workflowType:"integration",subjectType:"fixture",subjectId:suffix,initialState:"open",idempotencyKey:"create-1",detail:{source:"integration"}});
    assert.equal(created.case.version,"0");
    const replay=await createWorkflowCase({req:reqA,workflowType:"integration",subjectType:"fixture",subjectId:suffix,initialState:"open",idempotencyKey:"create-1",detail:{source:"integration"}});
    assert.equal(replay.replayed,true);
    assert.equal(replay.case.id,created.case.id);
    await assert.rejects(
      createWorkflowCase({req:reqA,workflowType:"integration",subjectType:"fixture",subjectId:suffix,initialState:"different",idempotencyKey:"create-1",detail:{source:"integration"}}),
      error=>error.status===409&&error.code==="IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
    );
    await assert.rejects(getWorkflowCase({req:reqB,caseId:created.case.id}),error=>error.status===404);
    await assert.rejects(
      assignWorkflowCase({req:reqA,caseId:created.case.id,expectedVersion:0,assigneeUserId:userB.id,reason:"cross tenant",idempotencyKey:"assign-cross"}),
      error=>error.status===404
    );

    const assigned=await assignWorkflowCase({req:reqA,caseId:created.case.id,expectedVersion:0,assigneeUserId:userA.id,reason:"owner",idempotencyKey:"assign-1"});
    assert.equal(assigned.operation,"assigned");
    assert.equal(assigned.case.version,"1");
    const assignedReplay=await assignWorkflowCase({req:reqA,caseId:created.case.id,expectedVersion:0,assigneeUserId:userA.id,reason:"owner",idempotencyKey:"assign-1"});
    assert.equal(assignedReplay.replayed,true);

    const concurrent=await Promise.allSettled([
      addWorkflowComment({req:reqA,caseId:created.case.id,expectedVersion:1,comment:"first",idempotencyKey:"comment-a"}),
      addWorkflowComment({req:reqA,caseId:created.case.id,expectedVersion:1,comment:"second",idempotencyKey:"comment-b"}),
    ]);
    assert.equal(concurrent.filter(result=>result.status==="fulfilled").length,1);
    assert.equal(concurrent.filter(result=>result.status==="rejected"&&result.reason.status===409).length,1);
    const afterComment=await getWorkflowCase({req:reqA,caseId:created.case.id});
    assert.equal(afterComment.version,"2");

    const transitioned=await transitionWorkflowCase({
      req:reqA,caseId:created.case.id,expectedVersion:2,transitionName:"review.complete",toState:"complete",
      domainFromState:"domain_pending",domainToState:"domain_approved",decision:"approved",stepCode:"review",
      reason:"Verified by integration test",comment:"No domain row was changed",detail:{evidence:"test"},idempotencyKey:"transition-1",
    });
    assert.equal(transitioned.case.version,"3");
    const transitionReplay=await transitionWorkflowCase({
      req:reqA,caseId:created.case.id,expectedVersion:2,transitionName:"review.complete",toState:"complete",
      domainFromState:"domain_pending",domainToState:"domain_approved",decision:"approved",stepCode:"review",
      reason:"Verified by integration test",comment:"No domain row was changed",detail:{evidence:"test"},idempotencyKey:"transition-1",
    });
    assert.equal(transitionReplay.replayed,true);

    const evidence=await pool.query(
      `SELECT
        (SELECT count(*)::int FROM workflow_cases WHERE organization_id=$1 AND id=$2) cases,
        (SELECT count(*)::int FROM workflow_transition_events WHERE organization_id=$1 AND case_id=$2) transitions,
        (SELECT count(*)::int FROM workflow_assignment_events WHERE organization_id=$1 AND case_id=$2) assignments,
        (SELECT count(*)::int FROM workflow_comment_events WHERE organization_id=$1 AND case_id=$2) comments,
        (SELECT count(*)::int FROM workflow_decision_events WHERE organization_id=$1 AND case_id=$2) decisions,
        (SELECT count(*)::int FROM workflow_command_receipts WHERE organization_id=$1 AND case_id=$2) receipts,
        (SELECT count(*)::int FROM workflow_notification_outbox WHERE organization_id=$1 AND case_id=$2) outbox,
        (SELECT count(*)::int FROM audit_logs WHERE organization_id=$1 AND entity_type='workflow_case' AND entity_id=$2::text) audits`,
      [orgA,created.case.id]
    );
    assert.deepEqual(evidence.rows[0],{cases:1,transitions:2,assignments:1,comments:1,decisions:1,receipts:4,outbox:4,audits:4});
    await assert.rejects(pool.query("UPDATE workflow_transition_events SET reason='tampered' WHERE organization_id=$1 AND case_id=$2",[orgA,created.case.id]));
    await assert.rejects(pool.query("DELETE FROM workflow_command_receipts WHERE organization_id=$1 AND case_id=$2",[orgA,created.case.id]));
    await assert.rejects(pool.query("UPDATE audit_logs SET detail='{}'::jsonb WHERE organization_id=$1 AND entity_type='workflow_case' AND entity_id=$2",[orgA,created.case.id]));

    const documentA=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
       VALUES($1,$2,'Canonical test','general',$3,$3) RETURNING id`,
      [orgA,`DOC-${suffix}-A`,userA.id]
    )).rows[0];
    await recordDocumentLink({req:reqA,documentId:documentA.id,entityType:"fixture",entityId:suffix,source:"api"});
    const documentLegacy=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,linked_entity_type,linked_entity_id,created_by,updated_by)
       VALUES($1,$2,'Legacy compatibility','general','fixture',$3,$4,$4) RETURNING id`,
      [orgA,`DOC-${suffix}-B`,suffix,userA.id]
    )).rows[0];
    const links=await listDocumentLinks({req:reqA,entityType:"fixture",entityId:suffix});
    assert.deepEqual(new Set(links.map(link=>link.document_id)),new Set([documentA.id,documentLegacy.id]));

    const duplicateDocument=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
       VALUES($1,$2,'Concurrent canonical link','general',$3,$3) RETURNING id`,
      [orgA,`DOC-${suffix}-CONCURRENT`,userA.id]
    )).rows[0];
    const duplicateResults=await Promise.all([
      recordDocumentLink({req:reqA,documentId:duplicateDocument.id,entityType:"fixture",entityId:`duplicate-${suffix}`,source:"api"}),
      recordDocumentLink({req:reqA,documentId:duplicateDocument.id,entityType:"fixture",entityId:`duplicate-${suffix}`,source:"api"}),
    ]);
    assert.equal(duplicateResults[0].id,duplicateResults[1].id);
    assert.equal((await pool.query(
      `SELECT count(*)::int value FROM document_links
        WHERE organization_id=$1 AND document_id=$2 AND entity_type='fixture' AND entity_id=$3`,
      [orgA,duplicateDocument.id,`duplicate-${suffix}`]
    )).rows[0].value,1,"concurrent canonical link writes must deduplicate");

    const rollbackDocumentNo=`DOC-${suffix}-ROLLBACK`;
    const rollbackClient=await pool.connect();
    try{
      await rollbackClient.query("BEGIN");
      const rollbackDocument=(await rollbackClient.query(
        `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
         VALUES($1,$2,'Atomic rollback','general',$3,$3) RETURNING id`,
        [orgA,rollbackDocumentNo,userA.id]
      )).rows[0];
      await assert.rejects(
        recordDocumentLink({req:reqA,documentId:rollbackDocument.id,entityType:"x".repeat(121),entityId:suffix,source:"api",client:rollbackClient}),
        error=>error.code==="23514"
      );
      await rollbackClient.query("ROLLBACK");
    }catch(error){await rollbackClient.query("ROLLBACK").catch(()=>{});throw error}finally{rollbackClient.release()}
    assert.equal((await pool.query("SELECT count(*)::int value FROM documents WHERE organization_id=$1 AND document_no=$2",[orgA,rollbackDocumentNo])).rows[0].value,0,"document and canonical link must roll back atomically");

    await assert.rejects(
      recordDocumentLink({req:reqB,documentId:documentA.id,entityType:"fixture",entityId:suffix,source:"api"}),
      error=>error.status===404
    );
    await assert.rejects(pool.query("UPDATE document_links SET entity_id='tampered' WHERE organization_id=$1 AND document_id=$2",[orgA,documentA.id]));
    await assert.rejects(pool.query("DELETE FROM documents WHERE organization_id=$1 AND id=$2",[orgA,documentA.id]),error=>error.code==="23503");

    const checksum="a".repeat(64),storageKey=`integration/${suffix}/v1`;
    const version=(await pool.query(
      `INSERT INTO document_versions(organization_id,document_id,version_no,original_name,storage_key,mime_type,size_bytes,content_sha256,created_by)
       VALUES($1,$2,1,'canonical.txt',$3,'text/plain',1,$4,$5) RETURNING id,version_no,content_sha256`,
      [orgA,documentA.id,storageKey,checksum,userA.id]
    )).rows[0];
    assert.equal(version.version_no,1);
    assert.equal(version.content_sha256.trim(),checksum);
    await assert.rejects(
      pool.query(
        `INSERT INTO document_versions(organization_id,document_id,version_no,original_name,storage_key,mime_type,size_bytes,content_sha256,created_by)
         VALUES($1,$2,1,'duplicate.txt',$3,'text/plain',1,$4,$5)`,
        [orgA,documentA.id,`${storageKey}-duplicate`,"b".repeat(64),userA.id]
      ),error=>error.code==="23505"
    );
    assert.equal((await pool.query("SELECT content_sha256 FROM document_versions WHERE organization_id=$1 AND id=$2",[orgA,version.id])).rows[0].content_sha256.trim(),checksum);

    const documentB=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
       VALUES($1,$2,'Other tenant document','general',$3,$3) RETURNING id`,
      [orgB,`DOC-${suffix}-TENANT-B`,userB.id]
    )).rows[0];
    const assetA=(await pool.query(
      `INSERT INTO assets(organization_id,code,name,category,created_by)
       VALUES($1,$2,'Canonical mismatch asset','integration',$3) RETURNING id`,
      [orgA,`ASSET-${suffix}`,userA.id]
    )).rows[0];
    await assert.rejects(
      pool.query(
        `INSERT INTO attachments(organization_id,asset_id,uploaded_by,original_name,stored_name,mime_type,size_bytes,canonical_document_id)
         VALUES($1,$2,$3,'mismatch.txt',$4,'text/plain',1,$5)`,
        [orgA,assetA.id,userA.id,`mismatch-${suffix}.txt`,documentB.id]
      ),error=>error.code==="23503"
    );

    const compatibility=await pool.query(
      `SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='linked_entity_id') legacy_document_link,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='correspondence_records' AND column_name='canonical_document_id') correspondence_link,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='archive_records' AND column_name='canonical_document_id') archive_link,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='attachments' AND column_name='canonical_document_id') attachment_link`
    );
    assert.deepEqual(compatibility.rows[0],{legacy_document_link:true,correspondence_link:true,archive_link:true,attachment_link:true});

    console.log("Workflow foundation integration passed: authorization, tenant isolation, version concurrency, idempotency, immutable evidence/audit, outbox, atomic canonical links, duplicate concurrency, delete restriction, version checksum, attachment tenant FK and compatibility verified.");
    await closePool();
  }

  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1;});
}
