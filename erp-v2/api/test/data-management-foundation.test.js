"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(apiRoot, file), "utf8");

test("migration history has one immutable file per version", () => {
  const files = fs.readdirSync(path.join(apiRoot, "migrations"))
    .filter(name => /^\d+_.+\.sql$/.test(name));
  const versions = files.map(name => name.split("_")[0]);
  assert.equal(new Set(versions).size, versions.length);

  const runner = read("scripts/migrate.js");
  assert.match(runner, /checksum CHAR\(64\)/);
  assert.match(runner, /createHash\("sha256"\)/);
  assert.match(runner, /Applied migration changed/);
  assert.match(runner, /Duplicate migration versions/);
  assert.match(runner, /startsWith\("legacy:"\)/);
  const releaseCheck = read("scripts/release-check.js");
  assert.match(releaseCheck, /expectedLatest/);
  assert.doesNotMatch(releaseCheck, /latest,"0028"/);
  assert.match(releaseCheck, /finally\(\(\)=>closePool\(\)\)/);
  assert.match(releaseCheck, /RELEASE_WEB_BASE/);
  assert.match(releaseCheck, /"\/lighting\.js","\/camera\.js","\/workflow\.css"/);
});

test("production runtime cannot mutate report schedule evidence", () => {
  const productionMigrate = read("scripts/production-migrate.js");
  assert.match(
    productionMigrate,
    /REVOKE UPDATE,DELETE,TRUNCATE ON[^;]*report_schedule_events,report_schedule_command_receipts/s
  );
});

test("organization and people data have canonical master-data semantics", () => {
  const migration = read("migrations/0032_data_management_foundation.sql");
  assert.match(migration, /CREATE TABLE reference_sets/);
  assert.match(migration, /WHERE code='owner'/);
  assert.match(migration, /CREATE TABLE reference_values/);
  assert.match(migration, /CREATE TABLE jobs/);
  assert.match(migration, /CREATE TABLE employee_assignments/);
  assert.match(migration, /employee_assignments_one_active_primary_uidx/);
  assert.match(migration, /FOREIGN KEY\(organization_id,employee_id\)/);
  assert.match(migration, /FOREIGN KEY\(organization_id,organization_unit_id\)/);
  assert.match(migration, /FOREIGN KEY\(organization_id,position_id\)/);
});

test("data governance catalog, quality rules and staged tenant policies exist", () => {
  const migration = read("migrations/0032_data_management_foundation.sql");
  assert.match(migration, /CREATE TABLE data_catalog_assets/);
  assert.match(migration, /CREATE TABLE organization_data_stewards/);
  assert.match(migration, /CREATE TABLE data_quality_rules/);
  assert.match(migration, /CREATE POLICY employees_tenant_policy/);
  assert.match(migration, /CREATE POLICY employee_assignments_tenant_policy/);
  assert.doesNotMatch(migration, /ALTER TABLE employees ENABLE ROW LEVEL SECURITY/);
});

test("job title never grants tenant ownership automatically", () => {
  const employees = read("src/routes/employees.js");
  assert.match(employees, /const codes = \["member"\]/);
  assert.doesNotMatch(employees, /role === "director"[^\n]*owner/);
  assert.doesNotMatch(employees, /role === "chief_engineer"[^\n]*manager/);
});

test("structure writes synchronize effective-dated assignments", () => {
  const employees = read("src/routes/employees.js");
  const modules = read("src/routes/business-modules.js");
  const assignments = read("src/services/employee-assignment.js");
  assert.match(employees, /syncPrimaryAssignment/);
  assert.match(modules, /INSERT INTO jobs/);
  assert.match(modules, /syncPrimaryAssignment/);
  assert.match(assignments, /assignment_type_code='primary'/);
  assert.match(assignments, /SET status='ended'/);
});
