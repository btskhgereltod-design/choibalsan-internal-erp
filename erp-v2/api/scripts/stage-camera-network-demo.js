"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { signAccessToken } = require("../src/security/token");

const baseUrl = String(process.env.CAMERA_DEMO_BASE_URL || "http://127.0.0.1:4100").replace(/\/$/, "");
const organizationSlug = process.env.CAMERA_DEMO_ORGANIZATION || "choibalsan-hugjil";
const username = String(process.env.CAMERA_DEMO_USERNAME || "").trim();

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function run() {
  assert.ok(username, "CAMERA_DEMO_USERNAME is required");
  const payload = await readInput();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const user = (await client.query(`SELECT user_row.id
      FROM users user_row
      JOIN organizations organization ON organization.id=user_row.organization_id
      JOIN subscriptions subscription ON subscription.organization_id=organization.id
      WHERE organization.slug=$1 AND lower(user_row.username)=lower($2)
        AND user_row.active=true AND user_row.can_login=true AND organization.status='active'
        AND subscription.status IN('trial','active','past_due')`, [organizationSlug, username])).rows[0];
    assert.ok(user, "Demo user not found");
    const response = await fetch(`${baseUrl}/api/camera/network/imports/legacy-recovery`, {
      method: "POST",
      headers: { authorization: `Bearer ${signAccessToken(user.id)}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    assert.ok([200, 201].includes(response.status), JSON.stringify(body));
    console.log(JSON.stringify({ ok: true, created: body.created, batchId: body.batch.id,
      records: body.batch.source_record_count, vertices: body.batch.source_vertex_count }));
  } finally {
    await client.end();
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
