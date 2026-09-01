"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {requireOrganizationId}=require("../src/db");

test("tenant context is transaction-local, mismatch-safe and has no implicit global",()=>{
  const db=read("src/db.js");
  assert.match(db,/set_config\('app\.organization_id',\$1,true\)/);
  assert.match(db,/TENANT_CONTEXT_TRANSACTION_REQUIRED/);
  assert.match(db,/TENANT_CONTEXT_MISMATCH/);
  assert.match(db,/OVERVA_ALLOW_SYSTEM_DB_BYPASS/);
  assert.doesNotMatch(db,/set_config\('app\.organization_id'.*false/);
  assert.throws(()=>requireOrganizationId("not-a-tenant"),/TENANT_CONTEXT_REQUIRED/);
  assert.equal(requireOrganizationId("A0EBC3C3-4804-4CC9-8875-BD0B275DA108"),"a0ebc3c3-4804-4cc9-8875-bd0b275da108");
});

test("controlled RLS rollout is limited to audited foundation tables",()=>{
  const sql=read("migrations/0085_foundation_rls_activation.sql");
  const enabled=[...sql.matchAll(/ALTER TABLE ([a-z_]+) ENABLE ROW LEVEL SECURITY/g)].map(match=>match[1]);
  assert.deepEqual(enabled.sort(),[
    "document_links","workflow_assignment_events","workflow_cases","workflow_command_receipts",
    "workflow_comment_events","workflow_decision_events","workflow_notification_delivery_events",
    "workflow_notification_delivery_state","workflow_notification_outbox","workflow_transition_events",
  ].sort());
  assert.match(sql,/security_invoker=true/);
  assert.doesNotMatch(sql,/employees ENABLE|documents ENABLE|correspondence_records ENABLE|archive_records ENABLE/);
});
