"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { signMarketToken } = require("../security/token");
const { authenticateMarket, requireMarketOperator } = require("../middleware/auth");
const { loadMarketIdentity, writeMarketAudit } = require("../services/market-identity");
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
    await client.query("COMMIT");
    const identity = await loadMarketIdentity(identityId);
    res.status(201).json({ token: signMarketToken(identityId), identity });
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
  if (!record || !record.active || !(await bcrypt.compare(parsed.data.password, record.password_hash))) {
    await writeMarketAudit({
      marketIdentityId: record?.id || null, actorType: "anonymous", eventType: "market.auth.login",
      outcome: "failure", subject: parsed.data.email, ipAddress: req.ip || null,
    });
    return res.status(401).json({ error: "Market email or password is incorrect" });
  }
  await writeMarketAudit({
    marketIdentityId: record.id, actorType: "market_identity", actorIdentityId: record.id,
    eventType: "market.auth.login", outcome: "success", subject: parsed.data.email,
    ipAddress: req.ip || null,
  });
  res.json({ token: signMarketToken(record.id), identity: await loadMarketIdentity(record.id) });
}));

router.get("/auth/me", authenticateMarket, (req, res) => res.json({ identity: req.marketIdentity }));

router.post("/auth/logout", authenticateMarket, asyncHandler(async(req, res) => {
  await writeMarketAudit({
    marketIdentityId: req.marketIdentity.id, actorType: "market_identity",
    actorIdentityId: req.marketIdentity.id, eventType: "market.auth.logout", outcome: "success",
    ipAddress: req.ip || null,
  });
  res.status(204).end();
}));

router.post("/memberships", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = z.object({ membershipType: participantView }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Customer or provider membership is required" });
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
      detail: { membershipType: parsed.data.membershipType, status: "active", supplierVerified: false },
      ipAddress: req.ip || null,
    });
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, membershipId,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.membership.activated", outcome: "success",
      detail: { membershipType: parsed.data.membershipType, activation: "self-service-participation" },
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

module.exports = router;
