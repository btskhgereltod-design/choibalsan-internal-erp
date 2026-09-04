"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireRoles, requireSystemRoles } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { syncPrimaryAssignment } = require("../services/employee-assignment");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const ROLES = ["director", "chief_engineer", "accountant", "hr", "storekeeper", "engineer", "electric", "safety", "camera_engineer", "worker"];
const optionalUuid = z.union([z.string().uuid(), z.literal(""), z.null()]).optional();
const employeeSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  employeeNo: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).default("worker"),
  departmentId: optionalUuid,
  positionId: optionalUuid,
  managerUserId: optionalUuid,
});
const accessSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]+$/).min(3).max(80),
  role: z.enum(ROLES),
  password: z.string().min(12).max(200),
});

function managedRoleCodes(role) {
  const codes = ["member"];
  if (["director", "chief_engineer", "accountant", "hr"].includes(role)) codes.splice(0, 1, "manager");
  if (role === "hr") codes.push("hr-officer");
  if (role === "safety") codes.push("safety-officer", "work-order-safety-reviewer");
  if (["director", "chief_engineer"].includes(role)) codes.push("work-order-manager", "lighting-incident-supervisor", "camera-incident-supervisor");
  if (["engineer", "electric"].includes(role)) codes.push("work-order-coordinator", "lighting-incident-reporter");
  if (role === "camera_engineer") codes.push("work-order-coordinator", "camera-incident-reporter");
  if (role === "storekeeper") codes.push("work-order-material-custodian", "inventory-custodian");
  if (["chief_engineer", "accountant"].includes(role)) codes.push("inventory-observer");
  if (role === "accountant") codes.push("finance-accountant");
  return codes;
}

async function syncManagedRoles(client, organizationId, userId, role) {
  await client.query(
    `DELETE FROM user_roles ur USING organization_roles r
      WHERE ur.organization_id=$1 AND ur.user_id=$2
        AND r.organization_id=ur.organization_id AND r.id=ur.role_id
        AND r.code IN('administrator','manager','member','hr-officer','safety-officer','work-order-manager','work-order-safety-reviewer','work-order-coordinator','work-order-material-custodian','finance-accountant','inventory-custodian','inventory-observer','lighting-incident-reporter','lighting-incident-supervisor','camera-incident-reporter','camera-incident-supervisor')`,
    [organizationId, userId]
  );
  await client.query(
    `INSERT INTO user_roles(organization_id,user_id,role_id)
     SELECT $1,$2,id FROM organization_roles
      WHERE organization_id=$1 AND code=ANY($3::text[])
     ON CONFLICT DO NOTHING`,
    [organizationId, userId, managedRoleCodes(role)]
  );
}

router.use(authenticate, requireRoles("director"));

router.get("/", asyncHandler(async (req, res) => {
  const organizationId = req.user.organization_id;
  const [employees, departments, positions] = await Promise.all([
    getPool().query(
      `SELECT e.id,e.full_name,e.job_role AS role,e.active,e.employee_no,e.department_id,e.position_id,
              e.manager_employee_id AS manager_user_id,d.name AS department_name,p.title AS position_title,
              m.full_name AS manager_name,u.id AS user_id,COALESCE(u.can_login,false) AS can_login,
              COALESCE(u.active,false) AS account_active,u.email,u.username,u.role AS access_role,
              ep.phone,ep.register_no,
              COALESCE(access.system_roles,'{}'::text[]) AS system_roles,
              COALESCE(access.role_names,'{}'::text[]) AS access_role_names,
              COALESCE(access.permission_count,0) AS permission_count
         FROM employees e
    LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
    LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
    LEFT JOIN employees m ON m.organization_id=e.organization_id AND m.id=e.manager_employee_id
    LEFT JOIN users u ON u.organization_id=e.organization_id AND u.employee_id=e.id
    LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
    LEFT JOIN LATERAL (
              SELECT array_agg(DISTINCT r.code ORDER BY r.code) AS system_roles,
                     array_agg(DISTINCT r.name ORDER BY r.name) AS role_names,
                     count(DISTINCT rp.permission_code)::int AS permission_count
                FROM user_roles ur
                JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id AND r.active=true
           LEFT JOIN organization_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
               WHERE ur.organization_id=e.organization_id AND ur.user_id=u.id
            ) access ON true
        WHERE e.organization_id=$1
        ORDER BY e.active DESC,COALESCE(p.rank_level,500),p.title NULLS LAST,e.full_name`,
      [organizationId]
    ),
    getPool().query("SELECT id,name FROM departments WHERE organization_id=$1 ORDER BY name", [organizationId]),
    getPool().query("SELECT id,title,department_id,rank_level FROM positions WHERE organization_id=$1 ORDER BY rank_level,title", [organizationId]),
  ]);
  res.json({ items: employees.rows, departments: departments.rows, positions: positions.rows, roles: ROLES });
}));

