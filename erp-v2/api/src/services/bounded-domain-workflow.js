"use strict";

const crypto=require("node:crypto");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("./audit");
const {recordDocumentLink}=require("./document-links");
const {
  WorkflowError,payloadHash,createWorkflowCase,transitionWorkflowCase,assignWorkflowCase,
}=require("./workflow-coordination");

const DEFINITIONS={
  complaint:{
    table:"complaint_cases",eventTable:"complaint_case_events",foreignKey:"complaint_case_id",
    workflowType:"complaint_case",subjectType:"complaint_case",stateColumn:"status",assigneeColumn:"assigned_user_id",
  },
  correspondence:{
    table:"correspondence_records",eventTable:"correspondence_events",foreignKey:"correspondence_id",
    workflowType:"correspondence",subjectType:"correspondence",stateColumn:"status",assigneeColumn:"responsible_user_id",
  },
  appointment:{
    table:"hr_appointment_cases",eventTable:null,foreignKey:null,
    workflowType:"hr_appointment",subjectType:"hr_appointment_case",stateColumn:"status",assigneeColumn:null,
  },
  exit:{
    table:"hr_employment_exit_cases",eventTable:null,foreignKey:null,
    workflowType:"hr_employment_exit",subjectType:"hr_employment_exit_case",stateColumn:"status",assigneeColumn:null,
  },
  transfer:{
    table:"hr_transfer_cases",eventTable:"hr_transfer_case_events",foreignKey:"transfer_case_id",
    workflowType:"hr_transfer",subjectType:"hr_transfer_case",stateColumn:"status",assigneeColumn:null,
  },
  discipline:{
    table:"hr_discipline_cases",eventTable:"hr_discipline_case_events",foreignKey:"discipline_case_id",
    workflowType:"hr_discipline",subjectType:"hr_discipline_case",stateColumn:"status",assigneeColumn:null,
  },
  leave:{
    table:"hr_leave_requests",eventTable:"hr_leave_events",foreignKey:"leave_request_id",
    workflowType:"hr_leave",subjectType:"hr_leave_request",stateColumn:"status",assigneeColumn:"assigned_user_id",
  },
  archive:{
    table:"archive_records",eventTable:"archive_events",foreignKey:"archive_record_id",
    workflowType:"archive_record",subjectType:"archive_record",stateColumn:"status",assigneeColumn:null,
  },
  archive_access:{
    table:"archive_access_requests",eventTable:null,foreignKey:null,
    workflowType:"archive_access",subjectType:"archive_access_request",stateColumn:"status",assigneeColumn:null,
  },
  archive_destruction:{
    table:"archive_destruction_proposals",eventTable:null,foreignKey:null,
    workflowType:"archive_destruction",subjectType:"archive_destruction_proposal",stateColumn:"status",assigneeColumn:null,
  },
};

function fail(code,status=400,detail={}){throw new WorkflowError(code,status,detail)}
function uuid(value,name="id"){
  const text=String(value||"").trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text))fail(`INVALID_${name.toUpperCase()}`,400);
  return text;
}
function key(value){return uuid(value,"idempotency_key")}
function expected(value){const number=Number(value);if(!Number.isSafeInteger(number)||number<0)fail("EXPECTED_VERSION_REQUIRED",400);return number}
function definition(name){const value=DEFINITIONS[name];if(!value)fail("UNKNOWN_DOMAIN",500);return value}
function authorizeAny(req,permissions){
  if(!req?.user?.id||!req.user.organization_id)fail("AUTHENTICATION_REQUIRED",401);
  const granted=new Set(req.user.permissions||[]);
  if(!(permissions||[]).some(permission=>granted.has(permission)))fail("DOMAIN_FORBIDDEN",403,{permissions});
  if(!granted.has("workflow.coordinate"))fail("WORKFLOW_FORBIDDEN",403,{permissions:["workflow.coordinate"]});
}
function authorizeRestricted(req,record,domain){
  if(record?.confidentiality!=="restricted")return;
  const required=domain==="discipline"?"hr.discipline.confidential.read":"documents.restricted.read";
  if(!(req.user.permissions||[]).includes(required))fail("RESTRICTED_DOCUMENT_FORBIDDEN",403);
}
function canonicalPayload(payload){return payloadHash(payload)}
async function lock(client,scope){await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[scope])}

