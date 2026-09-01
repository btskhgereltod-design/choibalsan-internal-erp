"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {direction,fileContentSha256,sourceEvidence}=require("../src/services/legacy-canonical-import");
const {sha256,sha256Structured}=require("../src/services/legacy-provenance");

test("0090 adds tenant-scoped immutable import evidence without importing data",()=>{
  const sql=read("migrations/0090_legacy_canonical_import_evidence.sql");
  for(const table of ["legacy_canonical_import_runs","legacy_canonical_import_mappings","legacy_canonical_import_events"])assert.match(sql,new RegExp(`CREATE TABLE ${table}`));
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,3);
  assert.match(sql,/legacy_canonical_import_runs_append_only/);
  assert.match(sql,/legacy_canonical_import_mappings_append_only/);
  assert.match(sql,/legacy_canonical_import_events_append_only/);
  assert.match(sql,/legacy imported projection requires append-only import evidence/);
  assert.doesNotMatch(sql,/INSERT INTO\s+(employees|employee_profiles|attendance_records|documents|correspondence_records|workflow_cases)/i);
});

test("adapter is default dry-run, permission gated, and excludes unsafe domains",()=>{
  const service=read("src/services/legacy-canonical-import.js"),cli=read("scripts/legacy-canonical-import.js");
  assert.match(service,/legacy_migration\.import/);assert.match(service,/ALLOW_LEGACY_CANONICAL_IMPORT/);
  assert.match(service,/ORDER_DECISION/);assert.match(service,/CORRESPONDENCE/);
  for(const forbidden of ["attendance_records","hr_appointment_cases","hr_leave_requests","hr_employment_exit_cases","workflow_cases","correspondence_events"])assert.doesNotMatch(service,new RegExp(`INSERT INTO ${forbidden}`));
  assert.match(service,/withTenantTransaction/);assert.match(service,/LEGACY_IMPORT_PREFLIGHT_CONFLICT/);assert.match(service,/replayed:true/);
  assert.match(cli,/const commit=process\.argv\.includes\("--commit"\)/);assert.match(cli,/OPEN_READONLY/);assert.match(cli,/PRAGMA query_only=ON/);
});

test("legacy direction and checksum rules are deterministic and fail closed",()=>{
  assert.equal(direction("Ирсэн"),"incoming");assert.equal(direction("Явсан"),"outgoing");assert.equal(direction("Дотоод"),"internal");assert.equal(direction("complaint"),null);
  const row={id:7,doc_no:"A-1",status:"old"};
  assert.deepEqual(sourceEvidence("orders_decisions",row),sourceEvidence("orders_decisions",{status:"old",doc_no:"A-1",id:7}));
  assert.notEqual(sourceEvidence("orders_decisions",row).payloadHash,sourceEvidence("orders_decisions",{...row,status:"changed"}).payloadHash);
});

test("file checksums hash raw bytes while structured payload hashing remains stable",()=>{
  const bytes=Buffer.from("abc","utf8"),changed=Buffer.from("abd","utf8");
  assert.equal(fileContentSha256(bytes),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const staged=sourceEvidence("doc_attachments",{id:11,file_name:"first.pdf"},fileContentSha256(bytes));
  assert.equal(staged.sourceSha256,fileContentSha256(bytes),"staged and importer file checksums use the same raw bytes");
  assert.equal(fileContentSha256(Buffer.from(bytes)),fileContentSha256(bytes),"file name is not part of the content checksum");
  assert.notEqual(fileContentSha256(changed),fileContentSha256(bytes),"one changed byte must conflict");
  assert.equal(sha256({b:2,a:1}),sha256Structured({a:1,b:2}),"existing structured JSON hashing is preserved");
});

test("safe approval stays separate from import execution",()=>{
  const review=read("src/services/legacy-review-groups.js"),ui=read("../web/legacy-migration-review.js");
  assert.match(review,/SAFE_CANONICAL_IMPORT_CATEGORIES/);assert.match(review,/LEGACY_SAFE_IMPORT_RECOMMENDATION_REQUIRED/);
  assert.match(review,/noImport:true/);assert.match(ui,/data-select-safe-import/);
  assert.doesNotMatch(ui,/legacy-canonical-import|actual-import|--commit/);
});
