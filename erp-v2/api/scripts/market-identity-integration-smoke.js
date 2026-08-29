"use strict";

if (process.env.RUN_MARKET_IDENTITY_INTEGRATION !== "1") {
  console.log("[market identity integration] skipped (set RUN_MARKET_IDENTITY_INTEGRATION=1)");
  process.exit(0);
}

process.env.NODE_ENV = "test";
process.env.MARKET_AUTH_TEST_DELIVERY = "true";
process.env.MARKET_PHONE_FINGERPRINT_KEY = "market-phone-integration-fingerprint-key-2026";

const assert = require("node:assert/strict");
const { migrate } = require("./migrate");
const { createApp } = require("../src/app");
const { getPool, closePool } = require("../src/db");
const { signAccessToken, signPlatformToken, signMarketToken, verifyAccessToken } = require("../src/security/token");
const { randomToken, tokenHash } = require("../src/services/market-auth");

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

async function verifyPhone(baseUrl, token, phone) {
  const requested = await request(baseUrl, "/api/market/auth/phone/request", {
    token, method: "POST", body: { phone },
  });
  assert.equal(requested.status, 202);
  assert.match(requested.data.testCode, /^\d{6}$/);
  const confirmed = await request(baseUrl, "/api/market/auth/phone/confirm", {
    token, method: "POST", body: { code: requested.data.testCode },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.data.verified, true);
  return confirmed;
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
    assert.ok(verifyAccessToken(participantToken).sid);
    assert.equal((await request(baseUrl, "/api/market/auth/me", {
      token: signMarketToken(participantId),
    })).status, 401);

    const capabilities = await request(baseUrl, "/api/market/auth/capabilities");
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.data.emailRecovery, true);
    assert.equal(capabilities.data.google, false);
    assert.equal(capabilities.data.phoneVerification, true);
    assert.equal(capabilities.data.stepUp, true);

    const recoveryEmail = `recovery-${unique}@example.test`;
    const recoveryIdentity = await request(baseUrl, "/api/market/auth/register", {
      method: "POST",
      body: { email: recoveryEmail, password: "Recovery-old-password-2026", displayName: "Recovery Identity" },
    });
    assert.equal(recoveryIdentity.status, 201);
    const recoveryRequest = await request(baseUrl, "/api/market/auth/password/forgot", {
      method: "POST", body: { email: recoveryEmail },
    });
    assert.equal(recoveryRequest.status, 202);
    assert.ok(recoveryRequest.data.testToken);
    const reset = await request(baseUrl, "/api/market/auth/password/reset", {
      method: "POST", body: { token: recoveryRequest.data.testToken, password: "Recovery-new-password-2026" },
    });
    assert.equal(reset.status, 204);
    assert.equal((await request(baseUrl, "/api/market/auth/password/reset", {
      method: "POST", body: { token: recoveryRequest.data.testToken, password: "Recovery-replayed-password-2026" },
    })).status, 400);
    assert.equal((await request(baseUrl, "/api/market/auth/me", { token: recoveryIdentity.data.token })).status, 401);
    assert.equal((await request(baseUrl, "/api/market/auth/login", {
      method: "POST", body: { email: recoveryEmail, password: "Recovery-old-password-2026" },
    })).status, 401);
    const recoveredLogin = await request(baseUrl, "/api/market/auth/login", {
      method: "POST", body: { email: recoveryEmail, password: "Recovery-new-password-2026" },
    });
    assert.equal(recoveredLogin.status, 200);
    assert.equal(recoveredLogin.data.identity.email_verified_at !== null, true);
    assert.equal((await request(baseUrl, "/api/market/auth/sessions", { token: recoveredLogin.data.token })).data.items.length, 1);
    assert.equal((await request(baseUrl, "/api/market/auth/sessions/revoke-all", {
      token: recoveredLogin.data.token, method: "POST",
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/auth/me", { token: recoveredLogin.data.token })).status, 401);

    const logoutIdentity = await request(baseUrl, "/api/market/auth/register", {
      method: "POST",
      body: { email: `logout-${unique}@example.test`, password: "Logout-test-password-2026", displayName: "Logout Identity" },
    });
    assert.equal((await request(baseUrl, "/api/market/auth/logout", {
      token: logoutIdentity.data.token, method: "POST",
    })).status, 204);
    assert.equal((await request(baseUrl, "/api/market/auth/me", { token: logoutIdentity.data.token })).status, 401);
    await getPool().query("UPDATE market_identities SET active=false WHERE id=$1", [logoutIdentity.data.identity.id]);
    const inactiveExchangeToken = randomToken();
    await getPool().query(
      `INSERT INTO market_auth_challenges(market_identity_id,purpose,token_hash,detail,expires_at)
       VALUES($1,'login_exchange',$2,'{"authMethod":"google"}'::jsonb,now()+interval '5 minutes')`,
      [logoutIdentity.data.identity.id, tokenHash(inactiveExchangeToken)]
    );
    const inactiveExchange = await request(baseUrl, "/api/market/auth/google/exchange", {
      method: "POST", body: { token: inactiveExchangeToken },
    });
    assert.equal(inactiveExchange.status, 401);
    assert.equal(inactiveExchange.data.error, "Market identity is inactive");
    const inactiveSessions = await getPool().query(
      "SELECT count(*)::int AS count FROM market_sessions WHERE market_identity_id=$1 AND revoked_at IS NULL",
      [logoutIdentity.data.identity.id]
    );
    assert.equal(inactiveSessions.rows[0].count, 0);

    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 403);

    const customerMembershipRequests = await Promise.all([
      request(baseUrl, "/api/market/memberships", {
        token: participantToken, method: "POST", body: { membershipType: "customer" },
      }),
      request(baseUrl, "/api/market/memberships", {
        token: participantToken, method: "POST", body: { membershipType: "customer" },
      }),
    ]);
    assert.deepEqual(customerMembershipRequests.map(item => item.status).sort(), [200, 201]);
    assert.equal(customerMembershipRequests.find(item => item.status === 200).data.idempotent, true);
    const customerMembershipCount = await getPool().query(
      `SELECT count(*)::int AS count FROM market_memberships
        WHERE market_identity_id=$1 AND membership_type='customer'`,
      [participantId]
    );
    assert.equal(customerMembershipCount.rows[0].count, 1);
    const providerSelfIssue = await request(baseUrl, "/api/market/memberships", {
      token: participantToken, method: "POST", body: { membershipType: "provider" },
    });
    assert.equal(providerSelfIssue.status, 409);
    assert.equal(providerSelfIssue.data.code, "MARKET_PROVIDER_APPLICATION_REQUIRED");
    await verifyPhone(baseUrl, participantToken, "99110001");
    const participantSessionId = verifyAccessToken(participantToken).sid;
    await getPool().query(
      "UPDATE market_sessions SET reauthenticated_at=now()-interval '20 minutes' WHERE id=$1",
      [participantSessionId]
    );
    const providerApplicationBody = {
      professionalSummary: "I design and deliver audited PostgreSQL and JavaScript business systems.",
      skills: ["PostgreSQL", "JavaScript"],
      portfolioUrl: "https://example.test/portfolio",
      rulesAccepted: true,
    };
    const staleApplication = await request(baseUrl, "/api/market/provider-applications", {
      token: participantToken, method: "POST", body: providerApplicationBody,
    });
    assert.equal(staleApplication.status, 403);
    assert.equal(staleApplication.data.code, "MARKET_STEP_UP_REQUIRED");
    const participantStepUp = await request(baseUrl, "/api/market/auth/step-up/password", {
      token: participantToken, method: "POST", body: { password: "Market-test-password-2026" },
    });
    assert.equal(participantStepUp.status, 200);
    const concurrentApplications = await Promise.all([
      request(baseUrl, "/api/market/provider-applications", {
        token: participantToken, method: "POST", body: providerApplicationBody,
      }),
      request(baseUrl, "/api/market/provider-applications", {
        token: participantToken, method: "POST", body: providerApplicationBody,
      }),
    ]);
    assert.deepEqual(concurrentApplications.map(item => item.status).sort(), [201, 409]);
    const application = concurrentApplications.find(item => item.status === 201);
    assert.equal(concurrentApplications.find(item => item.status === 409).data.code, "MARKET_PROVIDER_APPLICATION_OPEN");
    assert.equal(application.status, 201);
    assert.equal(application.data.identity.provider_application.status, "submitted");
    assert.deepEqual(application.data.identity.active_memberships, ["customer"]);
    assert.equal(application.data.identity.has_operator_authority, false);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 403);

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
    const riskSignal = await getPool().query(
      `INSERT INTO market_identity_risk_signals
         (market_identity_id,signal_type,severity,subject_hash,detail)
       VALUES($1,'email_collision','low',repeat('a',64),'{}'::jsonb) RETURNING id`,
      [participantId]
    );
    assert.equal((await request(baseUrl, "/api/market/operator/identity-risk-signals", {
      token: participantToken,
    })).status, 403);
    const riskQueue = await request(baseUrl, "/api/market/operator/identity-risk-signals", {
      token: operatorToken,
    });
    assert.equal(riskQueue.status, 200);
    assert.ok(riskQueue.data.items.some(item => item.id === riskSignal.rows[0].id));
    const riskReview = await request(baseUrl, `/api/market/operator/identity-risk-signals/${riskSignal.rows[0].id}/review`, {
      token: operatorToken, method: "POST",
      body: { status: "dismissed", reason: "Disposable false-positive identity signal" },
    });
    assert.equal(riskReview.status, 200);
    assert.equal(riskReview.data.item.status, "dismissed");
    assert.equal((await request(baseUrl, `/api/market/operator/identity-risk-signals/${riskSignal.rows[0].id}/review`, {
      token: operatorToken, method: "POST",
      body: { status: "dismissed", reason: "Idempotent review replay" },
    })).data.idempotent, true);
    const selfRisk = await getPool().query(
      `INSERT INTO market_identity_risk_signals
         (market_identity_id,signal_type,severity,subject_hash,detail)
       VALUES($1,'auth_velocity','medium',repeat('b',64),'{}'::jsonb) RETURNING id`,
      [operatorId]
    );
    assert.equal((await request(baseUrl, `/api/market/operator/identity-risk-signals/${selfRisk.rows[0].id}/review`, {
      token: operatorToken, method: "POST",
      body: { status: "confirmed", reason: "Self review must be denied" },
    })).status, 403);

    const storefrontPlan = await request(baseUrl, "/api/market/operator/storefront-plans", {
      token: operatorToken,
      method: "POST",
      body: {
        code: "standard",
        name: "Standard storefront",
        description: "Disposable configurable storefront plan for integration verification.",
        priceMnt: 200000,
        billingPeriodDays: 30,
        entitlements: { "storefront.active": true, "profile.links": 5 },
        reason: "Publish disposable storefront test plan",
      },
    });
    assert.equal(storefrontPlan.status, 201);

    await verifyPhone(baseUrl, operatorToken, "99110002");
    const operatorApplication = await request(baseUrl, "/api/market/provider-applications", {
      token: operatorToken,
      method: "POST",
      body: {
        professionalSummary: "Operator self-review must remain forbidden even with a complete provider profile.",
        skills: ["Market operations"],
        rulesAccepted: true,
      },
    });
    assert.equal(operatorApplication.status, 201);
    const selfReview = await request(baseUrl, `/api/market/operator/provider-applications/${operatorApplication.data.identity.provider_application.id}/start-review`, {
      token: operatorToken, method: "POST", body: { reason: "This self-review must be denied" },
    });
    assert.equal(selfReview.status, 403);
    assert.equal(selfReview.data.code, "MARKET_PROVIDER_SELF_REVIEW_DENIED");

    const rejectedIdentity = await request(baseUrl, "/api/market/auth/register", {
      method: "POST",
      body: { email: `rejected-${unique}@example.test`, password: "Rejected-test-password-2026", displayName: "Rejected Applicant" },
    });
    assert.equal(rejectedIdentity.status, 201);
    await verifyPhone(baseUrl, rejectedIdentity.data.token, "99110003");
    const rejectedApplication = await request(baseUrl, "/api/market/provider-applications", {
      token: rejectedIdentity.data.token,
      method: "POST",
      body: {
        professionalSummary: "This disposable profile exercises an attributable provider rejection decision.",
        skills: ["Disposable testing"],
        rulesAccepted: true,
      },
    });
    assert.equal(rejectedApplication.status, 201);
    assert.equal((await request(baseUrl, `/api/market/operator/provider-applications/${rejectedApplication.data.identity.provider_application.id}/reject`, {
      token: rejectedIdentity.data.token, method: "POST", body: { reason: "Participant cannot reject this application" },
    })).status, 403);
    const rejectedReview = await request(baseUrl, `/api/market/operator/provider-applications/${rejectedApplication.data.identity.provider_application.id}/start-review`, {
      token: operatorToken, method: "POST", body: { reason: "Begin attributable rejection review" },
    });
    assert.equal(rejectedReview.status, 200);
    assert.equal(rejectedReview.data.identity.provider_application.status, "under_review");
    const rejected = await request(baseUrl, `/api/market/operator/provider-applications/${rejectedApplication.data.identity.provider_application.id}/reject`, {
      token: operatorToken, method: "POST", body: { reason: "Disposable rejection path verification" },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.identity.provider_application.status, "rejected");
    assert.deepEqual(rejected.data.identity.active_memberships, []);

    assert.equal((await request(baseUrl, `/api/market/operator/provider-applications/${application.data.identity.provider_application.id}/approve`, {
      token: participantToken, method: "POST", body: { reason: "Participant cannot approve this application" },
    })).status, 403);
    const approvedReview = await request(baseUrl, `/api/market/operator/provider-applications/${application.data.identity.provider_application.id}/start-review`, {
      token: operatorToken, method: "POST", body: { reason: "Begin attributable provider review" },
    });
    assert.equal(approvedReview.status, 200);
    assert.equal(approvedReview.data.identity.provider_application.status, "under_review");
    const approved = await request(baseUrl, `/api/market/operator/provider-applications/${application.data.identity.provider_application.id}/approve`, {
      token: operatorToken, method: "POST", body: { reason: "Verified skills and provider profile" },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.identity.provider_application.status, "approved");
    assert.deepEqual(approved.data.identity.active_memberships, ["customer", "provider"]);
    assert.equal(approved.data.identity.has_operator_authority, false);

    const storefrontBody = {
      slug: `dual-${unique}`,
      displayName: "Dual Participant Studio",
      tagline: "Governed business systems and integration services",
      description: "A disposable public storefront used to verify Provider ownership, subscription access, and operator controls.",
      publicContact: "contact@example.test",
    };
    const storefront = await request(baseUrl, "/api/market/storefront", {
      token: participantToken, method: "POST", body: storefrontBody,
    });
    assert.equal(storefront.status, 201);
    assert.equal(storefront.data.item.status, "draft");
    const duplicateStorefront = await request(baseUrl, "/api/market/storefront", {
      token: participantToken, method: "POST", body: storefrontBody,
    });
    assert.equal(duplicateStorefront.status, 200);
    assert.equal(duplicateStorefront.data.idempotent, true);

    const subscriptionBody = {
      planId: storefrontPlan.data.item.id,
      externalPaymentReference: `bank-transfer-${unique}`,
    };
    const subscriptionRequests = await Promise.all([
      request(baseUrl, "/api/market/storefront/subscriptions", {
        token: participantToken, method: "POST", body: subscriptionBody,
      }),
      request(baseUrl, "/api/market/storefront/subscriptions", {
        token: participantToken, method: "POST", body: subscriptionBody,
      }),
    ]);
    assert.deepEqual(subscriptionRequests.map(item => item.status).sort(), [200, 201]);
    const subscriptionId = subscriptionRequests.find(item => item.status === 201).data.item.subscription.id;
    assert.equal((await request(baseUrl, `/api/market/operator/storefront-subscriptions/${subscriptionId}/activate`, {
      token: participantToken, method: "POST", body: { reason: "Participant cannot activate subscription" },
    })).status, 403);
    const activatedStorefront = await request(baseUrl, `/api/market/operator/storefront-subscriptions/${subscriptionId}/activate`, {
      token: operatorToken, method: "POST", body: { reason: "External payment evidence verified" },
    });
    assert.equal(activatedStorefront.status, 200);
    assert.equal(activatedStorefront.data.item.status, "active");
    assert.equal((await request(baseUrl, `/api/market/operator/storefront-subscriptions/${subscriptionId}/activate`, {
      token: operatorToken, method: "POST", body: { reason: "Idempotent activation verification" },
    })).data.idempotent, true);
    assert.equal((await request(baseUrl, "/api/market/storefronts")).data.items.length, 1);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 200);
    const providerMembership = approved.data.identity.memberships.find(item => item.membership_type === "provider");

    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/suspend`, {
      token: participantToken, method: "POST", body: { reason: "Participant cannot suspend own membership" },
    })).status, 403);
    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/suspend`, {
      token: operatorToken, method: "POST", body: { reason: "Disposable integration suspension check" },
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/storefront/me", { token: participantToken })).data.item.status, "suspended");
    assert.equal((await request(baseUrl, "/api/market/storefronts")).data.items.length, 0);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 403);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "customer" },
    })).status, 200);
    assert.equal((await request(baseUrl, `/api/market/operator/memberships/${providerMembership.id}/activate`, {
      token: operatorToken, method: "POST", body: { reason: "Disposable integration activation check" },
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/storefront/me", { token: participantToken })).data.item.status, "suspended");
    assert.equal((await request(baseUrl, `/api/market/operator/storefronts/${storefront.data.item.id}/reactivate`, {
      token: operatorToken, method: "POST", body: { reason: "Provider membership restored after review" },
    })).status, 200);
    assert.equal((await request(baseUrl, "/api/market/storefronts")).data.items.length, 1);
    assert.equal((await request(baseUrl, "/api/market/view", {
      token: participantToken, method: "POST", body: { view: "provider" },
    })).status, 200);
    await assert.rejects(
      getPool().query("UPDATE market_storefronts SET status='draft' WHERE id=$1", [storefront.data.item.id]),
      /invalid market storefront transition/
    );
    await assert.rejects(
      getPool().query("UPDATE market_storefront_subscriptions SET status='pending' WHERE id=$1", [subscriptionId]),
      /invalid market storefront subscription transition/
    );

    const evidence = await getPool().query(
      `SELECT event_type,outcome FROM market_audit_events
        WHERE market_identity_id=$1 ORDER BY id`,
      [participantId]
    );
    const eventTypes = evidence.rows.map(item => `${item.event_type}:${item.outcome}`);
    for (const expected of [
      "market.identity.registered:success",
      "market.provider.application.submitted:success",
      "market.provider.application.review_started:success",
      "market.provider.application.approved:success",
      "market.membership.issued:success",
      "market.membership.activated:success",
      "market.membership.suspended:success",
      "market.storefront.created:success",
      "market.storefront.subscription.requested:success",
      "market.storefront.subscription.activated:success",
      "market.storefront.suspended:success",
      "market.storefront.reactivated:success",
      "market.view.switch:denied",
      "market.view.switched:success",
    ]) assert.ok(eventTypes.includes(expected), `missing ${expected}`);

    const rejectedEvidence = await getPool().query(
      `SELECT event_type,outcome FROM market_audit_events
        WHERE market_identity_id=$1 ORDER BY id`,
      [rejectedIdentity.data.identity.id]
    );
    const rejectedEventTypes = rejectedEvidence.rows.map(item => `${item.event_type}:${item.outcome}`);
    assert.ok(rejectedEventTypes.includes("market.provider.application.review_started:success"));
    assert.ok(rejectedEventTypes.includes("market.provider.application.rejected:success"));

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
    assert.equal(latest.rows[0].version, "0063");
    console.log("[market identity integration] passed", {
      migration: latest.rows[0].version,
      memberships: approved.data.identity.active_memberships,
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
