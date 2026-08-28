"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { writeSecurityAudit } = require("../services/audit");
const { provisionTenant } = require("../services/tenant-provisioning");
const { ensureGrowthProfile, recordGrowthEvent } = require("../services/growth-journey");
const { asyncHandler } = require("../utils/async-handler");
const { loadConfig } = require("../config");
const { publicCatalog } = require("../services/connectors");

const router = express.Router();
const TRIAL_DAYS = 14;
const trialModuleCodes = Object.freeze([
  "assets", "work-orders", "inventory", "procurement", "hr",
  "attendance", "records", "archive", "finance", "executive",
]);
const reservedSlugs = new Set([
  "admin", "api", "app", "auth", "iot", "map", "status", "www", "overva",
  "support", "help", "billing", "root", "system", "platform", "demo", "test",
]);
const hash = value => crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");

router.get("/connectors", (_req, res) => res.json({ items: publicCatalog(loadConfig()) }));

const trialSchema = z.object({
  organizationName: z.string().trim().min(2).max(200),
  organizationCode: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(50),
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]+$/).min(3).max(80),
  password: z.string().min(12).max(200),
  modules: z.array(z.enum(trialModuleCodes)).max(6).default(["assets", "work-orders", "inventory", "hr"]),
  acceptedTerms: z.literal(true),
  website: z.string().max(0).default(""),
}).strict();

router.post("/trials", rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Энэ сүлжээнээс туршилтын эрх үүсгэх хязгаарт хүрлээ. Дараа дахин оролдоно уу." },
}), asyncHandler(async (req, res) => {
  const parsed = trialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Бүртгэлийн мэдээллээ бүрэн, зөв оруулна уу." });
  }
  const value = parsed.data;
  if (reservedSlugs.has(value.organizationCode)) {
    return res.status(409).json({ error: "Энэ байгууллагын кодыг ашиглах боломжгүй байна." });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`trial:${value.email}:${value.organizationCode}`]);
    const duplicate = await client.query(
      `SELECT EXISTS(SELECT 1 FROM organizations WHERE slug=$1) AS slug_exists,
              EXISTS(SELECT 1 FROM users u JOIN subscriptions s ON s.organization_id=u.organization_id
                       WHERE lower(u.email)=lower($2) AND s.status='trial') AS email_trial_exists`,
      [value.organizationCode, value.email]
    );
    if (duplicate.rows[0].slug_exists) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Энэ байгууллагын код бүртгэлтэй байна." });
    }
    if (duplicate.rows[0].email_trial_exists) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Энэ и-мэйлээр туршилтын эрх аль хэдийн үүссэн байна." });
    }

    const provisioned = await provisionTenant(client, {
      name: value.organizationName,
      slug: value.organizationCode,
      adminName: value.fullName,
      adminEmail: value.email,
      adminUsername: value.username,
      adminPassword: value.password,
      planCode: "pilot",
      trialDays: TRIAL_DAYS,
      enabledModules: value.modules,
    });
    const { organization, owner, subscription } = provisioned;
    const detail = { source: "overva.com", planCode: "pilot", trialDays: TRIAL_DAYS, modules: value.modules };
    await ensureGrowthProfile(client, organization.id, "self_service");
    await recordGrowthEvent(client, {
      organizationId: organization.id,
      eventType: "pilot_started",
      source: "tenant",
      actorUserId: owner.id,
      occurredAt: subscription.starts_at,
      detail,
      idempotencyKey: "pilot:self-signup",
    });
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES($1::uuid,$2::uuid,'trial.self_signup','organization',$1::uuid::text,$3::jsonb,$4)`,
      [organization.id, owner.id, JSON.stringify(detail), req.ip || null]
    );
    await client.query(
      `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
       VALUES(NULL,'trial.self_signup','organization',$1::uuid::text,$2::jsonb,$3)`,
      [organization.id, JSON.stringify({ ...detail, emailHash: hash(value.email) }), req.ip || null]
    );
    await writeSecurityAudit({
      client,
      organizationId: organization.id,
      actorType: "tenant_user",
      actorId: owner.id,
      action: "trial.self_signup",
      outcome: "success",
      subjectHash: hash(value.email),
      detail,
      ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.status(201).json({
      organization: { name: organization.name, code: organization.slug },
      owner: { username: owner.username, email: owner.email },
      trial: { endsAt: subscription.ends_at, days: TRIAL_DAYS },
      loginUrl: "https://app.overva.com",
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ error: "Байгууллагын код эсвэл хэрэглэгчийн мэдээлэл давхардлаа." });
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
module.exports.trialSchema = trialSchema;
module.exports.trialModuleCodes = trialModuleCodes;
module.exports.reservedSlugs = reservedSlugs;
