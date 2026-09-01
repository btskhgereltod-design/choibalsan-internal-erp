"use strict";

const crypto = require("node:crypto");
const { withTenantTransaction } = require("../db");
const { writeAudit } = require("./audit");

class WorkflowError extends Error {
  constructor(code, status = 400, detail = {}) {
    super(code);
    this.name = "WorkflowError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function payloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function requireText(value, name, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum) throw new WorkflowError(`INVALID_${name.toUpperCase()}`, 400);
  return text;
}

function requireUuid(value, name) {
  const text=requireText(value,name,36);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new WorkflowError(`INVALID_${name.toUpperCase()}`,400);
  }
  return text;
}

function authorize(req, requiredPermissions = ["workflow.coordinate"]) {
  if (!req?.user?.id || !req.user.organization_id) throw new WorkflowError("AUTHENTICATION_REQUIRED", 401);
  const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  if (!required.length) throw new WorkflowError("WORKFLOW_PERMISSION_REQUIRED", 500);
  const granted = new Set(req.user.permissions || []);
  const missing = required.filter(permission => !granted.has(permission));
  if (missing.length) throw new WorkflowError("WORKFLOW_FORBIDDEN", 403, { permissions:missing });
  return { organizationId:req.user.organization_id, actorUserId:req.user.id };
}

async function inTransaction(existingClient, organizationId, operation) {
  return withTenantTransaction(organizationId,operation,{client:existingClient});
}

async function lockCommand(client, scope) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope]);
}

async function findReceipt(client, identity, commandType, idempotencyKey, hash) {
  const result = await client.query(
    `SELECT result,payload_sha256 FROM workflow_command_receipts
      WHERE organization_id=$1 AND workflow_type=$2 AND subject_type=$3 AND subject_id=$4
        AND command_type=$5 AND idempotency_key=$6`,
    [identity.organization_id,identity.workflow_type,identity.subject_type,identity.subject_id,commandType,idempotencyKey]
  );
  if (!result.rowCount) return null;
  if (result.rows[0].payload_sha256.trim() !== hash) {
    throw new WorkflowError("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD", 409);
  }
  return { ...result.rows[0].result, replayed:true };
}

async function storeReceipt(client, identity, commandType, idempotencyKey, hash, actorUserId, result) {
  await client.query(
    `INSERT INTO workflow_command_receipts(
       organization_id,case_id,workflow_type,subject_type,subject_id,command_type,
       idempotency_key,payload_sha256,result,actor_user_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [identity.organization_id,identity.id,identity.workflow_type,identity.subject_type,
      identity.subject_id,commandType,idempotencyKey,hash,JSON.stringify(result),actorUserId]
  );
}

async function emitOutbox(client, identity, eventType, caseVersion, actorUserId, payload,
  recipientUserId = null, requestId = null) {
  await client.query(
    `INSERT INTO workflow_notification_outbox(
       organization_id,case_id,event_type,dedupe_key,recipient_user_id,payload,actor_user_id,
       correlation_id,request_id
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
    [identity.organization_id,identity.id,eventType,`${identity.id}:${caseVersion}:${eventType}`,
      recipientUserId,JSON.stringify(payload),actorUserId,crypto.randomUUID(),requestId]
  );
}

async function loadCaseForUpdate(client, organizationId, caseId) {
  const result = await client.query(
    "SELECT * FROM workflow_cases WHERE organization_id=$1 AND id=$2 FOR UPDATE",
    [organizationId,caseId]
  );
  if (!result.rowCount) throw new WorkflowError("WORKFLOW_CASE_NOT_FOUND", 404);
  return result.rows[0];
}

function caseIdentity(row) {
  return {
    id:row.id,
    organization_id:row.organization_id,
    workflow_type:row.workflow_type,
    subject_type:row.subject_type,
    subject_id:row.subject_id,
  };
}

function assertVersion(row, expectedVersion) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw new WorkflowError("EXPECTED_VERSION_REQUIRED", 400);
  }
  if (Number(row.version) !== expectedVersion) {
    throw new WorkflowError("WORKFLOW_VERSION_CONFLICT", 409, {
      expectedVersion,
      actualVersion:Number(row.version),
    });
  }
}

