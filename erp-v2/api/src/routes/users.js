"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireSystemRoles } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const ROLES = ["director", "chief_engineer", "accountant", "hr", "storekeeper", "engineer", "electric", "safety", "camera_engineer", "worker"];
const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]+$/).min(3).max(80),
  fullName: z.string().trim().min(2).max(200),
  role: z.enum(ROLES),
  password: z.string().min(12).max(200),
});
const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, "No changes supplied");
const resetSchema = z.object({ password: z.string().min(12).max(200) });

function managedRoleCodes(role) {
  const codes = [["director", "chief_engineer", "accountant", "hr"].includes(role) ? "manager" : "member"];
  if (role === "hr") codes.push("hr-officer");
  if (role === "safety") codes.push("safety-officer", "work-order-safety-reviewer");
  if (["director", "chief_engineer"].includes(role)) codes.push("work-order-manager");
  if (["engineer", "electric", "camera_engineer"].includes(role)) codes.push("work-order-coordinator");
  if (["storekeeper", "accountant"].includes(role)) codes.push("work-order-material-custodian");
  return codes;
}

async function syncManagedRoles(client, organizationId, userId, role) {
  await client.query(
    `DELETE FROM user_roles ur USING organization_roles r
      WHERE ur.organization_id=$1 AND ur.user_id=$2
        AND r.organization_id=ur.organization_id AND r.id=ur.role_id
        AND r.code IN('administrator','manager','member','hr-officer','safety-officer','work-order-manager','work-order-safety-reviewer','work-order-coordinator','work-order-material-custodian')`,
    [organizationId,userId]
  );
  await client.query(
    `INSERT INTO user_roles(organization_id,user_id,role_id)
     SELECT $1,$2,id FROM organization_roles WHERE organization_id=$1 AND code=ANY($3::text[])
     ON CONFLICT DO NOTHING`,
    [organizationId,userId,managedRoleCodes(role)]
  );
}

router.use(authenticate);

router.get("/assignable", asyncHandler(async (req, res) => {
  const result = await getPool().query(
    `SELECT u.id,u.full_name,u.role,u.department_id,u.employee_id,
            d.name AS department_name,p.title AS position_title
       FROM users u
       LEFT JOIN departments d ON d.organization_id=u.organization_id AND d.id=u.department_id
       LEFT JOIN positions p ON p.organization_id=u.organization_id AND p.id=u.position_id
      WHERE u.organization_id=$1 AND u.active=true AND u.can_login=true
      ORDER BY COALESCE(p.rank_level,500),u.full_name ASC`,
    [req.user.organization_id]
  );
  res.json({ items: result.rows });
}));

router.use(requireSystemRoles("owner"));

router.get("/", asyncHandler(async (req, res) => {
  const result = await getPool().query(
    `SELECT u.id,u.email,u.username,u.full_name,u.role,u.active,u.can_login,u.created_at,u.updated_at
       FROM users u
       LEFT JOIN positions p ON p.organization_id=u.organization_id AND p.id=u.position_id
      WHERE u.organization_id=$1 AND u.can_login=true
      ORDER BY u.active DESC,COALESCE(p.rank_level,500),p.title NULLS LAST,u.full_name`,
    [req.user.organization_id]
  );
  res.json({ items: result.rows, roles: ROLES });
}));

router.post("/", asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid user", issues: parsed.error.issues });
  const value = parsed.data;
  const passwordHash = await bcrypt.hash(value.password, 12);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH employee AS (
         INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,$5,$6) RETURNING id
       )
       INSERT INTO users(organization_id,email,username,password_hash,full_name,role,person_type,can_login,employee_id)
       SELECT $1,$2,$3,$4,$5,$6,'employee',true,id FROM employee
       RETURNING id,email,username,full_name,role,active,created_at,employee_id`,
      [req.user.organization_id,value.email,value.username,passwordHash,value.fullName,value.role]
    );
    await syncManagedRoles(client,req.user.organization_id,result.rows[0].id,value.role);
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES ($1,$2,'user.create','user',$3,$4::jsonb,$5)`,
      [req.user.organization_id, req.user.id, result.rows[0].id,
        JSON.stringify({ email: value.email, role: value.role }), req.ip || null]
    );
    await client.query("COMMIT");
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid user update" });
  if (id.data === req.user.id && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== "director"))) {
    return res.status(409).json({ error: "You cannot remove your own access or director role" });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      "SELECT id,employee_id,full_name,role,active FROM users WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [req.user.organization_id, id.data]
    );
    const current = currentResult.rows[0];
    if (!current) { await client.query("ROLLBACK"); return res.status(404).json({ error: "User not found" }); }

    const next = {
      fullName: parsed.data.fullName ?? current.full_name,
      role: parsed.data.role ?? current.role,
      active: parsed.data.active ?? current.active,
    };
    if (current.role === "director" && current.active && (next.role !== "director" || !next.active)) {
      const directors = await client.query(
        "SELECT count(*)::int AS count FROM users WHERE organization_id=$1 AND role='director' AND active=true",
        [req.user.organization_id]
      );
      if (directors.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "The organization must keep at least one active director" });
      }
    }
    const updated = await client.query(
      `UPDATE users SET full_name=$1, role=$2, active=$3, updated_at=now()
        WHERE organization_id=$4 AND id=$5
        RETURNING id,email,username,full_name,role,active,created_at,updated_at`,
      [next.fullName, next.role, next.active, req.user.organization_id, id.data]
    );
    // A login account is optional access for an employee. Changing account
    // status or access role must never change employment status or position.
    if (current.employee_id && parsed.data.fullName) await client.query(
      `UPDATE employees SET full_name=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [next.fullName, req.user.organization_id, current.employee_id]
    );
    if (parsed.data.role) {
      // Job title and application authority are different domains. Assigning a
      // director job role must never grant the tenant-owner system role.
      await syncManagedRoles(client,req.user.organization_id,id.data,next.role);
    }
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES ($1,$2,'user.update','user',$3,$4::jsonb,$5)`,
      [req.user.organization_id, req.user.id, id.data,
        JSON.stringify({ before: { role: current.role, active: current.active }, after: { role: next.role, active: next.active } }), req.ip || null]
    );
    await client.query("COMMIT");
    res.json({ item: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/:id/reset-password", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = resetSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Password must be at least 12 characters" });
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const result = await getPool().query(
    `UPDATE users SET password_hash=$1, updated_at=now()
      WHERE organization_id=$2 AND id=$3 RETURNING id`,
    [passwordHash, req.user.organization_id, id.data]
  );
  if (!result.rowCount) return res.status(404).json({ error: "User not found" });
  await getPool().query(
    `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
     VALUES ($1,$2,'user.password_reset','user',$3,'{}'::jsonb,$4)`,
    [req.user.organization_id, req.user.id, id.data, req.ip || null]
  );
  res.json({ ok: true });
}));

module.exports = router;
