"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORK_ORDER_PERMISSIONS: P,
  canReadOrder,
  canAssignOrder,
  canClaimOrder,
  canProgressOrder,
  canManageScope,
  availableStatusTransitions,
} = require("../src/services/work-order-authority");

const user=(id,departmentId,permissions,role="worker")=>({id,department_id:departmentId,permissions,role});
const order={id:"work-1",department_id:"department-a",assigned_to:"worker-a",created_by:"creator-a",status:"in_progress",workflow_policy_id:null};

test("legacy job role alone grants no work-order authority",()=>{
  const legacyDirector=user("director-a","department-b",[],"director");
  assert.equal(canReadOrder(legacyDirector,order),false);
  assert.equal(canAssignOrder(legacyDirector,order),false);
  assert.equal(canProgressOrder(legacyDirector,order),false);
});

test("manager permission grants governed cross-unit authority",()=>{
  const manager=user("manager-a","department-b",[P.READ_ALL,P.ASSIGN,P.PROGRESS,P.SCOPE_MANAGE,P.WORKFLOW_APPROVE]);
  assert.equal(canReadOrder(manager,order),true);
  assert.equal(canAssignOrder(manager,order),true);
  assert.equal(canProgressOrder(manager,order),true);
  assert.equal(canManageScope(manager,order),true);
  assert.deepEqual(availableStatusTransitions(manager,order),["pending_review","cancelled"]);
});

test("coordinator is limited to its unit and assigned execution",()=>{
  const coordinator=user("coordinator-a","department-a",[P.ASSIGN,P.PROGRESS,P.SCOPE_MANAGE]);
  assert.equal(canReadOrder(coordinator,order),true);
  assert.equal(canAssignOrder(coordinator,order),true);
  assert.equal(canProgressOrder(coordinator,order),false);
  assert.equal(canManageScope(coordinator,order),true);
  assert.deepEqual(availableStatusTransitions(coordinator,order),[]);

  const assignee=user("worker-a","department-a",[P.PROGRESS,P.SCOPE_MANAGE]);
  assert.equal(canProgressOrder(assignee,order),true);
  assert.deepEqual(availableStatusTransitions(assignee,order),["pending_review","cancelled"]);
});

test("eligible coordinator can claim only a normal routed team backlog item",()=>{
  const coordinator=user("coordinator-a","department-a",[P.ASSIGN,P.PROGRESS]);
  const backlog={...order,status:"new",assigned_to:null,work_type_id:"type-a",operational_stream:"core_service",assignment_kind:"normal"};
  assert.equal(canClaimOrder(coordinator,backlog),true);
  assert.equal(canClaimOrder(coordinator,{...backlog,department_id:"department-b"}),false);
  assert.equal(canClaimOrder(coordinator,{...backlog,assignment_kind:"special"}),false);
  assert.equal(canClaimOrder(coordinator,{...backlog,operational_stream:null}),false);
  assert.equal(canClaimOrder(coordinator,{...backlog,assigned_to:"worker-b"}),false);
});

test("safety reviewer can read all without assignment authority",()=>{
  const safety=user("safety-a","department-b",[P.READ_ALL,P.SCOPE_MANAGE,P.WORKFLOW_SAFETY]);
  assert.equal(canReadOrder(safety,order),true);
  assert.equal(canAssignOrder(safety,order),false);
  assert.equal(canManageScope(safety,order),true);
});
