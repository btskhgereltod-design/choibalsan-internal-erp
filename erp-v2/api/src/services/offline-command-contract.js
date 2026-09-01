"use strict";

const SERVER_CONFIRMATION_COMMANDS=new Set([
  "workflow.approve","workflow.reject","workflow.return","hr.terminate",
  "archive.destroy","workflow.final_close","security.permission_change",
]);
const DRAFT_QUEUE_COMMANDS=new Set(["draft.save","comment.draft"]);

class OfflineCommandError extends Error{
  constructor(code){super(code);this.name="OfflineCommandError";this.code=code;this.status=400}
}

function requireRequestId(value){
  const id=String(value||"").trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new OfflineCommandError("OFFLINE_REQUEST_ID_REQUIRED");
  return id;
}

function classifyOfflineCommand(commandType){
  const type=String(commandType||"").trim();
  if(!type)throw new OfflineCommandError("OFFLINE_COMMAND_TYPE_REQUIRED");
  if(DRAFT_QUEUE_COMMANDS.has(type))return {commandType:type,mode:"draft_queue",mayAppearFinalOffline:false};
  return {commandType:type,mode:"server_confirmation",mayAppearFinalOffline:false,
    critical:SERVER_CONFIRMATION_COMMANDS.has(type)};
}

function createRetryEnvelope({commandType,requestId,idempotencyKey=requestId,payload={}}){
  const classification=classifyOfflineCommand(commandType);
  const request=requireRequestId(requestId),key=requireRequestId(idempotencyKey);
  if(payload&&typeof payload==="object"&&("organization_id" in payload||"organizationId" in payload)){
    throw new OfflineCommandError("CLIENT_TENANT_ID_FORBIDDEN");
  }
  return Object.freeze({
    version:1,commandType:classification.commandType,requestId:request,idempotencyKey:key,
    payload,offlineMode:classification.mode,clientState:classification.mode==="draft_queue"?"queued_draft":"awaiting_server",
    final:false,
  });
}

function applyServerConfirmation(envelope,response){
  if(!response||response.requestId!==envelope.requestId||response.idempotencyKey!==envelope.idempotencyKey){
    throw new OfflineCommandError("SERVER_CONFIRMATION_MISMATCH");
  }
  if(response.confirmed!==true)throw new OfflineCommandError("SERVER_CONFIRMATION_REQUIRED");
  return {...envelope,clientState:"server_confirmed",final:true,serverVersion:response.version};
}

module.exports={SERVER_CONFIRMATION_COMMANDS,DRAFT_QUEUE_COMMANDS,OfflineCommandError,
  classifyOfflineCommand,createRetryEnvelope,applyServerConfirmation};
