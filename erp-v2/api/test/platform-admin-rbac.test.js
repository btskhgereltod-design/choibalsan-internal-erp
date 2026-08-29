"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(apiRoot, file), "utf8");

test("Platform admin RBAC is Platform-only and preserves existing admins through owner assignment", () => {
  const migration = read("migrations/0056_platform_admin_rbac.sql");
  assert.match(migration, /CREATE TABLE platform_permission_catalog/);
  assert.match(migration, /CREATE TABLE platform_admin_roles/);
  assert.match(migration, /CREATE TABLE platform_admin_role_assignments/);
  assert.match(migration, /platform-owner/);
  assert.match(migration, /SELECT admin\.id,role\.id,admin\.id/);
  assert.match(migration, /WHERE admin\.active=true/);
  assert.doesNotMatch(migration, /market\.|apps\.|group\./i);
});

test("Platform authentication derives current roles and permissions from active assignments", () => {
  const auth = read("src/middleware/auth.js");
  assert.match(auth, /platform_admin_role_assignments/);
  assert.match(auth, /assignment\.revoked_at IS NULL/);
  assert.match(auth, /role\.active=true/);
  assert.match(auth, /AS permissions/);
  assert.match(auth, /function requirePlatformPermissions/);
  assert.match(auth, /PLATFORM_PERMISSION_REQUIRED/);
});

test("every Platform control-plane route is guarded by a scoped Platform permission", () => {
  const route = read("src/routes/platform.js");
  const billing = read("src/routes/business-modules.js");
  const expected = [
    'requirePlatformPermissions("platform.ai-knowledge.read")',
    'requirePlatformPermissions("platform.ai-knowledge.manage")',
    'requirePlatformPermissions("platform.ai-usage.read")',
    'requirePlatformPermissions("platform.ai-usage.manage")',
    'requirePlatformPermissions("platform.catalog.validate")',
    'requirePlatformPermissions("platform.operations.read")',
    'requirePlatformPermissions("platform.adoption.read")',
    'requirePlatformPermissions("platform.adoption.manage")',
    'requirePlatformPermissions("platform.system.read")',
    'requirePlatformPermissions("platform.organizations.read")',
    'requirePlatformPermissions("platform.organizations.manage")'
  ];
  expected.forEach(permission => assert.ok(route.includes(permission), `missing ${permission}`));
  assert.match(billing, /requirePlatformPermissions\("platform\.billing\.read"\)/);
  assert.match(billing, /requirePlatformPermissions\("platform\.billing\.manage"\)/);
});

test("Founder control and support routes require their dedicated Platform permissions", () => {
  const route = read("src/routes/platform.js");
  assert.match(route, /router\.get\("\/founder\/control", requirePlatformPermissions\("platform\.founder\.read"\)/);
  assert.match(route, /router\.post\("\/support-access", requirePlatformPermissions\("platform\.support-access\.manage"\)/);
  assert.match(route, /router\.post\("\/support-access\/:id\/revoke", requirePlatformPermissions\("platform\.support-access\.manage"\)/);
  assert.match(route, /router\.get\("\/support-access\/:id\/snapshot", requirePlatformPermissions\("platform\.support-access\.manage"\)/);
});

test("bootstrap assigns the bounded Platform owner role without minting cross-business roles", () => {
  const bootstrap = read("scripts/bootstrap.js");
  assert.match(bootstrap, /platform_admin_role_assignments/);
  assert.match(bootstrap, /role\.code='platform-owner'/);
  assert.doesNotMatch(bootstrap, /market-owner|apps-owner|group-owner/);
});