async function existingCreate(client,def,organizationId,idempotencyKey,hash){
  const result=await client.query(`SELECT * FROM ${def.table} WHERE organization_id=$1 AND idempotency_key=$2`,[organizationId,idempotencyKey]);
  if(!result.rowCount)return null;
  if(String(result.rows[0].payload_sha256||"").trim()!==hash)fail("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",409);
  return {...result.rows[0],replayed:true};
}

async function insertDomainEvent(client,def,{organizationId,id,version,eventType,fromState=null,toState=null,actorUserId,reason="",detail={},requestId}){
  if(!def.eventTable)return;
  if(def.eventTable==="hr_leave_events"){
    const leaveEvent={created:"requested",manager_approve:"routed",approve:"approved",reject:"rejected",return:"returned",resubmit:"resubmitted",cancel:"cancelled"}[eventType]||eventType;
    await client.query(`INSERT INTO hr_leave_events(organization_id,leave_request_id,event_type,note,actor_user_id)
      VALUES($1,$2,$3,$4,$5)`,[organizationId,id,leaveEvent,String(reason||""),actorUserId]);
    return;
  }
  await client.query(`INSERT INTO ${def.eventTable}
    (organization_id,${def.foreignKey},version,event_type,from_state,to_state,actor_user_id,reason,detail,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
  [organizationId,id,version,eventType,fromState,toState,actorUserId,String(reason||""),JSON.stringify(detail),requestId]);
}

async function createAggregate({req,domain,initialState,idempotencyKey,payload,permissions,insert,documentIds=[],after=null}){
  authorizeAny(req,permissions);
  const def=definition(domain),org=req.user.organization_id,actor=req.user.id,requestId=key(idempotencyKey),hash=canonicalPayload(payload);
  return withTenantTransaction(org,async client=>{
    await lock(client,`domain-create:${org}:${domain}:${requestId}`);
    const replay=await existingCreate(client,def,org,requestId,hash);
    if(replay)return {item:replay,replayed:true};
    const id=crypto.randomUUID();
    const item=await insert(client,{id,organizationId:org,actorUserId:actor,idempotencyKey:requestId,payloadSha256:hash});
    const coordinated=await createWorkflowCase({
      req,workflowType:def.workflowType,subjectType:def.subjectType,subjectId:id,initialState,
      idempotencyKey:requestId,detail:{domain,domainState:initialState},requiredPermissions:["workflow.coordinate"],client,
    });
    const updated=(await client.query(`UPDATE ${def.table} SET workflow_case_id=$3 WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id,coordinated.case.id])).rows[0];
    await insertDomainEvent(client,def,{organizationId:org,id,version:0,eventType:"created",toState:initialState,actorUserId:actor,detail:{payloadSha256:hash},requestId});
    for(const documentId of documentIds.filter(Boolean)){
      await recordDocumentLink({req,documentId:uuid(documentId,"document_id"),entityType:def.subjectType,entityId:id,source:"domain",requiredPermissions:[],client});
    }
    if(after)await after(client,{item:updated,requestId,actorUserId:actor,organizationId:org});
    await writeAudit(req,`${domain}.created`,def.subjectType,id,{version:0,state:initialState,requestId},client);
    return {item:updated,replayed:false};
  });
}

