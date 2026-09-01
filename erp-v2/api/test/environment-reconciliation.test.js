"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");

const apiRoot=path.join(__dirname,"..");
const root=path.join(apiRoot,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const sha=file=>crypto.createHash("sha256").update(read(file)).digest("hex");
const {isReconciledLegacyMigration}=require("../scripts/migrate");

test("documented production 0079 and 0080 artifacts match repository authority",()=>{
  const release=read("docs/PRODUCTION_PHASE_A_RELEASE_20260831T121534Z.md");
  assert.match(release,new RegExp(sha("api/migrations/0079_work_order_assignment_write_guard.sql"),"i"));
  assert.match(release,new RegExp(sha("api/migrations/0080_automation_delivery_idempotency.sql"),"i"));
  assert.match(release,/schema was exactly `0080` after migration/i);
});

test("known local 0079 checksum is narrow and repaired without rewriting history",()=>{
  const runner=read("api/scripts/migrate.js");
  const repair=read("api/migrations/0081_work_order_assignment_reconciliation.sql");
  assert.match(runner,/0079:0079_work_order_assignment_write_guard\.sql/);
  assert.match(runner,/5c67374512217eec036f8f2d46830d3635863e07e95ea0a3c75fd10d66357d33/);
  assert.doesNotMatch(runner,/UPDATE schema_migrations SET filename=\$2,checksum=\$3[\s\S]*RECONCILED_LEGACY/);
  assert.match(repair,/assignment_identity_guard/);
  assert.match(repair,/ON DELETE RESTRICT/);
  assert.doesNotMatch(repair,/INSERT INTO work_order_events|UPDATE work_order_events|DELETE FROM/);
  assert.equal(isReconciledLegacyMigration({version:"0079",filename:"0079_work_order_assignment_write_guard.sql",appliedChecksum:"5c67374512217eec036f8f2d46830d3635863e07e95ea0a3c75fd10d66357d33"}),true);
  assert.equal(isReconciledLegacyMigration({version:"0079",filename:"0079_work_order_assignment_write_guard.sql",appliedChecksum:"0".repeat(64)}),false);
  assert.equal(isReconciledLegacyMigration({version:"0080",filename:"0080_automation_delivery_idempotency.sql",appliedChecksum:"5c67374512217eec036f8f2d46830d3635863e07e95ea0a3c75fd10d66357d33"}),false);
});

test("phase migrations do not guess employee numbers or fabricate domain history",()=>{
  const sql=[
    "api/migrations/0081_work_order_assignment_reconciliation.sql",
    "api/migrations/0082_shared_workflow_foundation.sql",
    "api/migrations/0083_canonical_document_links.sql",
    "api/migrations/0084_workflow_notification_delivery.sql",
    "api/migrations/0085_foundation_rls_activation.sql",
  ].map(read).join("\n");
  assert.doesNotMatch(sql,/employee_no\s*=/i);
  assert.doesNotMatch(sql,/INSERT INTO (employment_lifecycle_events|employee_events|correspondence_records|archive_records)/i);
});