async function createWorkflowCase({ req, workflowType, subjectType, subjectId, initialState,
  idempotencyKey, detail = {}, requiredPermissions, client = null }) {
  const actor = authorize(req, requiredPermissions);
  const input = {
    workflowType:requireText(workflowType,"workflow_type",120),
    subjectType:requireText(subjectType,"subject_type",120),
    subjectId:requireText(subjectId,"subject_id",240),
    initialState:requireText(initialState,"initial_state",120),
    detail,
  };
  const key = requireText(idempotencyKey,"idempotency_key",240);
  const hash = payloadHash(input);
  return inTransaction(client,actor.organizationId,async tx => {
    const identity = {
      organization_id:actor.organizationId,
      workflow_type:input.workflowType,
      subject_type:input.subjectType,
      subject_id:input.subjectId,
    };
    await lockCommand(tx, `workflow:${actor.organizationId}:${input.workflowType}:${input.subjectType}:${input.subjectId}`);
    const replay = await findReceipt(tx, identity,"case.create",key,hash);
    if (replay) return replay;
    let row;
    try {
      row = (await tx.query(
        `INSERT INTO workflow_cases(
           organization_id,workflow_type,subject_type,subject_id,coordination_state,created_by
         ) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [actor.organizationId,input.workflowType,input.subjectType,input.subjectId,input.initialState,actor.actorUserId]
      )).rows[0];
    } catch (error) {
      if (error.code === "23505") throw new WorkflowError("WORKFLOW_CASE_EXISTS", 409);
      throw error;
    }
    const fullIdentity = caseIdentity(row);
    await tx.query(
      `INSERT INTO workflow_transition_events(
         organization_id,case_id,case_version,transition_name,to_coordination_state,
         actor_user_id,detail
       ) VALUES($1,$2,0,'created',$3,$4,$5::jsonb)`,
      [actor.organizationId,row.id,input.initialState,actor.actorUserId,JSON.stringify(detail)]
    );
    const result = { case:row, replayed:false };
    await emitOutbox(tx,fullIdentity,"workflow.case.created",0,actor.actorUserId,{ workflowType:input.workflowType,subjectType:input.subjectType,subjectId:input.subjectId },null,key);
    await writeAudit(req,"workflow.case.create","workflow_case",row.id,{ workflowType:input.workflowType,subjectType:input.subjectType,subjectId:input.subjectId },tx);
    await storeReceipt(tx,fullIdentity,"case.create",key,hash,actor.actorUserId,result);
    return result;
  });
}

async function transitionWorkflowCase({ req, caseId, expectedVersion, transitionName, toState,
  domainFromState = null, domainToState = null, decision = null, stepCode = "", reason = "",
  comment = "", detail = {}, idempotencyKey, requiredPermissions, client = null }) {
  const actor = authorize(req, requiredPermissions);
  const input = {
    caseId:requireUuid(caseId,"case_id"), expectedVersion,
    transitionName:requireText(transitionName,"transition_name",120),
    toState:requireText(toState,"to_state",120), domainFromState,domainToState,
    decision,stepCode:String(stepCode || ""),reason:String(reason || ""),
    comment:String(comment || ""),detail,
  };
  if (decision !== null && !["approved","rejected","returned"].includes(decision)) {
    throw new WorkflowError("INVALID_DECISION", 400);
  }
  if (decision && !input.reason.trim()) throw new WorkflowError("DECISION_REASON_REQUIRED", 400);
  const key = requireText(idempotencyKey,"idempotency_key",240);
  const hash = payloadHash(input);
  return inTransaction(client,actor.organizationId,async tx => {
    await lockCommand(tx, `workflow-command:${actor.organizationId}:${input.caseId}:${key}`);
    const row = await loadCaseForUpdate(tx,actor.organizationId,input.caseId);
    const identity = caseIdentity(row);
    const replay = await findReceipt(tx,identity,"case.transition",key,hash);
    if (replay) return replay;
    assertVersion(row,expectedVersion);
    const nextVersion = expectedVersion + 1;
    const updated = (await tx.query(
      `UPDATE workflow_cases SET coordination_state=$3,version=$4,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$5 RETURNING *`,
      [actor.organizationId,row.id,input.toState,nextVersion,expectedVersion]
    )).rows[0];
    if (!updated) throw new WorkflowError("WORKFLOW_VERSION_CONFLICT",409);
    await tx.query(
      `INSERT INTO workflow_transition_events(
         organization_id,case_id,case_version,transition_name,from_coordination_state,
         to_coordination_state,domain_from_state,domain_to_state,decision,reason,comment,
         actor_user_id,detail
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [actor.organizationId,row.id,nextVersion,input.transitionName,row.coordination_state,input.toState,
        domainFromState,domainToState,decision,input.reason,input.comment,actor.actorUserId,JSON.stringify(detail)]
    );
    if (decision) {
      await tx.query(
        `INSERT INTO workflow_decision_events(
           organization_id,case_id,case_version,decision,step_code,reason,comment,actor_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [actor.organizationId,row.id,nextVersion,decision,input.stepCode,input.reason,input.comment,actor.actorUserId]
      );
    }
    const result = { case:updated, replayed:false };
    await emitOutbox(tx,identity,"workflow.case.transitioned",nextVersion,actor.actorUserId,{ transitionName:input.transitionName,toState:input.toState,decision },null,key);
    await writeAudit(req,"workflow.case.transition","workflow_case",row.id,{ transitionName:input.transitionName,from:row.coordination_state,to:input.toState,version:nextVersion,decision },tx);
    await storeReceipt(tx,identity,"case.transition",key,hash,actor.actorUserId,result);
    return result;
  });
}

async function assignWorkflowCase({ req, caseId, expectedVersion, assigneeUserId = null,
  reason = "", idempotencyKey, requiredPermissions, client = null }) {
  const actor = authorize(req, requiredPermissions);
  const normalizedAssignee = assigneeUserId === null ? null : requireUuid(assigneeUserId,"assignee_user_id");
  const input = { caseId:requireUuid(caseId,"case_id"),expectedVersion,assigneeUserId:normalizedAssignee,reason:String(reason || "") };
  const key = requireText(idempotencyKey,"idempotency_key",240);
  const hash = payloadHash(input);
  return inTransaction(client,actor.organizationId,async tx => {
    await lockCommand(tx,`workflow-command:${actor.organizationId}:${input.caseId}:${key}`);
    const row = await loadCaseForUpdate(tx,actor.organizationId,input.caseId);
    const identity = caseIdentity(row);
    const replay = await findReceipt(tx,identity,"case.assign",key,hash);
    if (replay) return replay;
    assertVersion(row,expectedVersion);
    if (row.current_assignee_user_id === normalizedAssignee) throw new WorkflowError("ASSIGNMENT_UNCHANGED",409);
    if (normalizedAssignee) {
      const user = await tx.query("SELECT id FROM users WHERE organization_id=$1 AND id=$2 AND active=true",[actor.organizationId,normalizedAssignee]);
      if (!user.rowCount) throw new WorkflowError("ASSIGNEE_NOT_FOUND",404);
    }
    const operation = !row.current_assignee_user_id ? "assigned" : !normalizedAssignee ? "unassigned" : "reassigned";
    const nextVersion = expectedVersion + 1;
    const updated = (await tx.query(
      `UPDATE workflow_cases SET current_assignee_user_id=$3,version=$4,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$5 RETURNING *`,
      [actor.organizationId,row.id,normalizedAssignee,nextVersion,expectedVersion]
    )).rows[0];
    if (!updated) throw new WorkflowError("WORKFLOW_VERSION_CONFLICT",409);
    await tx.query(
      `INSERT INTO workflow_assignment_events(
         organization_id,case_id,case_version,operation,from_user_id,to_user_id,reason,actor_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [actor.organizationId,row.id,nextVersion,operation,row.current_assignee_user_id,normalizedAssignee,input.reason,actor.actorUserId]
    );
    const result = { case:updated,operation,replayed:false };
    await emitOutbox(tx,identity,"workflow.case.assigned",nextVersion,actor.actorUserId,{ operation,assigneeUserId:normalizedAssignee },normalizedAssignee,key);
    await writeAudit(req,"workflow.case.assign","workflow_case",row.id,{ operation,fromUserId:row.current_assignee_user_id,toUserId:normalizedAssignee,version:nextVersion },tx);
    await storeReceipt(tx,identity,"case.assign",key,hash,actor.actorUserId,result);
    return result;
  });
}

async function addWorkflowComment({ req, caseId, expectedVersion, comment, idempotencyKey,
  requiredPermissions, client = null }) {
  const actor = authorize(req,requiredPermissions);
  const input = { caseId:requireUuid(caseId,"case_id"),expectedVersion,comment:requireText(comment,"comment",4000) };
  const key = requireText(idempotencyKey,"idempotency_key",240);
  const hash = payloadHash(input);
  return inTransaction(client,actor.organizationId,async tx => {
    await lockCommand(tx,`workflow-command:${actor.organizationId}:${input.caseId}:${key}`);
    const row = await loadCaseForUpdate(tx,actor.organizationId,input.caseId);
    const identity = caseIdentity(row);
    const replay = await findReceipt(tx,identity,"case.comment",key,hash);
    if (replay) return replay;
    assertVersion(row,expectedVersion);
    const nextVersion=expectedVersion+1;
    const updated=(await tx.query(
      `UPDATE workflow_cases SET version=$3,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$4 RETURNING *`,
      [actor.organizationId,row.id,nextVersion,expectedVersion]
    )).rows[0];
    if(!updated)throw new WorkflowError("WORKFLOW_VERSION_CONFLICT",409);
    await tx.query(
      `INSERT INTO workflow_comment_events(organization_id,case_id,case_version,comment,actor_user_id)
       VALUES($1,$2,$3,$4,$5)`,
      [actor.organizationId,row.id,nextVersion,input.comment,actor.actorUserId]
    );
    const result={case:updated,replayed:false};
    await emitOutbox(tx,identity,"workflow.case.commented",nextVersion,actor.actorUserId,{},null,key);
    await writeAudit(req,"workflow.case.comment","workflow_case",row.id,{version:nextVersion},tx);
    await storeReceipt(tx,identity,"case.comment",key,hash,actor.actorUserId,result);
    return result;
  });
}

async function getWorkflowCase({ req, caseId, requiredPermissions, client = null }) {
  const actor=authorize(req,requiredPermissions);
  return withTenantTransaction(actor.organizationId,async tx=>{
    const result=await tx.query("SELECT * FROM workflow_cases WHERE organization_id=$1 AND id=$2",[actor.organizationId,requireUuid(caseId,"case_id")]);
    if(!result.rowCount)throw new WorkflowError("WORKFLOW_CASE_NOT_FOUND",404);
    return result.rows[0];
  },{client});
}

module.exports = {
  WorkflowError,
  payloadHash,
  createWorkflowCase,
  transitionWorkflowCase,
  assignWorkflowCase,
  addWorkflowComment,
  getWorkflowCase,
};
