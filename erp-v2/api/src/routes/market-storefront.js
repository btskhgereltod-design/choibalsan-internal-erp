"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticateMarket, requireMarketOperator } = require("../middleware/auth");
const { writeMarketAudit } = require("../services/market-identity");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const reason = z.string().trim().min(12).max(1000);
const entitlementValue = z.union([z.boolean(), z.number().int().min(0).max(1000000), z.string().trim().min(1).max(100)]);
const planSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(12).max(1000),
  priceMnt: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  billingPeriodDays: z.coerce.number().int().min(1).max(366),
  entitlements: z.record(z.string().regex(/^[a-z][a-z0-9._-]{1,79}$/), entitlementValue)
    .refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= 30),
  reason,
});
const storefrontSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,59}$/),
  displayName: z.string().trim().min(2).max(120),
  tagline: z.string().trim().min(10).max(180),
  description: z.string().trim().min(40).max(3000),
  publicContact: z.string().trim().min(3).max(300).optional().or(z.literal("")),
});
const subscriptionSchema = z.object({
  planId: uuid,
  externalPaymentReference: z.string().trim().min(4).max(200),
});

async function activeOperatorAssignment(client, identityId) {
  const result = await client.query(
    `SELECT id FROM market_operator_assignments
      WHERE market_identity_id=$1 AND role_code='market-operator' AND revoked_at IS NULL
      FOR UPDATE`,
    [identityId]
  );
  return result.rows[0]?.id || null;
}

