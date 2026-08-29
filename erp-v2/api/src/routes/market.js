"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticateMarket, requireMarketOperator, requireRecentMarketStepUp } = require("../middleware/auth");
const { loadMarketIdentity, writeMarketAudit } = require("../services/market-identity");
const { createMarketSession, revokeMarketSessions } = require("../services/market-auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const participantView = z.enum(["customer", "provider"]);
const reasonSchema = z.object({ reason: z.string().trim().min(12).max(1000) });
const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(12).max(200),
  displayName: z.string().trim().min(2).max(120),
});
const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
});
const providerApplicationSchema = z.object({
  professionalSummary: z.string().trim().min(40).max(2000),
  skills: z.array(z.string().trim().min(2).max(60)).min(1).max(12),
  portfolioUrl: z.union([z.string().trim().url().max(500), z.literal("")]).optional(),
  rulesAccepted: z.literal(true),
});
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many Market authentication attempts" },
});

router.post("/auth/register", authLimiter, asyncHandler(async(req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Market registration details are invalid" });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO market_identities(email,password_hash,display_name)
       VALUES(lower($1),$2,$3)
       RETURNING id`,
      [parsed.data.email, passwordHash, parsed.data.displayName]
    );
    const identityId = created.rows[0].id;
    await writeMarketAudit({
      client, marketIdentityId: identityId, actorType: "market_identity", actorIdentityId: identityId,
      eventType: "market.identity.registered", outcome: "success", subject: parsed.data.email,
      ipAddress: req.ip || null,
    });
    const auth = await createMarketSession({ client, identityId, authMethod: "password", req });
    await client.query("COMMIT");
    const identity = await loadMarketIdentity(identityId);
    res.status(201).json({ token: auth.token, identity });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/auth/login", authLimiter, asyncHandler(async(req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Market login details are invalid" });
  const result = await getPool().query(
    `SELECT id,password_hash,active FROM market_identities WHERE lower(email)=lower($1) LIMIT 1`,
    [parsed.data.email]
  );
  const record = result.rows[0];
  if (!record || !record.active || !record.password_hash || !(await bcrypt.compare(parsed.data.password, record.password_hash))) {
    await writeMarketAudit({
      marketIdentityId: record?.id || null, actorType: "anonymous", eventType: "market.auth.login",
      outcome: "failure", subject: parsed.data.email, ipAddress: req.ip || null,
    });
    return res.status(401).json({ error: "Market email or password is incorrect" });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const auth = await createMarketSession({ client, identityId: record.id, authMethod: "password", req });
    await writeMarketAudit({
      client, marketIdentityId: record.id, marketSessionId: auth.session.id,
      actorType: "market_identity", actorIdentityId: record.id,
      eventType: "market.auth.login", outcome: "success", subject: parsed.data.email,
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ token: auth.token, identity: await loadMarketIdentity(record.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/auth/me", authenticateMarket, (req, res) => res.json({ identity: req.marketIdentity }));

router.post("/auth/logout", authenticateMarket, asyncHandler(async(req, res) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await revokeMarketSessions({
      client, identityId: req.marketIdentity.id, sessionId: req.marketSession.id,
      reason: "user logout", req,
    });
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/memberships", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = z.object({ membershipType: participantView }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Customer or provider membership is required" });
  if (parsed.data.membershipType === "provider") {
    return res.status(409).json({
      error: "Provider capability requires a reviewed application",
      code: "MARKET_PROVIDER_APPLICATION_REQUIRED",
    });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM market_identities WHERE id=$1 FOR UPDATE", [req.marketIdentity.id]);
    const existing = await client.query(
      `SELECT id,status FROM market_memberships
        WHERE market_identity_id=$1 AND membership_type=$2 FOR UPDATE`,
      [req.marketIdentity.id, parsed.data.membershipType]
    );
    if (existing.rowCount) {
      if (existing.rows[0].status === "active") {
        await writeMarketAudit({
          client, marketIdentityId: req.marketIdentity.id, membershipId: existing.rows[0].id,
          actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
          eventType: "market.membership.issue.idempotent", outcome: "success",
          detail: { membershipType: parsed.data.membershipType, currentStatus: "active" },
          ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.json({ identity: await loadMarketIdentity(req.marketIdentity.id), idempotent: true });
      }
      await writeMarketAudit({
        client, marketIdentityId: req.marketIdentity.id, membershipId: existing.rows[0].id,
        actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
        eventType: "market.membership.issue", outcome: "denied",
        detail: { membershipType: parsed.data.membershipType, currentStatus: existing.rows[0].status },
        ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      return res.status(409).json({
        error: existing.rows[0].status === "suspended"
          ? "Suspended membership requires Market operator activation"
          : "Membership is already active",
        code: existing.rows[0].status === "suspended" ? "MARKET_MEMBERSHIP_SUSPENDED" : "MARKET_MEMBERSHIP_EXISTS",
      });
    }
    const created = await client.query(
      `INSERT INTO market_memberships
         (market_identity_id,membership_type,status,issued_by_kind,issued_by_identity_id)
       VALUES($1,$2,'active','self',$1)
       RETURNING id`,
      [req.marketIdentity.id, parsed.data.membershipType]
    );
    const membershipId = created.rows[0].id;
    await client.query(
      `UPDATE market_identities SET selected_view=COALESCE(selected_view,$2),updated_at=now() WHERE id=$1`,
      [req.marketIdentity.id, parsed.data.membershipType]
    );
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, membershipId,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.membership.issued", outcome: "success",
      detail: { membershipType: parsed.data.membershipType, status: "active", action: "order-intent" },
      ipAddress: req.ip || null,
    });
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, membershipId,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.membership.activated", outcome: "success",
      detail: { membershipType: parsed.data.membershipType, activation: "customer-order-intent" },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({ identity: await loadMarketIdentity(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/provider-applications", authenticateMarket, requireRecentMarketStepUp, asyncHandler(async(req, res) => {
  const parsed = providerApplicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    error: "Provider summary, skills, accepted rules, and an optional valid portfolio URL are required",
  });
  const skills = [...new Set(parsed.data.skills.map(item => item.trim()))];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM market_identities WHERE id=$1 FOR UPDATE", [req.marketIdentity.id]);
    const membership = await client.query(
      `SELECT status FROM market_memberships
        WHERE market_identity_id=$1 AND membership_type='provider'`,
      [req.marketIdentity.id]
    );
    if (membership.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: membership.rows[0].status === "active"
          ? "Provider capability is already active"
          : "Suspended provider capability requires Market operator activation",
        code: membership.rows[0].status === "active"
          ? "MARKET_PROVIDER_MEMBERSHIP_EXISTS"
          : "MARKET_MEMBERSHIP_SUSPENDED",
      });
    }
    const open = await client.query(
      `SELECT id,status FROM market_provider_applications
        WHERE market_identity_id=$1 AND status IN ('submitted','under_review')
        FOR UPDATE`,
      [req.marketIdentity.id]
    );
    if (open.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Provider application is already awaiting review",
        code: "MARKET_PROVIDER_APPLICATION_OPEN",
      });
    }
    const phoneVerification = await client.query(
      `SELECT verification.id
         FROM market_identity_verifications verification
         JOIN market_phone_contacts contact
           ON contact.market_identity_id=verification.market_identity_id
          AND contact.phone_fingerprint=verification.evidence_hash
          AND contact.status='verified'
        WHERE verification.market_identity_id=$1 AND verification.verification_type='phone'
          AND verification.status='verified' AND verification.revoked_at IS NULL
        ORDER BY verification.decided_at DESC LIMIT 1 FOR UPDATE OF verification,contact`,
      [req.marketIdentity.id]
    );
    if (!phoneVerification.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Verified phone is required before submitting a Provider application",
        code: "MARKET_PHONE_VERIFICATION_REQUIRED",
      });
    }
    const created = await client.query(
      `INSERT INTO market_provider_applications
         (market_identity_id,professional_summary,skill_tags,portfolio_url,rules_accepted_at,
          assurance_policy_version,phone_verification_id,step_up_at)
       VALUES($1,$2,$3,$4,now(),1,$5,$6) RETURNING id`,
      [req.marketIdentity.id, parsed.data.professionalSummary, skills, parsed.data.portfolioUrl || null,
        phoneVerification.rows[0].id, req.marketSession.reauthenticated_at]
    );
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, providerApplicationId: created.rows[0].id,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.provider.application.submitted", outcome: "success",
      detail: { status: "submitted", skillCount: skills.length, rulesAccepted: true,
        assurancePolicyVersion: 1, phoneVerified: true, recentStepUp: true },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({ identity: await loadMarketIdentity(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/view", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = z.object({ view: participantView }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Customer or provider view is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const allowed = await client.query(
      `SELECT membership.id,identity.selected_view
         FROM market_identities identity
         JOIN market_memberships membership ON membership.market_identity_id=identity.id
        WHERE identity.id=$1 AND identity.active=true
          AND membership.membership_type=$2 AND membership.status='active'
        FOR UPDATE OF identity,membership`,
      [req.marketIdentity.id, parsed.data.view]
    );
    if (!allowed.rowCount) {
      await writeMarketAudit({
        client, marketIdentityId: req.marketIdentity.id,
        actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
        eventType: "market.view.switch", outcome: "denied",
        detail: { requestedView: parsed.data.view, reason: "active_membership_required" },
        ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      return res.status(403).json({
        error: "An active membership is required for this Market view",
        code: "MARKET_MEMBERSHIP_REQUIRED",
        view: parsed.data.view,
      });
    }
    await client.query("UPDATE market_identities SET selected_view=$2,updated_at=now() WHERE id=$1",
      [req.marketIdentity.id, parsed.data.view]);
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, membershipId: allowed.rows[0].id,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.view.switched", outcome: "success",
      detail: { from: allowed.rows[0].selected_view, to: parsed.data.view, authorityChanged: false },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ identity: await loadMarketIdentity(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

async function activeOperatorAssignment(client, identityId) {
  const result = await client.query(
    `SELECT id FROM market_operator_assignments
      WHERE market_identity_id=$1 AND role_code='market-operator' AND revoked_at IS NULL
      FOR UPDATE`,
    [identityId]
  );
  return result.rows[0]?.id || null;
}

router.post("/operator/provider-applications/:id/start-review", authenticateMarket, requireMarketOperator,
  asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Application and 12+ character review reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const application = await client.query(
        `SELECT id,market_identity_id,status,assurance_policy_version,phone_verification_id
           FROM market_provider_applications
          WHERE id=$1 FOR UPDATE`,
        [id.data]
      );
      if (!application.rowCount || application.rows[0].status !== "submitted") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only a submitted provider application can enter review", code: "MARKET_PROVIDER_APPLICATION_NOT_SUBMITTED" });
      }
      const item = application.rows[0];
      if (item.market_identity_id === req.marketIdentity.id) {
        await writeMarketAudit({
          client, marketIdentityId: item.market_identity_id, providerApplicationId: item.id,
          operatorAssignmentId: assignmentId, actorType: "market_operator",
          actorIdentityId: req.marketIdentity.id, eventType: "market.provider.application.review",
          outcome: "denied", detail: { reason: "operator_self_review_forbidden" }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(403).json({ error: "A Market operator cannot review their own provider application", code: "MARKET_PROVIDER_SELF_REVIEW_DENIED" });
      }
      await client.query(
        `UPDATE market_provider_applications
            SET status='under_review',reviewed_at=now(),updated_at=now()
          WHERE id=$1`,
        [item.id]
      );
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, providerApplicationId: item.id,
        operatorAssignmentId: assignmentId, actorType: "market_operator",
        actorIdentityId: req.marketIdentity.id, eventType: "market.provider.application.review_started",
        outcome: "success", detail: { reason: parsed.data.reason, from: "submitted", to: "under_review" },
        ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ identity: await loadMarketIdentity(item.market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post("/operator/provider-applications/:id/approve", authenticateMarket, requireMarketOperator,
  asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Application and 12+ character reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const application = await client.query(
        `SELECT id,market_identity_id,status FROM market_provider_applications
          WHERE id=$1 FOR UPDATE`,
        [id.data]
      );
      if (!application.rowCount || application.rows[0].status !== "under_review") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only an application under review can be approved", code: "MARKET_PROVIDER_APPLICATION_NOT_UNDER_REVIEW" });
      }
      const item = application.rows[0];
      if (item.market_identity_id === req.marketIdentity.id) {
        await writeMarketAudit({
          client, marketIdentityId: item.market_identity_id, providerApplicationId: item.id,
          operatorAssignmentId: assignmentId, actorType: "market_operator",
          actorIdentityId: req.marketIdentity.id, eventType: "market.provider.application.approve",
          outcome: "denied", detail: { reason: "operator_self_review_forbidden" }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(403).json({ error: "A Market operator cannot approve their own provider application", code: "MARKET_PROVIDER_SELF_REVIEW_DENIED" });
      }
      if (item.assurance_policy_version === 1) {
        const assurance = await client.query(
          `SELECT verification.id
             FROM market_identity_verifications verification
             JOIN market_phone_contacts contact
               ON contact.market_identity_id=verification.market_identity_id
              AND contact.phone_fingerprint=verification.evidence_hash
              AND contact.status='verified'
            WHERE verification.id=$1 AND verification.market_identity_id=$2
              AND verification.verification_type='phone'
              AND verification.status='verified' AND verification.revoked_at IS NULL
            FOR UPDATE OF verification,contact`,
          [item.phone_verification_id, item.market_identity_id]
        );
        if (!assurance.rowCount) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: "Provider phone assurance is no longer valid",
            code: "MARKET_PROVIDER_ASSURANCE_INVALID",
          });
        }
      }
      const existing = await client.query(
        `SELECT id,status FROM market_memberships
          WHERE market_identity_id=$1 AND membership_type='provider' FOR UPDATE`,
        [item.market_identity_id]
      );
      if (existing.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Provider membership already exists", code: "MARKET_PROVIDER_MEMBERSHIP_EXISTS" });
      }
      await client.query(
        `UPDATE market_provider_applications
            SET status='approved',reviewed_at=COALESCE(reviewed_at,now()),decided_at=now(),
                decided_by_identity_id=$2,decision_reason=$3,updated_at=now()
          WHERE id=$1`,
        [item.id, req.marketIdentity.id, parsed.data.reason]
      );
      const membership = await client.query(
        `INSERT INTO market_memberships
           (market_identity_id,membership_type,status,issued_by_kind,issued_by_identity_id)
         VALUES($1,'provider','active','market_operator',$2) RETURNING id`,
        [item.market_identity_id, req.marketIdentity.id]
      );
      await client.query(
        `UPDATE market_identities SET selected_view=COALESCE(selected_view,'provider'),updated_at=now()
          WHERE id=$1`,
        [item.market_identity_id]
      );
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, membershipId: membership.rows[0].id,
        providerApplicationId: item.id, operatorAssignmentId: assignmentId,
        actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
        eventType: "market.provider.application.approved", outcome: "success",
        detail: { reason: parsed.data.reason, providerMembershipCreated: true }, ipAddress: req.ip || null,
      });
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, membershipId: membership.rows[0].id,
        providerApplicationId: item.id, operatorAssignmentId: assignmentId,
        actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
        eventType: "market.membership.issued", outcome: "success",
        detail: { membershipType: "provider", issuedBy: "approved-provider-application" }, ipAddress: req.ip || null,
      });
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, membershipId: membership.rows[0].id,
        providerApplicationId: item.id, operatorAssignmentId: assignmentId,
        actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
        eventType: "market.membership.activated", outcome: "success",
        detail: { membershipType: "provider", activation: "approved-provider-application" }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ identity: await loadMarketIdentity(item.market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post("/operator/provider-applications/:id/reject", authenticateMarket, requireMarketOperator,
  asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Application and 12+ character reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const application = await client.query(
        `SELECT id,market_identity_id,status FROM market_provider_applications
          WHERE id=$1 FOR UPDATE`,
        [id.data]
      );
      if (!application.rowCount || application.rows[0].status !== "under_review") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only an application under review can be rejected", code: "MARKET_PROVIDER_APPLICATION_NOT_UNDER_REVIEW" });
      }
      const item = application.rows[0];
      if (item.market_identity_id === req.marketIdentity.id) {
        await writeMarketAudit({
          client, marketIdentityId: item.market_identity_id, providerApplicationId: item.id,
          operatorAssignmentId: assignmentId, actorType: "market_operator",
          actorIdentityId: req.marketIdentity.id, eventType: "market.provider.application.reject",
          outcome: "denied", detail: { reason: "operator_self_review_forbidden" }, ipAddress: req.ip || null,
        });
        await client.query("COMMIT");
        return res.status(403).json({ error: "A Market operator cannot reject their own provider application", code: "MARKET_PROVIDER_SELF_REVIEW_DENIED" });
      }
      await client.query(
        `UPDATE market_provider_applications
            SET status='rejected',reviewed_at=COALESCE(reviewed_at,now()),decided_at=now(),
                decided_by_identity_id=$2,decision_reason=$3,updated_at=now()
          WHERE id=$1`,
        [item.id, req.marketIdentity.id, parsed.data.reason]
      );
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, providerApplicationId: item.id,
        operatorAssignmentId: assignmentId, actorType: "market_operator",
        actorIdentityId: req.marketIdentity.id, eventType: "market.provider.application.rejected",
        outcome: "success", detail: { reason: parsed.data.reason, providerMembershipCreated: false },
        ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ identity: await loadMarketIdentity(item.market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post("/operator/memberships/:id/suspend", authenticateMarket, requireMarketOperator,
  asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Membership and 12+ character reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const membership = await client.query(
        `UPDATE market_memberships SET status='suspended',suspended_at=now(),suspension_reason=$2,updated_at=now()
          WHERE id=$1 AND status='active'
          RETURNING id,market_identity_id,membership_type`,
        [id.data, parsed.data.reason]
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only an active membership can be suspended", code: "MARKET_MEMBERSHIP_NOT_ACTIVE" });
      }
      const item = membership.rows[0];
      await client.query(
        `UPDATE market_identities identity
            SET selected_view=(SELECT membership_type FROM market_memberships
                                WHERE market_identity_id=identity.id AND status='active'
                                ORDER BY membership_type LIMIT 1),updated_at=now()
          WHERE identity.id=$1 AND identity.selected_view=$2`,
        [item.market_identity_id, item.membership_type]
      );
      if (item.membership_type === "provider") {
        const storefront = await client.query(
          `UPDATE market_storefronts
              SET status='suspended',suspended_at=now(),suspension_reason=$2,updated_at=now()
            WHERE provider_membership_id=$1 AND status IN ('draft','active','expired')
            RETURNING id`,
          [item.id, parsed.data.reason]
        );
        if (storefront.rowCount) {
          await writeMarketAudit({
            client, marketIdentityId: item.market_identity_id, membershipId: item.id,
            storefrontId: storefront.rows[0].id, operatorAssignmentId: assignmentId,
            actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
            eventType: "market.storefront.suspended", outcome: "success",
            detail: { reason: parsed.data.reason, source: "provider-membership-suspension" }, ipAddress: req.ip || null,
          });
        }
      }
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, membershipId: item.id,
        operatorAssignmentId: assignmentId, actorType: "market_operator",
        actorIdentityId: req.marketIdentity.id, eventType: "market.membership.suspended", outcome: "success",
        detail: { membershipType: item.membership_type, reason: parsed.data.reason }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ identity: await loadMarketIdentity(item.market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post("/operator/memberships/:id/activate", authenticateMarket, requireMarketOperator,
  asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = reasonSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Membership and 12+ character reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const membership = await client.query(
        `UPDATE market_memberships SET status='active',activated_at=now(),suspended_at=NULL,
                suspension_reason=NULL,updated_at=now()
          WHERE id=$1 AND status='suspended'
          RETURNING id,market_identity_id,membership_type`,
        [id.data]
      );
      if (!membership.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only a suspended membership can be activated", code: "MARKET_MEMBERSHIP_NOT_SUSPENDED" });
      }
      const item = membership.rows[0];
      await writeMarketAudit({
        client, marketIdentityId: item.market_identity_id, membershipId: item.id,
        operatorAssignmentId: assignmentId, actorType: "market_operator",
        actorIdentityId: req.marketIdentity.id, eventType: "market.membership.activated", outcome: "success",
        detail: { membershipType: item.membership_type, reason: parsed.data.reason }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ identity: await loadMarketIdentity(item.market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })
);

router.use("/", require("./market-auth-assurance"));
router.use("/", require("./market-storefront"));

module.exports = router;
