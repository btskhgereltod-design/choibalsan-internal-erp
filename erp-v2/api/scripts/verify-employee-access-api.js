"use strict";

const { getPool } = require("../src/db");
const { signAccessToken } = require("../src/security/token");

(async () => {
  const director = await getPool().query(
    "SELECT id FROM users WHERE role='director' AND active=true AND can_login=true ORDER BY created_at LIMIT 1"
  );
  if (!director.rowCount) throw new Error("No active director available for smoke test");
  const response = await fetch("http://127.0.0.1:4100/api/employees", {
    headers: { authorization: `Bearer ${signAccessToken(director.rows[0].id)}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  const first = body.items?.[0];
  if (first && (!Object.hasOwn(first, "permission_count") || !Object.hasOwn(first, "account_active"))) {
    throw new Error("Access overview fields are missing");
  }
  console.log(JSON.stringify({ status: response.status, employees: body.items?.length || 0, accessFields: true }));
  await getPool().end();
})().catch(async error => {
  console.error(error.message);
  await getPool().end().catch(() => {});
  process.exit(1);
});