async function findCommandReplay(client,def,organizationId,id,command,requestId,hash){
  const result=await client.query(`SELECT payload_sha256,result FROM domain_command_receipts
    WHERE organization_id=$1 AND domain_type=$2 AND entity_id=$3 AND command_type=$4 AND idempotency_key=$5`,
  [organizationId,def.workflowType,id,command,requestId]);
  if(!result.rowCount)return null;
  if(String(result.rows[0].payload_sha256).trim()!==hash)fail("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",409);
  return {...result.rows[0].result,replayed:true};
}
async function storeCommandReceipt(client,def,{organizationId,id,command,requestId,hash,actorUserId,result}){
  await client.query(`INSERT INTO domain_command_receipts
    (organization_id,domain_type,entity_id,command_type,idempotency_key,payload_sha256,result,actor_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
  [organizationId,def.workflowType,id,command,requestId,hash,JSON.stringify(result),actorUserId]);
}

async function transitionAggregate({req,domain,id,expectedVersion,command,toState,allowedFrom,permissions,
  reason="",comment="",decision=null,stepCode="",idempotencyKey,detail={},set={},precondition=null,after=null,documentIds=[],coordinationReason=null}){
  authorizeAny(req,permissions);
  const def=definition(domain),org=req.user.organization_id,actor=req.user.id,entityId=uuid(id),version=expected(expectedVersion),requestId=key(idempotencyKey);
  const safeCoordinationReason=coordinationReason===null?reason:String(coordinationReason);
  const input={domain,id:entityId,expectedVersion:version,command,toState,reason,comment,decision,stepCode,detail,set};
  if(coordinationReason!==null)input.coordinationReason=safeCoordinationReason;
  const hash=canonicalPayload(input);
  return withTenantTransaction(org,async client=>{
    await lock(client,`domain-command:${org}:${domain}:${entityId}:${requestId}`);
    const replay=await findCommandReplay(client,def,org,entityId,command,requestId,hash);
    if(replay)return replay;
    const found=await client.query(`SELECT * FROM ${def.table} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[org,entityId]);
    if(!found.rowCount)fail("DOMAIN_RECORD_NOT_FOUND",404);
    const current=found.rows[0],fromState=current[def.stateColumn];
    authorizeRestricted(req,current,domain);
    if(Number(current.version)!==version)fail("DOMAIN_VERSION_CONFLICT",409,{expectedVersion:version,actualVersion:Number(current.version)});
    if(!allowedFrom.includes(fromState))fail("INVALID_DOMAIN_TRANSITION",409,{fromState,command,toState});
    if(precondition)await precondition(client,current);
    const coordinated=await transitionWorkflowCase({
      req,caseId:current.workflow_case_id,expectedVersion:version,transitionName:command,toState,
      domainFromState:fromState,domainToState:toState,decision,stepCode,reason:safeCoordinationReason,comment,detail:{...detail,domain},
      idempotencyKey:requestId,requiredPermissions:["workflow.coordinate"],client,
    });
    const allowedColumns={
      complaint:new Set(["resolution","response_document_id","close_reason","closed_at","assigned_unit_id"]),
      correspondence:new Set(["resolution","response_document_id","management_resolution","closed_at","due_date","assigned_unit_id"]),
      appointment:new Set(["effective_date","order_document_id","employee_id"]),
      exit:new Set(["order_document_id"]),leave:new Set(["decision_note","decided_by","decided_at"]),
      transfer:new Set(["consent_status","consent_document_id","workload_assessment","proposal_document_id","decision_document_id","acknowledgement_document_id","implemented_assignment_id","implemented_at","completed_at"]),
      discipline:new Set(["investigator_user_id","notice_document_id","notice_at","explanation_status","explanation_document_id","explanation_at","investigation_summary","finding","recommendation","recommended_action_code","recommendation_document_id","recommendation_by","recommendation_at","decision_outcome","sanction_code","decision_reason","decision_document_id","decision_by","decision_at","effective_from","sanction_expires_on","acknowledgement_status","acknowledgement_document_id","acknowledged_at","removed_at","removal_reason","removal_document_id","dispute_status","dispute_reference","dispute_document_id","dispute_resolution","closed_at"]),
      archive:new Set(["legal_hold_checked_at","location","box_no","shelf_no"]),
      archive_access:new Set(["decided_by","decided_at","issued_by","issued_at","returned_to","returned_at","due_back_at","condition_note"]),
      archive_destruction:new Set(["external_approval_reference"]),
    }[domain]||new Set();
    const assignments=[[def.stateColumn,toState],["version",Number(coordinated.case.version)],["updated_at",new Date()]];
    for(const [column,value] of Object.entries(set||{})){if(!allowedColumns.has(column))fail("UNSAFE_DOMAIN_COLUMN",500,{column});assignments.push([column,value])}
    const clauses=assignments.map(([column],index)=>`${column}=$${index+3}`);
    const params=[org,entityId,...assignments.map(([,value])=>value)];
    const updated=(await client.query(`UPDATE ${def.table} SET ${clauses.join(",")} WHERE organization_id=$1 AND id=$2 AND version=$${params.length+1} RETURNING *`,[...params,version])).rows[0];
    if(!updated)fail("DOMAIN_VERSION_CONFLICT",409);
    await insertDomainEvent(client,def,{organizationId:org,id:entityId,version:Number(updated.version),eventType:command,fromState,toState,actorUserId:actor,reason,detail:{...detail,payloadSha256:hash},requestId});
    for(const documentId of documentIds.filter(Boolean))await recordDocumentLink({req,documentId:uuid(documentId,"document_id"),entityType:def.subjectType,entityId:entityId,source:"domain",requiredPermissions:[],client});
    if(after)await after(client,{current,updated,requestId,actorUserId:actor,organizationId:org});
    await writeAudit(req,`${domain}.${command}`,def.subjectType,entityId,{version:Number(updated.version),previousState:fromState,resultingState:toState,reason:safeCoordinationReason,requestId},client);
    const result={item:updated,replayed:false};
    await storeCommandReceipt(client,def,{organizationId:org,id:entityId,command,requestId,hash,actorUserId:actor,result});
    return result;
  });
}

