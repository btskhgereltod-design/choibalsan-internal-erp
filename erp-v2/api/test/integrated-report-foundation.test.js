"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const route = fs.readFileSync(path.join(root, "api", "src", "routes", "reports.js"), "utf8");
const web = fs.readFileSync(path.join(root, "web", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "web", "reports.css"), "utf8");

test("management report counts completion events and reconstructs period boundaries", () => {
  assert.match(route, /event_type='status_changed' AND e\.to_status='completed'/);
  assert.match(route, /status_at_start/);
  assert.match(route, /status_at_end/);
  assert.match(route, /opening_backlog/);
  assert.match(route, /closing_backlog/);
  assert.match(route, /unknownStatusAtStart/);
  assert.match(route, /unknownStatusAtEnd/);
  assert.match(route, /previousUnknownStatusAtStart/);
  assert.match(route, /previousUnknownStatusAtEnd/);
});

test("management report compares an equal prior period and limits a request to one year", () => {
  assert.match(route, /previousFrom/);
  assert.match(route, /comparison: \{ period: period\.previous, work: previous \}/);
  assert.match(route, /days > 366/);
});

test("people reporting is based on canonical employees rather than login accounts", () => {
  assert.match(route, /FROM employees e/);
  assert.match(route, /basis: "canonical_employee_assignment_events_v1"/);
  assert.match(route, /assignment_history_version=1/);
  assert.doesNotMatch(route, /FROM users u LEFT JOIN work_orders/);
  assert.match(web, /append-only түүхээс ажилтны үндсэн бүртгэлтэй холбож тооцов/);
  assert.match(web, /Түүхгүй хуучин төлөвийг unknown/);
});

test("calendar boundaries and trend buckets use the tenant timezone", () => {
  assert.match(route, /AT TIME ZONE \$4/);
  assert.match(route, /organization\.timezone/);
  assert.match(route, /created_at AT TIME ZONE \$4/);
  assert.match(route, /timeZone: organization\.timezone/);
  assert.match(route, /a\.created_at<=w\.created_at AND a\.created_at<b\.ends_at/);
  assert.match(route, /a\.created_at<=w\.created_at AND a\.created_at<w\.ends_at/);
  assert.match(route, /a\.assignment_operation='initial'/);
  assert.doesNotMatch(route, /w\.created_at>=b\.starts_at AND w\.created_at<b\.ends_at AND w\.assigned_to IS NULL/);
});

test("asset values are explicitly returned as a current snapshot", () => {
  assert.match(route, /assetSnapshot: \{ asOf: generatedAt/);
  assert.match(web, /Одоогийн хөрөнгийн төлөв/);
  assert.match(web, /хугацааны урсгал биш/);
});

test("report UI offers calendar presets, comparison, and printable output", () => {
  assert.match(web, /data-report-preset="month"/);
  assert.match(web, /data-report-preset="quarter"/);
  assert.match(web, /data-report-preset="year"/);
  assert.match(web, /reportDelta/);
  assert.match(web, /window\.print\(\)/);
  assert.match(css, /@media print/);
});

test("tenant owner can access reports without relying on a legacy job title", () => {
  assert.match(route, /roles\.has\("owner"\)/);
  assert.doesNotMatch(route, /router\.use\(authenticate, requireRoles/);
  assert.match(web, /system_roles\|\|\[\]/);
  assert.match(web, /reportOwner/);
});

test("CSV export reconciles opening, movement, closing, and period-end overdue rows", () => {
  assert.match(route, /start_status/);
  assert.match(route, /end_status/);
  assert.match(route, /completed_at IS NOT NULL OR cancelled_at IS NOT NULL/);
  assert.match(route, /"Эхний үлдэгдэл","Хугацаанд үүссэн"/);
  assert.match(route, /"Эцсийн үлдэгдэл","Эцэст хугацаа хэтэрсэн"/);
});
