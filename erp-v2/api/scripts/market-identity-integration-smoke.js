"use strict";

if (process.env.RUN_MARKET_IDENTITY_INTEGRATION !== "1") {
  console.log("[market identity integration] skipped (set RUN_MARKET_IDENTITY_INTEGRATION=1)");
  process.exit(0);
}

const assert = require("node:assert/strict");
const { migrate } = require("./migrate");
const { createApp } = require("../src/app");
const { getPool, closePool } = require("../src/db");
const { signAccessToken, signPlatformToken } = require("../src/security/token");

async function request(baseUrl, path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function run() {
  await migrate();
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const unique = Date.now().toString(36);
  try {
    const participant = await request(baseUrl, "/api/market/auth/register", {
      method: "POST",
      body: { email: `participant-${unique}@example.test`, password: "Market-test-password-2026", displayName: "Dual Participant" },
    });
    assert.equal(participant.status, 201);
    const participantToken = participant.data.token;
    const participantId = participant.data.identity.id;
    assert.deepEqual(participant.data.identity.active_memberships, []);
    assert.equal(participant.data.identity.has_operator_authority, false);

    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 403);

    assert.equal((await request(baseUrl, "/api/market/memberships", {
      token: participantToken, method: "POST", body: { membershipType: "customer" },
    })).status, 201);
    const both = await request(baseUrl, "/api/market/memberships", {
      token: participantToken, method: "POST", body: { membershipType: "provider" },
    });
    assert.equal(both.status, 201);
    assert.deepEqual(both.data.identity.active_memberships, ["customer", "provider"]);
    assert.equal(both.data.identity.has_operator_authority, false);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 200);

    assert.equal((await request(baseUrl, "/api/market/auth/me", {
      token: signAccessToken("00000000-0000-4000-8000-000000000001"),
    })).status, 401);
    assert.equal((await request(baseUrl, "/api/market/auth/me", {
      token: signPlatformToken("00000000-0000-4000-8000-000000000002"),
    })).status, 401);
    assert.equal((await request(baseUrl, "/api/auth/me", { token: participantToken })).status, 401);

    const operator = await request(baseUrl, "/api/market/auth/register", {
      method: "POST",
      body: { email: `operator-${unique}@example.test`, password: "Operator-test-password-2026", displayName: "Market Operator" },
    });
    assert.equal(operator.status, 201);
    const operatorId = operator.data.identity.id;
    await getPool().query(
      `INSERT INTO market_operator_assignments(market_identity_id,assigned_by_identity_id,reason)
       VALUES($1,$1,'Disposable integration operator assignment')`,
      [operatorId]
    );
    const operatorLogin = await request(baseUrl, "/api/market/auth/login", {
      method: "POST",
      body: { email: `operator-${unique}@example.test`, password: "Operator-test-password-2026" },
    });
    assert.equal(operatorLogin.status, 200);
    assert.equal(operatorLogin.data.identity.has_operator_authority, true);
    const operatorToken = operatorLogin.data.token;
    const providerMembership = both.data.identity.memberships.find(item => item.membership_type === "provider");

    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/suspend`, {
      token: participantToken, method: "POST", body: { reason: "Participant cannot suspend own membership" },
    })).status, 403);
    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/suspend`, {
      token: operatorToken, method: "POST", body: { reason: "Disposable integration suspension check" },
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 403);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "customer" },
    })).status, 200);
    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/activate`, {
      token: operatorToken, method: "POST", body: { reason: "Disposable integration activation check" },
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 200);

    const evidence = await getPool().query(
      `SELECT event_type,outcome FROM market_audit_events
        WHERE market_identity_id=$1 ORDER BY id`,
      [participantId]
    );
    const eventTypes = evidence.rows.map(item => `${item.event_type}:${item.outcome}`);
    for (const expected of [
      "market.identity.registered:success",
      "market.membership.issued:success",
      "market.membership.activated:success",
      "market.membership.suspended:success",
      "market.view.switch:denied",
      "market.view.switched:success",
    ]) assert.ok(eventTypes.includes(expected), `missing ${expected}`);

    const targetOperator = await getPool().query(
      "SELECT count(*)::int AS count FROM market_operator_assignments WHERE market_identity_id=$1",
      [participantId]
    );
    assert.equal(targetOperator.rows[0].count, 0);
    await assert.rejects(
      getPool().query("UPDATE market_audit_events SET detail='{}'::jsonb WHERE market_identity_id=$1", [participantId]),
      /append-only/
    );

    const latest = await getPool().query("SELECT max(version) AS version FROM schema_migrations");
    assert.equal(latest.rows[0].version, "0058");
    console.log("[market identity integration] passed", {
      migration: latest.rows[0].version,
      memberships: both.data.identity.active_memberships,
      evidenceEvents: evidence.rowCount,
      participantOperatorAssignments: targetOperator.rows[0].count,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await closePool();
  }
}

run().catch(error => {
  console.error("[market identity integration] failed", error);
  process.exitCode = 1;
});
