"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {canonicalJson,sha256}=require("../src/services/legacy-provenance");
const {requirePermissions}=require("../src/middleware/auth");

test("0087 is additive tenant-scoped provenance with the required source guard",()=>{
  const sql=read("migrations/0087_legacy_migration_provenance_review.sql");
  for(const field of ["organization_id","legacy_source","legacy_table","legacy_id","legacy_status","source_sha256","payload_hash","classification","target_type","target_id","review_status","reviewed_by","reviewed_at","imported_at","created_at"])assert.match(sql,new RegExp(`\\b${field}\\b`));
  for(const value of ["MATCH_EXISTING","IMPORT_NEW","REVIEW_REQUIRED","LEGACY_ONLY"])assert.match(sql,new RegExp(value));
  assert.match(sql,/UNIQUE\(organization_id,legacy_source,legacy_table,legacy_id\)/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql,/legacy_provenance_decisions_append_only/);
  assert.match(sql,/legacy provenance change requires append-only decision evidence/);
  assert.match(sql,/CHECK\(imported_at IS NULL\)/);
  assert.doesNotMatch(sql,/UPDATE\s+(employees|employee_profiles|departments|jobs|positions|employee_assignments|attendance_records|workflow_)/i);
  const production=read("scripts/production-migrate.js");
  assert.match(production,/REVOKE UPDATE,DELETE,TRUNCATE ON[^;]*legacy_provenance_decisions/s);
  assert.match(production,/REVOKE DELETE,TRUNCATE ON legacy_provenance_records/);
  const hardening=read("migrations/0088_legacy_provenance_projection_guard_hardening.sql");
  assert.match(hardening,/from_classification=OLD\.classification/);
  assert.match(hardening,/actor_user_id=NEW\.reviewed_by/);
  assert.match(hardening,/match_candidate_id IS DISTINCT FROM OLD\.match_candidate_id/);
});

test("extractor and stager expose provenance only and never fabricate domain history",()=>{
  const exporter=read("../ops/export-legacy-migration-review.js"),stager=read("scripts/stage-legacy-migration-review.js"),route=read("src/routes/legacy-migration.js");
  assert.match(exporter,/OPEN_READONLY/);assert.match(exporter,/PRAGMA query_only=ON/);
  assert.match(exporter,/ATTENDANCE_IMPORT_BLOCKED/);assert.match(exporter,/DUPLICATE_DOCUMENT_NUMBER/);assert.match(exporter,/ORPHAN_ATTACHMENT/);assert.match(exporter,/DUPLICATE_FILE_HASH/);
  assert.match(stager,/registerProvenanceRecord/);assert.match(stager,/noDomainImport:true/);
  assert.doesNotMatch(stager,/INSERT INTO\s+(employees|departments|jobs|positions|employee_assignments|attendance_records|documents|correspondence_records|archive_records|workflow_)/i);
  assert.doesNotMatch(route,/(INSERT|UPDATE|DELETE)[^;]*(imported_at|workflow_transition|appointment_cases|exit_cases)/i);
});

test("review permission is enforced by backend middleware",()=>{
  const middleware=requirePermissions("legacy_migration.review");let status,body,nextCalled=false;
  middleware({user:{permissions:["legacy_migration.read"]}},{status(value){status=value;return this},json(value){body=value}},()=>{nextCalled=true});
  assert.equal(status,403);assert.equal(body.error,"Insufficient permission");assert.equal(nextCalled,false);
  middleware({user:{permissions:["legacy_migration.review"]}},{status(){throw new Error("must not deny")},json(){}},()=>{nextCalled=true});
  assert.equal(nextCalled,true);
});

test("canonical decision payload hashing is stable and conflict-sensitive",()=>{
  assert.equal(canonicalJson({b:2,a:{d:4,c:3}}),canonicalJson({a:{c:3,d:4},b:2}));
  assert.equal(sha256({b:2,a:1}),sha256({a:1,b:2}));assert.notEqual(sha256({a:1}),sha256({a:2}));
});

test("review UI shows grouped evidence, deterministic recommendation, batch review and no import action",()=>{
  const ui=read("../web/legacy-migration-review.js"),administration=read("../web/administration.js"),html=read("../web/index.html");
  for(const marker of ["Grouped review queue","source мөрийн дэлгэрэнгүй","Recommendation","Reviewer note","Decision history","NO IMPORT","APPROVE_RECOMMENDATION","SEND_MANUAL_REVIEW"])assert.match(ui,new RegExp(marker));
  assert.match(administration,/data-legacy-review-nav/);assert.match(html,/legacy-migration-review\.js\?v=2/);
  assert.doesNotMatch(ui,/legacy-migration[^`"']*\/import|data-legacy-import|data-legacy-commit/i);
});

test("review UI assets are included in the web image and cannot fall through to the SPA shell",()=>{
  const docker=read("../web/Dockerfile"),nginx=read("../web/nginx.conf");
  assert.match(docker,/COPY legacy-migration-review\.js \/usr\/share\/nginx\/html\/legacy-migration-review\.js/);
  assert.match(docker,/COPY legacy-migration-review\.css \/usr\/share\/nginx\/html\/legacy-migration-review\.css/);
  assert.match(nginx,/location ~\* \\\.\(\?:js\|css\)\$\s*\{\s*try_files \$uri =404;/s);
});
