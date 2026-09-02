"use strict";

const {withTenantTransaction}=require("../db");
const {recordDocumentLink}=require("./document-links");
const {
  WorkflowError,authorizeAny,transitionAggregate,canonicalPayload,uuid,key,expected,
}=require("./bounded-domain-workflow");

async function requestHrDisciplineAssessment({
  req,complaintCaseId,expectedVersion,subjectReference,reason,documentIds=[],idempotencyKey,
}){
  authorizeAny(req,["complaints.handoff.create"]);
  const organizationId=req.user.organization_id;
  const caseId=uuid(complaintCaseId,"complaint_case_id");
  const version=expected(expectedVersion);
  const requestId=key(idempotencyKey);
  const subject=String(subjectReference||"").trim();
  const rationale=String(reason||"").trim();
  const evidenceIds=documentIds.map(value=>uuid(value,"document_id"));
  if(!subject||subject.length>500)throw new WorkflowError("INVALID_SUBJECT_REFERENCE",400);
  if(!rationale||rationale.length>4000)throw new WorkflowError("INVALID_HANDOFF_REASON",400);
  const handoffPayload={complaintCaseId:caseId,subjectReference:subject,reason:rationale,documentIds:evidenceIds};
  const handoffHash=canonicalPayload(handoffPayload);
  const replay=await withTenantTransaction(organizationId,async client=>(await client.query(
    "SELECT * FROM complaint_hr_handoffs WHERE organization_id=$1 AND idempotency_key=$2",
    [organizationId,requestId],
  )).rows[0]);
  if(replay){
    if(String(replay.payload_sha256).trim()!==handoffHash)throw new WorkflowError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",409);
    const item=await withTenantTransaction(organizationId,async client=>(await client.query(
      "SELECT * FROM complaint_cases WHERE organization_id=$1 AND id=$2",
      [organizationId,caseId],
    )).rows[0]);
    return {item,handoff:replay,replayed:true};
  }
  const current=await withTenantTransaction(organizationId,async client=>(await client.query(
    "SELECT status FROM complaint_cases WHERE organization_id=$1 AND id=$2",
    [organizationId,caseId],
  )).rows[0]);
  if(!current)throw new WorkflowError("DOMAIN_RECORD_NOT_FOUND",404);
  const result=await transitionAggregate({
    req,domain:"complaint",id:caseId,expectedVersion:version,
    command:"request_discipline_handoff",toState:current.status,
    allowedFrom:["in_progress","under_review","response_approved","response_sent","implementation_monitoring","closed"],
    permissions:["complaints.handoff.create"],reason:rationale,idempotencyKey:requestId,
    detail:{handoffId:requestId,subjectReference:subject},documentIds:evidenceIds,
    after:async(client,ctx)=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${ctx.organizationId}:complaint-hr-handoff`]);
      const next=(await client.query("SELECT COALESCE(max(substring(handoff_no from '[0-9]+$')::int),0)+1 next FROM complaint_hr_handoffs WHERE organization_id=$1",[ctx.organizationId])).rows[0].next;
      await client.query(`INSERT INTO complaint_hr_handoffs(
        id,organization_id,handoff_no,complaint_case_id,subject_reference,reason,idempotency_key,
        payload_sha256,requested_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[
        requestId,ctx.organizationId,`HRH-${String(next).padStart(6,"0")}`,ctx.current.id,
        subject,rationale,requestId,handoffHash,ctx.actorUserId,
      ]);
      await client.query(`INSERT INTO complaint_hr_handoff_events(
        organization_id,handoff_id,version,event_type,actor_user_id,reason,detail,request_id
      ) VALUES($1,$2,0,'requested',$3,$4,$5::jsonb,$6)`,[
        ctx.organizationId,requestId,ctx.actorUserId,rationale,
        JSON.stringify({complaintCaseId:ctx.current.id,subjectReference:subject}),requestId,
      ]);
      for(const documentId of evidenceIds)await recordDocumentLink({
        req,documentId,entityType:"complaint_hr_handoff",entityId:requestId,relationType:"evidence",
        source:"domain",requiredPermissions:[],client,
      });
    },
  });
  const handoff=await withTenantTransaction(organizationId,async client=>(await client.query(
    "SELECT * FROM complaint_hr_handoffs WHERE organization_id=$1 AND id=$2",
    [organizationId,requestId],
  )).rows[0]);
  return {...result,handoff};
}

module.exports={requestHrDisciplineAssessment};
