"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { getPool, closePool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

function parseCsv(input) {
  const text = String(input).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

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
  const reportUser = await getPool().query(
    `SELECT DISTINCT u.id
       FROM users u
       LEFT JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
       LEFT JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
      WHERE u.active=true AND (r.code='owner' OR u.role IN('director','chief_engineer','accountant'))
      ORDER BY u.id LIMIT 1`
  );
  assert.ok(reportUser.rowCount, "A report-authorized tenant user is required");
  const reportHeaders = { authorization:`Bearer ${signAccessToken(reportUser.rows[0].id)}` };
  const now = new Date();
  const stableFrom = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,10);
  const stableTo = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0)).toISOString().slice(0,10);
  const reportRange = `from=${stableFrom}&to=${stableTo}`;
  const reportResponse = await fetch(`http://127.0.0.1:4100/api/reports/overview?${reportRange}`, { headers:reportHeaders });
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200, JSON.stringify(report));
  assert.equal(report.people.basis, "canonical_employee_assignment_events_v1");
  assert.equal(report.dataQuality.historicalAssignmentSource, "work_order_events.assignment_v1");
  const csvResponse = await fetch(`http://127.0.0.1:4100/api/reports/work-orders.csv?${reportRange}`, { headers:reportHeaders });
  assert.equal(csvResponse.status, 200, "Report CSV must respond");
  assert.match(csvResponse.headers.get("content-type") || "", /text\/csv/);
  const csvRows = parseCsv(await csvResponse.text());
  assert.equal(csvRows[0]?.length, 23, "Report CSV must keep its 23-column reconciliation contract");
  const detailRows = csvRows.slice(1).filter(row => row.some(Boolean));
  const flagTotal = index => detailRows.reduce((sum,row) => sum + Number(row[index] || 0), 0);
  assert.equal(flagTotal(13), report.work.opening_backlog, "CSV opening backlog must reconcile");
  assert.equal(flagTotal(14), report.work.created, "CSV created count must reconcile");
  assert.equal(flagTotal(15), report.work.completed, "CSV completed count must reconcile");
  assert.equal(flagTotal(16), report.work.cancelled, "CSV cancelled count must reconcile");
  assert.equal(flagTotal(17), report.work.closing_backlog, "CSV closing backlog must reconcile");
  assert.equal(flagTotal(18), report.work.overdue, "CSV overdue count must reconcile");
  const ordinaryUser = await getPool().query(
    `SELECT u.id
       FROM users u
      WHERE u.active=true AND u.role NOT IN('director','chief_engineer','accountant')
        AND NOT EXISTS(
          SELECT 1 FROM user_roles ur
          JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
          WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id AND r.code='owner'
        )
      ORDER BY u.id LIMIT 1`
  );
  assert.ok(ordinaryUser.rowCount, "An ordinary active user is required for the report denial check");
  const forbiddenResponse = await fetch(`http://127.0.0.1:4100/api/reports/overview?${reportRange}`, {
    headers:{ authorization:`Bearer ${signAccessToken(ordinaryUser.rows[0].id)}` },
  });
  assert.equal(forbiddenResponse.status, 403, "Ordinary user must not receive the management report");
  console.log(`Session/report/CSV smoke passed: ${body.organization.enabledModules.length} modules, ${body.permissions.length} permissions, ${detailRows.length} CSV rows, ordinary user 403.`);
  await closePool();
})().catch(async error => {
  console.error(error);
  await closePool().catch(() => {});
  process.exitCode = 1;
});
