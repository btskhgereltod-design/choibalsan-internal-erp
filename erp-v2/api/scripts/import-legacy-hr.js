"use strict";

require("dotenv").config();
const crypto = require("node:crypto");
const { getPool, closePool } = require("../src/db");

const dryRun = process.argv.includes("--dry-run");
const base64Input = process.argv.includes("--base64");
const organizationSlug = process.env.IMPORT_ORG_SLUG;

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const json = base64Input ? Buffer.from(input.trim(), "base64").toString("utf8") : input;
        resolve(JSON.parse(json));
      }
      catch (error) { reject(new Error(`Invalid import JSON: ${error.message}`)); }
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

function integer(value) {
  const result = number(value);
  return result === null ? null : Math.max(0, Math.trunc(result));
}

function date(value) {
  const result = text(value);
  return result && /^\d{4}-\d{2}-\d{2}/.test(result) ? result.slice(0, 10) : null;
}

function bounded(value, minimum, maximum, fallback = 0) {
  const parsed = number(value);
  if (parsed === null) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function legacyStatus(record) {
  const mapping = {
    "Ажилласан": "worked",
    "Ажил тасалсан": "absent",
    "Чөлөө": "leave",
    "Өвчтэй": "sick",
    "Ээлжийн амралт": "vacation",
    "Хоцорсон": "late",
    "Илүү цаг": "worked",
  };
  const status = mapping[text(record.record_type)];
  if (!status) throw new Error(`Unsupported attendance type at legacy record ${record.legacy_record_id}`);
  return status;
}

function attendanceHours(record, status) {
  const hasHours = [record.work_hours, record.leave_hours, record.overtime_hours]
    .some((value) => value !== null && value !== undefined && value !== "");
  if (!hasHours) {
    return {
      work: ["worked", "late"].includes(status) ? 8 : 0,
      leave: ["absent", "leave", "sick", "vacation"].includes(status) ? 8 : 0,
      overtime: 0,
    };
  }
  const work = bounded(record.work_hours, 0, 8);
  const leave = bounded(record.leave_hours, 0, 8);
  return {
    work: Math.min(work, 8 - leave),
    leave,
    overtime: bounded(record.overtime_hours, 0, 16),
  };
}

async function main() {
  if (!organizationSlug) throw new Error("IMPORT_ORG_SLUG is required");
  const payload = await readStdin();
  if (payload?.source !== "overva-legacy-hr-import-v1") throw new Error("Unexpected import source");
  if (!Array.isArray(payload.people) || !Array.isArray(payload.attendance)) throw new Error("Invalid HR import payload");

  const legacyIds = new Set();
  for (const person of payload.people) {
    const legacyId = integer(person.legacy_user_id);
    if (!legacyId || legacyIds.has(legacyId)) throw new Error(`Invalid or duplicate legacy employee id: ${person.legacy_user_id}`);
    legacyIds.add(legacyId);
  }

  const pool = getPool();
  const client = await pool.connect();
  const report = {
    sourcePeople: payload.people.length,
    matchedPeople: 0,
    profilesEnriched: 0,
    attendanceSource: payload.attendance.length,
    attendanceInserted: 0,
    attendanceUpdated: 0,
    attendanceManualPreserved: 0,
  };

  try {
    await client.query("BEGIN");
    const organization = await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE", [organizationSlug]);
    if (organization.rowCount !== 1) throw new Error(`Organization not found: ${organizationSlug}`);
    const organizationId = organization.rows[0].id;

    const actor = await client.query(
      `SELECT id FROM users
        WHERE organization_id=$1 AND active=true AND role IN ('owner','administrator','director')
        ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'administrator' THEN 2 ELSE 3 END,created_at
        LIMIT 1`,
      [organizationId],
    );
    const actorId = actor.rows[0]?.id || null;

    const employeeByLegacyId = new Map();
    for (const raw of payload.people) {
      const legacyId = integer(raw.legacy_user_id);
      const match = await client.query(
        `SELECT ep.id AS profile_id,ep.employee_id,ep.user_id
           FROM employee_profiles ep
           JOIN employees e ON e.organization_id=ep.organization_id AND e.id=ep.employee_id
          WHERE ep.organization_id=$1 AND ep.legacy_user_id=$2
          FOR UPDATE`,
        [organizationId, legacyId],
      );
      if (match.rowCount !== 1) throw new Error(`Legacy employee ${legacyId} is not mapped exactly once in OVERVA`);
      const { employee_id: employeeId, user_id: userId } = match.rows[0];
      employeeByLegacyId.set(legacyId, { employeeId, userId });
      report.matchedPeople += 1;

      await client.query(
        `UPDATE employee_profiles SET
           register_no=COALESCE(NULLIF(register_no,''),$3),
           address=COALESCE(NULLIF(address,''),$4,$5),
           phone=COALESCE(NULLIF(phone,''),$6),
           hire_date=COALESCE(hire_date,$7),
           contract_type=COALESCE(NULLIF(contract_type,''),$8),
           contract_end=COALESCE(contract_end,$9),
           salary=COALESCE(salary,$10),
           status_hr=COALESCE(NULLIF(status_hr,''),$11),
           job_category=COALESCE(NULLIF(job_category,''),$12),
           education=COALESCE(NULLIF(education,''),$13),
           gender=COALESCE(NULLIF(gender,''),$14),
           birthdate=COALESCE(birthdate,$15),
           nationality=COALESCE(NULLIF(nationality,''),$16),
           emergency_contact=COALESCE(NULLIF(emergency_contact,''),$17),
           contract_scan_url=COALESCE(NULLIF(contract_scan_url,''),$18),
           avatar_url=COALESCE(NULLIF(avatar_url,''),$19),
           skill_allowance_rate=COALESCE(skill_allowance_rate,$20),
           skill_allowance=COALESCE(skill_allowance,$21),
           meal_allowance=COALESCE(meal_allowance,$22),
           tenure_years=COALESCE(tenure_years,$23),
           tenure_allowance_rate=COALESCE(tenure_allowance_rate,$24),
           tenure_allowance=COALESCE(tenure_allowance,$25),
           haot_exempt=COALESCE(haot_exempt,$26),
           work_condition=COALESCE(NULLIF(work_condition,''),$27),
           family_status=COALESCE(NULLIF(family_status,''),$28,''),
           spouse_name=COALESCE(NULLIF(spouse_name,''),$29),
           children_count=COALESCE(children_count,$30),
           children_names=COALESCE(NULLIF(children_names,''),$31),
           diploma=COALESCE(NULLIF(diploma,''),$32),
           professional_cert=COALESCE(NULLIF(professional_cert,''),$33),
           id_card_no=COALESCE(NULLIF(id_card_no,''),$34),
           job_description=COALESCE(NULLIF(job_description,''),$35,''),
           contract_no=COALESCE(NULLIF(contract_no,''),$36,''),
           contract_date=COALESCE(contract_date,$37),
           contract_notes=COALESCE(NULLIF(contract_notes,''),$38),
           updated_at=now()
         WHERE organization_id=$1 AND employee_id=$2`,
        [organizationId,employeeId,text(raw.register_no),text(raw.address),text(raw.home_address),text(raw.phone),date(raw.hire_date),
          text(raw.contract_type),date(raw.contract_end),number(raw.salary),text(raw.status_hr),text(raw.job_category),text(raw.education),
          text(raw.gender),date(raw.birthdate),text(raw.nationality),text(raw.emergency_contact),text(raw.contract_scan_url),text(raw.avatar_url),
          number(raw.skill_allowance_rate),number(raw.skill_allowance),number(raw.meal_allowance),number(raw.tenure_years),number(raw.tenure_allowance_rate),
          number(raw.tenure_allowance),Boolean(raw.haot_exempt),text(raw.work_condition),text(raw.family_status),text(raw.spouse_name),integer(raw.children_count),
          text(raw.children_names),text(raw.diploma),text(raw.professional_cert),text(raw.id_card_no),text(raw.job_description),text(raw.contract_no),
          date(raw.contract_date),text(raw.contract_notes)],
      );
      report.profilesEnriched += 1;
    }

    for (const raw of payload.attendance) {
      const legacyId = integer(raw.legacy_user_id);
      const match = employeeByLegacyId.get(legacyId);
      if (!match) throw new Error(`Attendance references an unmapped legacy employee: ${legacyId}`);
      const attendanceDate = date(raw.start_date);
      if (!attendanceDate || (date(raw.end_date) && date(raw.end_date) !== attendanceDate)) {
        throw new Error(`Unsupported attendance date range at legacy record ${raw.legacy_record_id}`);
      }
      const status = legacyStatus(raw);
      const hours = attendanceHours(raw, status);
      const existing = await client.query(
        `SELECT id,source FROM attendance_records
          WHERE organization_id=$1 AND employee_id=$2 AND attendance_date=$3
          FOR UPDATE`,
        [organizationId, match.employeeId, attendanceDate],
      );
      if (existing.rowCount && existing.rows[0].source !== "import") {
        report.attendanceManualPreserved += 1;
        continue;
      }
      if (existing.rowCount) {
        await client.query(
          `UPDATE attendance_records SET user_id=$1,status=$2,work_hours=$3,leave_hours=$4,
             overtime_hours=$5,note=$6,updated_by=$7,updated_at=now()
           WHERE organization_id=$8 AND id=$9`,
          [match.userId,status,hours.work,hours.leave,hours.overtime,text(raw.note) || "",actorId,organizationId,existing.rows[0].id],
        );
        report.attendanceUpdated += 1;
      } else {
        await client.query(
          `INSERT INTO attendance_records(
             organization_id,user_id,employee_id,attendance_date,status,work_hours,leave_hours,
             overtime_hours,note,source,created_by,updated_by
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'import',$10,$10)`,
          [organizationId,match.userId,match.employeeId,attendanceDate,status,hours.work,hours.leave,hours.overtime,text(raw.note) || "",actorId],
        );
        report.attendanceInserted += 1;
      }
    }

    const checksum = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,detail)
       VALUES($1,$2,'hr.legacy_import',$3,$4::jsonb)`,
      [organizationId,actorId,"hr_import",JSON.stringify({
        source: payload.source,
        checksum,
        people: report.sourcePeople,
        attendance: report.attendanceSource,
        inserted: report.attendanceInserted,
        updated: report.attendanceUpdated,
        manualPreserved: report.attendanceManualPreserved,
        dryRun,
      })],
    );

    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "import", ...report }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
