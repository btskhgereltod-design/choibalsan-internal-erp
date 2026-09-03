"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { signAccessToken } = require("../src/security/token");

const baseUrl = String(process.env.CAMERA_DEMO_BASE_URL || "http://127.0.0.1:4200").replace(/\/$/, "");
const organizationSlug = process.env.CAMERA_DEMO_ORGANIZATION || "choibalsan-hugjil";
const username = String(process.env.CAMERA_DEMO_USERNAME || "").trim();

async function run() {
  assert.ok(username, "CAMERA_DEMO_USERNAME is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const user = (await client.query(`SELECT user_row.id
      FROM users user_row JOIN organizations organization ON organization.id=user_row.organization_id
      WHERE organization.slug=$1 AND lower(user_row.username)=lower($2)
        AND user_row.active=true AND user_row.can_login=true`, [organizationSlug, username])).rows[0];
    assert.ok(user, "Demo user not found");
    const token = signAccessToken(user.id);
    const response = await fetch(`${baseUrl}/api/camera/network/workspace`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(Array.isArray(body.routes), true);
    assert.equal(Array.isArray(body.nodes), true);
    assert.equal(Array.isArray(body.cameraPoints), true);
    assert.equal(Array.isArray(body.recovery?.candidates), true);
    assert.equal(body.summary.cameraPoints, body.cameraPoints.length);
    assert.equal(body.capabilities.canManage, true);
    assert.equal(body.capabilities.canUpdateCameraGps, true);
    console.log(JSON.stringify({
      ok: true,
      schema: "0105",
      routes: body.routes.length,
      nodes: body.nodes.length,
      cameraPoints: body.cameraPoints.length,
      cameraPointsWithGps: body.summary.cameraPointsWithGps,
      recoveryRoutes: body.recovery.summary.candidates,
      recoveryVertices: body.recovery.summary.vertices,
      recoveryPending: body.recovery.summary.pending,
      permissions: { canManage: body.capabilities.canManage, canUpdateCameraGps: body.capabilities.canUpdateCameraGps },
    }));
  } finally {
    await client.end();
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
