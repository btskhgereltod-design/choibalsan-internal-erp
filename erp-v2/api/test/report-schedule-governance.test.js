"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const migration = fs.readFileSync(path.join(root, "api", "migrations", "0106_report_schedule_governance.sql"), "utf8");
const route = fs.readFileSync(path.join(root, "api", "src", "routes", "report-schedules.js"), "utf8");
const web = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
const importer = fs.readFileSync(path.join(root, "api", "scripts", "stage-legacy-report-schedules.js"), "utf8");
const { _nextOccurrence, _addMonthsClamped } = require("../src/routes/report-schedules");

test("report schedules preserve end-of-month cadence without date rollover", () => {
  assert.equal(_addMonthsClamped("2025-01-31", 1), "2025-02-28");
  assert.equal(_addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(_nextOccurrence("2024-02-29", "annual"), "2025-02-28");
  assert.equal(_nextOccurrence("2025-02-28", "monthly", 31), "2025-03-31");
  assert.equal(_nextOccurrence("2026-09-01", "weekly"), "2026-09-08");
  assert.equal(_nextOccurrence("2026-09-01", "one_time"), "2026-09-01");
});

test("schedule storage is tenant scoped and lifecycle evidence is append only", () => {
  for (const table of ["report_schedules", "report_schedule_events", "report_schedule_command_receipts"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /report_schedule_events_append_only/);
  assert.match(migration, /report_schedule_command_receipts_append_only/);
  assert.match(migration, /FOREIGN KEY\(organization_id,responsible_user_id\)/);
  assert.doesNotMatch(route, /DELETE FROM report_schedules/);
});

test("writes derive tenant and actor, enforce permissions and record audit in one transaction", () => {
  assert.match(route, /withTenantTransaction\(req\.user\.organization_id/);
  assert.match(route, /req\.user\.organization_id/);
  assert.match(route, /req\.user\.id/);
  for (const permission of ["report-schedules.read", "report-schedules.manage", "report-schedules.submit"]) {
    assert.match(route, new RegExp(permission.replace(".", "\\.")));
  }
  for (const action of ["report_schedule.create", "report_schedule.update", "report_schedule.submit", "report_schedule.retire"]) {
    assert.match(route, new RegExp(action.replace(".", "\\.")));
  }
});

test("submission is version checked and exact-payload idempotent", () => {
  assert.match(route, /REPORT_SCHEDULE_VERSION_CONFLICT/);
  assert.match(route, /REPORT_SCHEDULE_IDEMPOTENCY_CONFLICT/);
  assert.match(route, /payload_sha256/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /FOR UPDATE/);
  assert.match(route, /command_type='submit'/);
  assert.match(route, /event_type,from_version,to_version/);
});

test("report UI exposes the legacy workflow with explicit evidence semantics", () => {
  assert.match(web, /Тайлангийн хуваарь/);
  assert.match(web, /data-report-schedule-submit/);
  assert.match(web, /data-report-schedule-retire/);
  assert.match(web, /append-only баримт/);
  assert.match(web, /capabilities\.canSubmit/);
});

test("legacy rows can enter only the guarded local demo path", () => {
  assert.match(importer, /sqlite3\.OPEN_READONLY/);
  assert.match(importer, /ALLOW_LEGACY_REPORT_SCHEDULE_DEMO_IMPORT/);
  assert.match(importer, /Production import is forbidden/);
  assert.match(importer, /Loopback demo database required/);
  assert.match(importer, /target must be empty/);
  assert.match(importer, /legacyId/);
});
