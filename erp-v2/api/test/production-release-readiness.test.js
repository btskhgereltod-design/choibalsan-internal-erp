"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname,"..","..");
const read = file => fs.readFileSync(path.join(root,file),"utf8");

test("production release has real restore evidence and immutable rollback identity",()=>{
  const evidence=read("docs/PRODUCTION_RESTORE_REHEARSAL_20260831T110319Z.md");
  const images=read("docs/PRODUCTION_RELEASE_IMAGE_RECORD_20260831T083827Z.md");
  const rollback=read("docker-compose.rollback.yml");
  assert.match(evidence,/pg_restore/);
  assert.match(evidence,/Work Orders \| 106/);
  assert.match(evidence,/Session smoke passed|authenticated organization session: passed/);
  assert.match(images,/079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2/);
  assert.match(images,/d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1/);
  assert.match(rollback,/OVERVA_ROLLBACK_API_IMAGE/);
  assert.match(rollback,/pull_policy: never/);
});

test("post-deploy runbook has exact data, privilege, smoke, and stop gates",()=>{
  const runbook=read("docs/PRODUCTION_RELEASE_READINESS_RUNBOOK.md");
  const session=read("api/scripts/session-smoke.js");
  const contract=read("api/scripts/production-release-contract-smoke.js");
  assert.match(runbook,/schema `0080`/);
  assert.match(runbook,/typed_backfill_before_cutoff/);
  assert.match(runbook,/snapshot_mismatches/);
  assert.match(runbook,/convalidated/);
  assert.match(runbook,/can_truncate/);
  assert.match(runbook,/duplicate_rule_runs/);
  assert.match(runbook,/smoke:release-contract/);
  assert.match(runbook,/work_order_events_assignment_v1_required/);
  assert.match(runbook,/forward-fix/);
  assert.match(session,/23-column reconciliation contract/);
  assert.match(session,/ordinary user 403/);
  assert.match(session,/u\.active=true AND u\.can_login=true/);
  assert.match(contract,/ASSIGNMENT_IDEMPOTENCY_CONFLICT/);
  assert.match(contract,/foreign-tenant user must not resolve/);
});
