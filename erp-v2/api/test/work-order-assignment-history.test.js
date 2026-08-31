"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { changeAssignment, recordInitialAssignment } = require("../src/services/work-order-assignment");

const apiRoot = path.join(__dirname,"..");
const read = file => fs.readFileSync(path.join(apiRoot,file),"utf8");

test("assignment history migration is tenant-scoped, append-only, and rollout-compatible",()=>{
  const sql=read("migrations/0078_work_order_assignment_history.sql");
  const guard=read("migrations/0079_work_order_assignment_write_guard.sql");
  const productionMigrate=read("scripts/production-migrate.js");
  const trialCleanup=read("scripts/remove-trial-work-order.js");
  assert.match(sql,/ALTER TABLE work_order_events/);
  assert.match(sql,/assignment_history_version/);
  assert.match(sql,/FOREIGN KEY\(organization_id,from_assignee_user_id\)/);
  assert.match(sql,/FOREIGN KEY\(organization_id,to_assignee_user_id\)/);
  assert.match(sql,/FOREIGN KEY\(organization_id,from_assignee_employee_id\)/);
  assert.match(sql,/FOREIGN KEY\(organization_id,to_assignee_employee_id\)/);
  assert.match(sql,/CREATE TRIGGER work_order_events_append_only/);
  assert.match(guard,/phase 1 of 2/);
  assert.match(guard,/overva_validate_work_order_assignment_identity/);
  assert.match(guard,/WORK_ORDER_ASSIGNMENT_FROM_IDENTITY_MISMATCH/);
  assert.match(guard,/WORK_ORDER_ASSIGNMENT_TO_IDENTITY_MISMATCH/);
  assert.match(guard,/ON DELETE RESTRICT/);
  assert.doesNotMatch(guard,/CREATE TRIGGER work_order_events_assignment_v1_required/);
  assert.doesNotMatch(guard,/WORK_ORDER_ASSIGNMENT_HISTORY_V1_REQUIRED/);
  assert.match(productionMigrate,/work_order_events/);
  assert.doesNotMatch(trialCleanup,/DELETE FROM work_orders/);
  assert.match(trialCleanup,/trial_record_retired/);
  assert.match(sql,/overva_reject_audit_mutation/);
  assert.doesNotMatch(sql,/UPDATE work_order_events\s+SET/i);
  assert.match(sql,/NULL means legacy\/non-canonical assignment evidence/);
});

test("an idempotency key reused with another assignment payload is an explicit conflict",async()=>{
  const client={query:async sql=>{
    assert.match(sql,/idempotency_key=\$3/);
    return {rowCount:1,rows:[{
      to_assignee_user_id:"user-a",assignment_reason:"Original",assignment_source:"api",actor_user_id:"manager-a",
    }]};
  }};
  await assert.rejects(
    changeAssignment(client,{
      organizationId:"org-a",current:{id:"work-1"},assignee:{id:"user-b"},
      actorUserId:"manager-a",source:"api",reason:"Different",idempotencyKey:"key-a",
    }),
    error=>error.code==="ASSIGNMENT_IDEMPOTENCY_CONFLICT"
  );
});

test("current assignment snapshot remains compatible while every write path records canonical history",()=>{
  const route=read("src/routes/work-orders.js");
  const service=read("src/services/work-order-assignment.js");
  const legacyImport=read("scripts/import-legacy-lighting.js");
  const automation=read("src/services/automation.js");
  assert.match(route,/recordInitialAssignment/);
  assert.match(route,/changeAssignment/);
  assert.match(service,/UPDATE work_orders SET assigned_to=\$1/);
  assert.match(legacyImport,/Source assignment observed during import/);
  assert.match(automation,/recordInitialAssignment/);
});

test("same-assignee request is a no-op and cannot create false reassignment history",async()=>{
  const client={query:async()=>{throw new Error("query must not run")}};
  const current={id:"work-1",status:"assigned",assigned_to:"user-a",assigned_employee_id:"employee-a"};
  const result=await changeAssignment(client,{
    organizationId:"org-a",current,assignee:{id:"user-a",employee_id:"employee-a"},actorUserId:"manager-a",
  });
  assert.equal(result.changed,false);
  assert.equal(result.item,current);
  assert.equal(result.event,null);
});

test("reassignment updates the snapshot before appending typed from/to evidence",async()=>{
  const calls=[];
  const client={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes("UPDATE work_orders"))return {rows:[{id:"work-1",status:"assigned",assigned_to:"user-b"}]};
    if(sql.includes("INSERT INTO work_order_events"))return {rows:[{id:91,assignment_operation:"reassigned"}]};
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const result=await changeAssignment(client,{
    organizationId:"org-a",
    current:{id:"work-1",status:"assigned",assigned_to:"user-a",assigned_employee_id:"employee-a"},
    assignee:{id:"user-b",employee_id:"employee-b",full_name:"User B"},actorUserId:"manager-a",reason:"Shift handoff",
  });
  assert.equal(result.changed,true);
  assert.equal(calls.length,2);
  assert.match(calls[0].sql,/UPDATE work_orders/);
  assert.match(calls[1].sql,/assignment_history_version/);
  assert.equal(calls[1].params[6],"reassigned");
  assert.equal(calls[1].params[8],"user-a");
  assert.equal(calls[1].params[9],"user-b");
  assert.equal(calls[1].params[10],"employee-a");
  assert.equal(calls[1].params[11],"employee-b");
});

test("an initially unassigned Work Order has a known typed initial state",async()=>{
  const calls=[];
  const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:1}]}}};
  await recordInitialAssignment(client,{
    organizationId:"org-a",workOrderId:"work-1",actorUserId:"creator-a",assignee:null,status:"new",source:"api",
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].params[6],"initial");
  assert.equal(calls[0].params[8],null);
  assert.equal(calls[0].params[9],null);
  assert.equal(calls[0].params[15],true);
  assert.match(calls[0].sql,/SELECT created_at FROM work_orders WHERE organization_id=\$1 AND id=\$2/);
});

test("historical reporting uses typed assignment events and reports legacy history as unknown",()=>{
  const route=read("src/routes/reports.js");
  const web=read("../web/app.js");
  assert.match(route,/basis: "canonical_employee_assignment_events_v1"/);
  assert.match(route,/assignment_history_version=1/);
  assert.match(route,/unknown_created_assignment/);
  assert.match(route,/unknown_completed_assignment/);
  assert.match(route,/assignment_knowledge/);
  assert.match(web,/Түүхгүй хуучин төлөвийг unknown/);
});