async function expireDueSubscriptions() {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `UPDATE market_storefront_subscriptions subscription
          SET status='expired',updated_at=now()
        WHERE subscription.status='active' AND subscription.expires_at<=now()
        RETURNING subscription.id,subscription.storefront_id`
    );
    for (const subscription of due.rows) {
      const storefront = await client.query(
        `UPDATE market_storefronts SET status='expired',updated_at=now()
          WHERE id=$1 AND status='active'
          RETURNING id,market_identity_id`,
        [subscription.storefront_id]
      );
      const identityId = storefront.rows[0]?.market_identity_id
        || (await client.query("SELECT market_identity_id FROM market_storefronts WHERE id=$1", [subscription.storefront_id])).rows[0]?.market_identity_id;
      await writeMarketAudit({
        client, marketIdentityId: identityId, storefrontId: subscription.storefront_id,
        storefrontSubscriptionId: subscription.id, actorType: "system",
        eventType: "market.storefront.subscription.expired", outcome: "success",
        detail: { automatic: true },
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function storefrontSnapshot(identityId, client = getPool()) {
  const result = await client.query(
    `SELECT storefront.*,
            (SELECT row_to_json(subscription_row) FROM (
              SELECT subscription.id,subscription.status,subscription.requested_at,
                     subscription.activated_at,subscription.expires_at,
                     subscription.external_payment_reference,subscription.price_mnt_snapshot,
                     subscription.billing_period_days_snapshot,subscription.entitlement_snapshot,
                     plan.code AS plan_code,plan.name AS plan_name
                FROM market_storefront_subscriptions subscription
                JOIN market_storefront_plans plan ON plan.id=subscription.plan_id
               WHERE subscription.storefront_id=storefront.id
               ORDER BY subscription.requested_at DESC LIMIT 1
            ) subscription_row) AS subscription
       FROM market_storefronts storefront
      WHERE storefront.market_identity_id=$1`,
    [identityId]
  );
  return result.rows[0] || null;
}

router.get("/storefront-plans", asyncHandler(async(req, res) => {
  await expireDueSubscriptions();
  const result = await getPool().query(
    `SELECT id,code,version,name,description,price_mnt,billing_period_days,entitlement_snapshot
       FROM market_storefront_plans WHERE status='active' ORDER BY price_mnt,code`
  );
  res.json({ items: result.rows });
}));

router.get("/storefronts", asyncHandler(async(req, res) => {
  await expireDueSubscriptions();
  const result = await getPool().query(
    `SELECT storefront.id,storefront.slug,storefront.display_name,storefront.tagline,
            storefront.description,storefront.public_contact,plan.code AS plan_code,plan.name AS plan_name
       FROM market_storefronts storefront
       JOIN market_memberships membership ON membership.id=storefront.provider_membership_id
       JOIN market_storefront_subscriptions subscription ON subscription.storefront_id=storefront.id
         AND subscription.status='active' AND subscription.expires_at>now()
       JOIN market_storefront_plans plan ON plan.id=subscription.plan_id
      WHERE storefront.status='active' AND membership.status='active'
      ORDER BY storefront.updated_at DESC LIMIT 100`
  );
  res.json({ items: result.rows });
}));

router.get("/storefronts/:slug", asyncHandler(async(req, res) => {
  await expireDueSubscriptions();
  const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/).safeParse(String(req.params.slug || "").toLowerCase());
  if (!slug.success) return res.status(400).json({ error: "Invalid storefront slug" });
  const result = await getPool().query(
    `SELECT storefront.id,storefront.slug,storefront.display_name,storefront.tagline,
            storefront.description,storefront.public_contact,plan.code AS plan_code,plan.name AS plan_name
       FROM market_storefronts storefront
       JOIN market_memberships membership ON membership.id=storefront.provider_membership_id
       JOIN market_storefront_subscriptions subscription ON subscription.storefront_id=storefront.id
         AND subscription.status='active' AND subscription.expires_at>now()
       JOIN market_storefront_plans plan ON plan.id=subscription.plan_id
      WHERE lower(storefront.slug)=lower($1) AND storefront.status='active' AND membership.status='active'`,
    [slug.data]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Storefront unavailable" });
  res.json({ item: result.rows[0] });
}));

router.get("/storefront/me", authenticateMarket, asyncHandler(async(req, res) => {
  await expireDueSubscriptions();
  res.json({ item: await storefrontSnapshot(req.marketIdentity.id) });
}));

router.post("/storefront", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = storefrontSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid storefront profile is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM market_identities WHERE id=$1 FOR UPDATE", [req.marketIdentity.id]);
    const membership = await client.query(
      `SELECT id FROM market_memberships
        WHERE market_identity_id=$1 AND membership_type='provider' AND status='active' FOR UPDATE`,
      [req.marketIdentity.id]
    );
    if (!membership.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Active Provider membership required", code: "MARKET_PROVIDER_MEMBERSHIP_REQUIRED" });
    }
    const existing = await client.query("SELECT id FROM market_storefronts WHERE market_identity_id=$1 FOR UPDATE", [req.marketIdentity.id]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      return res.json({ item: await storefrontSnapshot(req.marketIdentity.id), idempotent: true });
    }
    const value = parsed.data;
    const created = await client.query(
      `INSERT INTO market_storefronts
         (market_identity_id,provider_membership_id,slug,display_name,tagline,description,public_contact)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.marketIdentity.id, membership.rows[0].id, value.slug, value.displayName,
        value.tagline, value.description, value.publicContact || null]
    );
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, membershipId: membership.rows[0].id,
      storefrontId: created.rows[0].id, actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.storefront.created", outcome: "success", detail: { slug: value.slug, status: "draft" },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({ item: await storefrontSnapshot(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/storefront", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = storefrontSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid storefront profile is required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const value = parsed.data;
    const updated = await client.query(
      `UPDATE market_storefronts storefront
          SET slug=$2,display_name=$3,tagline=$4,description=$5,public_contact=$6,updated_at=now()
        WHERE storefront.market_identity_id=$1 AND storefront.status<>'closed'
          AND EXISTS (SELECT 1 FROM market_memberships membership
                       WHERE membership.id=storefront.provider_membership_id
                         AND membership.membership_type='provider' AND membership.status='active')
        RETURNING id`,
      [req.marketIdentity.id, value.slug, value.displayName, value.tagline,
        value.description, value.publicContact || null]
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Owned storefront and active Provider membership required", code: "MARKET_STOREFRONT_ACCESS_REQUIRED" });
    }
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, storefrontId: updated.rows[0].id,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.storefront.profile_updated", outcome: "success", detail: { slug: value.slug },
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ item: await storefrontSnapshot(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/storefront/subscriptions", authenticateMarket, asyncHandler(async(req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Plan and external payment reference are required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const storefront = await client.query(
      `SELECT storefront.id,storefront.status FROM market_storefronts storefront
        JOIN market_memberships membership ON membership.id=storefront.provider_membership_id
       WHERE storefront.market_identity_id=$1 AND membership.status='active'
         AND membership.membership_type='provider' FOR UPDATE OF storefront`,
      [req.marketIdentity.id]
    );
    if (!storefront.rowCount || ["suspended", "closed"].includes(storefront.rows[0].status)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Available owned storefront and active Provider membership required", code: "MARKET_STOREFRONT_ACCESS_REQUIRED" });
    }
    const plan = await client.query(
      `SELECT id,code,version,price_mnt,billing_period_days,entitlement_snapshot
         FROM market_storefront_plans WHERE id=$1 AND status='active' FOR UPDATE`,
      [parsed.data.planId]
    );
    if (!plan.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Active storefront plan required", code: "MARKET_STOREFRONT_PLAN_UNAVAILABLE" });
    }
    const open = await client.query(
      `SELECT id,plan_id,status FROM market_storefront_subscriptions
        WHERE storefront_id=$1 AND status IN ('pending','active','suspended') FOR UPDATE`,
      [storefront.rows[0].id]
    );
    if (open.rowCount) {
      if (open.rows[0].status === "pending" && open.rows[0].plan_id === plan.rows[0].id) {
        await client.query("COMMIT");
        return res.json({ item: await storefrontSnapshot(req.marketIdentity.id), idempotent: true });
      }
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An open storefront subscription already exists", code: "MARKET_STOREFRONT_SUBSCRIPTION_OPEN" });
    }
    const item = plan.rows[0];
    const created = await client.query(
      `INSERT INTO market_storefront_subscriptions
         (storefront_id,plan_id,external_payment_reference,price_mnt_snapshot,
          billing_period_days_snapshot,entitlement_snapshot)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [storefront.rows[0].id, item.id, parsed.data.externalPaymentReference,
        item.price_mnt, item.billing_period_days, item.entitlement_snapshot]
    );
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, storefrontPlanId: item.id,
      storefrontId: storefront.rows[0].id, storefrontSubscriptionId: created.rows[0].id,
      actorType: "market_identity", actorIdentityId: req.marketIdentity.id,
      eventType: "market.storefront.subscription.requested", outcome: "success",
      detail: { planCode: item.code, planVersion: item.version, priceMnt: item.price_mnt }, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({ item: await storefrontSnapshot(req.marketIdentity.id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/operator/storefront-plans", authenticateMarket, requireMarketOperator, asyncHandler(async(req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Valid versioned storefront plan and reason are required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
    if (!assignmentId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
    }
    const current = await client.query(
      `SELECT id,version FROM market_storefront_plans WHERE code=$1 AND status='active' FOR UPDATE`,
      [parsed.data.code]
    );
    if (current.rowCount) {
      await client.query("UPDATE market_storefront_plans SET status='retired',retired_at=now() WHERE id=$1", [current.rows[0].id]);
    }
    const value = parsed.data;
    const created = await client.query(
      `INSERT INTO market_storefront_plans
         (code,version,name,description,price_mnt,billing_period_days,entitlement_snapshot,created_by_identity_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [value.code, (current.rows[0]?.version || 0) + 1, value.name, value.description,
        value.priceMnt, value.billingPeriodDays, value.entitlements, req.marketIdentity.id]
    );
    await writeMarketAudit({
      client, marketIdentityId: req.marketIdentity.id, operatorAssignmentId: assignmentId,
      storefrontPlanId: created.rows[0].id, actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
      eventType: "market.storefront.plan.published", outcome: "success",
      detail: { code: value.code, version: created.rows[0].version, reason: value.reason,
        replacedPlanId: current.rows[0]?.id || null }, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({ item: created.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/operator/storefront-subscriptions/:id/activate", authenticateMarket, requireMarketOperator, asyncHandler(async(req, res) => {
  const id = uuid.safeParse(req.params.id);
  const parsed = z.object({ reason }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Subscription and 12+ character reason are required" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
    if (!assignmentId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
    }
    const subscription = await client.query(
      `SELECT subscription.*,storefront.market_identity_id,storefront.status AS storefront_status
         FROM market_storefront_subscriptions subscription
         JOIN market_storefronts storefront ON storefront.id=subscription.storefront_id
        WHERE subscription.id=$1 FOR UPDATE OF subscription,storefront`,
      [id.data]
    );
    if (!subscription.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Storefront subscription unavailable" });
    }
    const item = subscription.rows[0];
    if (item.status === "active") {
      await client.query("COMMIT");
      return res.json({ item: await storefrontSnapshot(item.market_identity_id), idempotent: true });
    }
    if (item.status !== "pending" || ["suspended", "closed"].includes(item.storefront_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only a pending subscription for an available storefront can be activated", code: "MARKET_STOREFRONT_SUBSCRIPTION_NOT_PENDING" });
    }
    const activated = await client.query(
      `UPDATE market_storefront_subscriptions
          SET status='active',activated_at=now(),expires_at=now()+billing_period_days_snapshot*interval '1 day',
              decided_by_identity_id=$2,decision_reason=$3,updated_at=now()
        WHERE id=$1 RETURNING activated_at,expires_at`,
      [item.id, req.marketIdentity.id, parsed.data.reason]
    );
    await client.query(
      `UPDATE market_storefronts SET status='active',suspended_at=NULL,suspension_reason=NULL,updated_at=now()
        WHERE id=$1 AND status IN ('draft','expired')`,
      [item.storefront_id]
    );
    for (const [code, value] of Object.entries(item.entitlement_snapshot)) {
      await client.query(
        `INSERT INTO market_storefront_entitlements
           (subscription_id,entitlement_code,entitlement_value,valid_from,valid_until)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(subscription_id,entitlement_code) DO NOTHING`,
        [item.id, code, JSON.stringify(value), activated.rows[0].activated_at, activated.rows[0].expires_at]
      );
    }
    await writeMarketAudit({
      client, marketIdentityId: item.market_identity_id, operatorAssignmentId: assignmentId,
      storefrontPlanId: item.plan_id, storefrontId: item.storefront_id, storefrontSubscriptionId: item.id,
      actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
      eventType: "market.storefront.subscription.activated", outcome: "success",
      detail: { reason: parsed.data.reason, expiresAt: activated.rows[0].expires_at }, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ item: await storefrontSnapshot(item.market_identity_id) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

for (const action of ["suspend", "reactivate"]) {
  router.post(`/operator/storefronts/:id/${action}`, authenticateMarket, requireMarketOperator, asyncHandler(async(req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = z.object({ reason }).safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Storefront and 12+ character reason are required" });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const assignmentId = await activeOperatorAssignment(client, req.marketIdentity.id);
      if (!assignmentId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Market operator assignment required", code: "MARKET_OPERATOR_REQUIRED" });
      }
      const targetStatus = action === "suspend" ? "suspended" : "active";
      const currentStatus = action === "suspend" ? "active" : "suspended";
      const item = await client.query(
        `UPDATE market_storefronts storefront
            SET status=$2,
                suspended_at=CASE WHEN $2='suspended' THEN now() ELSE NULL END,
                suspension_reason=CASE WHEN $2='suspended' THEN $3 ELSE NULL END,
                updated_at=now()
          WHERE storefront.id=$1 AND storefront.status=$4
            AND ($2='suspended' OR (
              EXISTS (SELECT 1 FROM market_memberships membership WHERE membership.id=storefront.provider_membership_id AND membership.status='active')
              AND EXISTS (SELECT 1 FROM market_storefront_subscriptions subscription
                           WHERE subscription.storefront_id=storefront.id AND subscription.status='active' AND subscription.expires_at>now())
            ))
          RETURNING id,market_identity_id`,
        [id.data, targetStatus, parsed.data.reason, currentStatus]
      );
      if (!item.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Storefront cannot ${action} from its current state`, code: "MARKET_STOREFRONT_TRANSITION_DENIED" });
      }
      await writeMarketAudit({
        client, marketIdentityId: item.rows[0].market_identity_id, operatorAssignmentId: assignmentId,
        storefrontId: item.rows[0].id, actorType: "market_operator", actorIdentityId: req.marketIdentity.id,
        eventType: `market.storefront.${action === "suspend" ? "suspended" : "reactivated"}`, outcome: "success",
        detail: { reason: parsed.data.reason }, ipAddress: req.ip || null,
      });
      await client.query("COMMIT");
      res.json({ item: await storefrontSnapshot(item.rows[0].market_identity_id) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }));
}

module.exports = router;
