"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const projectRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readProject = file => fs.readFileSync(path.join(projectRoot, file), "utf8");

test("tenant architecture controls capture source, history, criticality and recovery targets", () => {
  const sql = readApi("migrations/0034_data_architecture_controls.sql");
  assert.match(sql, /CREATE TABLE organization_data_asset_controls/);
  assert.match(sql, /authoritative_system/);
  assert.match(sql, /update_policy/);
  assert.match(sql, /history_strategy/);
  assert.match(sql, /criticality/);
  assert.match(sql, /recovery_point_minutes/);
  assert.match(sql, /recovery_time_minutes/);
  assert.match(sql, /PRIMARY KEY\(organization_id,asset_code\)/);
  assert.doesNotMatch(sql, /ALTER TABLE organization_data_asset_controls ENABLE ROW LEVEL SECURITY/);
});

test("tenant API validates and audits architecture controls", () => {
  const route = readApi("src/routes/data-governance.js");
  assert.match(route, /router\.put\("\/architecture\/:assetCode"/);
  assert.match(route, /Маш чухал өгөгдөлд RPO болон RTO/);
  assert.match(route, /architecture\.(updated|created)/);
  assert.match(route, /data\.architecture\.(update|create)/);
});

test("platform admin receives aggregate governance health and backup freshness", () => {
  const route = readApi("src/routes/platform.js");
  const ui = readProject("web/platform.js");
  const html = readProject("web/platform.html");
  assert.match(route, /architecture_controls/);
  assert.match(route, /pending_dispositions/);
  assert.match(route, /backup_status/);
  assert.match(ui, /renderGovernance/);
  assert.match(html, /Байгууллагуудын хэрэгжилтийн хяналт/);
});

test("tenant settings exposes architecture controls without adding a sidebar module", () => {
  const ui = readProject("web/business-modules.js");
  assert.match(ui, /dataArchitectureForm/);
  assert.match(ui, /Албан ёсны эх сурвалж/);
  assert.match(ui, /recoveryPointMinutes/);
  assert.match(ui, /\/api\/data-governance\/architecture\//);
});
