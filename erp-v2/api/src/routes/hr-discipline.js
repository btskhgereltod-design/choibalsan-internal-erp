"use strict";

const express=require("express");
const {z}=require("zod");
const {authenticate,requireModule}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("../services/audit");
const {computeDisciplineDeadline,computeSanctionExpiry}=require("../services/discipline-deadline");
const {
  createAggregate,transitionAggregate,authorizeAny,canonicalPayload,uuid,key,expected,WorkflowError,
}=require("../services/bounded-domain-workflow");

const router=express.Router();
const optionalUuid=z.union([z.string().uuid(),z.literal(""),z.null()]).optional();
const suspensionSchema=z.object({
  kind:z.enum(["medical_leave","annual_leave","personal_leave","law_enforcement_investigation","audit_investigation","authorized_body_investigation"]),
  startsOn:z.iso.date(),endsOn:z.iso.date(),evidenceDocumentId:z.string().uuid(),
}).refine(value=>value.endsOn>=value.startsOn,{message:"Suspension end must not precede start"});
const createSchema=z.object({
  employeeId:z.string().uuid(),sourceHandoffId:optionalUuid,handoffExpectedVersion:z.coerce.number().int().min(0).optional(),
  violationKey:z.string().trim().min(1).max(200),violationReference:z.string().trim().min(1).max(4000),
  occurredOn:z.iso.date(),discoveredOn:z.iso.date(),legalBasisReference:z.string().trim().min(1).max(1000),
  deadlineClass:z.enum(["ordinary","full_property_liability"]).default("ordinary"),
  deadlineSuspensions:z.array(suspensionSchema).max(100).default([]),decisionDueOn:z.iso.date().optional(),policySnapshot:z.object({
    policyCode:z.string().trim().min(1).max(120),policyVersion:z.string().trim().min(1).max(120),
    fourEyesRequired:z.boolean(),deadlineBasis:z.string().trim().min(1).max(500),
  }).passthrough(),initialEvidenceDocumentIds:z.array(z.string().uuid()).max(30).default([]),idempotencyKey:z.string().uuid(),
}).superRefine((value,ctx)=>{
  if(value.sourceHandoffId&&!Number.isSafeInteger(value.handoffExpectedVersion))ctx.addIssue({code:"custom",path:["handoffExpectedVersion"],message:"Required with sourceHandoffId"});
});
const commandSchema=z.object({
  expectedVersion:z.coerce.number().int().min(0),reason:z.string().trim().min(1).max(4000),
  investigatorUserId:optionalUuid,noticeDocumentId:optionalUuid,explanationStatus:z.enum(["provided","refused"]).optional(),
  explanationDocumentId:optionalUuid,investigationSummary:z.string().trim().max(12000).optional(),
  finding:z.enum(["substantiated","unsubstantiated","insufficient_evidence"]).optional(),
  recommendation:z.string().trim().max(8000).optional(),recommendedActionCode:z.string().trim().max(120).optional(),
  recommendationDocumentId:optionalUuid,decisionOutcome:z.enum(["sanctioned","no_action","returned"]).optional(),
  sanctionCode:z.string().trim().max(120).optional(),decisionDocumentId:optionalUuid,
  effectiveFrom:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),sanctionExpiresOn:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),
  acknowledgementStatus:z.enum(["provided","refused"]).optional(),acknowledgementDocumentId:optionalUuid,
  removalDocumentId:optionalUuid,disputeReference:z.string().trim().max(1000).optional(),disputeDocumentId:optionalUuid,
  disputeResolution:z.string().trim().max(4000).optional(),idempotencyKey:z.string().uuid(),
});
const declineSchema=z.object({expectedVersion:z.coerce.number().int().min(0),reason:z.string().trim().min(1).max(4000),idempotencyKey:z.string().uuid()});
const disciplinePermissions=["hr.discipline.read","hr.discipline.confidential.read","hr.discipline.intake","hr.discipline.investigate","hr.discipline.recommend","hr.discipline.decide","hr.discipline.admin"];

router.use(authenticate,requireModule("hr"));

