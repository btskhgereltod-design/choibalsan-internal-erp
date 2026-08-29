"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const projectRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readProject = file => fs.readFileSync(path.join(projectRoot, file), "utf8");

test("platform command center exposes aggregate operational signals", () => {
  const route = readApi("src/routes/platform.js");
  assert.match(route, /router\.get\("\/command-center"/);
  assert.match(route, /security_events_24h/);
  assert.match(route, /dead_letter_executions/);
  assert.match(route, /quality_failures/);
  assert.match(route, /overdue_invoices/);
  assert.match(route, /builder_support_requests/);
});

test("organization control view is UUID scoped and privacy safe", () => {
  const route = readApi("src/routes/platform.js");
  const start = route.indexOf('router.get("/organizations/:id/control"');
  const end = route.indexOf('router.post("/organizations"', start);
  assert(start >= 0 && end > start);
  const control = route.slice(start, end);

  assert.match(control, /z\.uuid\(\)\.safeParse/);
  assert.match(control, /WHERE organization_id=\$1/);
  assert.match(control, /architecture_controls/);
  assert.match(control, /active_login_accounts/);
  assert.match(control, /recent_activity/);

  // The platform operator receives counts and states, never tenant employee,
  // document, evidence, or integration payload rows.
  assert.doesNotMatch(control, /SELECT[^`]*employees\.full_name/is);
  assert.doesNotMatch(control, /SELECT[^`]*document_versions[^`]*(content|storage_key)/is);
  assert.doesNotMatch(control, /SELECT[^`]*(request_payload|response_payload|evidence)/is);
});

test("platform UI contains command center and organization control views", () => {
  const html = readProject("web/platform.html");
  const js = readProject("web/platform.js");
  assert.match(html, /data-view="command"/);
  assert.match(html, /id="attentionQueue"/);
  assert.match(html, /id="organizationControl"/);
  assert.match(html, /id="detailModules"/);
  assert.match(js, /\/api\/platform\/command-center/);
  assert.match(js, /\/control`/);
});

test("platform adoption overview exposes aggregate onboarding milestones", () => {
  const route = readApi("src/routes/platform.js");
  const start = route.indexOf('router.get("/adoption/overview"');
  const end = route.indexOf('router.get("/system/status"', start);
  assert(start >= 0 && end > start);
  const adoption = route.slice(start, end);

  assert.match(adoption, /first_login_at/);
  assert.match(adoption, /structure_ready_at/);
  assert.match(adoption, /first_value_at/);
  assert.match(adoption, /stable_at/);
  assert.match(adoption, /structure_attempts/);
  assert.match(adoption, /likely_abandoned/);
  assert.doesNotMatch(adoption, /employees\.full_name/i);
  assert.doesNotMatch(adoption, /document_versions[^`]*(content|storage_key)/is);
});

test("platform UI contains adoption funnel and time-to-value view", () => {
  const html = readProject("web/platform.html");
  const js = readProject("web/platform.js");
  assert.match(html, /data-view="adoption"/);
  assert.match(html, /id="adoptionFunnel"/);
  assert.match(html, /id="adoptionOrganizations"/);
  assert.match(js, /\/api\/platform\/adoption\/overview/);
  assert.match(js, /Smart Import/);
});

test("admin shell separates Group, Platform, Apps, and Market without fabricating access", () => {
  const html = readProject("web/platform.html");
  const js = readProject("web/platform.js");

  assert.match(html, /data-admin-context="group"/);
  assert.match(html, /data-admin-context="platform"/);
  assert.match(html, /data-admin-context="apps"/);
  assert.match(html, /data-admin-context="market"/);
  assert.match(html, /data-admin-context-panel="platform"/);
  assert.match(html, /ТӨЛӨВЛӨСӨН · 20 ДҮРИЙН SIMULATION · BACKEND БАЙХГҮЙ/);
  assert.match(html, /Одоогийн Platform token энэ орчинд эрх өгөхгүй/);
  assert.match(html, /Group admin гэсэн бүхнийг нээдэг эрх байхгүй/);
  assert.match(html, /platform\.css\?v=4/);
  assert.match(html, /platform-system\.css\?v=12/);
  assert.match(html, /platform\.js\?v=12/);
  assert.match(html, /20 ДҮРИЙН SIMULATION/);
  assert.match(html, /Портфолио ба шаардлага/);
  assert.match(html, /Нийлүүлэгч ба listing/);
  assert.match(js, /function switchAdminContext/);
  assert.match(js, /function hasPlatformPermission/);
  assert.match(html, /data-requires-platform-permission="platform\.organizations\.manage"/);
  assert.match(html, /data-requires-platform-permission="platform\.billing\.manage"/);
  assert.match(js, /platform\.organizations\.read/);
  assert.doesNotMatch(js, /\/api\/(market|apps)/);
});
