"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { signAccessToken } = require("../security/token");
const { authenticate } = require("../middleware/auth");
const { writeSecurityAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const subjectHash = value => crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
const loginSchema = z.object({
  organization: z.string().trim().min(2).max(80),
  identifier: z.string().trim().min(2).max(200),
  password: z.string().min(8).max(200),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(12).max(200),
});
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу." },
});

router.post("/login", loginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Нэвтрэх мэдээллээ бүрэн, зөв оруулна уу." });
    const { organization, identifier, password } = parsed.data;
    const result = await getPool().query(
      `SELECT u.id, u.password_hash, u.email, u.username, u.full_name, u.role,
              u.organization_id, o.slug AS organization_slug, o.name AS organization_name,
              s.plan_code,s.status AS subscription_status,s.ends_at AS subscription_ends_at
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
         JOIN subscriptions s ON s.organization_id=o.id
        WHERE o.slug = lower($1) AND o.status = 'active' AND u.active = true AND u.can_login = true
          AND s.status IN ('trial','active','past_due')
          AND (s.ends_at IS NULL OR s.ends_at > now() OR s.status='past_due')
          AND (lower(u.email) = lower($2) OR lower(u.username) = lower($2))
        LIMIT 1`,
      [organization, identifier]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      const organizationResult = user ? { rows: [{ id: user.organization_id }] } : await getPool().query(
        "SELECT id FROM organizations WHERE slug=lower($1) LIMIT 1", [organization]
      );
      await writeSecurityAudit({
        organizationId: organizationResult.rows[0]?.id || null,
        actorType: "anonymous",
        action: "auth.login",
        outcome: "failure",
        subjectHash: subjectHash(`${organization}:${identifier}`),
        ipAddress: req.ip || null,
      });
      return res.status(401).json({ error: "Байгууллагын код, хэрэглэгчийн нэр эсвэл нууц үг буруу байна." });
    }
    await getPool().query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES ($1,$2,'auth.login','user',$2::uuid::text,'{}'::jsonb,$3)`,
      [user.organization_id,user.id,req.ip||null]
    );
    await writeSecurityAudit({
      organizationId: user.organization_id,
      actorType: "tenant_user",
      actorId: user.id,
      action: "auth.login",
      outcome: "success",
      subjectHash: subjectHash(`${organization}:${identifier}`),
      ipAddress: req.ip || null,
    });
    delete user.password_hash;
    res.json({ token: signAccessToken(user.id), user });
  })
);

router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

router.post("/logout", authenticate, asyncHandler(async (req, res) => {
  await writeSecurityAudit({
    organizationId: req.user.organization_id,
    actorType: "tenant_user",
    actorId: req.user.id,
    action: "auth.logout",
    outcome: "success",
    ipAddress: req.ip || null,
  });
  res.status(204).end();
}));

router.post("/change-password", authenticate, rateLimit({ windowMs: 15 * 60 * 1000, limit: 5 }),
  asyncHandler(async (req, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "New password must be at least 12 characters" });
    const current = await getPool().query(
      "SELECT password_hash FROM users WHERE organization_id=$1 AND id=$2 AND active=true",
      [req.user.organization_id, req.user.id]
    );
    if (!current.rowCount || !(await bcrypt.compare(parsed.data.currentPassword, current.rows[0].password_hash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    if (await bcrypt.compare(parsed.data.newPassword, current.rows[0].password_hash)) {
      return res.status(409).json({ error: "New password must be different" });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await getPool().query("UPDATE users SET password_hash=$1,updated_at=now() WHERE organization_id=$2 AND id=$3",
      [passwordHash, req.user.organization_id, req.user.id]);
    await getPool().query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES ($1::uuid,$2::uuid,'user.password_change','user',$2::uuid::text,'{}'::jsonb,$3)`,
      [req.user.organization_id, req.user.id, req.ip || null]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