router.get("/discipline-overview",asyncHandler(async(req,res)=>{
  authorizeAny(req,disciplinePermissions);
  const confidential=(req.user.permissions||[]).includes("hr.discipline.confidential.read");
  const canIntake=(req.user.permissions||[]).includes("hr.discipline.intake");
  const result=await withTenantTransaction(req.user.organization_id,async client=>{
    const summary=confidential?(await client.query(`SELECT count(*)::int total,
      count(*) FILTER(WHERE status NOT IN('closed','cancelled'))::int open,
      count(*) FILTER(WHERE status='decision_pending')::int decision_pending,
      count(*) FILTER(WHERE status IN('sanctioned','acknowledged','monitoring'))::int active_decisions,
      count(*) FILTER(WHERE status NOT IN('closed','cancelled') AND decision_due_on<CURRENT_DATE)::int overdue
      FROM hr_discipline_cases WHERE organization_id=$1`,[req.user.organization_id])).rows[0]:{
        total:null,open:null,decision_pending:null,active_decisions:null,overdue:null,redacted:true,
      };
    const items=confidential?(await client.query(`SELECT c.id,c.case_no,c.employee_id,e.full_name employee_name,c.violation_reference,
      c.occurred_on,c.discovered_on,c.decision_due_on,c.finding,c.decision_outcome,c.sanction_code,c.status,c.version,c.updated_at
      FROM hr_discipline_cases c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
      WHERE c.organization_id=$1 ORDER BY c.updated_at DESC LIMIT 300`,[req.user.organization_id])).rows:[];
    const handoffs=canIntake?(await client.query(`SELECT h.id,h.handoff_no,h.subject_reference,h.reason,h.version,h.requested_at,c.registration_no
      FROM complaint_hr_handoffs h JOIN complaint_cases c ON c.organization_id=h.organization_id AND c.id=h.complaint_case_id
      WHERE h.organization_id=$1 AND h.status='requested' ORDER BY h.requested_at LIMIT 300`,[req.user.organization_id])).rows:[];
    return {summary,items,handoffs,canReadConfidential:confidential,canIntake};
  });
  res.json(result);
}));

router.get("/discipline-cases/:id",asyncHandler(async(req,res)=>{
  authorizeAny(req,["hr.discipline.confidential.read"]);const id=uuid(req.params.id);
  const result=await withTenantTransaction(req.user.organization_id,async client=>{
    const item=(await client.query(`SELECT c.*,e.full_name employee_name,i.full_name investigator_name,r.full_name recommendation_by_name,d.full_name decision_by_name
      FROM hr_discipline_cases c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
      LEFT JOIN users i ON i.organization_id=c.organization_id AND i.id=c.investigator_user_id
      LEFT JOIN users r ON r.organization_id=c.organization_id AND r.id=c.recommendation_by
      LEFT JOIN users d ON d.organization_id=c.organization_id AND d.id=c.decision_by
      WHERE c.organization_id=$1 AND c.id=$2`,[req.user.organization_id,id])).rows[0];
    if(!item)return null;
    const [events,workflow,documents]=await Promise.all([
      client.query("SELECT * FROM hr_discipline_case_events WHERE organization_id=$1 AND discipline_case_id=$2 ORDER BY created_at,id",[req.user.organization_id,id]),
      client.query(`SELECT e.* FROM workflow_transition_events e JOIN workflow_cases w ON w.organization_id=e.organization_id AND w.id=e.case_id
        WHERE w.organization_id=$1 AND w.subject_type='hr_discipline_case' AND w.subject_id=$2 ORDER BY e.created_at,e.id`,[req.user.organization_id,id]),
      client.query(`SELECT d.id,d.document_no,d.title,d.status,d.classification_code FROM document_links l JOIN documents d
        ON d.organization_id=l.organization_id AND d.id=l.document_id
        WHERE l.organization_id=$1 AND l.entity_type='hr_discipline_case' AND l.entity_id=$2`,[req.user.organization_id,id]),
    ]);
    return {item,events:events.rows,workflow:workflow.rows,documents:documents.rows};
  });
  if(!result)return res.status(404).json({error:"DISCIPLINE_CASE_NOT_FOUND"});res.json(result);
}));