async function assignAggregate({req,domain,id,expectedVersion,assigneeUserId,assignedUnitId=null,reason="",idempotencyKey,permissions}){
  authorizeAny(req,permissions);
  const def=definition(domain);if(!def.assigneeColumn)fail("DOMAIN_ASSIGNMENT_UNSUPPORTED",400);
  const org=req.user.organization_id,actor=req.user.id,entityId=uuid(id),version=expected(expectedVersion),requestId=key(idempotencyKey),assignee=uuid(assigneeUserId,"assignee_user_id");
  const input={domain,id:entityId,expectedVersion:version,assigneeUserId:assignee,assignedUnitId,reason};const hash=canonicalPayload(input);
  return withTenantTransaction(org,async client=>{
    await lock(client,`domain-command:${org}:${domain}:${entityId}:${requestId}`);
    const command="assign";
    const replay=await findCommandReplay(client,def,org,entityId,command,requestId,hash);if(replay)return replay;
    const found=await client.query(`SELECT * FROM ${def.table} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[org,entityId]);
    if(!found.rowCount)fail("DOMAIN_RECORD_NOT_FOUND",404);const current=found.rows[0];authorizeRestricted(req,current,domain);
    if(Number(current.version)!==version)fail("DOMAIN_VERSION_CONFLICT",409,{actualVersion:Number(current.version)});
    const coordinated=await assignWorkflowCase({req,caseId:current.workflow_case_id,expectedVersion:version,assigneeUserId:assignee,reason,idempotencyKey:requestId,requiredPermissions:["workflow.coordinate"],client});
    let nextState=current[def.stateColumn];
    if(domain==="complaint"&&["registered","assigned"].includes(nextState))nextState="assigned";
    if(domain==="correspondence"&&["registered","assigned"].includes(nextState))nextState="assigned";
    const unitColumn=["complaint","correspondence"].includes(domain)?"assigned_unit_id":null;
    const params=[org,entityId,assignee,Number(coordinated.case.version),nextState,version];
    let sql=`UPDATE ${def.table} SET ${def.assigneeColumn}=$3,version=$4,${def.stateColumn}=$5,updated_at=now()`;
    if(unitColumn){params.splice(5,0,assignedUnitId||null);sql+=`,${unitColumn}=$6`}
    const expectedIndex=params.length;sql+=` WHERE organization_id=$1 AND id=$2 AND version=$${expectedIndex} RETURNING *`;
    const updated=(await client.query(sql,params)).rows[0];if(!updated)fail("DOMAIN_VERSION_CONFLICT",409);
    await insertDomainEvent(client,def,{organizationId:org,id:entityId,version:Number(updated.version),eventType:coordinated.operation,fromState:current[def.stateColumn],toState:nextState,actorUserId:actor,reason,detail:{assigneeUserId:assignee,assignedUnitId,payloadSha256:hash},requestId});
    await writeAudit(req,`${domain}.${coordinated.operation}`,def.subjectType,entityId,{version:Number(updated.version),fromUserId:current[def.assigneeColumn],toUserId:assignee,reason,requestId},client);
    const result={item:updated,replayed:false};
    await storeCommandReceipt(client,def,{organizationId:org,id:entityId,command,requestId,hash,actorUserId:actor,result});
    return result;
  });
}

module.exports={WorkflowError,DEFINITIONS,authorizeAny,createAggregate,transitionAggregate,assignAggregate,uuid,key,expected,canonicalPayload};
