"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {randomUUID}=require("node:crypto");
const {classifyOfflineCommand,createRetryEnvelope,applyServerConfirmation}=require("../src/services/offline-command-contract");

test("critical actions never appear final while offline",()=>{
  for(const command of ["workflow.approve","workflow.reject","hr.terminate","archive.destroy","workflow.final_close","security.permission_change"]){
    assert.deepEqual(classifyOfflineCommand(command),{commandType:command,mode:"server_confirmation",mayAppearFinalOffline:false,critical:true});
  }
});

test("unknown commands fail into server confirmation and drafts stay visibly local",()=>{
  assert.equal(classifyOfflineCommand("future.command").mode,"server_confirmation");
  assert.equal(classifyOfflineCommand("draft.save").mode,"draft_queue");
});

test("retry envelope excludes client tenant selection and requires matching server confirmation",()=>{
  const requestId=randomUUID();
  const envelope=createRetryEnvelope({commandType:"workflow.approve",requestId,payload:{caseId:randomUUID(),expectedVersion:2}});
  assert.equal(envelope.final,false);assert.equal(envelope.clientState,"awaiting_server");
  assert.throws(()=>createRetryEnvelope({commandType:"draft.save",requestId:randomUUID(),payload:{organizationId:randomUUID()}}),/CLIENT_TENANT_ID_FORBIDDEN/);
  assert.throws(()=>applyServerConfirmation(envelope,{confirmed:true,requestId:randomUUID(),idempotencyKey:requestId,version:3}),/SERVER_CONFIRMATION_MISMATCH/);
  const final=applyServerConfirmation(envelope,{confirmed:true,requestId,idempotencyKey:requestId,version:3});
  assert.equal(final.final,true);assert.equal(final.serverVersion,3);
});