router.post("/discipline-cases",asyncHandler(async(req,res)=>{
  const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_DISCIPLINE_CASE",issues:parsed.error.issues});
  const v=parsed.data,deadline=computeDisciplineDeadline({occurredOn:v.occurredOn,discoveredOn:v.discoveredOn,deadlineClass:v.deadlineClass,suspensionPeriods:v.deadlineSuspensions});
  if(v.decisionDueOn&&v.decisionDueOn!==deadline.decisionDueOn)return res.status(409).json({error:"DISCIPLINE_DECISION_DUE_MISMATCH",computedDecisionDueOn:deadline.decisionDueOn});
  const payload={...v,decisionDueOn:deadline.decisionDueOn,deadlineCalculation:deadline.evidence};
  const evidenceDocumentIds=[...new Set([...v.initialEvidenceDocumentIds,...v.deadlineSuspensions.map(item=>item.evidenceDocumentId)])];
  const result=await createAggregate({req,domain:"discipline",initialState:"intake",idempotencyKey:v.idempotencyKey,payload,
    permissions:["hr.discipline.intake"],documentIds:evidenceDocumentIds,insert:async(client,c)=>{
      const employee=await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 AND active=true",[c.organizationId,v.employeeId]);
      if(!employee.rowCount)throw Object.assign(new Error("ACTIVE_EMPLOYEE_NOT_FOUND"),{status:404});
      if(v.sourceHandoffId){const handoff=(await client.query("SELECT * FROM complaint_hr_handoffs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[c.organizationId,v.sourceHandoffId])).rows[0];if(!handoff)throw Object.assign(new Error("HANDOFF_NOT_FOUND"),{status:404});if(handoff.status!=="requested"||Number(handoff.version)!==v.handoffExpectedVersion)throw Object.assign(new Error("HANDOFF_STATE_CONFLICT"),{status:409})}
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${c.organizationId}:hr-discipline`]);
      const n=(await client.query("SELECT COALESCE(max(substring(case_no from '[0-9]+$')::int),0)+1 next FROM hr_discipline_cases WHERE organization_id=$1",[c.organizationId])).rows[0].next;
      return (await client.query(`INSERT INTO hr_discipline_cases(
        id,organization_id,case_no,employee_id,source_handoff_id,violation_key,violation_reference,occurred_on,discovered_on,
        legal_basis_reference,deadline_rule_code,deadline_suspensions,deadline_calculation,decision_due_on,policy_snapshot,idempotency_key,payload_sha256,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17,$18) RETURNING *`,[
        c.id,c.organizationId,`DSC-${String(n).padStart(6,"0")}`,v.employeeId,v.sourceHandoffId||null,v.violationKey,v.violationReference,
        v.occurredOn,v.discoveredOn,v.legalBasisReference,v.deadlineClass,JSON.stringify(v.deadlineSuspensions),JSON.stringify(deadline.evidence),deadline.decisionDueOn,JSON.stringify(v.policySnapshot),c.idempotencyKey,c.payloadSha256,c.actorUserId,
      ])).rows[0];
    },after:v.sourceHandoffId?async(client,ctx)=>{
      const updated=(await client.query(`UPDATE complaint_hr_handoffs SET status='accepted',target_discipline_case_id=$4,
        responded_by=$5,responded_at=now(),updated_at=now(),version=version+1
        WHERE organization_id=$1 AND id=$2 AND status='requested' AND version=$3 RETURNING *`,[
        ctx.organizationId,v.sourceHandoffId,v.handoffExpectedVersion,ctx.item.id,ctx.actorUserId,
      ])).rows[0];
      if(!updated)throw Object.assign(new Error("HANDOFF_STATE_CONFLICT"),{status:409});
      await client.query(`INSERT INTO complaint_hr_handoff_events(organization_id,handoff_id,version,event_type,actor_user_id,reason,detail,request_id)
        VALUES($1,$2,$3,'accepted',$4,$5,$6::jsonb,$7)`,[ctx.organizationId,v.sourceHandoffId,updated.version,ctx.actorUserId,
        "Accepted into an independently reviewed HR case",JSON.stringify({disciplineCaseId:ctx.item.id}),ctx.requestId]);
      await writeAudit(req,"complaint_hr_handoff.accepted","complaint_hr_handoff",v.sourceHandoffId,{disciplineCaseId:ctx.item.id,version:updated.version},client);
    }:null});
  res.status(result.replayed?200:201).json(result);
}));

router.post("/discipline-handoffs/:id/decline",asyncHandler(async(req,res)=>{
  authorizeAny(req,["hr.discipline.intake"]);const handoffId=uuid(req.params.id,"handoff_id"),parsed=declineSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"INVALID_HANDOFF_DECISION",issues:parsed.error.issues});
  const v=parsed.data,requestId=key(v.idempotencyKey),version=expected(v.expectedVersion),hash=canonicalPayload({handoffId,expectedVersion:version,reason:v.reason});
  const result=await withTenantTransaction(req.user.organization_id,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${req.user.organization_id}:discipline-handoff:${handoffId}:${requestId}`]);
    const replay=(await client.query("SELECT detail FROM complaint_hr_handoff_events WHERE organization_id=$1 AND handoff_id=$2 AND request_id=$3",[req.user.organization_id,handoffId,requestId])).rows[0];
    if(replay){if(replay.detail?.payloadSha256!==hash)throw new WorkflowError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",409);return {item:(await client.query("SELECT * FROM complaint_hr_handoffs WHERE organization_id=$1 AND id=$2",[req.user.organization_id,handoffId])).rows[0],replayed:true}}
    const item=(await client.query("SELECT * FROM complaint_hr_handoffs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,handoffId])).rows[0];
    if(!item)throw new WorkflowError("HANDOFF_NOT_FOUND",404);if(item.status!=="requested"||Number(item.version)!==version)throw new WorkflowError("HANDOFF_STATE_CONFLICT",409);
    const updated=(await client.query(`UPDATE complaint_hr_handoffs SET status='declined',response_reason=$3,responded_by=$4,responded_at=now(),updated_at=now(),version=version+1
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,handoffId,v.reason,req.user.id])).rows[0];
    await client.query(`INSERT INTO complaint_hr_handoff_events(organization_id,handoff_id,version,event_type,actor_user_id,reason,detail,request_id)
      VALUES($1,$2,$3,'declined',$4,$5,$6::jsonb,$7)`,[req.user.organization_id,handoffId,updated.version,req.user.id,v.reason,JSON.stringify({payloadSha256:hash}),requestId]);
    await writeAudit(req,"complaint_hr_handoff.declined","complaint_hr_handoff",handoffId,{reason:v.reason,version:updated.version,requestId},client);
    return {item:updated,replayed:false};
  });res.json(result);
}));

const commandRules={
  assign_investigator:{to:"investigation",from:["intake","returned"],permissions:["hr.discipline.investigate"]},
  issue_notice:{to:"explanation_pending",from:["investigation"],permissions:["hr.discipline.investigate"]},
  record_explanation:{to:"investigation",from:["explanation_pending"],permissions:["hr.discipline.investigate"]},
  submit_recommendation:{to:"recommendation_review",from:["investigation"],permissions:["hr.discipline.recommend"]},
  request_decision:{to:"decision_pending",from:["recommendation_review"],permissions:["hr.discipline.recommend"]},
  return:{to:"returned",from:["recommendation_review","decision_pending"],permissions:["hr.discipline.decide"],decision:"returned"},
  acknowledge:{to:"acknowledged",from:["sanctioned","no_action"],permissions:["hr.discipline.admin"]},
  start_monitoring:{to:"monitoring",from:["acknowledged"],permissions:["hr.discipline.admin"]},
  expire:{to:"expired",from:["sanctioned","acknowledged","monitoring"],permissions:["hr.discipline.admin"]},
  early_remove:{to:"removed",from:["sanctioned","acknowledged","monitoring"],permissions:["hr.discipline.admin"]},
  dispute:{to:"disputed",from:["sanctioned","acknowledged","monitoring","expired","removed","closed"],permissions:["hr.discipline.admin"]},
  resolve_dispute:{to:"closed",from:["disputed"],permissions:["hr.discipline.admin","hr.discipline.decide"]},
  close:{to:"closed",from:["acknowledged","no_action","expired","removed"],permissions:["hr.discipline.admin"]},
  cancel:{to:"cancelled",from:["intake"],permissions:["hr.discipline.intake"]},
};

router.post("/discipline-cases/:id/commands/:command",asyncHandler(async(req,res)=>{
  const command=req.params.command,parsed=commandSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_COMMAND",issues:parsed.error.issues});
  const v=parsed.data;let rule=commandRules[command];if(command==="decide"){
    if(!v.decisionOutcome)return res.status(400).json({error:"DECISION_OUTCOME_REQUIRED"});
    rule={to:v.decisionOutcome==="sanctioned"?"sanctioned":v.decisionOutcome==="no_action"?"no_action":"returned",from:["decision_pending"],permissions:["hr.discipline.decide"],decision:v.decisionOutcome==="returned"?"returned":"approved"};
  }
  if(!rule)return res.status(404).json({error:"UNKNOWN_COMMAND"});
  const set={},documents=[];const addDocument=(column,value)=>{if(value){set[column]=value;documents.push(value)}};
  if(v.investigatorUserId)set.investigator_user_id=v.investigatorUserId;
  addDocument("notice_document_id",v.noticeDocumentId);addDocument("explanation_document_id",v.explanationDocumentId);
  addDocument("recommendation_document_id",v.recommendationDocumentId);addDocument("decision_document_id",v.decisionDocumentId);
  addDocument("acknowledgement_document_id",v.acknowledgementDocumentId);addDocument("removal_document_id",v.removalDocumentId);addDocument("dispute_document_id",v.disputeDocumentId);
  if(v.explanationStatus)set.explanation_status=v.explanationStatus;if(v.investigationSummary!==undefined)set.investigation_summary=v.investigationSummary;
  if(v.finding)set.finding=v.finding;if(v.recommendation!==undefined)set.recommendation=v.recommendation;if(v.recommendedActionCode)set.recommended_action_code=v.recommendedActionCode;
  if(v.sanctionCode)set.sanction_code=v.sanctionCode;if(v.effectiveFrom)set.effective_from=v.effectiveFrom;if(v.sanctionExpiresOn)set.sanction_expires_on=v.sanctionExpiresOn;
  if(v.acknowledgementStatus)set.acknowledgement_status=v.acknowledgementStatus;if(v.disputeReference!==undefined)set.dispute_reference=v.disputeReference;if(v.disputeResolution!==undefined)set.dispute_resolution=v.disputeResolution;
  const result=await transitionAggregate({req,domain:"discipline",id:req.params.id,expectedVersion:v.expectedVersion,command,toState:rule.to,allowedFrom:rule.from,permissions:rule.permissions,
    reason:v.reason,coordinationReason:`Restricted discipline command: ${command}`,decision:rule.decision||null,stepCode:command,idempotencyKey:v.idempotencyKey,set,documentIds:documents,precondition:async(client,current)=>{
      if(command==="assign_investigator"){
        if(!v.investigatorUserId)throw Object.assign(new Error("INVESTIGATOR_REQUIRED"),{status:409});const user=await client.query("SELECT id FROM users WHERE organization_id=$1 AND id=$2 AND active=true",[current.organization_id,v.investigatorUserId]);if(!user.rowCount)throw Object.assign(new Error("INVESTIGATOR_NOT_FOUND"),{status:404});
        if(current.status==="returned")Object.assign(set,{decision_outcome:null,sanction_code:null,decision_reason:"",decision_document_id:null,decision_by:null,decision_at:null,effective_from:null,sanction_expires_on:null});
      }
      if(command==="issue_notice"){if(!v.noticeDocumentId)throw Object.assign(new Error("DISCIPLINE_NOTICE_REQUIRED"),{status:409});set.notice_at=new Date()}
      if(command==="record_explanation"){if(!v.explanationStatus||!v.explanationDocumentId)throw Object.assign(new Error("DISCIPLINE_EXPLANATION_EVIDENCE_REQUIRED"),{status:409});set.explanation_at=new Date()}
      if(command==="submit_recommendation"){
        if(current.explanation_status==="pending"||!v.finding||!v.recommendation||!v.recommendationDocumentId)throw Object.assign(new Error("DISCIPLINE_RECOMMENDATION_INCOMPLETE"),{status:409});
        if(v.finding==="substantiated"&&!v.recommendedActionCode)throw Object.assign(new Error("RECOMMENDED_ACTION_REQUIRED"),{status:409});
        set.recommendation_by=req.user.id;set.recommendation_at=new Date();
      }
      if(command==="request_decision"&&(!current.recommendation_document_id||current.finding==="pending"))throw Object.assign(new Error("DISCIPLINE_RECOMMENDATION_INCOMPLETE"),{status:409});
      if(command==="decide"||command==="return"){
        const outcome=command==="return"?"returned":v.decisionOutcome;if(!v.decisionDocumentId)throw Object.assign(new Error("DISCIPLINE_DECISION_DOCUMENT_REQUIRED"),{status:409});
        const fourEyes=current.policy_snapshot?.fourEyesRequired===true;if(fourEyes&&[current.created_by,current.investigator_user_id,current.recommendation_by].includes(req.user.id))throw Object.assign(new Error("DISCIPLINE_FOUR_EYES_REQUIRED"),{status:409});
        const decisionDate=String((await client.query("SELECT CURRENT_DATE::text value")).rows[0].value);
        if(outcome==="sanctioned"&&decisionDate>String(current.decision_due_on).slice(0,10))throw Object.assign(new Error("DISCIPLINE_DECISION_DEADLINE_EXPIRED"),{status:409});
        if(outcome==="sanctioned"&&(!v.sanctionCode||!v.effectiveFrom))throw Object.assign(new Error("DISCIPLINE_SANCTION_TERMS_REQUIRED"),{status:409});
        if(outcome==="sanctioned"){
          if(v.effectiveFrom>decisionDate)throw Object.assign(new Error("DISCIPLINE_EFFECTIVE_DATE_IN_FUTURE"),{status:409});
          const computedExpiry=computeSanctionExpiry(decisionDate);
          if(v.sanctionExpiresOn&&v.sanctionExpiresOn!==computedExpiry)throw Object.assign(new Error("DISCIPLINE_SANCTION_EXPIRY_MISMATCH"),{status:409,detail:{computedSanctionExpiresOn:computedExpiry}});
          set.sanction_expires_on=computedExpiry;
        }
        set.decision_outcome=outcome;set.decision_reason=v.reason;set.decision_by=req.user.id;set.decision_at=new Date();
      }
      if(command==="acknowledge"){if(!v.acknowledgementStatus||!v.acknowledgementDocumentId)throw Object.assign(new Error("DISCIPLINE_ACKNOWLEDGEMENT_EVIDENCE_REQUIRED"),{status:409});set.acknowledged_at=new Date()}
      if(command==="start_monitoring"&&current.decision_outcome!=="sanctioned")throw Object.assign(new Error("DISCIPLINE_SANCTION_REQUIRED"),{status:409});
      if(command==="expire"){const today=(await client.query("SELECT CURRENT_DATE::text value")).rows[0].value;if(!current.sanction_expires_on||String(current.sanction_expires_on).slice(0,10)>String(today))throw Object.assign(new Error("DISCIPLINE_EXPIRY_NOT_REACHED"),{status:409})}
      if(command==="early_remove"){if(!v.removalDocumentId)throw Object.assign(new Error("DISCIPLINE_REMOVAL_EVIDENCE_REQUIRED"),{status:409});set.removed_at=new Date();set.removal_reason=v.reason}
      if(command==="dispute"){if(!v.disputeReference||!v.disputeDocumentId)throw Object.assign(new Error("DISCIPLINE_DISPUTE_EVIDENCE_REQUIRED"),{status:409});set.dispute_status="raised"}
      if(command==="resolve_dispute"){if(!v.disputeResolution)throw Object.assign(new Error("DISCIPLINE_DISPUTE_RESOLUTION_REQUIRED"),{status:409});set.dispute_status="resolved";set.closed_at=new Date()}
      if(command==="close"){if(current.decision_outcome==="sanctioned"&&!['expired','removed'].includes(current.status))throw Object.assign(new Error("DISCIPLINE_ACTIVE_SANCTION_CANNOT_CLOSE"),{status:409});set.closed_at=new Date()}
    }});
  res.json(result);
}));

module.exports=router;
