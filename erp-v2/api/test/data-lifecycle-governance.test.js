"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const projectRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readProject = file => fs.readFileSync(path.join(projectRoot, file), "utf8");

test("lifecycle migration adds approval, hold and append-only evidence controls", () => {
  const sql = readApi("migrations/0033_data_lifecycle_governance.sql");
  assert.match(sql, /CREATE TABLE data_lifecycle_policies/);
  assert.match(sql, /CHECK\(requires_approval = true\)/);
  assert.match(sql, /CREATE TABLE data_legal_holds/);
  assert.match(sql, /CREATE TABLE data_disposition_requests/);
  assert.match(sql, /CREATE TABLE data_lifecycle_events/);
  assert.match(sql, /data_lifecycle_events_append_only/);
  assert.match(sql, /GOVERNANCE_ACTIVE_HOLD/);
  assert.doesNotMatch(sql, /ALTER TABLE data_lifecycle_events ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /DELETE FROM/);
});

test("governance API is tenant-primary-admin only and has no execution endpoint", () => {
  const route = readApi("src/routes/data-governance.js");
  assert.match(route, /requireSystemRoles\("owner"\)/);
  assert.doesNotMatch(route, /requireRoles\("director"\)/);
  assert.match(route, /writeLifecycleEvent/);
  assert.match(route, /writeAudit/);
  assert.match(route, /executionPerformed:false/);
  assert.doesNotMatch(route, /router\.(post|delete)\("\/execute/);
  assert.doesNotMatch(route, /DELETE FROM/);
});

test("runtime cannot mutate lifecycle evidence", () => {
  const productionMigrate = readApi("scripts/production-migrate.js");
  assert.match(productionMigrate, /data_lifecycle_events/);
  assert.match(productionMigrate, /REVOKE UPDATE,DELETE,TRUNCATE/);
});

test("tenant settings exposes lifecycle governance without a sidebar module", () => {
  const ui = readProject("web/business-modules.js");
  assert.match(ui, /data-settings-tab="data"/);
  assert.match(ui, /Өгөгдлийн удирдлага/);
  assert.match(ui, /Өгөгдлийг автоматаар устгахгүй/);
  assert.match(ui, /\/api\/data-governance/);
});
