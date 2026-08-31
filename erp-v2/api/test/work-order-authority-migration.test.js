"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root=path.join(__dirname,"..");

test("work-order authority migration seeds explicit permissions and compatibility roles",()=>{
  const sql=fs.readFileSync(path.join(root,"migrations/0064_work_order_authority.sql"),"utf8");
  for(const code of ["work-orders.create","work-orders.assign","work-orders.progress","work-orders.workflow.safety","work-orders.workflow.approve","work-orders.exception.decide"]){
    assert.match(sql,new RegExp(code.replaceAll(".","\\.")));
  }
  assert.match(sql,/work-order-manager/);
  assert.match(sql,/startSafetyPermission/);
});

test("work-order route no longer uses legacy role middleware",()=>{
  const source=fs.readFileSync(path.join(root,"src/routes/work-orders.js"),"utf8");
  assert.doesNotMatch(source,/requireRoles/);
  assert.doesNotMatch(source,/managerRoles|broadReadRoles|operationalRoles/);
  assert.match(source,/WORK_ORDER_PERMISSION_REQUIRED/);
  assert.match(source,/parsed\.data\.assignedTo&&!hasPermission\(req\.user,WORK_ORDER_PERMISSIONS\.ASSIGN\)/);
});
