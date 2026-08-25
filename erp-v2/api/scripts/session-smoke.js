"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { getPool, closePool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

(async () => {
  const user = await getPool().query(
    `SELECT u.id
       FROM users u
       JOIN organizations o ON o.id=u.organization_id
      WHERE u.active=true AND o.status='active'
      ORDER BY u.created_at
      LIMIT 1`
  );
  assert.ok(user.rowCount, "An active tenant user is required");
  const headers = { authorization: `Bearer ${signAccessToken(user.rows[0].id)}` };
  const meResponse = await fetch("http://127.0.0.1:4100/api/auth/me", { headers });
  assert.equal(meResponse.status, 200, "Authenticated /api/auth/me must respond");
  const organizationResponse = await fetch("http://127.0.0.1:4100/api/organizations/current", { headers });
  assert.equal(organizationResponse.status, 200, "Organization session endpoint must respond");
  const body = await organizationResponse.json();
  assert.ok(body.organization.enabledModules.includes("core-work"));
  assert.ok(body.organization.enabledModules.includes("structure"));
  assert.ok(Array.isArray(body.permissions));
  console.log(`Session smoke passed: ${body.organization.enabledModules.length} enabled modules, ${body.permissions.length} permissions.`);
  await closePool();
})().catch(async error => {
  console.error(error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
