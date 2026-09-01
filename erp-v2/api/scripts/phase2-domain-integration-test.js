"use strict";

if(process.env.RUN_PHASE2_DOMAIN_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config({quiet:true});
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool,withTenantTransaction}=require("../src/db");
  const {createAggregate,transitionAggregate,assignAggregate}=require("../src/services/bounded-domain-workflow");
  const permissions=["workflow.coordinate","complaints.register","complaints.assign","complaints.process","complaints.response.approve","complaints.response.send","records.register","records.assign","records.process","records.response.approve","records.response.send","hr.appointment.manage","hr.appointment.finalize","hr.leave.request","hr.leave.manage","hr.leave.approve","hr.exit.manage","hr.exit.finalize","archive.intake","archive.access.manage","archive.retention.review","archive.destruction.approve","archive.disposal.execute","archive.disposal.verify","documents.manage"];
  const request=(user,grants=permissions)=>({user:{...user,permissions:grants},ip:"127.0.0.1"});

  async function seedFixture(pool,suffix){
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const orgA=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Phase2 A ${suffix}`,`phase2-a-${suffix}`])).rows[0].id;
      const orgB=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Phase2 B ${suffix}`,`phase2-b-${suffix}`])).rows[0].id;
      for(const code of ["hr","records","complaints","archive"])await client.query("INSERT INTO organization_modules(organization_id,module_code,enabled) VALUES($1,$2,true)",[orgA,code]);
      const makeUser=async(organizationId,name)=>(await client.query("INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'integration',$4,'director') RETURNING id,organization_id,employee_id",[organizationId,`${name}-${suffix}@test.invalid`,`${name}-${suffix}`,name])).rows[0];
      const userA=await makeUser(orgA,"phase2-a"),userA2=await makeUser(orgA,"phase2-a2"),userB=await makeUser(orgB,"phase2-b");
      const department=(await client.query("INSERT INTO departments(organization_id,code,name) VALUES($1,'OPS','Operations') RETURNING id",[orgA])).rows[0].id;
      const job=(await client.query("INSERT INTO jobs(organization_id,code,name) VALUES($1,'ENG','Engineer') RETURNING id",[orgA])).rows[0].id;
      const position=(await client.query("INSERT INTO positions(organization_id,department_id,job_id,code,title) VALUES($1,$2,$3,'ENG','Engineer') RETURNING id",[orgA,department,job])).rows[0].id;
      const employee=(await client.query("INSERT INTO employees(organization_id,full_name,employee_no,department_id,position_id) VALUES($1,'Existing Employee','E-TEST',$2,$3) RETURNING id",[orgA,department,position])).rows[0].id;
      await client.query("INSERT INTO employee_profiles(organization_id,employee_id,status_hr) VALUES($1,$2,'Идэвхтэй')",[orgA,employee]);
      const document=(await client.query("INSERT INTO documents(organization_id,document_no,title,document_type,classification_code,created_by,updated_by) VALUES($1,$2,'Phase 2 evidence','official','internal',$3,$3) RETURNING id",[orgA,`P2-${suffix}`,userA.id])).rows[0].id;
      await client.query("COMMIT");
      userA.employee_id=employee;
      return {orgA,orgB,userA,userA2,userB,department,position,employee,document};
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  }

  async function main(){
    const pool=getPool(),databaseName=(await pool.query("SELECT current_database() name")).rows[0].name;
    if(!/^overva_test_phase2_/i.test(databaseName))throw new Error("Disposable overva_test_phase2_* database required");
    const suffix=randomUUID().slice(0,8),f=await seedFixture(pool,suffix),req=request(f.userA),other=request(f.userB);
    const complaintPayload={caseType:"complaint",requesterName:"Citizen",requesterContact:"contact",sourceChannel:"paper",category:"service",subject:"Test complaint",description:"Evidence",confidentiality:"internal",dueDate:null,documentIds:[],idempotencyKey:randomUUID()};
    const complaint=await createAggregate({req,domain:"complaint",initialState:"received",idempotencyKey:complaintPayload.idempotencyKey,payload:complaintPayload,permissions:["complaints.register"],insert:async(client,c)=>(await client.query(`INSERT INTO complaint_cases(id,organization_id,registration_no,case_type,requester_name,requester_contact,source_channel,category,subject,description,confidentiality,idempotency_key,payload_sha256,created_by) VALUES($1,$2,$3,'complaint','Citizen','contact','paper','service','Test complaint','Evidence','internal',$4,$5,$6) RETURNING *`,[c.id,c.organizationId,`CMP-${suffix}`,c.idempotencyKey,c.payloadSha256,c.actorUserId])).rows[0]});
    const replay=await createAggregate({req,domain:"complaint",initialState:"received",idempotencyKey:complaintPayload.idempotencyKey,payload:complaintPayload,permissions:["complaints.register"],insert:async()=>{throw new Error("must not insert")}});
    assert.equal(replay.replayed,true,"identical duplicate command must replay");
    await assert.rejects(createAggregate({req,domain:"complaint",initialState:"received",idempotencyKey:complaintPayload.idempotencyKey,payload:{...complaintPayload,subject:"changed"},permissions:["complaints.register"],insert:async()=>null}),error=>error.status===409);
    await assert.rejects(transitionAggregate({req:other,domain:"complaint",id:complaint.item.id,expectedVersion:0,command:"validate",toState:"validating",allowedFrom:["received"],permissions:["complaints.register"],reason:"wrong tenant",idempotencyKey:randomUUID()}),error=>error.status===404);
    await transitionAggregate({req,domain:"complaint",id:complaint.item.id,expectedVersion:0,command:"validate",toState:"validating",allowedFrom:["received"],permissions:["complaints.register"],reason:"complete",idempotencyKey:randomUUID()});
    await transitionAggregate({req,domain:"complaint",id:complaint.item.id,expectedVersion:1,command:"register",toState:"registered",allowedFrom:["validating"],permissions:["complaints.register"],reason:"registered",idempotencyKey:randomUUID()});
    const assigned=await assignAggregate({req,domain:"complaint",id:complaint.item.id,expectedVersion:2,assigneeUserId:f.userA2.id,reason:"assignment",idempotencyKey:randomUUID(),permissions:["complaints.assign"]});
    assert.equal(assigned.item.status,"assigned");
    const concurrent=await Promise.allSettled(["a","b"].map(reason=>transitionAggregate({req,domain:"complaint",id:complaint.item.id,expectedVersion:3,command:"start",toState:"in_progress",allowedFrom:["assigned"],permissions:["complaints.process"],reason,idempotencyKey:randomUUID()})));
    assert.equal(concurrent.filter(x=>x.status==="fulfilled").length,1);assert.equal(concurrent.filter(x=>x.status==="rejected"&&x.reason.status===409).length,1);

    const leavePayload={employeeId:f.employee,leaveType:"annual",startsOn:"2030-01-02",endsOn:"2030-01-03",requestedDays:2,reason:"test",routingPolicy:{managerReviewRequired:false},idempotencyKey:randomUUID()};
    const leave=await createAggregate({req,domain:"leave",initialState:"hr_review",idempotencyKey:leavePayload.idempotencyKey,payload:leavePayload,permissions:["hr.leave.request"],insert:async(client,c)=>(await client.query(`INSERT INTO hr_leave_requests(id,organization_id,employee_id,leave_type,starts_on,ends_on,requested_days,reason,status,routing_policy,idempotency_key,payload_sha256,created_by) VALUES($1,$2,$3,'annual','2030-01-02','2030-01-03',2,'test','hr_review',$4::jsonb,$5,$6,$7) RETURNING *`,[c.id,c.organizationId,f.employee,JSON.stringify(leavePayload.routingPolicy),c.idempotencyKey,c.payloadSha256,c.actorUserId])).rows[0]});
    await transitionAggregate({req,domain:"leave",id:leave.item.id,expectedVersion:0,command:"approve",toState:"approved",allowedFrom:["hr_review"],permissions:["hr.leave.approve"],reason:"approved",decision:"approved",stepCode:"approve",idempotencyKey:randomUUID(),set:{decision_note:"approved",decided_by:f.userA.id,decided_at:new Date()}});

    const appointmentPayload={candidateFullName:"New Employee",positionId:f.position,organizationUnitId:f.department,effectiveDate:"2030-02-01",requirements:[],idempotencyKey:randomUUID()};
    const appointment=await createAggregate({req,domain:"appointment",initialState:"draft",idempotencyKey:appointmentPayload.idempotencyKey,payload:appointmentPayload,permissions:["hr.appointment.manage"],insert:async(client,c)=>(await client.query(`INSERT INTO hr_appointment_cases(id,organization_id,case_no,candidate_full_name,position_id,organization_unit_id,effective_date,idempotency_key,payload_sha256,created_by) VALUES($1,$2,$3,'New Employee',$4,$5,'2030-02-01',$6,$7,$8) RETURNING *`,[c.id,c.organizationId,`APT-${suffix}`,f.position,f.department,c.idempotencyKey,c.payloadSha256,c.actorUserId])).rows[0]});
    let appointmentVersion=0;
    for(const [command,to,from,permission,decision] of [["submit","documents_pending","draft","hr.appointment.manage",null],["hr_review","hr_review","documents_pending","hr.appointment.manage",null],["management_review","management_review","hr_review","hr.appointment.manage",null],["approve","approved","management_review","hr.appointment.finalize","approved"]]){
      const result=await transitionAggregate({req,domain:"appointment",id:appointment.item.id,expectedVersion:appointmentVersion,command,toState:to,allowedFrom:[from],permissions:[permission],reason:"integration",decision,stepCode:command,idempotencyKey:randomUUID()});appointmentVersion=Number(result.item.version);
    }
    assert.equal(appointmentVersion,4);

    const archivePayload={title:"Archive",canonicalDocumentId:f.document,idempotencyKey:randomUUID()};
    const archive=await createAggregate({req,domain:"archive",initialState:"intake_pending",idempotencyKey:archivePayload.idempotencyKey,payload:archivePayload,permissions:["archive.intake"],documentIds:[f.document],insert:async(client,c)=>(await client.query(`INSERT INTO archive_records(id,organization_id,archive_no,title,category,canonical_document_id,status,created_by,idempotency_key,payload_sha256) VALUES($1,$2,$3,'Archive','test',$4,'intake_pending',$5,$6,$7) RETURNING *`,[c.id,c.organizationId,`ARC-${suffix}`,f.document,c.actorUserId,c.idempotencyKey,c.payloadSha256])).rows[0]});
    const accepted=await transitionAggregate({req,domain:"archive",id:archive.item.id,expectedVersion:0,command:"accept",toState:"active",allowedFrom:["intake_pending"],permissions:["archive.intake"],reason:"accepted",idempotencyKey:randomUUID()});assert.equal(accepted.item.status,"active");
    const evidence=await withTenantTransaction(f.orgA,async client=>(await client.query(`SELECT (SELECT count(*)::int FROM workflow_cases WHERE organization_id=$1) cases,(SELECT count(*)::int FROM workflow_notification_outbox WHERE organization_id=$1) outbox,(SELECT count(*)::int FROM audit_logs WHERE organization_id=$1 AND action LIKE 'complaint.%') complaint_audits,(SELECT count(*)::int FROM complaint_case_events WHERE organization_id=$1) complaint_events,(SELECT count(*)::int FROM document_links WHERE organization_id=$1 AND entity_type='archive_record') document_links`,[f.orgA])).rows[0]);
    assert.ok(evidence.cases>=4);assert.ok(evidence.outbox>=7);assert.ok(evidence.complaint_audits>=2);assert.ok(evidence.complaint_events>=3);assert.equal(evidence.document_links,1);
    const rls=(await pool.query("SELECT count(*)::int enabled FROM pg_class WHERE relname=ANY($1) AND relrowsecurity",[["hr_appointment_cases","complaint_cases","complaint_case_events","archive_access_requests","archive_destruction_proposals","domain_command_receipts"]])).rows[0].enabled;
    assert.equal(rls,6,"new Phase 2 tenant tables must have RLS enabled");
    await assert.rejects(pool.query("UPDATE complaint_case_events SET reason='tampered' WHERE organization_id=$1",[f.orgA]));await assert.rejects(pool.query("DELETE FROM domain_command_receipts WHERE organization_id=$1",[f.orgA]));
    console.log("Phase 2 domain integration passed: tenant denial, RLS activation, idempotency conflict/replay, concurrency, assignment, leave, appointment, archive, canonical documents, audit, immutable events, and outbox intent.");
    await closePool();
  }
  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
