"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { getPool, closePool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

(async () => {
  const user = await getPool().query(
    `SELECT u.id FROM users u
      WHERE u.active=true AND EXISTS(
        SELECT 1 FROM user_roles ur
        JOIN organization_role_permissions rp
          ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
        WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id
          AND rp.permission_code='builder.manage'
      ) ORDER BY u.created_at LIMIT 1`
  );
  assert.ok(user.rowCount, "A user with builder.manage is required");
  const headers = { authorization: `Bearer ${signAccessToken(user.rows[0].id)}` };
  const catalogResponse = await fetch("http://127.0.0.1:4100/api/builder/catalog", { headers });
  assert.equal(catalogResponse.status, 200, "Builder catalog must respond");
  const catalog = await catalogResponse.json();
  assert.ok(catalog.templates.some(item => item.code === "general" && item.maturity === "verified"));
  assert.ok(catalog.templates.some(item => item.code === "municipal-infrastructure" && item.maturity === "pilot"));
  assert.ok(catalog.modules.some(item => item.core));
  assert.ok(catalog.rules.some(item => item.rule_type === "requires_approval"));

  const currentResponse = await fetch("http://127.0.0.1:4100/api/builder/current", { headers });
  assert.equal(currentResponse.status, 200, "Builder current configuration must respond");
  const current = await currentResponse.json();
  assert.ok(Array.isArray(current.modules));
  assert.ok(Array.isArray(current.builds));
  const aiStatusResponse = await fetch("http://127.0.0.1:4100/api/builder/ai/status", { headers });
  assert.equal(aiStatusResponse.status, 200, "Builder AI status must respond");
  const aiStatus = await aiStatusResponse.json();
  assert.equal(aiStatus.execution, "proposal_only");
  assert.equal(typeof aiStatus.enabled, "boolean");
  console.log(`Builder smoke passed: ${catalog.modules.length} modules, ${catalog.templates.length} templates, ${current.builds.length} builds, AI enabled=${aiStatus.enabled}.`);
  await closePool();
})().catch(async error => {
  console.error(error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
