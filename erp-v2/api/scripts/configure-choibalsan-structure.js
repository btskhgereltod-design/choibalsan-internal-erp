"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");
const { syncPrimaryAssignment } = require("../src/services/employee-assignment");

const ORGANIZATION_SLUG = "choibalsan-hugjil";
const dryRun = process.argv.includes("--dry-run");

// This is a tenant-specific pilot profile. It must never be used as a global
// OVERVA default: other organizations build their own structure.
const POSITION_RULES = new Map([
  ["Захирал", { department: "Захиргаа аж ахуй", rank: 1, manager: null }],
  ["Ерөнхий инженер", { department: "Захиргаа аж ахуй", rank: 2, manager: "Захирал" }],
  ["Ерөнхий нягтлан бодогч", { department: "Захиргаа аж ахуй", rank: 2, manager: "Захирал" }],
  ["Хүний нөөцийн ажилтан", { department: "Захиргаа аж ахуй", rank: 3, manager: "Захирал" }],
  ["Хөдөлмөрийн аюулгүй байдал эрүүл ахуйн ажилтан", { department: "Захиргаа аж ахуй", rank: 3, manager: "Захирал" }],
  ["Нярав", { department: "Захиргаа аж ахуй", rank: 4, manager: "Захирал" }],
  ["Сахиул", { department: "Захиргаа аж ахуй", rank: 6, manager: "Захирал" }],
  ["Цахилгааны инженер", { department: "Цахилгааны тасаг", rank: 3, manager: "Ерөнхий инженер" }],
  ["Цахилгаанчин", { department: "Цахилгааны тасаг", rank: 5, manager: "Цахилгааны инженер" }],
  ["Гагнуурчин", { department: "Цахилгааны тасаг", rank: 5, manager: "Цахилгааны инженер" }],
  ["Кранист", { department: "Цахилгааны тасаг", rank: 5, manager: "Цахилгааны инженер" }],
  ["Туслах ажилчин", { department: "Цахилгааны тасаг", rank: 6, manager: "Цахилгааны инженер" }],
  ["Сүлжээний инженер", { department: "Теле камерийн тасаг", rank: 3, manager: "Ерөнхий инженер" }],
  ["Сүлжээний техникч", { department: "Теле камерийн тасаг", rank: 4, manager: "Сүлжээний инженер" }],
]);

async function oneByTitle(client, organizationId, title) {
  const result = await client.query(
    `SELECT e.id,e.full_name,e.department_id,e.position_id,e.manager_employee_id
       FROM employees e
       JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
      WHERE e.organization_id=$1 AND e.active=true AND p.title=$2`,
    [organizationId, title]
  );
  if (result.rowCount !== 1) {
    throw new Error(`Expected one active employee for position "${title}", found ${result.rowCount}`);
  }
  return result.rows[0];
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  const report = { positionsUpdated: 0, assignmentsChanged: 0, technicalEmployeesDeactivated: 0 };
  try {
    await client.query("BEGIN");
    const organization = await client.query(
      "SELECT id FROM organizations WHERE slug=$1 FOR UPDATE",
      [ORGANIZATION_SLUG]
    );
    if (!organization.rowCount) throw new Error(`Organization not found: ${ORGANIZATION_SLUG}`);
    const organizationId = organization.rows[0].id;

    const departments = await client.query(
      "SELECT id,name FROM departments WHERE organization_id=$1 FOR UPDATE",
      [organizationId]
    );
    const departmentByName = new Map(departments.rows.map(row => [row.name, row.id]));
    for (const name of new Set([...POSITION_RULES.values()].map(rule => rule.department))) {
      if (!departmentByName.has(name)) throw new Error(`Required department is missing: ${name}`);
    }

    const positions = await client.query(
      "SELECT id,title,department_id,rank_level FROM positions WHERE organization_id=$1 FOR UPDATE",
      [organizationId]
    );
    const positionByTitle = new Map(positions.rows.map(row => [row.title, row]));
    for (const [title, rule] of POSITION_RULES) {
      const position = positionByTitle.get(title);
      if (!position) throw new Error(`Required position is missing: ${title}`);
      const departmentId = departmentByName.get(rule.department);
      if (position.department_id !== departmentId || position.rank_level !== rule.rank) {
        await client.query(
          "UPDATE positions SET department_id=$3,rank_level=$4,updated_at=now() WHERE organization_id=$1 AND id=$2",
          [organizationId, position.id, departmentId, rule.rank]
        );
        report.positionsUpdated += 1;
      }
    }

    const realEmployees = await client.query(
      `SELECT e.id,e.full_name,p.title AS position_title
         FROM employees e
         JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
        WHERE e.organization_id=$1 AND e.active=true
        ORDER BY e.full_name`,
      [organizationId]
    );
    if (realEmployees.rowCount !== 21) {
      throw new Error(`Expected 21 active Choibalsan Hugjil employees with positions, found ${realEmployees.rowCount}`);
    }

    const managerByTitle = new Map();
    for (const managerTitle of new Set([...POSITION_RULES.values()].map(rule => rule.manager).filter(Boolean))) {
      managerByTitle.set(managerTitle, await oneByTitle(client, organizationId, managerTitle));
    }

    const actor = await oneByTitle(client, organizationId, "Захирал");
    const actorUser = await client.query(
      "SELECT id FROM users WHERE organization_id=$1 AND employee_id=$2 AND active=true ORDER BY created_at LIMIT 1",
      [organizationId, actor.id]
    );
    const actorUserId = actorUser.rows[0]?.id || null;

    for (const employee of realEmployees.rows) {
      const rule = POSITION_RULES.get(employee.position_title);
      if (!rule) throw new Error(`No structure rule for position: ${employee.position_title}`);
      const result = await syncPrimaryAssignment(client, {
        organizationId,
        employeeId: employee.id,
        departmentId: departmentByName.get(rule.department),
        positionId: positionByTitle.get(employee.position_title).id,
        managerEmployeeId: rule.manager ? managerByTitle.get(rule.manager).id : null,
        actorUserId,
        source: "import",
        note: "Choibalsan Hugjil-ийн баталгаажсан хуучин ERP бүтэц",
      });
      if (result.changed) report.assignmentsChanged += 1;
    }

    const technicalEmployee = await client.query(
      `UPDATE employees e SET active=false,updated_at=now()
        WHERE e.organization_id=$1 AND e.full_name='ERP v2 Administrator' AND e.active=true
          AND e.department_id IS NULL AND e.position_id IS NULL
        RETURNING e.id`,
      [organizationId]
    );
    if (technicalEmployee.rowCount) {
      report.technicalEmployeesDeactivated = technicalEmployee.rowCount;
      await client.query(
        `UPDATE employee_assignments
            SET status='ended',effective_to=GREATEST(effective_from,CURRENT_DATE),ended_by=$3,updated_at=now()
          WHERE organization_id=$1 AND employee_id=$2
            AND assignment_type_code='primary' AND status='active'`,
        [organizationId, technicalEmployee.rows[0].id, actorUserId]
      );
    }

    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
       VALUES($1,$2,'organization.structure.normalized','organization',$3,$4::jsonb)`,
      [organizationId, actorUserId, String(organizationId), JSON.stringify({
        source: "choibalsan-legacy-erp",
        departments: departmentByName.size,
        positions: POSITION_RULES.size,
        employees: realEmployees.rowCount,
        ...report,
      })]
    );

    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", organization: ORGANIZATION_SLUG, ...report }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
