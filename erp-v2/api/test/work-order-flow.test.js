"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canTransition, canPerformWorkflowAction, availableWorkflowActions, resolveWorkflowAction } = require("../src/services/work-order-flow");

test("work order follows the review workflow", () => {
  assert.equal(canTransition("new", "in_progress"), true);
  assert.equal(canTransition("in_progress", "pending_review"), true);
  assert.equal(canTransition("pending_review", "completed"), true);
});

test("completed and cancelled work orders are terminal", () => {
  assert.equal(canTransition("completed", "in_progress"), false);
  assert.equal(canTransition("cancelled", "new"), false);
});

test("work order cannot skip directly from new to completed", () => {
  assert.equal(canTransition("new", "completed"), false);
});

const policy={
  startSafetyRole:"safety",
  startApprovalRole:"chief_engineer",
  completionSafetyRole:"safety",
  completionApprovalRole:"chief_engineer",
  startSafetyPermission:"work-orders.workflow.safety",
  startApprovalPermission:"work-orders.workflow.approve",
  completionSafetyPermission:"work-orders.workflow.safety",
  completionApprovalPermission:"work-orders.workflow.approve",
};
const safetyPermissions=["work-orders.workflow.safety"];
const approvalPermissions=["work-orders.workflow.approve"];

test("safety and chief engineer approvals cannot be skipped",()=>{
  assert.equal(canPerformWorkflowAction({action:"management_approve_start",stage:"awaiting_safety_start",permissions:approvalPermissions,config:policy}),false);
  assert.equal(canPerformWorkflowAction({action:"safety_authorize_start",stage:"awaiting_safety_start",permissions:safetyPermissions,config:policy}),true);
  assert.deepEqual(availableWorkflowActions({stage:"awaiting_management_start",permissions:approvalPermissions,config:policy}),["management_approve_start"]);
});

test("only assigned division engineer submits completion",()=>{
  assert.equal(canPerformWorkflowAction({action:"submit_completion",stage:"execution",permissions:["work-orders.progress"],userId:"engineer-1",assignedTo:"engineer-1",config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"submit_completion",stage:"execution",permissions:approvalPermissions,userId:"chief-1",assignedTo:"engineer-1",config:policy}),false);
});

test("completion requires safety inspection before chief engineer closure",()=>{
  assert.equal(canPerformWorkflowAction({action:"management_close",stage:"awaiting_safety_completion",permissions:approvalPermissions,config:policy}),false);
  assert.equal(canPerformWorkflowAction({action:"safety_accept_completion",stage:"awaiting_safety_completion",permissions:safetyPermissions,config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"management_close",stage:"awaiting_management_completion",permissions:approvalPermissions,config:policy}),true);
});

test("configured permission overrides the legacy role compatibility field",()=>{
  assert.equal(canPerformWorkflowAction({action:"safety_authorize_start",stage:"awaiting_safety_start",role:"safety",permissions:[],config:policy}),false);
});

test("legacy-only workflow policy fails closed",()=>{
  assert.equal(canPerformWorkflowAction({action:"safety_authorize_start",stage:"awaiting_safety_start",role:"safety",permissions:safetyPermissions,config:{startSafetyRole:"safety"}}),false);
});

test("tenant policy may make HSE the final start gate without changing the default",()=>{
  assert.equal(resolveWorkflowAction("safety_authorize_start",policy).to,"awaiting_management_start");
  assert.deepEqual(resolveWorkflowAction("safety_authorize_start",{...policy,startManagementRequired:false}),{
    ...resolveWorkflowAction("safety_authorize_start",policy),to:"execution",status:"in_progress",
  });
});

test("safety reviewer can return an unsafe request or suspend active execution",()=>{
  assert.equal(canPerformWorkflowAction({action:"safety_return_start",stage:"awaiting_safety_start",permissions:safetyPermissions,config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"safety_suspend_execution",stage:"execution",permissions:safetyPermissions,config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"safety_suspend_execution",stage:"execution",permissions:approvalPermissions,config:policy}),false);
});
