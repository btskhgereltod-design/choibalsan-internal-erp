"use strict";

require("dotenv").config();
const crypto = require("node:crypto");
const { getPool, closePool } = require("../src/db");
const { syncPrimaryAssignment } = require("../src/services/employee-assignment");

const ROLES = new Set(["director", "chief_engineer", "accountant", "hr", "storekeeper", "engineer", "electric", "safety", "camera_engineer", "worker"]);
const dryRun = process.argv.includes("--dry-run");
const base64Input = process.argv.includes("--base64");
const organizationSlug = process.env.IMPORT_ORG_SLUG || process.env.BOOTSTRAP_ORG_SLUG;

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const json = base64Input ? Buffer.from(input.trim(), "base64").toString("utf8") : input;
        resolve(JSON.parse(json));
      } catch (error) { reject(new Error(`Invalid import JSON: ${error.message}`)); }
    });
    process.stdin.on("error", reject);
  });
}

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function date(value) {
  const result = text(value);
  return result && /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
}

function timestamp(value) {
  const result = text(value);
  if (!result) return null;
  const parsed = new Date(result.includes("T") ? result : `${result.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function code(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 10).toUpperCase()}`;
}

function aliasedEmail(email, legacyId) {
  const at = email.lastIndexOf("@");
  if (at < 1) return `${email}.legacy-${legacyId}@legacy.invalid`;
  return `${email.slice(0, at)}+legacy${legacyId}${email.slice(at)}`;
}

async function findOrCreateDepartment(client, organizationId, name) {
  if (!name) return null;
  const existing = await client.query(
    "SELECT id FROM departments WHERE organization_id=$1 AND lower(name)=lower($2) LIMIT 1",
    [organizationId, name]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const inserted = await client.query(
    "INSERT INTO departments(organization_id,code,name) VALUES ($1,$2,$3) RETURNING id",
    [organizationId, code("LEGACY-DEPT", name), name]
  );
  return inserted.rows[0].id;
}

async function findOrCreatePosition(client, organizationId, departmentId, title) {
  if (!title) return null;
  const existing = await client.query(
    `SELECT id FROM positions WHERE organization_id=$1 AND lower(title)=lower($2)
      AND department_id IS NOT DISTINCT FROM $3::uuid LIMIT 1`,
    [organizationId, title, departmentId]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const positionCode = code("LEGACY-POS", `${departmentId || "none"}:${title}`);
  const jobCode = code("LEGACY-JOB", title);
  const job = await client.query(
    `INSERT INTO jobs(organization_id,code,name,metadata)
     VALUES($1,$2,$3,'{"source":"legacy_demo_import"}'::jsonb)
     ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,updated_at=now()
     RETURNING id`,
    [organizationId, jobCode, title]
  );
  const inserted = await client.query(
    `INSERT INTO positions(organization_id,department_id,job_id,code,title,rank_level,metadata)
     VALUES ($1,$2,$3,$4,$5,10,'{"source":"legacy_demo_import"}'::jsonb) RETURNING id`,
    [organizationId, departmentId, job.rows[0].id, positionCode, title]
  );
  return inserted.rows[0].id;
}

async function main() {
  const payload = await readStdin();
  if (!["overva-legacy-employee-import-v1","choibalsan-legacy"].includes(payload.source) || !Array.isArray(payload.employees)) throw new Error("Unexpected import source");
  if (!organizationSlug) throw new Error("IMPORT_ORG_SLUG is required");
  if (payload.employees.length !== 21) throw new Error(`Expected 21 active employees, received ${payload.employees.length}`);
  const emailCounts = payload.employees.reduce((counts, item) => {
    const email = text(item.email)?.toLowerCase();
    if (email) counts.set(email, (counts.get(email) || 0) + 1);
    return counts;
  }, new Map());
  const pool = getPool();
  const client = await pool.connect();
  const report = { source: payload.employees.length, inserted: 0, matched: 0, departments: new Set(), positions: new Set(), loginDisabled: 0 };
  try {
    await client.query("BEGIN");
    const organization = await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE", [organizationSlug]);
    if (!organization.rowCount) throw new Error(`Organization not found: ${organizationSlug}`);
    const organizationId = organization.rows[0].id;

    for (const raw of payload.employees) {
      const username = text(raw.username)?.toLowerCase();
      const personalEmail = text(raw.email)?.toLowerCase();
      const email = emailCounts.get(personalEmail) > 1 ? aliasedEmail(personalEmail, raw.id) : personalEmail;
      const fullName = text(raw.full_name);
      if (!username || !email || !fullName || !/^\$2[aby]\$/.test(String(raw.password_hash || ""))) {
        throw new Error(`Invalid legacy employee record: ${raw.id}`);
      }
      const conflict = await client.query(
        `SELECT id,full_name,username,email,role FROM users WHERE organization_id=$1
          AND (lower(username)=lower($2) OR lower(email)=lower($3)) FOR UPDATE`,
        [organizationId, username, email]
      );
      let userId;
      const departmentName = text(raw.department);
      const positionTitle = text(raw.position);
      const departmentId = await findOrCreateDepartment(client, organizationId, departmentName);
      const positionId = await findOrCreatePosition(client, organizationId, departmentId, positionTitle);
      if (departmentName) report.departments.add(departmentName.toLowerCase());
      if (positionTitle) report.positions.add(`${departmentName || ""}:${positionTitle}`.toLowerCase());

      const legacyMatch = await client.query(
        `SELECT ep.user_id AS id,ep.employee_id FROM employee_profiles ep
          WHERE ep.organization_id=$1 AND ep.legacy_user_id=$2 FOR UPDATE`,
        [organizationId, raw.id]
      );
      let employeeId = legacyMatch.rows[0]?.employee_id || null;
      if (legacyMatch.rowCount && legacyMatch.rows[0].id) {
        userId = legacyMatch.rows[0].id;
        report.matched += 1;
        await client.query(
          `UPDATE users SET full_name=$1,role=$2,department_id=$3,position_id=$4,can_login=$5,updated_at=now()
           WHERE organization_id=$6 AND id=$7`,
          [fullName, ROLES.has(raw.role) ? raw.role : "worker", departmentId, positionId,
            Boolean(raw.can_login), organizationId, userId]
        );
      } else if (conflict.rowCount) {
        const existing = conflict.rows[0];
        const sameName = existing.full_name.trim().toLowerCase() === fullName.toLowerCase();
        const sameEmailAndRole = existing.email.trim().toLowerCase() === email && existing.role === raw.role;
        if (conflict.rowCount !== 1 || (!sameName && !sameEmailAndRole)) {
          throw new Error(`Username/email conflict for legacy employee ${raw.id}`);
        }
        userId = existing.id;
        report.matched += 1;
        await client.query(
          `UPDATE users SET full_name=$1,role=$2,department_id=$3,position_id=$4,can_login=$5,updated_at=now()
           WHERE organization_id=$6 AND id=$7`,
          [fullName, ROLES.has(raw.role) ? raw.role : "worker", departmentId, positionId,
            Boolean(raw.can_login), organizationId, userId]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,active,can_login,department_id,position_id)
           VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9) RETURNING id`,
          [organizationId, email, username, raw.password_hash, fullName, ROLES.has(raw.role) ? raw.role : "worker",
            Boolean(raw.can_login), departmentId, positionId]
        );
        userId = inserted.rows[0].id;
        report.inserted += 1;
      }
      if (!raw.can_login) report.loginDisabled += 1;

      if (!employeeId) {
        const linkedEmployee = await client.query(
          "SELECT employee_id FROM users WHERE organization_id=$1 AND id=$2",
          [organizationId, userId]
        );
        employeeId = linkedEmployee.rows[0]?.employee_id || null;
      }
      if (employeeId) {
        await client.query(
          `UPDATE employees SET full_name=$3,job_role=$4,active=true,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, employeeId, fullName, ROLES.has(raw.role) ? raw.role : "worker"]
        );
      } else {
        const employee = await client.query(
          `INSERT INTO employees(organization_id,full_name,job_role,active)
           VALUES($1,$2,$3,true) RETURNING id`,
          [organizationId, fullName, ROLES.has(raw.role) ? raw.role : "worker"]
        );
        employeeId = employee.rows[0].id;
      }
      await client.query(
        `UPDATE users SET employee_id=$3,person_type='employee',department_id=$4,position_id=$5,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, userId, employeeId, departmentId, positionId]
      );
      await syncPrimaryAssignment(client, {
        organizationId, employeeId, departmentId, positionId,
        source:"import", note:"Sanitized legacy demo import",
      });

      await client.query(
        `INSERT INTO employee_profiles(
          organization_id,user_id,employee_id,legacy_user_id,register_no,address,phone,hire_date,contract_type,
          contract_end,salary,status_hr,job_category,education,gender,birthdate,nationality,
          emergency_contact,contract_scan_url,avatar_url,skill_allowance_rate,skill_allowance,
          meal_allowance,tenure_years,tenure_allowance_rate,tenure_allowance,haot_exempt,
          work_condition,legacy_created_at,personal_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         ON CONFLICT (organization_id,legacy_user_id) DO UPDATE SET
          user_id=EXCLUDED.user_id,employee_id=EXCLUDED.employee_id,register_no=EXCLUDED.register_no,address=EXCLUDED.address,
          phone=EXCLUDED.phone,hire_date=EXCLUDED.hire_date,contract_type=EXCLUDED.contract_type,
          contract_end=EXCLUDED.contract_end,salary=EXCLUDED.salary,status_hr=EXCLUDED.status_hr,
          job_category=EXCLUDED.job_category,education=EXCLUDED.education,gender=EXCLUDED.gender,
          birthdate=EXCLUDED.birthdate,nationality=EXCLUDED.nationality,
          emergency_contact=EXCLUDED.emergency_contact,contract_scan_url=EXCLUDED.contract_scan_url,
          avatar_url=EXCLUDED.avatar_url,skill_allowance_rate=EXCLUDED.skill_allowance_rate,
          skill_allowance=EXCLUDED.skill_allowance,meal_allowance=EXCLUDED.meal_allowance,
          tenure_years=EXCLUDED.tenure_years,tenure_allowance_rate=EXCLUDED.tenure_allowance_rate,
          tenure_allowance=EXCLUDED.tenure_allowance,haot_exempt=EXCLUDED.haot_exempt,
          work_condition=EXCLUDED.work_condition,legacy_created_at=EXCLUDED.legacy_created_at,
          personal_email=EXCLUDED.personal_email,updated_at=now()`,
        [organizationId,userId,employeeId,raw.id,text(raw.register_no),text(raw.address),text(raw.phone),date(raw.hire_date),
          text(raw.contract_type),date(raw.contract_end),number(raw.salary),text(raw.status_hr),text(raw.job_category),
          text(raw.education),text(raw.gender),date(raw.birthdate),text(raw.nationality),text(raw.emergency_contact),
          text(raw.contract_scan_url),text(raw.avatar_url),number(raw.skill_allowance_rate),number(raw.skill_allowance),
          number(raw.meal_allowance),number(raw.tenure_years),number(raw.tenure_allowance_rate),
          number(raw.tenure_allowance),Boolean(raw.haot_exempt),text(raw.work_condition),timestamp(raw.created_at),personalEmail]
      );
    }

    await client.query(
      `DELETE FROM positions p WHERE p.organization_id=$1 AND p.code LIKE 'LEGACY-POS-%'
        AND NOT EXISTS(SELECT 1 FROM users u WHERE u.organization_id=p.organization_id AND u.position_id=p.id)`,
      [organizationId]
    );
    await client.query(
      `DELETE FROM departments d WHERE d.organization_id=$1 AND d.code LIKE 'LEGACY-DEPT-%'
        AND NOT EXISTS(SELECT 1 FROM users u WHERE u.organization_id=d.organization_id AND u.department_id=d.id)
        AND NOT EXISTS(SELECT 1 FROM positions p WHERE p.organization_id=d.organization_id AND p.department_id=d.id)`,
      [organizationId]
    );

    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,detail)
       SELECT $1,id,'employee.import','employee_import',$2::jsonb FROM users
       WHERE organization_id=$1 AND role='director' AND active=true ORDER BY created_at LIMIT 1`,
      [organizationId, JSON.stringify({ source: payload.source, employeeCount: report.source, inserted: report.inserted, matched: report.matched })]
    );
    if (dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "import", source: report.source, inserted: report.inserted,
      matched: report.matched, departments: report.departments.size, positions: report.positions.size,
      loginDisabled: report.loginDisabled }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
