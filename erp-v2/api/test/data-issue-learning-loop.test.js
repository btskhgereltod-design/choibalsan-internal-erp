"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const projectRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readProject = file => fs.readFileSync(path.join(projectRoot, file), "utf8");

test("data issue cases are tenant-scoped and decision history is immutable", () => {
  const sql = readApi("migrations/0045_data_issue_learning_loop.sql");
  assert.match(sql, /CREATE TABLE data_quality_findings/);
  assert.match(sql, /UNIQUE\(organization_id,fingerprint\)/);
  assert.match(sql, /CREATE TABLE data_quality_finding_events/);
  assert.match(sql, /data_quality_finding_events_immutable/);
  assert.match(sql, /humanApprovalRequired/);
  assert.doesNotMatch(sql, /raw_payload|raw_data|source_data JSONB/);
  assert.match(readApi("scripts/production-migrate.js"), /data_quality_finding_events/);
});

test("finding API records human decisions without mutating canonical data", () => {
  const route = readApi("src/routes/data-governance.js");
  assert.match(route, /safeSourceReference/);
  assert.match(route, /rawValuesStored:false/);
  assert.match(route, /canonicalMutationPerformed:false/);
  assert.match(route, /data\.finding\.decision/);
  assert.doesNotMatch(route, /findings[\s\S]*UPDATE (employees|assets|work_orders)/);
});

test("real migration lessons seed reusable classifications", () => {
  const sql = readApi("migrations/0045_data_issue_learning_loop.sql");
  assert.match(sql, /legacy-lighting-asset-classification/);
  assert.match(sql, /operational-object-vs-fixed-asset/);
  assert.match(sql, /legacy-work-progress-without-measurement/);
  assert.match(sql, /percentage-without-measurement-basis/);
});

test("tenant UI exposes review queue and admin sees aggregate only", () => {
  const ui = readProject("web/business-modules.js");
  const platform = readProject("web/platform.js");
  const platformApi = readApi("src/routes/platform.js");
  assert.match(ui, /AI болон импорт өгөгдлийг чимээгүй засахгүй/);
  assert.match(ui, /dataFindingForm/);
  assert.match(ui, /Canonical өгөгдлийг автоматаар өөрчлөөгүй/);
  assert.match(platform, /Issue learning/);
  assert.match(platformApi, /open_findings/);
  assert.doesNotMatch(platformApi, /SELECT[\s\S]{0,100}description[\s\S]{0,100}FROM data_quality_findings/);
});
