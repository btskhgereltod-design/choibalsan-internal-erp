"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canTransition, canPerformWorkflowAction, availableWorkflowActions } = require("../src/services/work-order-flow");

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
};

test("safety and chief engineer approvals cannot be skipped",()=>{
  assert.equal(canPerformWorkflowAction({action:"management_approve_start",stage:"awaiting_safety_start",role:"chief_engineer",config:policy}),false);
  assert.equal(canPerformWorkflowAction({action:"safety_authorize_start",stage:"awaiting_safety_start",role:"safety",config:policy}),true);
  assert.deepEqual(availableWorkflowActions({stage:"awaiting_management_start",role:"chief_engineer",config:policy}),["management_approve_start"]);
});

test("only assigned division engineer submits completion",()=>{
  assert.equal(canPerformWorkflowAction({action:"submit_completion",stage:"execution",role:"electric",userId:"engineer-1",assignedTo:"engineer-1",config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"submit_completion",stage:"execution",role:"chief_engineer",userId:"chief-1",assignedTo:"engineer-1",config:policy}),false);
});

test("completion requires safety inspection before chief engineer closure",()=>{
  assert.equal(canPerformWorkflowAction({action:"management_close",stage:"awaiting_safety_completion",role:"chief_engineer",config:policy}),false);
  assert.equal(canPerformWorkflowAction({action:"safety_accept_completion",stage:"awaiting_safety_completion",role:"safety",config:policy}),true);
  assert.equal(canPerformWorkflowAction({action:"management_close",stage:"awaiting_management_completion",role:"chief_engineer",config:policy}),true);
});
