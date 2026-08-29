"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { loadConfig } = require("../config");
const { authenticateMarket, requireMarketOperator, requireRecentMarketStepUp,
  hasRecentMarketStepUp } = require("../middleware/auth");
const { loadMarketIdentity, subjectHash, writeMarketAudit, writeMarketRiskSignal } = require("../services/market-identity");
const { consumeAuthChallenge, createAuthChallenge, createMarketSession, decryptSecret, encryptSecret,
  deliverMarketEmail, randomToken, revokeMarketSessions } = require("../services/market-auth");
const { deliverMarketSms, generateOtp, maskedPhone, normalizePhone,
  phoneFingerprint, phoneParts } = require("../services/market-phone");
const { authorizationUrl, exchangeCode, verifyIdToken } = require("../services/market-google-oidc");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const emailSchema = z.object({ email: z.string().trim().email().max(200) });
const tokenSchema = z.object({ token: z.string().min(32).max(200) });
const resetSchema = tokenSchema.extend({ password: z.string().min(12).max(200) });
const passwordStepUpSchema = z.object({ password: z.string().min(8).max(200) });
const phoneRequestSchema = z.object({ phone: z.string().trim().min(8).max(30) });
const phoneConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const riskReviewSchema = z.object({
  status: z.enum(["reviewed", "dismissed", "confirmed"]),
  reason: z.string().trim().min(4).max(1000),
});
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many Market recovery attempts" },
});
const phoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many phone verification attempts" },
});

function deliveryAvailable() {
  const auth = loadConfig().marketAuth;
  return auth.email.enabled || auth.testDelivery;
}

router.get("/auth/capabilities", (_req, res) => {
  const auth = loadConfig().marketAuth;
  res.json({
    emailRecovery: auth.email.enabled || auth.testDelivery,
    google: auth.google.enabled,
    phoneVerification: auth.sms.enabled || auth.testDelivery,
    stepUp: true,
    facebook: false,
  });
});

router.post("/auth/step-up/password", limiter, authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = passwordStepUpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Current password is required" });
  const identity = await getPool().query(
    "SELECT password_hash FROM market_identities WHERE id=$1 AND active=true",
    [req.marketIdentity.id]
  );
  if (!identity.rows[0]?.password_hash) {
    return res.status(409).json({
      error: "Use Google to confirm this sensitive action",
      code: "MARKET_GOOGLE_STEP_UP_REQUIRED",
    });
  }
  if (!await bcrypt.compare(parsed.data.password, identity.rows[0].password_hash)) {
    await writeMarketAudit({
      marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.auth.step_up.password", outcome: "failure",
      detail: { authorityChanged: false }, ipAddress: req.ip || null,
    });
    return res.status(401).json({ error: "Password is incorrect" });
  }
  await getPool().query(
    "UPDATE market_sessions SET reauthenticated_at=now() WHERE id=$1 AND market_identity_id=$2",
    [req.marketSession.id, req.marketIdentity.id]
  );
  await writeMarketAudit({
    marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
    actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
    eventType: "market.auth.step_up.password", outcome: "success",
    detail: { authorityChanged: false }, ipAddress: req.ip || null,
  });
  res.json({ stepUpValid: true, validForSeconds: 600 });
}));

router.get("/auth/provider-readiness", authenticateMarket, asyncHandler(async(req, res) => {
  const contact = await getPool().query(
    `SELECT country_code,last_four,verified_at FROM market_phone_contacts
      WHERE market_identity_id=$1 AND status='verified' ORDER BY verified_at DESC LIMIT 1`,
    [req.marketIdentity.id]
  );
  res.json({
    stepUpValid: hasRecentMarketStepUp(req.marketSession),
    stepUpMethod: req.marketSession.auth_method,
    phoneAvailable: loadConfig().marketAuth.sms.enabled || loadConfig().marketAuth.testDelivery,
    phoneVerified: Boolean(contact.rowCount),
    maskedPhone: contact.rowCount ? maskedPhone(contact.rows[0].country_code, contact.rows[0].last_four) : null,
    providerApplication: req.marketIdentity.provider_application,
    providerActive: req.marketIdentity.active_memberships.includes("provider"),
  });
}));

