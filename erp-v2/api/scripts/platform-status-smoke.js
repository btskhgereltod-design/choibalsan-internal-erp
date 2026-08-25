"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { getPool, closePool } = require("../src/db");
const { signPlatformToken } = require("../src/security/token");

async function main() {
  const admin = await getPool().query(
    "SELECT id FROM platform_admins WHERE active=true ORDER BY created_at LIMIT 1"
  );
  assert.equal(admin.rowCount, 1, "An active platform administrator is required");
  const authorization = `Bearer ${signPlatformToken(admin.rows[0].id)}`;
  const response = await fetch("http://127.0.0.1:4100/api/platform/system/status", {
    headers: { authorization },
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "healthy");
  assert.equal(body.schema_version, "0045");
  assert(Number(body.governance.reference_sets) > 0);
  assert(Number(body.governance.dictionary_elements) > 0);
  assert(Number(body.governance.kpi_templates) > 0);
  assert(Number(body.governance.quality_rule_templates) > 0);
  assert(body.governance && Array.isArray(body.governance.organizations));
  assert(["current", "stale"].includes(body.backup_status));

  const commandResponse = await fetch("http://127.0.0.1:4100/api/platform/command-center", {
    headers: { authorization },
  });
  const command = await commandResponse.json();
  assert.equal(commandResponse.status, 200, JSON.stringify(command));
  assert(command.summary && Array.isArray(command.attention) && Array.isArray(command.activity));

  const adoptionResponse = await fetch("http://127.0.0.1:4100/api/platform/adoption/overview", {
    headers: { authorization },
  });
  const adoption = await adoptionResponse.json();
  assert.equal(adoptionResponse.status, 200, JSON.stringify(adoption));
  assert(adoption.summary && Array.isArray(adoption.funnel) && Array.isArray(adoption.items));
  assert.equal(adoption.funnel.length, 6);
  assert.equal(Object.hasOwn(adoption.items[0] || {}, "employee_name"), false);

  const organizationsResponse = await fetch("http://127.0.0.1:4100/api/platform/organizations", {
    headers: { authorization },
  });
  const organizations = await organizationsResponse.json();
  assert.equal(organizationsResponse.status, 200, JSON.stringify(organizations));
  assert(Array.isArray(organizations.items));
  if (organizations.items.length) {
    const detailResponse = await fetch(
      `http://127.0.0.1:4100/api/platform/organizations/${organizations.items[0].id}/control`,
      { headers: { authorization } }
    );
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200, JSON.stringify(detail));
    assert(detail.organization && detail.readiness && detail.governance && detail.operations);
    assert(Array.isArray(detail.modules) && Array.isArray(detail.recent_activity));
    assert.equal(Object.hasOwn(detail, "employees"), false);
    assert.equal(Object.hasOwn(detail, "documents"), false);
  }

  console.log(`Platform control smoke passed: schema ${body.schema_version}, backup ${body.backup_status}, ${organizations.items.length} organizations, ${command.attention.length} attention items, ${adoption.summary.total_attempts} adoption attempts.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(closePool);
