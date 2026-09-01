"use strict";

if(process.env.RUN_FOUNDATION_RLS_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config();
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool,setTenantContext,withTenantTransaction,withSystemTransaction}=require("../src/db");
  const {createWorkflowCase}=require("../src/services/workflow-coordination");
  const {recordDocumentLink}=require("../src/services/document-links");

  async function main(){
    const pool=getPool(),databaseName=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName))throw new Error("Foundation RLS integration requires a disposable database");
    const suffix=randomUUID().replaceAll("-","").slice(0,10),roleName=`overva_rls_${suffix}`;
    const fixture=await pool.connect();let orgA,orgB,userA,userB;
    try{
      await fixture.query("BEGIN");
      orgA=(await fixture.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`RLS A ${suffix}`,`rls-a-${suffix}`])).rows[0].id;
      orgB=(await fixture.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`RLS B ${suffix}`,`rls-b-${suffix}`])).rows[0].id;
      userA=(await fixture.query(`INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test','RLS A','director') RETURNING id`,[orgA,`a-${suffix}@test.invalid`,`a-${suffix}`])).rows[0].id;
      userB=(await fixture.query(`INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test','RLS B','director') RETURNING id`,[orgB,`b-${suffix}@test.invalid`,`b-${suffix}`])).rows[0].id;
      await fixture.query("COMMIT");
    }catch(error){await fixture.query("ROLLBACK").catch(()=>{});throw error}finally{fixture.release()}

    const reqA={user:{id:userA,organization_id:orgA,permissions:["workflow.coordinate"]},ip:"127.0.0.1"};
    const reqB={user:{id:userB,organization_id:orgB,permissions:["workflow.coordinate"]},ip:"127.0.0.1"};
    const caseA=await createWorkflowCase({req:reqA,workflowType:"rls",subjectType:"fixture",subjectId:`a-${suffix}`,initialState:"open",idempotencyKey:"create-a"});
    const caseB=await createWorkflowCase({req:reqB,workflowType:"rls",subjectType:"fixture",subjectId:`b-${suffix}`,initialState:"open",idempotencyKey:"create-b"});
    const documentA=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
       VALUES($1,$2,'RLS canonical A','general',$3,$3) RETURNING id`,[orgA,`RLS-A-${suffix}`,userA]
    )).rows[0];
    await recordDocumentLink({req:{...reqA,user:{...reqA.user,permissions:["documents.manage"]}},documentId:documentA.id,entityType:"rls",entityId:`a-${suffix}`});
    await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,linked_entity_type,linked_entity_id,created_by,updated_by)
       VALUES($1,$2,'RLS legacy A','general','rls',$3,$4,$4)`,[orgA,`RLS-A-LEGACY-${suffix}`,`a-${suffix}`,userA]
    );
    const documentB=(await pool.query(
      `INSERT INTO documents(organization_id,document_no,title,document_type,created_by,updated_by)
       VALUES($1,$2,'RLS canonical B','general',$3,$3) RETURNING id`,[orgB,`RLS-B-${suffix}`,userB]
    )).rows[0];
    await recordDocumentLink({req:{...reqB,user:{...reqB.user,permissions:["documents.manage"]}},documentId:documentB.id,entityType:"rls",entityId:`b-${suffix}`});

    await pool.query(`CREATE ROLE ${roleName} NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await pool.query(`GRANT SELECT,INSERT,UPDATE ON workflow_cases,workflow_transition_events,workflow_notification_outbox,workflow_notification_delivery_state,workflow_notification_delivery_events,document_links TO ${roleName}`);
    await pool.query(`GRANT SELECT ON documents,document_entity_links_compat TO ${roleName}`);
    await pool.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleName}`);
    const client=await pool.connect();
    try{
      await client.query(`SET ROLE ${roleName}`);
      const missing=await client.query("SELECT count(*)::int value FROM workflow_cases");
      assert.equal(missing.rows[0].value,0,"missing tenant context must fail closed");
      assert.equal((await client.query("SELECT count(*)::int value FROM document_entity_links_compat")).rows[0].value,0,"compatibility view must fail closed without tenant context");
      await client.query("BEGIN");
      await setTenantContext(client,orgA);
      const visible=await client.query("SELECT id FROM workflow_cases");
      assert.deepEqual(visible.rows.map(row=>row.id),[caseA.case.id]);
      assert.equal((await client.query("SELECT count(*)::int value FROM workflow_cases WHERE id=$1",[caseB.case.id])).rows[0].value,0);
      const visibleDocuments=await client.query("SELECT document_id,source FROM document_entity_links_compat ORDER BY document_id");
      assert.equal(visibleDocuments.rowCount,2);
      assert.deepEqual(new Set(visibleDocuments.rows.map(row=>row.source)),new Set(["api","legacy"]));
      assert.equal(visibleDocuments.rows.some(row=>row.document_id===documentB.id),false,"compatibility view must not leak another tenant");
      await assert.rejects(setTenantContext(client,orgB),error=>error.code==="TENANT_CONTEXT_MISMATCH");
      await assert.rejects(
        client.query(`INSERT INTO workflow_cases(organization_id,workflow_type,subject_type,subject_id,coordination_state,created_by) VALUES($1,'rls','mismatch',$2,'open',$3)`,[orgB,`mismatch-${suffix}`,userB]),
        error=>error.code==="42501"
      );
      await client.query("ROLLBACK");
      assert.equal(await (async()=>{const r=await client.query("SELECT NULLIF(current_setting('app.organization_id',true),'') value");return r.rows[0].value})(),null);
      await client.query("RESET ROLE");
    }finally{client.release()}

    await withTenantTransaction(orgA,async tx=>assert.equal(await (async()=>{const r=await tx.query("SELECT current_setting('app.organization_id') value");return r.rows[0].value})(),orgA));
    const reused=await pool.connect();
    try{assert.equal((await reused.query("SELECT NULLIF(current_setting('app.organization_id',true),'') value")).rows[0].value,null)}finally{reused.release()}
    await assert.rejects(withSystemTransaction("integration diagnostics",async()=>{}),error=>error.code==="SYSTEM_DB_BYPASS_DISABLED");

    const activation=await pool.query(`SELECT count(*)::int value FROM pg_class WHERE relname IN(
      'workflow_cases','workflow_transition_events','workflow_assignment_events','workflow_decision_events',
      'workflow_comment_events','workflow_command_receipts','workflow_notification_outbox',
      'workflow_notification_delivery_state','workflow_notification_delivery_events','document_links') AND relrowsecurity`);
    assert.equal(activation.rows[0].value,10);
    await pool.query(`DROP OWNED BY ${roleName}`);
    await pool.query(`DROP ROLE ${roleName}`);
    console.log("Foundation RLS integration passed: missing context fail-closed, workflow and canonical/legacy document links isolated, mismatched writes rejected, SET LOCAL cleared on pool reuse, and bypass disabled.");
    await closePool();
  }

  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
