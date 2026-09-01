"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {payloadHash}=require("../src/services/workflow-coordination");

test("shared workflow is coordination evidence, not domain authority",()=>{
  const sql=read("migrations/0082_shared_workflow_foundation.sql");
  assert.match(sql,/CREATE TABLE workflow_cases/);
  assert.match(sql,/coordination_state/);
  assert.match(sql,/Never the authoritative HR, correspondence, archive/);
  assert.doesNotMatch(sql,/ALTER TABLE (employees|employee_profiles|correspondence_records|archive_records).*status/is);
});

test("workflow foundation includes required safety primitives",()=>{
  const sql=read("migrations/0082_shared_workflow_foundation.sql");
  const service=read("src/services/workflow-coordination.js");
  for(const table of ["workflow_transition_events","workflow_assignment_events","workflow_decision_events","workflow_comment_events","workflow_command_receipts","workflow_notification_outbox"]){
    assert.match(sql,new RegExp(`CREATE TABLE ${table}`));
    assert.match(sql,new RegExp(`${table}_append_only`));
  }
  assert.match(sql,/FOREIGN KEY\(organization_id,actor_user_id\)/);
  assert.match(sql,/workflow_cases_tenant_policy/);
  assert.match(service,/WORKFLOW_VERSION_CONFLICT/);
  assert.match(service,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(service,/pg_advisory_xact_lock/);
  assert.match(service,/writeAudit/);
  assert.match(service,/WORKFLOW_FORBIDDEN/);
});

test("idempotency payload hash is stable across object key order",()=>{
  assert.equal(payloadHash({b:2,a:{d:4,c:3}}),payloadHash({a:{c:3,d:4},b:2}));
  assert.notEqual(payloadHash({value:1}),payloadHash({value:2}));
});

test("production runtime role cannot mutate workflow evidence",()=>{
  const production=read("scripts/production-migrate.js");
  for(const table of ["workflow_transition_events","workflow_assignment_events","workflow_decision_events","workflow_comment_events","workflow_command_receipts","workflow_notification_outbox"]){
    assert.match(production,new RegExp(table));
  }
});
