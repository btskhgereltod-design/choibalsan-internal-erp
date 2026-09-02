"use strict";

if(process.env.RUN_PHASE2_DOMAIN_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config({quiet:true});
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool,withTenantTransaction}=require("../src/db");
  const {createAggregate,transitionAggregate,assignAggregate}=require("../src/services/bounded-domain-workflow");
  const {requestHrDisciplineAssessment}=require("../src/services/complaint-hr-handoff");
  const {applyPrimaryAssignmentChange}=require("../src/services/employee-assignment");
  const {writeAudit}=require("../src/services/audit");
  const permissions=["workflow.coordinate","complaints.register","complaints.assign","complaints.process","complaints.response.approve","complaints.response.send","complaints.handoff.create","records.register","records.assign","records.process","records.response.approve","records.response.send","hr.appointment.manage","hr.appointment.finalize","hr.leave.request","hr.leave.manage","hr.leave.approve","hr.exit.manage","hr.exit.finalize","hr.transfer.read","hr.transfer.manage","hr.transfer.review","hr.transfer.decide","hr.transfer.implement","hr.discipline.read","hr.discipline.confidential.read","hr.discipline.intake","hr.discipline.investigate","hr.discipline.recommend","hr.discipline.decide","hr.discipline.admin","archive.intake","archive.access.manage","archive.retention.review","archive.destruction.approve","archive.disposal.execute","archive.disposal.verify","documents.manage"];
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
      const targetDepartment=(await client.query("INSERT INTO departments(organization_id,code,name) VALUES($1,'QA','Quality') RETURNING id",[orgA])).rows[0].id;
      const targetJob=(await client.query("INSERT INTO jobs(organization_id,code,name) VALUES($1,'QAE','Quality Engineer') RETURNING id",[orgA])).rows[0].id;
      const targetPosition=(await client.query("INSERT INTO positions(organization_id,department_id,job_id,code,title) VALUES($1,$2,$3,'QAE','Quality Engineer') RETURNING id",[orgA,targetDepartment,targetJob])).rows[0].id;
      const employee=(await client.query("INSERT INTO employees(organization_id,full_name,employee_no,department_id,position_id) VALUES($1,'Existing Employee','E-TEST',$2,$3) RETURNING id",[orgA,department,position])).rows[0].id;
      await client.query("INSERT INTO employee_profiles(organization_id,employee_id,status_hr) VALUES($1,$2,'Идэвхтэй')",[orgA,employee]);
      const assignment=(await client.query(`INSERT INTO employee_assignments(
        organization_id,employee_id,organization_unit_id,position_id,assignment_type_code,status,effective_from,source,created_by
      ) VALUES($1,$2,$3,$4,'primary','active',CURRENT_DATE-30,'system',$5) RETURNING id`,[orgA,employee,department,position,userA.id])).rows[0].id;
      const document=(await client.query("INSERT INTO documents(organization_id,document_no,title,document_type,classification_code,created_by,updated_by) VALUES($1,$2,'Phase 2 evidence','official','internal',$3,$3) RETURNING id",[orgA,`P2-${suffix}`,userA.id])).rows[0].id;
      await client.query("COMMIT");
      userA.employee_id=employee;
      return {orgA,orgB,userA,userA2,userB,department,position,targetDepartment,targetPosition,employee,assignment,document};
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
    const handoffKey=randomUUID(),handoffInput={req,complaintCaseId:complaint.item.id,expectedVersion:4,subjectReference:"Employee reference supplied by complainant",reason:"HR must independently assess the evidence",documentIds:[f.document],idempotencyKey:handoffKey};
    const handoff=await requestHrDisciplineAssessment(handoffInput);assert.equal(handoff.replayed,false);assert.equal(handoff.handoff.status,"requested");assert.equal(handoff.item.status,"in_progress");
    const handoffReplay=await requestHrDisciplineAssessment(handoffInput);assert.equal(handoffReplay.replayed,true);assert.equal(handoffReplay.handoff.id,handoff.handoff.id);
    await assert.rejects(requestHrDisciplineAssessment({...handoffInput,subjectReference:"changed"}),error=>error.status===409);
    await assert.rejects(requestHrDisciplineAssessment({...handoffInput,req:other,idempotencyKey:randomUUID()}),error=>error.status===404);

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

    const today=(await pool.query("SELECT CURRENT_DATE::text value")).rows[0].value;
    const transferPayload={employeeId:f.employee,transferType:"rotation",targetOrganizationUnitId:f.targetDepartment,targetPositionId:f.targetPosition,targetManagerEmployeeId:null,reason:"Verified operating need",legalBasisReference:"Tenant-reviewed legal and policy basis",effectiveFrom:today,effectiveTo:null,consentRequired:true,proposalDocumentId:f.document,policySnapshot:{source:"integration-reviewed-policy",consentRequired:true},idempotencyKey:randomUUID()};
    const transfer=await createAggregate({req,domain:"transfer",initialState:"draft",idempotencyKey:transferPayload.idempotencyKey,payload:transferPayload,permissions:["hr.transfer.manage"],documentIds:[f.document],insert:async(client,c)=>(await client.query(`INSERT INTO hr_transfer_cases(
      id,organization_id,case_no,employee_id,transfer_type,source_assignment_id,target_organization_unit_id,target_position_id,
      reason,legal_basis_reference,effective_from,consent_required,consent_status,proposal_document_id,policy_snapshot,
      idempotency_key,payload_sha256,created_by
    ) VALUES($1,$2,$3,$4,'rotation',$5,$6,$7,$8,$9,$10,true,'pending',$11,$12::jsonb,$13,$14,$15) RETURNING *`,[
      c.id,c.organizationId,`TRF-${suffix}`,f.employee,f.assignment,f.targetDepartment,f.targetPosition,transferPayload.reason,
      transferPayload.legalBasisReference,today,f.document,JSON.stringify(transferPayload.policySnapshot),c.idempotencyKey,c.payloadSha256,c.actorUserId,
    ])).rows[0]});
    let transferVersion=0;
    const moveTransfer=async({command,to,from,permission,set={},decision=null,documentIds=[],precondition})=>{
      const result=await transitionAggregate({req,domain:"transfer",id:transfer.item.id,expectedVersion:transferVersion,command,toState:to,allowedFrom:[from],permissions:[permission],reason:"integration",decision,stepCode:command,idempotencyKey:randomUUID(),set,documentIds,precondition});
      transferVersion=Number(result.item.version);return result;
    };
    await moveTransfer({command:"submit",to:"eligibility_review",from:"draft",permission:"hr.transfer.manage"});
    await moveTransfer({command:"request_consent",to:"consent_pending",from:"eligibility_review",permission:"hr.transfer.review"});
    await moveTransfer({command:"record_consent",to:"hr_review",from:"consent_pending",permission:"hr.transfer.manage",set:{consent_status:"provided",consent_document_id:f.document},documentIds:[f.document]});
    await moveTransfer({command:"management_review",to:"management_review",from:"hr_review",permission:"hr.transfer.review",set:{workload_assessment:"Capacity verified",proposal_document_id:f.document},documentIds:[f.document]});
    await moveTransfer({command:"approve",to:"approved",from:"management_review",permission:"hr.transfer.decide",decision:"approved",set:{decision_document_id:f.document},documentIds:[f.document]});
    const implementSet={implemented_at:new Date()};
    const implemented=await moveTransfer({command:"implement",to:"implemented",from:"approved",permission:"hr.transfer.implement",set:implementSet,precondition:async(client,current)=>{
      const applied=await applyPrimaryAssignmentChange(client,{organizationId:current.organization_id,employeeId:current.employee_id,expectedAssignmentId:current.source_assignment_id,departmentId:current.target_organization_unit_id,positionId:current.target_position_id,effectiveFrom:today,actorUserId:f.userA.id,source:"system",note:`Transfer ${current.case_no}`});
      implementSet.implemented_assignment_id=applied.assignment.id;
    }});
    assert.equal(implemented.item.status,"implemented");assert.equal(implemented.item.implemented_assignment_id,implementSet.implemented_assignment_id);
    const placement=await withTenantTransaction(f.orgA,async client=>(await client.query(`SELECT
      (SELECT status FROM employee_assignments WHERE organization_id=$1 AND id=$2) source_status,
      (SELECT count(*)::int FROM employee_assignments WHERE organization_id=$1 AND employee_id=$3 AND status='active' AND position_id=$4) target_active,
      (SELECT position_id FROM employees WHERE organization_id=$1 AND id=$3) employee_position`,[f.orgA,f.assignment,f.employee,f.targetPosition])).rows[0]);
    assert.equal(placement.source_status,"ended");assert.equal(placement.target_active,1);assert.equal(placement.employee_position,f.targetPosition);

    const dates=(await pool.query("SELECT CURRENT_DATE::text today,(CURRENT_DATE+30)::text due,(CURRENT_DATE+365)::text expires")).rows[0];
    const deadlineCalculation={ruleVersion:"mn-labour-law-123-2024",deadlineClass:"ordinary",occurredOn:dates.today,discoveredOn:dates.today,decisionDueOn:dates.due,suspensionPeriods:[]};
    const disciplinePayload={employeeId:f.employee,sourceHandoffId:handoff.handoff.id,handoffExpectedVersion:0,violationKey:`V-${suffix}`,violationReference:"Reported conduct requires independent HR review",occurredOn:dates.today,discoveredOn:dates.today,legalBasisReference:"Reviewed law and tenant policy",deadlineClass:"ordinary",deadlineSuspensions:[],deadlineCalculation,decisionDueOn:dates.due,policySnapshot:{policyCode:"TEST",policyVersion:"1",fourEyesRequired:true,deadlineBasis:"reviewed integration fixture"},initialEvidenceDocumentIds:[f.document],idempotencyKey:randomUUID()};
    const discipline=await createAggregate({req,domain:"discipline",initialState:"intake",idempotencyKey:disciplinePayload.idempotencyKey,payload:disciplinePayload,permissions:["hr.discipline.intake"],documentIds:[f.document],insert:async(client,c)=>(await client.query(`INSERT INTO hr_discipline_cases(
      id,organization_id,case_no,employee_id,source_handoff_id,violation_key,violation_reference,occurred_on,discovered_on,
      legal_basis_reference,deadline_rule_code,deadline_suspensions,deadline_calculation,decision_due_on,policy_snapshot,idempotency_key,payload_sha256,created_by
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17,$18) RETURNING *`,[
      c.id,c.organizationId,`DSC-${suffix}`,f.employee,handoff.handoff.id,disciplinePayload.violationKey,disciplinePayload.violationReference,
      dates.today,dates.today,disciplinePayload.legalBasisReference,"ordinary",JSON.stringify([]),JSON.stringify(deadlineCalculation),dates.due,JSON.stringify(disciplinePayload.policySnapshot),c.idempotencyKey,c.payloadSha256,c.actorUserId,
    ])).rows[0],after:async(client,ctx)=>{
      const accepted=(await client.query(`UPDATE complaint_hr_handoffs SET status='accepted',target_discipline_case_id=$4,responded_by=$5,responded_at=now(),updated_at=now(),version=version+1
        WHERE organization_id=$1 AND id=$2 AND status='requested' AND version=$3 RETURNING *`,[ctx.organizationId,handoff.handoff.id,0,ctx.item.id,ctx.actorUserId])).rows[0];
      assert.ok(accepted);await client.query(`INSERT INTO complaint_hr_handoff_events(organization_id,handoff_id,version,event_type,actor_user_id,reason,detail,request_id)
        VALUES($1,$2,$3,'accepted',$4,'integration acceptance',$5::jsonb,$6)`,[ctx.organizationId,handoff.handoff.id,accepted.version,ctx.actorUserId,JSON.stringify({disciplineCaseId:ctx.item.id}),ctx.requestId]);
      await writeAudit(req,"complaint_hr_handoff.accepted","complaint_hr_handoff",handoff.handoff.id,{disciplineCaseId:ctx.item.id},client);
    }});
    await assert.rejects(transitionAggregate({req:other,domain:"discipline",id:discipline.item.id,expectedVersion:0,command:"assign_investigator",toState:"investigation",allowedFrom:["intake"],permissions:["hr.discipline.investigate"],reason:"wrong tenant",idempotencyKey:randomUUID()}),error=>error.status===404);
    let disciplineVersion=0;
    const moveDiscipline=async({actingReq=req,command,to,from,permission,set={},decision=null,documentIds=[]})=>{
      const result=await transitionAggregate({req:actingReq,domain:"discipline",id:discipline.item.id,expectedVersion:disciplineVersion,command,toState:to,allowedFrom:[from],permissions:[permission],reason:"integration",decision,stepCode:command,idempotencyKey:randomUUID(),set,documentIds});disciplineVersion=Number(result.item.version);return result;
    };
    await moveDiscipline({command:"assign_investigator",to:"investigation",from:"intake",permission:"hr.discipline.investigate",set:{investigator_user_id:f.userA.id}});
    await moveDiscipline({command:"issue_notice",to:"explanation_pending",from:"investigation",permission:"hr.discipline.investigate",set:{notice_document_id:f.document,notice_at:new Date()},documentIds:[f.document]});
    await moveDiscipline({command:"record_explanation",to:"investigation",from:"explanation_pending",permission:"hr.discipline.investigate",set:{explanation_status:"provided",explanation_document_id:f.document,explanation_at:new Date()},documentIds:[f.document]});
    await moveDiscipline({command:"submit_recommendation",to:"recommendation_review",from:"investigation",permission:"hr.discipline.recommend",set:{investigation_summary:"Evidence reviewed",finding:"substantiated",recommendation:"Apply reviewed tenant policy",recommended_action_code:"TEST-ACTION",recommendation_document_id:f.document,recommendation_by:f.userA.id,recommendation_at:new Date()},documentIds:[f.document]});
    await moveDiscipline({command:"request_decision",to:"decision_pending",from:"recommendation_review",permission:"hr.discipline.recommend"});
    const decisionReq=request(f.userA2),decision=await moveDiscipline({actingReq:decisionReq,command:"decide",to:"sanctioned",from:"decision_pending",permission:"hr.discipline.decide",decision:"approved",set:{decision_outcome:"sanctioned",sanction_code:"TEST-ACTION",decision_reason:"Independent decision",decision_document_id:f.document,decision_by:f.userA2.id,decision_at:new Date(),effective_from:dates.today,sanction_expires_on:dates.expires},documentIds:[f.document]});
    assert.equal(decision.item.status,"sanctioned");assert.notEqual(decision.item.decision_by,decision.item.investigator_user_id);
    await moveDiscipline({command:"acknowledge",to:"acknowledged",from:"sanctioned",permission:"hr.discipline.admin",set:{acknowledgement_status:"provided",acknowledgement_document_id:f.document,acknowledged_at:new Date()},documentIds:[f.document]});
    await moveDiscipline({command:"start_monitoring",to:"monitoring",from:"acknowledged",permission:"hr.discipline.admin"});
    const acceptedHandoff=await withTenantTransaction(f.orgA,async client=>(await client.query("SELECT status,target_discipline_case_id FROM complaint_hr_handoffs WHERE organization_id=$1 AND id=$2",[f.orgA,handoff.handoff.id])).rows[0]);
    assert.equal(acceptedHandoff.status,"accepted");assert.equal(acceptedHandoff.target_discipline_case_id,discipline.item.id);

    const archivePayload={title:"Archive",canonicalDocumentId:f.document,idempotencyKey:randomUUID()};
    const archive=await createAggregate({req,domain:"archive",initialState:"intake_pending",idempotencyKey:archivePayload.idempotencyKey,payload:archivePayload,permissions:["archive.intake"],documentIds:[f.document],insert:async(client,c)=>(await client.query(`INSERT INTO archive_records(id,organization_id,archive_no,title,category,canonical_document_id,status,created_by,idempotency_key,payload_sha256) VALUES($1,$2,$3,'Archive','test',$4,'intake_pending',$5,$6,$7) RETURNING *`,[c.id,c.organizationId,`ARC-${suffix}`,f.document,c.actorUserId,c.idempotencyKey,c.payloadSha256])).rows[0]});
    const accepted=await transitionAggregate({req,domain:"archive",id:archive.item.id,expectedVersion:0,command:"accept",toState:"active",allowedFrom:["intake_pending"],permissions:["archive.intake"],reason:"accepted",idempotencyKey:randomUUID()});assert.equal(accepted.item.status,"active");
    const evidence=await withTenantTransaction(f.orgA,async client=>(await client.query(`SELECT (SELECT count(*)::int FROM workflow_cases WHERE organization_id=$1) cases,(SELECT count(*)::int FROM workflow_notification_outbox WHERE organization_id=$1) outbox,(SELECT count(*)::int FROM audit_logs WHERE organization_id=$1 AND action LIKE 'complaint%') complaint_audits,(SELECT count(*)::int FROM complaint_case_events WHERE organization_id=$1) complaint_events,(SELECT count(*)::int FROM complaint_hr_handoffs WHERE organization_id=$1) complaint_handoffs,(SELECT count(*)::int FROM hr_transfer_case_events WHERE organization_id=$1) transfer_events,(SELECT count(*)::int FROM hr_discipline_case_events WHERE organization_id=$1) discipline_events,(SELECT count(*)::int FROM document_links WHERE organization_id=$1 AND entity_type='archive_record') document_links,(SELECT count(*)::int FROM document_links WHERE organization_id=$1 AND entity_type='complaint_hr_handoff') handoff_document_links,(SELECT count(*)::int FROM document_links WHERE organization_id=$1 AND entity_type='hr_transfer_case') transfer_document_links,(SELECT count(*)::int FROM document_links WHERE organization_id=$1 AND entity_type='hr_discipline_case') discipline_document_links`,[f.orgA])).rows[0]);
    assert.ok(evidence.cases>=6);assert.ok(evidence.outbox>=22);assert.ok(evidence.complaint_audits>=4);assert.ok(evidence.complaint_events>=4);assert.equal(evidence.complaint_handoffs,1);assert.ok(evidence.transfer_events>=7);assert.ok(evidence.discipline_events>=9);assert.equal(evidence.document_links,1);assert.equal(evidence.handoff_document_links,1);assert.ok(evidence.transfer_document_links>=1);assert.ok(evidence.discipline_document_links>=1);
    const rls=(await pool.query("SELECT count(*)::int enabled FROM pg_class WHERE relname=ANY($1) AND relrowsecurity",[["hr_appointment_cases","complaint_cases","complaint_case_events","complaint_hr_handoffs","complaint_hr_handoff_events","hr_transfer_cases","hr_transfer_case_events","hr_discipline_cases","hr_discipline_case_events","archive_access_requests","archive_destruction_proposals","domain_command_receipts"]])).rows[0].enabled;
    assert.equal(rls,12,"new Phase 2 tenant tables must have RLS enabled");
    await assert.rejects(pool.query("UPDATE complaint_case_events SET reason='tampered' WHERE organization_id=$1",[f.orgA]));await assert.rejects(pool.query("UPDATE complaint_hr_handoff_events SET reason='tampered' WHERE organization_id=$1",[f.orgA]));await assert.rejects(pool.query("UPDATE hr_transfer_case_events SET reason='tampered' WHERE organization_id=$1",[f.orgA]));await assert.rejects(pool.query("UPDATE hr_discipline_case_events SET reason='tampered' WHERE organization_id=$1",[f.orgA]));await assert.rejects(pool.query("DELETE FROM domain_command_receipts WHERE organization_id=$1",[f.orgA]));
    console.log("Phase 2 domain integration passed: tenant denial, RLS activation, idempotency conflict/replay, concurrency, complaint-to-HR atomic discipline intake, confidential discipline lifecycle, employee transfer Assignment change, leave, appointment, archive, canonical documents, audit, immutable events, and outbox intent.");
    await closePool();
  }
  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
