"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {deterministicUuid,normalizeGroup}=require("../src/services/legacy-review-groups");

test("0089 is additive, tenant scoped, version guarded, and append only",()=>{
  const sql=read("migrations/0089_legacy_review_group_recommendations.sql");
  for(const table of ["legacy_review_groups","legacy_review_group_members","legacy_review_group_decisions","legacy_review_batch_commands"])assert.match(sql,new RegExp(`CREATE TABLE ${table}`));
  for(const category of ["ATTENDANCE","INACTIVE_USER","ORDER_DECISION","CORRESPONDENCE","DOCUMENT_ATTACHMENT"])assert.match(sql,new RegExp(category));
  for(const action of ["APPROVE_RECOMMENDATION","MARK_LEGACY_ONLY","SEND_MANUAL_REVIEW"])assert.match(sql,new RegExp(action));
  assert.match(sql,/UNIQUE\(organization_id,category,group_key\)/);
  assert.match(sql,/UNIQUE\(organization_id,idempotency_key\)/);
  assert.match(sql,/legacy review group version must increment exactly once/);
  assert.match(sql,/legacy_review_group_members_append_only/);
  assert.match(sql,/legacy_review_group_decisions_append_only/);
  assert.match(sql,/legacy_review_batch_commands_append_only/);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,4);
  assert.doesNotMatch(sql,/UPDATE\s+(employees|employee_profiles|departments|jobs|positions|employee_assignments|attendance_records|documents|correspondence_records|archive_records|workflow_)/i);
});

test("analyzer is read only and encodes safety boundaries",()=>{
  const exporter=read("../ops/export-legacy-review-groups.js");
  assert.match(exporter,/OPEN_READONLY/);assert.match(exporter,/PRAGMA query_only=ON/);
  assert.match(exporter,/PRODUCTION_RECONCILIATION_MISSING/);assert.match(exporter,/RECONCILE_REQUIRED/);
  assert.match(exporter,/SUPERSEDED_CANDIDATE/);assert.match(exporter,/ACTIVE_EMPLOYEE_OVERLAP/);
  assert.match(exporter,/NOT_CLASSIFIED_AS_COMPLAINT/);assert.match(exporter,/HASH_IS_SIGNAL_NOT_MERGE_KEY/);
  assert.doesNotMatch(exporter,/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?(employees|hr_records|orders_decisions|correspondence|documents|archive_docs)/i);
});

test("stager and batch service contain no import or domain creation path",()=>{
  const stager=read("scripts/stage-legacy-review-groups.js"),service=read("src/services/legacy-review-groups.js"),route=read("src/routes/legacy-migration.js");
  assert.match(stager,/noDomainImport:true/);assert.match(service,/LEGACY_EXTERNAL_EVIDENCE_REQUIRED/);assert.match(service,/LEGACY_ATTENDANCE_FINAL_DECISION_BLOCKED/);
  assert.match(service,/applyProvenanceDecisionInTransaction/);assert.match(service,/FOR UPDATE/);assert.match(service,/writeAudit/);
  assert.match(route,/requirePermissions\("legacy_migration.review"\)/);assert.match(route,/review-groups\/batch-decisions/);
  for(const source of [stager,service,route])assert.doesNotMatch(source,/INSERT INTO\s+(employees|employee_profiles|departments|jobs|positions|employee_assignments|attendance_records|documents|correspondence_records|archive_records|workflow_)/i);
});

test("deterministic member command identifiers and group normalization are stable",()=>{
  assert.equal(deterministicUuid("batch","one"),deterministicUuid("batch","one"));assert.notEqual(deterministicUuid("batch","one"),deterministicUuid("batch","two"));
  assert.match(deterministicUuid("batch","one"),/^[0-9a-f-]{36}$/);
  const normalized=normalizeGroup({category:"ATTENDANCE",groupKey:"1|2026-01-01",deterministicVersion:"v1",groupHash:"a".repeat(64),sourceSummary:{},signals:["X","X"],recommendation:"RECONCILE_REQUIRED",recommendationReason:"Evidence required",confidence:"LOW",requiresExternalEvidence:true,externalEvidenceStatus:"MISSING",members:[{provenanceId:crypto.randomUUID()}]});
  assert.deepEqual(normalized.signals,["X"]);assert.equal(normalized.requiresExternalEvidence,true);
  assert.throws(()=>normalizeGroup({...normalized,externalEvidenceStatus:"NOT_REQUIRED"}),/LEGACY_EXTERNAL_EVIDENCE_INVALID/);
});

test("grouped UI supports category review and safe batch actions without import",()=>{
  const ui=read("../web/legacy-migration-review.js");
  for(const marker of ["ATTENDANCE","INACTIVE_USER","ORDER_DECISION","CORRESPONDENCE","DOCUMENT_ATTACHMENT","APPROVE_RECOMMENDATION","MARK_LEGACY_ONLY","SEND_MANUAL_REVIEW","Final decision хаалттай"])assert.match(ui,new RegExp(marker));
  assert.doesNotMatch(ui,/data-legacy-import|data-legacy-commit|\/actual-import/i);
});
