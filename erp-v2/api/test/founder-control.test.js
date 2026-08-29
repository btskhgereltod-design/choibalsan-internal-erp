"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const repoRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readRepo = file => fs.readFileSync(path.join(repoRoot, file), "utf8");

test("Founder operator remains Platform-scoped and is assigned only to the initial active admin", () => {
  const migration = readApi("migrations/0057_founder_control.sql");
  assert.match(migration, /platform\.founder\.read/);
  assert.match(migration, /platform\.support-access\.manage/);
  assert.match(migration, /founder-operator/);
  assert.match(migration, /ORDER BY created_at,id LIMIT 1/);
  assert.doesNotMatch(migration, /'(?:market|apps|group)\./i);
});

test("support access is reason-bound, scoped, short-lived, attributable, and append-only", () => {
  const migration = readApi("migrations/0057_founder_control.sql");
  const route = readApi("src/routes/platform.js");
  assert.match(migration, /platform_support_access_grants/);
  assert.match(migration, /interval '60 minutes'/);
  assert.match(migration, /'diagnostics','configuration','audit'/);
  assert.match(migration, /platform_support_access_events_append_only/);
  assert.match(route, /durationMinutes:z\.coerce\.number\(\)\.int\(\)\.min\(5\)\.max\(60\)/);
  assert.match(route, /g\.platform_admin_id=\$2/);
  assert.match(route, /SUPPORT_ACCESS_INACTIVE/);
  assert.match(route, /rawTenantRows:false,tenantApiBypass:false,mutationsAllowed:false/);
  assert.match(route, /platform\.support_access\.issued/);
  assert.match(route, /platform\.support_access\.revoked/);
});

test("offline break-glass recovery requires explicit confirmation and leaves immutable evidence", () => {
  const recovery = readApi("scripts/recover-platform-owner.js");
  assert.match(recovery, /RECOVER_PLATFORM_OWNER/);
  assert.match(recovery, /BREAK_GLASS_TARGET_EMAIL/);
  assert.match(recovery, /BREAK_GLASS_REASON/);
  assert.match(recovery, /platform\.break_glass\.owner_recovered/);
  assert.match(recovery, /platform_audit_logs/);
  assert.match(recovery, /security_audit_events/);
  assert.doesNotMatch(recovery, /market|ranking|review|proposal|dispute/i);
});

test("Founder Control UI states real, preview, planned, and external boundaries truthfully", () => {
  const html = readRepo("web/platform.html");
  const client = readRepo("web/platform.js");
  assert.match(html, /FOUNDER CONTROL · V31/);
  assert.match(html, /Tenant diagnostic grant/);
  assert.match(html, /Root \/ Break-glass нь web-ийн super admin биш/);
  assert.match(client, /platform\.founder\.read/);
  assert.match(html, /platform\.support-access\.manage/);
  assert.match(client, /market-customer/);
  assert.match(client, /market-provider/);
  assert.match(client, /market-operator/);
});

test("public customer/provider toggle remains a participant view and not a super-admin grant", () => {
  const site = readRepo("public-site/site.js");
  const html = readRepo("public-site/index.html");
  assert.match(site, /let activeMarketRole = "guest"/);
  assert.match(site, /if \(!marketIdentity \|\| !active\.has\(view\)\)/);
  assert.match(site, /role === "provider" \? "provider" : "customer"/);
  assert.match(html, /data-market-role="customer"/);
  assert.match(html, /data-market-role="provider"/);
  assert.match(html, /market-role-switch[^"]* hidden/);
  assert.doesNotMatch(site, /super[_-]?admin/i);
});