router.post("/auth/phone/request", phoneLimiter, authenticateMarket, requireRecentMarketStepUp,
  asyncHandler(async(req, res) => {
    const auth = loadConfig().marketAuth;
    if (!auth.sms.enabled && !auth.testDelivery) {
      return res.status(503).json({ error: "Market phone verification is not configured" });
    }
    const parsed = phoneRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Valid phone number is required" });
    let phone;
    try { phone = normalizePhone(parsed.data.phone); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message, code: error.code }); }
    const fingerprint = phoneFingerprint(phone);
    const parts = phoneParts(phone);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM market_identities WHERE id=$1 AND active=true FOR UPDATE", [req.marketIdentity.id]);
      const existing = await client.query(
        `SELECT id,phone_fingerprint,country_code,last_four,status FROM market_phone_contacts
          WHERE market_identity_id=$1 AND status IN ('pending','verified') FOR UPDATE`,
        [req.marketIdentity.id]
      );
      if (existing.rows[0]?.status === "verified") {
        await client.query("COMMIT");
        if (existing.rows[0].phone_fingerprint === fingerprint) {
          return res.json({ verified: true, idempotent: true,
            maskedPhone: maskedPhone(existing.rows[0].country_code, existing.rows[0].last_four) });
        }
        return res.status(409).json({
          error: "Verified phone changes require a separate reviewed flow",
          code: "MARKET_PHONE_CHANGE_REVIEW_REQUIRED",
        });
      }
      const recent = await client.query(
        `SELECT count(*)::int AS count,max(created_at) AS latest
           FROM market_phone_verification_challenges
          WHERE market_identity_id=$1 AND created_at>now()-interval '1 hour'`,
        [req.marketIdentity.id]
      );
      if (recent.rows[0].count >= 5
        || (recent.rows[0].latest && Date.now() - new Date(recent.rows[0].latest).getTime() < 60000)) {
        await client.query("ROLLBACK");
        return res.status(429).json({ error: "Please wait before requesting another code", code: "MARKET_PHONE_RATE_LIMITED" });
      }
      // Serialize every decision for the same blinded phone value. This closes
      // the gap where two identities could both observe no verified owner before
      // one of them reaches the partial unique index.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [fingerprint]);
      const collision = await client.query(
        `SELECT market_identity_id FROM market_phone_contacts
          WHERE phone_fingerprint=$1 AND status='verified' AND market_identity_id<>$2 FOR UPDATE`,
        [fingerprint, req.marketIdentity.id]
      );
      if (collision.rowCount) {
        const risk = await writeMarketRiskSignal({
          client, marketIdentityId: req.marketIdentity.id,
          relatedIdentityId: collision.rows[0].market_identity_id,
          signalType: "phone_collision", severity: "high",
          subject: fingerprint, detail: { action: "provider_phone_verification", authorityChanged: false },
        });
        await writeMarketAudit({
          client, marketIdentityId: req.marketIdentity.id, riskSignalId: risk.id,
          marketSessionId: req.marketSession.id, actorType: "market_identity",
          actorIdentityId: req.marketIdentity.id, eventType: "market.auth.phone.requested",
          outcome: "denied", detail: { reason: "phone_collision", authorityChanged: false },
          ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(409).json({
          error: "This phone cannot be verified automatically",
          code: "MARKET_PHONE_REVIEW_REQUIRED",
        });
      }
      let contactId = existing.rows[0]?.id;
      if (contactId) {
        await client.query(
          `UPDATE market_phone_contacts SET phone_ciphertext=$2,phone_fingerprint=$3,
             country_code=$4,last_four=$5,requested_at=now(),updated_at=now() WHERE id=$1`,
          [contactId, encryptSecret(phone), fingerprint, parts.countryCode, parts.lastFour]
        );
      } else {
        const contact = await client.query(
          `INSERT INTO market_phone_contacts
             (market_identity_id,phone_ciphertext,phone_fingerprint,country_code,last_four)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,
          [req.marketIdentity.id, encryptSecret(phone), fingerprint, parts.countryCode, parts.lastFour]
        );
        contactId = contact.rows[0].id;
      }
      await client.query(
        `UPDATE market_phone_verification_challenges SET consumed_at=now()
          WHERE market_identity_id=$1 AND consumed_at IS NULL`,
        [req.marketIdentity.id]
      );
      const code = generateOtp();
      const otpHash = await bcrypt.hash(code, 10);
      const challenge = await client.query(
        `INSERT INTO market_phone_verification_challenges
           (market_identity_id,phone_contact_id,otp_hash,requested_ip,expires_at)
         VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING id,expires_at`,
        [req.marketIdentity.id, contactId, otpHash, req.ip || null]
      );
      await deliverMarketSms({ to: phone, code });
      await writeMarketAudit({
        client, marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
        phoneContactId: contactId, phoneChallengeId: challenge.rows[0].id,
        actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
        eventType: "market.auth.phone.requested", outcome: "success",
        detail: { maskedPhone: maskedPhone(parts.countryCode, parts.lastFour), expiresInSeconds: 300,
          authorityChanged: false }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.status(202).json({
        sent: true, maskedPhone: maskedPhone(parts.countryCode, parts.lastFour), expiresInSeconds: 300,
        ...(auth.testDelivery ? { testCode: code } : {}),
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }));

router.post("/auth/phone/confirm", phoneLimiter, authenticateMarket, requireRecentMarketStepUp,
  asyncHandler(async(req, res) => {
    const parsed = phoneConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A six-digit verification code is required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query(
        `SELECT challenge.*,contact.phone_fingerprint,contact.country_code,contact.last_four
           FROM market_phone_verification_challenges challenge
           JOIN market_phone_contacts contact ON contact.id=challenge.phone_contact_id
          WHERE challenge.market_identity_id=$1 AND challenge.consumed_at IS NULL
          ORDER BY challenge.created_at DESC LIMIT 1 FOR UPDATE OF challenge,contact`,
        [req.marketIdentity.id]
      );
      const item = challenge.rows[0];
      if (!item || new Date(item.expires_at).getTime() <= Date.now() || item.attempt_count >= item.max_attempts) {
        if (item) await client.query(
          "UPDATE market_phone_verification_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE id=$1",
          [item.id]
        );
        await client.query("COMMIT");
        return res.status(400).json({ error: "Verification code is invalid or expired", code: "MARKET_PHONE_CODE_INVALID" });
      }
      const valid = await bcrypt.compare(parsed.data.code, item.otp_hash);
      if (!valid) {
        await client.query(
          `UPDATE market_phone_verification_challenges
              SET attempt_count=attempt_count+1,
                  consumed_at=CASE WHEN attempt_count+1>=max_attempts THEN now() ELSE consumed_at END
            WHERE id=$1`,
          [item.id]
        );
        await writeMarketAudit({
          client, marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
          phoneContactId: item.phone_contact_id, phoneChallengeId: item.id,
          actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
          eventType: "market.auth.phone.confirmed", outcome: "failure",
          detail: { authorityChanged: false }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(400).json({ error: "Verification code is invalid or expired", code: "MARKET_PHONE_CODE_INVALID" });
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [item.phone_fingerprint]);
      const collision = await client.query(
        `SELECT market_identity_id FROM market_phone_contacts
          WHERE phone_fingerprint=$1 AND status='verified' AND market_identity_id<>$2 FOR UPDATE`,
        [item.phone_fingerprint, req.marketIdentity.id]
      );
      if (collision.rowCount) {
        const risk = await writeMarketRiskSignal({
          client, marketIdentityId: req.marketIdentity.id,
          relatedIdentityId: collision.rows[0].market_identity_id,
          signalType: "phone_collision", severity: "high", subject: item.phone_fingerprint,
          detail: { action: "phone_confirmation_race", authorityChanged: false },
        });
        await client.query("UPDATE market_phone_verification_challenges SET consumed_at=now() WHERE id=$1", [item.id]);
        await writeMarketAudit({
          client, marketIdentityId: req.marketIdentity.id, riskSignalId: risk.id,
          marketSessionId: req.marketSession.id, phoneContactId: item.phone_contact_id,
          phoneChallengeId: item.id, actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
          eventType: "market.auth.phone.confirmed", outcome: "denied",
          detail: { reason: "phone_collision", authorityChanged: false }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(409).json({ error: "This phone requires identity review", code: "MARKET_PHONE_REVIEW_REQUIRED" });
      }
      await client.query("UPDATE market_phone_verification_challenges SET consumed_at=now() WHERE id=$1", [item.id]);
      await client.query(
        "UPDATE market_phone_contacts SET status='verified',verified_at=now(),updated_at=now() WHERE id=$1 AND status='pending'",
        [item.phone_contact_id]
      );
      const verification = await client.query(
        `INSERT INTO market_identity_verifications
           (market_identity_id,verification_type,status,source,evidence_hash,reason,decided_at)
         VALUES($1,'phone','verified','sms-otp',$2,'Phone control confirmed by one-time code',now())
         ON CONFLICT DO NOTHING RETURNING id`,
        [req.marketIdentity.id, item.phone_fingerprint]
      );
      const verificationRow = verification.rows[0] || (await client.query(
        `SELECT id FROM market_identity_verifications
          WHERE market_identity_id=$1 AND verification_type='phone' AND status='verified' AND revoked_at IS NULL`,
        [req.marketIdentity.id]
      )).rows[0];
      await writeMarketAudit({
        client, marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
        phoneContactId: item.phone_contact_id, phoneChallengeId: item.id,
        verificationId: verificationRow?.id || null,
        actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
        eventType: "market.auth.phone.confirmed", outcome: "success",
        detail: { maskedPhone: maskedPhone(item.country_code, item.last_four), authorityChanged: false },
        ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ verified: true, maskedPhone: maskedPhone(item.country_code, item.last_four),
        identity: await loadMarketIdentity(req.marketIdentity.id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }));

router.post("/auth/password/forgot", limiter, asyncHandler(async(req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid email is required" });
  if (!deliveryAvailable()) return res.status(503).json({ error: "Market recovery email is not configured" });
  const email = parsed.data.email.toLowerCase();
  const identity = await getPool().query(
    "SELECT id,email FROM market_identities WHERE lower(email)=lower($1) AND active=true LIMIT 1",
    [email]
  );
  let testToken;
  if (identity.rowCount) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const challenge = await createAuthChallenge({
        client, identityId: identity.rows[0].id, purpose: "password_reset",
        email, lifetimeMinutes: 20, req,
      });
      const link = `${loadConfig().marketAuth.appUrl}/?market_reset_token=${encodeURIComponent(challenge.token)}`;
      if (loadConfig().marketAuth.testDelivery) testToken = challenge.token;
      else await deliverMarketEmail({ to: email, template: "market-password-reset", link });
      await writeMarketAudit({
        client, marketIdentityId: identity.rows[0].id, authChallengeId: challenge.id,
        actorType: "anonymous", eventType: "market.auth.password_reset.requested", outcome: "success",
        subject: email, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  } else {
    await writeMarketAudit({
      actorType: "anonymous", eventType: "market.auth.password_reset.requested", outcome: "success",
      subject: email, detail: { matched: false }, ipAddress: req.ip || null,
    });
  }
  res.status(202).json({
    message: "If the account exists, a recovery link has been sent.",
    ...(testToken ? { testToken } : {}),
  });
}));

router.post("/auth/password/reset", limiter, asyncHandler(async(req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid recovery token and strong password are required" });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const challenge = await consumeAuthChallenge({ client, token: parsed.data.token, purpose: "password_reset" });
    if (!challenge?.market_identity_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Recovery link is invalid or expired" });
    }
    await client.query(
      "UPDATE market_identities SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1",
      [challenge.market_identity_id, passwordHash]
    );
    const verification = await client.query(
      `INSERT INTO market_identity_verifications
         (market_identity_id,verification_type,status,source,evidence_hash,reason,decided_at)
       VALUES($1,'email','verified','password-recovery',$2,'Email control confirmed by recovery link',now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [challenge.market_identity_id, subjectHash(challenge.email_snapshot)]
    );
    await revokeMarketSessions({
      client, identityId: challenge.market_identity_id,
      reason: "password reset", req,
    });
    await writeMarketAudit({
      client, marketIdentityId: challenge.market_identity_id, authChallengeId: challenge.id,
      verificationId: verification.rows[0]?.id || null,
      actorType: "market_identity", actorIdentityId: challenge.market_identity_id,
      eventType: "market.auth.password_reset.completed", outcome: "success",
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/auth/email-verification/request", limiter, authenticateMarket, asyncHandler(async(req, res) => {
  if (!deliveryAvailable()) return res.status(503).json({ error: "Market verification email is not configured" });
  if (req.marketIdentity.email_verified_at) return res.json({ verified: true, idempotent: true });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const challenge = await createAuthChallenge({
      client, identityId: req.marketIdentity.id, purpose: "email_verification",
      email: req.marketIdentity.email, lifetimeMinutes: 30, req,
    });
    const link = `${loadConfig().marketAuth.appUrl}/?market_verify_token=${encodeURIComponent(challenge.token)}`;
    if (!loadConfig().marketAuth.testDelivery) {
      await deliverMarketEmail({ to: req.marketIdentity.email, template: "market-email-verification", link });
    }
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, marketSessionId: req.marketSession.id,
      authChallengeId: challenge.id, actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.auth.email_verification.requested", outcome: "success",
      subject: req.marketIdentity.email, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(202).json({ sent: true, ...(loadConfig().marketAuth.testDelivery ? { testToken: challenge.token } : {}) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/auth/email-verification/confirm", limiter, asyncHandler(async(req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid verification token is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const challenge = await consumeAuthChallenge({ client, token: parsed.data.token, purpose: "email_verification" });
    if (!challenge?.market_identity_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Verification link is invalid or expired" });
    }
    await client.query("UPDATE market_identities SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1", [challenge.market_identity_id]);
    const verification = await client.query(
      `INSERT INTO market_identity_verifications
         (market_identity_id,verification_type,status,source,evidence_hash,reason,decided_at)
       VALUES($1,'email','verified','email-link',$2,'Email control confirmed by verification link',now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [challenge.market_identity_id, subjectHash(challenge.email_snapshot)]
    );
    await writeMarketAudit({
      client, marketIdentityId: challenge.market_identity_id, authChallengeId: challenge.id,
      verificationId: verification.rows[0]?.id || null,
      actorType: "market_identity", actorIdentityId: challenge.market_identity_id,
      eventType: "market.auth.email_verification.completed", outcome: "success",
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ verified: true, identity: await loadMarketIdentity(challenge.market_identity_id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.get("/auth/sessions", authenticateMarket, asyncHandler(async(req, res) => {
  const result = await getPool().query(
    `SELECT id,auth_method,created_at,last_seen_at,expires_at,(id=$2) AS current
       FROM market_sessions WHERE market_identity_id=$1 AND revoked_at IS NULL AND expires_at>now()
       ORDER BY last_seen_at DESC`,
    [req.marketIdentity.id, req.marketSession.id]
  );
  res.json({ items: result.rows });
}));

router.post("/auth/sessions/revoke-all", authenticateMarket, asyncHandler(async(req, res) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const count = await revokeMarketSessions({
      client, identityId: req.marketIdentity.id, reason: "user revoked all sessions", req,
    });
    await client.query("COMMIT");
    res.json({ revoked: count });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

async function startGoogle(req, res, { identityId = null, purpose = "google_login", sessionId = null } = {}) {
  if (!loadConfig().marketAuth.google.enabled) {
    return res.status(503).json({ error: "Market Google login is unavailable" });
  }
  const verifier = randomToken(48);
  const nonce = randomToken(24);
  const challenge = await createAuthChallenge({
    identityId, purpose, detail: sessionId ? { sessionId } : {},
    secret: JSON.stringify({ verifier, nonce }), lifetimeMinutes: 10, req,
  });
  res.json({ url: authorizationUrl({ state: challenge.token, nonce, verifier,
    reauthenticate: purpose === "google_reauth" }) });
}

router.get("/auth/google/start", limiter, asyncHandler(async(req, res) => startGoogle(req, res)));
router.post("/auth/google/link/start", limiter, authenticateMarket,
  asyncHandler(async(req, res) => startGoogle(req, res,
    { identityId: req.marketIdentity.id, purpose: "google_link" })));
router.post("/auth/google/reauth/start", limiter, authenticateMarket,
  asyncHandler(async(req, res) => {
    if (!(req.marketIdentity.external_auth_methods || []).includes("google")) {
      return res.status(409).json({ error: "Google is not linked to this Market identity", code: "MARKET_GOOGLE_NOT_LINKED" });
    }
    return startGoogle(req, res, {
      identityId: req.marketIdentity.id, purpose: "google_reauth", sessionId: req.marketSession.id,
    });
  }));

router.get("/auth/google/callback", limiter, asyncHandler(async(req, res) => {
  const input = z.object({ code: z.string().min(8).max(4000), state: z.string().min(32).max(200) }).safeParse(req.query);
  const appUrl = loadConfig().marketAuth.appUrl;
  if (!input.success) return res.redirect(303, `${appUrl}/?market_auth_error=google_callback_invalid`);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let purpose;
    let challenge;
    for (const candidate of ["google_login", "google_link", "google_reauth"]) {
      challenge = await consumeAuthChallenge({ client, token: input.data.state, purpose: candidate });
      if (challenge) { purpose = candidate; break; }
    }
    if (!challenge?.secret_ciphertext) {
      await client.query("ROLLBACK");
      return res.redirect(303, `${appUrl}/?market_auth_error=google_state_expired`);
    }
    const secret = JSON.parse(decryptSecret(challenge.secret_ciphertext));
    const idToken = await exchangeCode(input.data.code, secret.verifier);
    const google = await verifyIdToken(idToken, secret.nonce);
    const existingExternal = await client.query(
      `SELECT id,market_identity_id FROM market_external_identities
        WHERE provider='google' AND issuer=$1 AND subject=$2 AND revoked_at IS NULL FOR UPDATE`,
      [google.issuer, google.subject]
    );
    if (purpose === "google_reauth") {
      const sessionId = challenge.detail?.sessionId;
      const matches = challenge.market_identity_id && existingExternal.rowCount
        && existingExternal.rows[0].market_identity_id === challenge.market_identity_id;
      if (!matches || !sessionId) {
        await writeMarketAudit({
          client, marketIdentityId: challenge.market_identity_id, authChallengeId: challenge.id,
          externalIdentityId: existingExternal.rows[0]?.id || null,
          actorType: "market_identity", actorIdentityId: challenge.market_identity_id,
          eventType: "market.auth.step_up.google", outcome: "denied",
          detail: { reason: "google_identity_mismatch", authorityChanged: false }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.redirect(303, `${appUrl}/?market_auth_error=google_reauth_mismatch`);
      }
      const updated = await client.query(
        `UPDATE market_sessions SET reauthenticated_at=now(),last_seen_at=now()
          WHERE id=$1 AND market_identity_id=$2 AND revoked_at IS NULL AND expires_at>now() RETURNING id`,
        [sessionId, challenge.market_identity_id]
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return res.redirect(303, `${appUrl}/?market_auth_error=google_reauth_session_expired`);
      }
      await writeMarketAudit({
        client, marketIdentityId: challenge.market_identity_id, marketSessionId: sessionId,
        authChallengeId: challenge.id, externalIdentityId: existingExternal.rows[0].id,
        actorType: "market_identity", actorIdentityId: challenge.market_identity_id,
        eventType: "market.auth.step_up.google", outcome: "success",
        detail: { authorityChanged: false }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      return res.redirect(303, `${appUrl}/?market_google_reauthenticated=1`);
    }
    let identityId = challenge.market_identity_id;
    let externalIdentityId = existingExternal.rows[0]?.id || null;
    if (purpose === "google_link") {
      if (!identityId || (existingExternal.rowCount && existingExternal.rows[0].market_identity_id !== identityId)) {
        const risk = await writeMarketRiskSignal({
          client, marketIdentityId: identityId,
          relatedIdentityId: existingExternal.rows[0]?.market_identity_id || null,
          signalType: "external_identity_conflict", severity: "high",
          subject: `${google.issuer}|${google.subject}`, detail: { provider: "google" },
        });
        await writeMarketAudit({
          client, marketIdentityId: identityId, authChallengeId: challenge.id, riskSignalId: risk.id,
          actorType: identityId ? "market_identity" : "anonymous", actorIdentityId: identityId,
          eventType: "market.auth.google.link", outcome: "denied",
          detail: { reason: "external_identity_conflict", authorityChanged: false }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.redirect(303, `${appUrl}/?market_auth_error=google_already_linked`);
      }
    } else if (existingExternal.rowCount) {
      identityId = existingExternal.rows[0].market_identity_id;
    } else {
      const emailOwner = await client.query(
        "SELECT id FROM market_identities WHERE lower(email)=lower($1) AND active=true FOR UPDATE",
        [google.email]
      );
      if (emailOwner.rowCount) {
        const risk = await writeMarketRiskSignal({
          client, relatedIdentityId: emailOwner.rows[0].id,
          signalType: "email_collision", severity: "low", subject: google.email,
          detail: { provider: "google", action: "login_requires_explicit_link" },
        });
        await writeMarketAudit({
          client, authChallengeId: challenge.id, riskSignalId: risk.id,
          actorType: "anonymous", eventType: "market.auth.google.login", outcome: "denied",
          subject: google.email, detail: { reason: "existing_email_link_required", authorityChanged: false },
          ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.redirect(303, `${appUrl}/?market_auth_error=existing_email_link_required`);
      }
      const identity = await client.query(
        `INSERT INTO market_identities(email,password_hash,display_name,email_verified_at)
         VALUES($1,NULL,$2,now()) RETURNING id`,
        [google.email, google.displayName]
      );
      identityId = identity.rows[0].id;
      await writeMarketAudit({
        client, marketIdentityId: identityId, actorType: "market_identity", actorIdentityId: identityId,
        eventType: "market.identity.registered", outcome: "success", subject: google.email,
        detail: { authMethod: "google", authorityChanged: false }, ipAddress: req.ip || null,
      });
    }
    const activeIdentity = await client.query(
      "SELECT id FROM market_identities WHERE id=$1 AND active=true FOR UPDATE",
      [identityId]
    );
    if (!activeIdentity.rowCount) {
      await writeMarketAudit({
        client, marketIdentityId: identityId, externalIdentityId, authChallengeId: challenge.id,
        actorType: "anonymous", eventType: "market.auth.google.login", outcome: "denied",
        detail: { reason: "identity_inactive", authorityChanged: false }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      return res.redirect(303, `${appUrl}/?market_auth_error=identity_inactive`);
    }
    if (!externalIdentityId) {
      const linked = await client.query(
        `INSERT INTO market_external_identities
           (market_identity_id,provider,issuer,subject,email_snapshot,email_verified)
         VALUES($1,'google',$2,$3,$4,true) RETURNING id`,
        [identityId, google.issuer, google.subject, google.email]
      );
      externalIdentityId = linked.rows[0].id;
    } else {
      await client.query("UPDATE market_external_identities SET last_used_at=now(),email_snapshot=$2,email_verified=true WHERE id=$1", [externalIdentityId, google.email]);
    }
    await client.query("UPDATE market_identities SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1", [identityId]);
    for (const verification of [
      ["email", subjectHash(google.email), "google-oidc", "Google verified email claim"],
      ["google_account", subjectHash(`${google.issuer}|${google.subject}`), "google-oidc", "Google issuer and subject verified"],
    ]) {
      await client.query(
        `INSERT INTO market_identity_verifications
           (market_identity_id,verification_type,status,source,evidence_hash,reason,decided_at)
         VALUES($1,$2,'verified',$4,$3,$5,now()) ON CONFLICT DO NOTHING`,
        [identityId, verification[0], verification[1], verification[2], verification[3]]
      );
    }
    await writeMarketAudit({
      client, marketIdentityId: identityId, externalIdentityId, authChallengeId: challenge.id,
      actorType: "market_identity", actorIdentityId: identityId,
      eventType: purpose === "google_link" ? "market.auth.google.linked" : "market.auth.google.verified",
      outcome: "success", detail: { authorityChanged: false }, ipAddress: req.ip || null,
    });
    if (purpose === "google_link") {
      await client.query("COMMIT");
      return res.redirect(303, `${appUrl}/?market_google_linked=1`);
    }
    const exchange = await createAuthChallenge({
      client, identityId, purpose: "login_exchange", detail: { authMethod: "google" },
      lifetimeMinutes: 2, req,
    });
    await client.query("COMMIT");
    return res.redirect(303, `${appUrl}/?market_auth_code=${encodeURIComponent(exchange.token)}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[market google callback]", { name: error.name, message: error.message });
    return res.redirect(303, `${loadConfig().marketAuth.appUrl}/?market_auth_error=google_login_failed`);
  } finally { client.release(); }
}));

router.post("/auth/google/exchange", limiter, asyncHandler(async(req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid login exchange code is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const challenge = await consumeAuthChallenge({ client, token: parsed.data.token, purpose: "login_exchange" });
    if (!challenge?.market_identity_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Login exchange code is invalid or expired" });
    }
    const auth = await createMarketSession({ client, identityId: challenge.market_identity_id, authMethod: "google", req });
    await writeMarketAudit({
      client, marketIdentityId: challenge.market_identity_id, marketSessionId: auth.session.id,
      authChallengeId: challenge.id, actorType: "market_identity", actorIdentityId: challenge.market_identity_id,
      eventType: "market.auth.login", outcome: "success", detail: { authMethod: "google" },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ token: auth.token, identity: await loadMarketIdentity(challenge.market_identity_id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/auth/google/unlink", authenticateMarket, asyncHandler(async(req, res) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query("SELECT password_hash FROM market_identities WHERE id=$1 FOR UPDATE", [req.marketIdentity.id]);
    const activeExternal = await client.query(
      "SELECT id,provider FROM market_external_identities WHERE market_identity_id=$1 AND revoked_at IS NULL FOR UPDATE",
      [req.marketIdentity.id]
    );
    const google = activeExternal.rows.find(item => item.provider === "google");
    if (!google) {
      await client.query("COMMIT");
      return res.json({ identity: await loadMarketIdentity(req.marketIdentity.id), idempotent: true });
    }
    if (!identity.rows[0]?.password_hash && activeExternal.rowCount <= 1) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Add another login method before unlinking Google", code: "MARKET_LAST_CREDENTIAL" });
    }
    await client.query("UPDATE market_external_identities SET revoked_at=now() WHERE id=$1", [google.id]);
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, externalIdentityId: google.id,
      marketSessionId: req.marketSession.id, actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.auth.google.unlinked", outcome: "success", detail: { authorityChanged: false },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ identity: await loadMarketIdentity(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.get("/operator/identity-risk-signals", authenticateMarket, requireMarketOperator, asyncHandler(async(req, res) => {
  const status = z.enum(["open", "reviewed", "dismissed", "confirmed"]).catch("open").parse(req.query.status);
  const result = await getPool().query(
    `SELECT id,market_identity_id,related_identity_id,signal_type,severity,status,detail,
            detected_at,reviewed_at,reviewed_by_identity_id,review_reason
       FROM market_identity_risk_signals WHERE status=$1
       ORDER BY detected_at ASC LIMIT 100`,
    [status]
  );
  res.json({ items: result.rows });
}));

router.post("/operator/identity-risk-signals/:id/review", authenticateMarket, requireMarketOperator, asyncHandler(async(req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const input = riskReviewSchema.safeParse(req.body);
  if (!id.success || !input.success) return res.status(400).json({ error: "Valid risk review is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const signal = await client.query(
      "SELECT * FROM market_identity_risk_signals WHERE id=$1 FOR UPDATE", [id.data]
    );
    if (!signal.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Identity risk signal not found" });
    }
    if (signal.rows[0].status !== "open") {
      await client.query("COMMIT");
      return res.json({ item: signal.rows[0], idempotent: true });
    }
    if ([signal.rows[0].market_identity_id, signal.rows[0].related_identity_id].includes(req.marketIdentity.id)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Operator cannot review own identity signal", code: "MARKET_IDENTITY_SELF_REVIEW_DENIED" });
    }
    const updated = await client.query(
      `UPDATE market_identity_risk_signals
          SET status=$2,reviewed_at=now(),reviewed_by_identity_id=$3,review_reason=$4
        WHERE id=$1 RETURNING *`,
      [id.data, input.data.status, req.marketIdentity.id, input.data.reason]
    );
    await writeMarketAudit({
      client, marketIdentityId: signal.rows[0].market_identity_id, riskSignalId: id.data,
      marketSessionId: req.marketSession.id, actorType: "market_operator",
      actorIdentityId: req.marketIdentity.id, eventType: "market.identity.risk.reviewed", outcome: "success",
      detail: { status: input.data.status, reason: input.data.reason, authorityChanged: false }, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ item: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

module.exports = router;