router.post("/", asyncHandler(async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Ажилтны мэдээлэл буруу байна", issues: parsed.error.issues });
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO employees(organization_id,full_name,employee_no,job_role)
       VALUES($1,$2,NULLIF($3,''),$4)
       RETURNING id,full_name,employee_no,job_role AS role,active,department_id,position_id,manager_employee_id AS manager_user_id`,
      [req.user.organization_id, value.fullName, value.employeeNo || null, value.role]
    );
    const assignment = await syncPrimaryAssignment(client, {
      organizationId:req.user.organization_id,
      employeeId:result.rows[0].id,
      departmentId:value.departmentId || null,
      positionId:value.positionId || null,
      managerEmployeeId:value.managerUserId || null,
      actorUserId:req.user.id,
    });
    await writeAudit(req, "employee.create", "employee", result.rows[0].id, {
      fullName:value.fullName, role:value.role, assignmentId:assignment.assignmentId,
    }, client);
    await client.query("COMMIT");
    res.status(201).json({
      item:{ ...result.rows[0], department_id:assignment.departmentId,
        position_id:assignment.positionId, manager_user_id:assignment.managerEmployeeId, can_login:false },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/:id/access", requireSystemRoles("owner"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const parsed = accessSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Нэвтрэх эрхийн мэдээлэл буруу байна", issues: parsed.error?.issues });
  const value = parsed.data;
  const passwordHash = await bcrypt.hash(value.password, 12);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const employee = (await client.query(
      "SELECT * FROM employees WHERE organization_id=$1 AND id=$2 AND active=true FOR UPDATE",
      [req.user.organization_id, id.data]
    )).rows[0];
    if (!employee) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Идэвхтэй ажилтан олдсонгүй" });
    }
    const old = (await client.query(
      "SELECT id,can_login FROM users WHERE organization_id=$1 AND employee_id=$2 FOR UPDATE",
      [req.user.organization_id, id.data]
    )).rows[0];
    if (old?.can_login) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Энэ ажилтан нэвтрэх бүртгэлтэй байна" });
    }
    const result = old
      ? await client.query(
        `UPDATE users SET email=$3,username=$4,password_hash=$5,full_name=$6,role=$7,can_login=true,active=true,
                          department_id=$8,position_id=$9,updated_at=now()
          WHERE organization_id=$1 AND id=$2
          RETURNING id,email,username,full_name,role,active,can_login,employee_id`,
        [req.user.organization_id, old.id, value.email, value.username, passwordHash, employee.full_name, value.role, employee.department_id, employee.position_id]
      )
      : await client.query(
        `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,can_login,person_type,employee_id,department_id,position_id)
         VALUES($1,$2,$3,$4,$5,$6,true,'employee',$7,$8,$9)
         RETURNING id,email,username,full_name,role,active,can_login,employee_id`,
        [req.user.organization_id, value.email, value.username, passwordHash, employee.full_name, value.role, id.data, employee.department_id, employee.position_id]
      );
    await syncManagedRoles(client, req.user.organization_id, result.rows[0].id, value.role);
    await client.query("COMMIT");
    await writeAudit(req, "employee.access_grant", "employee", id.data, {
      userId: result.rows[0].id,
      email: value.email,
      username: value.username,
      role: value.role,
      migratedLegacyAccount: Boolean(old),
    });
    res.json({ item: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
