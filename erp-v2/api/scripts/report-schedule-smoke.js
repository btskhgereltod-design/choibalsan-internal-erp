"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getPool, closePool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

const baseUrl = process.env.REPORT_SCHEDULE_SMOKE_BASE_URL || "http://127.0.0.1:4100";

async function request(path, token, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${result.error || ""}`);
  return { response, result };
}

(async () => {
  if (process.env.RUN_REPORT_SCHEDULE_SMOKE !== "1") {
    console.log("Set RUN_REPORT_SCHEDULE_SMOKE=1 to run");
    return;
  }
  const database = (await getPool().query("SELECT current_database() AS name")).rows[0].name;
  assert.match(database, /^(erp_v2|overva_(test|rehearsal)_[a-z0-9_]+)$/i, "Demo/test database required");
  const authorized = (await getPool().query(
    `SELECT DISTINCT user_row.id FROM users user_row
       JOIN user_roles assignment ON assignment.organization_id=user_row.organization_id
        AND assignment.user_id=user_row.id
       JOIN organization_roles role ON role.organization_id=assignment.organization_id
        AND role.id=assignment.role_id
      WHERE user_row.active=true AND role.code='owner'
      ORDER BY user_row.id LIMIT 1`
  )).rows[0];
  assert.ok(authorized, "Authorized report schedule user required");
  const unauthorized = (await getPool().query(
    `SELECT user_row.id FROM users user_row
      WHERE user_row.active=true AND user_row.can_login=true
        AND NOT EXISTS(
          SELECT 1 FROM user_roles assignment
          JOIN organization_role_permissions grant_row
            ON grant_row.organization_id=assignment.organization_id AND grant_row.role_id=assignment.role_id
          WHERE assignment.organization_id=user_row.organization_id AND assignment.user_id=user_row.id
            AND grant_row.permission_code='report-schedules.read'
        ) ORDER BY user_row.id LIMIT 1`
  )).rows[0];
  const token = signAccessToken(authorized.id);
  if (unauthorized) {
    const denied = await fetch(`${baseUrl}/api/report-schedules`, {
      headers: { authorization: `Bearer ${signAccessToken(unauthorized.id)}` },
    });
    assert.equal(denied.status, 403, "Unprivileged user must be denied");
  }

  let list = (await request("/api/report-schedules", token)).result;
  for (const stale of list.items.filter(item => item.name.startsWith("Demo smoke тайлан"))) {
    await request(`/api/report-schedules/${stale.id}/retire`, token, "POST", {
      expectedVersion: stale.version,
      reason: "Cleaning a prior interrupted demo smoke",
    });
  }
  if (list.items.some(item => item.name.startsWith("Demo smoke тайлан"))) {
    list = (await request("/api/report-schedules", token)).result;
  }
  const initialCount = list.items.length;
  assert.equal(initialCount, 20, "Imported demo baseline must contain 20 active schedules");
  assert.equal(list.capabilities.canManage, true);
  assert.equal(list.capabilities.canSubmit, true);
  const dashboard = (await request("/api/dashboard/overview", token)).result;
  const scheduleAlerts = dashboard.alerts.filter(item => item.reportTab === "schedule");
  assert.ok(scheduleAlerts.length > 0, "Dashboard must project due report schedules");
  assert.ok(scheduleAlerts.every(item => item.view === "reports"), "Schedule alerts must open the report workspace");
  assert.ok(Array.isArray(dashboard.activity), "Dashboard information flow must be an array");
  assert.ok(dashboard.activity.every(item => item.id && item.kind && item.title && item.occurredAt && item.view), "Information flow rows must use the safe navigation contract");
  assert.ok(dashboard.activity.every(item => item.note === undefined && item.detail === undefined), "Information flow must not expose event notes or detail payloads");
  assert.ok(dashboard.infrastructure, "Dashboard infrastructure overview is required for the owner fixture");
  const lightingByCode = new Map(dashboard.infrastructure.lighting.map(item => [item.code, item]));
  for (const code of ["road", "ger", "tower", "signal", "unclassified"]) {
    assert.ok(lightingByCode.has(code), `Lighting overview must include ${code}; received ${[...lightingByCode.keys()].join(", ")}`);
  }
  assert.deepEqual(
    [lightingByCode.get("road").locations, lightingByCode.get("road").poles, lightingByCode.get("road").total, lightingByCode.get("road").replacements, lightingByCode.get("road").faults],
    [36, 1747, 2582, 43, 338],
    "Road-lighting overview must match the reconciled demo source"
  );
  assert.deepEqual(
    [lightingByCode.get("ger").locations, lightingByCode.get("ger").total, lightingByCode.get("ger").faults],
    [191, 2237, 212],
    "Ger-district lighting overview must match the reconciled demo source"
  );
  assert.deepEqual(
    [lightingByCode.get("tower").locations, lightingByCode.get("tower").total, lightingByCode.get("tower").faults],
    [143, 786, 182],
    "Tower-lighting overview must match the reconciled demo source"
  );
  assert.deepEqual(
    [lightingByCode.get("signal").locations, lightingByCode.get("signal").total, lightingByCode.get("signal").faults],
    [12, 12, 0],
    "Traffic-signal overview must match the canonical demo assets"
  );
  assert.equal(lightingByCode.get("unclassified").locations, 69, "Unclassified lighting objects must remain visible for reconciliation");
  assert.deepEqual(
    [dashboard.infrastructure.camera.locations, dashboard.infrastructure.camera.devices, dashboard.infrastructure.camera.active, dashboard.infrastructure.camera.broken, Number(dashboard.infrastructure.camera.availability)],
    [110, 302, 236, 66, 78.1],
    "Camera overview must be derived from current objects, specifications and open incidents"
  );
  const suffix = crypto.randomUUID().slice(0, 8);
  const created = (await request("/api/report-schedules", token, "POST", {
    name: `Demo smoke тайлан ${suffix}`,
    frequency: "monthly",
    nextDue: "2026-09-30",
    responsibleUserId: null,
    responsibleLabel: "QA",
    recipient: "Demo",
    warnDays: 7,
    note: "Автомат шалгалтын архивлагдах мөр",
  })).result.item;
  const updated = (await request(`/api/report-schedules/${created.id}`, token, "PATCH", {
    name: `Demo smoke тайлан шинэчилсэн ${suffix}`,
    frequency: "monthly",
    nextDue: "2026-09-30",
    responsibleUserId: null,
    responsibleLabel: "QA",
    recipient: "Demo",
    warnDays: 5,
    note: "Автомат шалгалтын архивлагдах мөр",
    expectedVersion: created.version,
  })).result.item;
  const idempotencyKey = crypto.randomUUID();
  const submissionBody = { expectedVersion: updated.version, idempotencyKey, submittedOn: "2026-09-04" };
  const submitted = (await request(`/api/report-schedules/${created.id}/submissions`, token, "POST", submissionBody)).result;
  const replay = (await request(`/api/report-schedules/${created.id}/submissions`, token, "POST", submissionBody)).result;
  assert.equal(submitted.nextDue, "2026-10-30");
  assert.equal(replay.replayed, true);
  await request(`/api/report-schedules/${created.id}/retire`, token, "POST", {
    expectedVersion: submitted.item.version,
    reason: "Automated demo smoke completed",
  });
  const events = (await request(`/api/report-schedules/${created.id}/events`, token)).result.items;
  assert.deepEqual(events.map(item => item.event_type), ["retired", "submitted", "updated", "created"]);
  list = (await request("/api/report-schedules", token)).result;
  assert.equal(list.items.length, initialCount, "Archived smoke row must not leak into the active schedule");
  console.log(`Report schedule smoke passed: ${initialCount} active, ${scheduleAlerts.length} dashboard alerts, ${dashboard.activity.length} safe information-flow rows, live lighting/camera overview, ${unauthorized ? "permission denial, " : "no unprivileged login fixture, "}CRUD, replay and ${events.length} events.`);
})().then(closePool).catch(async error => {
  console.error(error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
