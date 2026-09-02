"use strict";

async function resolveAssignment(client, organizationId, employeeId, values) {
  const departmentId = values.departmentId || null;
  const positionId = values.positionId || null;
  const managerEmployeeId = values.managerEmployeeId || null;

  if (managerEmployeeId === employeeId) {
    const error = new Error("An employee cannot manage their own assignment");
    error.code = "ASSIGNMENT_SELF_MANAGER";
    throw error;
  }

  let resolvedDepartmentId = departmentId;
  if (positionId) {
    const position = await client.query(
      "SELECT department_id FROM positions WHERE organization_id=$1 AND id=$2 AND active=true",
      [organizationId, positionId]
    );
    if (!position.rowCount) {
      const error = new Error("Position is unavailable");
      error.code = "ASSIGNMENT_POSITION_INVALID";
      throw error;
    }
    const positionDepartmentId = position.rows[0].department_id;
    if (resolvedDepartmentId && positionDepartmentId && resolvedDepartmentId !== positionDepartmentId) {
      const error = new Error("Position belongs to another organization unit");
      error.code = "ASSIGNMENT_POSITION_UNIT_MISMATCH";
      throw error;
    }
    resolvedDepartmentId ||= positionDepartmentId;
  }

  return { departmentId:resolvedDepartmentId, positionId, managerEmployeeId };
}

async function syncPrimaryAssignment(client, {
  organizationId,
  employeeId,
  departmentId = null,
  positionId = null,
  managerEmployeeId = null,
  actorUserId = null,
  source = "manual",
  note = "",
}) {
  const resolved = await resolveAssignment(client, organizationId, employeeId, {
    departmentId, positionId, managerEmployeeId,
  });
  const current = await client.query(
    `SELECT id,organization_unit_id,position_id,manager_employee_id
       FROM employee_assignments
      WHERE organization_id=$1 AND employee_id=$2
        AND assignment_type_code='primary' AND status='active'
      FOR UPDATE`,
    [organizationId, employeeId]
  );
  const old = current.rows[0];
  const unchanged = old
    && old.organization_unit_id === resolved.departmentId
    && old.position_id === resolved.positionId
    && old.manager_employee_id === resolved.managerEmployeeId;

  if (!unchanged && old) {
    await client.query(
      `UPDATE employee_assignments
          SET status='ended',effective_to=GREATEST(effective_from,CURRENT_DATE),
              ended_by=$3,updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [organizationId, old.id, actorUserId]
    );
  }

  let assignmentId = old?.id || null;
  if (!unchanged && (resolved.departmentId || resolved.positionId || resolved.managerEmployeeId)) {
    const inserted = await client.query(
      `INSERT INTO employee_assignments(
         organization_id,employee_id,organization_unit_id,position_id,manager_employee_id,
         assignment_type_code,status,effective_from,source,note,created_by
       ) VALUES($1,$2,$3,$4,$5,'primary','active',CURRENT_DATE,$6,$7,$8)
       RETURNING id`,
      [organizationId, employeeId, resolved.departmentId, resolved.positionId,
        resolved.managerEmployeeId, source, note, actorUserId]
    );
    assignmentId = inserted.rows[0].id;
  } else if (!unchanged) {
    assignmentId = null;
  }

  await client.query(
    `UPDATE employees
        SET department_id=$3,position_id=$4,manager_employee_id=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, employeeId, resolved.departmentId, resolved.positionId, resolved.managerEmployeeId]
  );
  await client.query(
    `UPDATE users SET department_id=$3,position_id=$4,updated_at=now()
      WHERE organization_id=$1 AND employee_id=$2`,
    [organizationId, employeeId, resolved.departmentId, resolved.positionId]
  );

  return { assignmentId, changed:!unchanged, ...resolved };
}

async function applyPrimaryAssignmentChange(client, {
  organizationId,employeeId,expectedAssignmentId,departmentId=null,positionId=null,
  managerEmployeeId=null,effectiveFrom,effectiveTo=null,actorUserId,source="system",note="",
}) {
  const resolved=await resolveAssignment(client,organizationId,employeeId,{departmentId,positionId,managerEmployeeId});
  const today=String((await client.query("SELECT CURRENT_DATE::text value")).rows[0].value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom||""))||String(effectiveFrom)>today){
    const error=new Error("ASSIGNMENT_EFFECTIVE_DATE_NOT_REACHED");error.code="ASSIGNMENT_EFFECTIVE_DATE_NOT_REACHED";throw error;
  }
  const current=(await client.query(`SELECT * FROM employee_assignments
    WHERE organization_id=$1 AND employee_id=$2 AND assignment_type_code='primary' AND status='active' FOR UPDATE`,
  [organizationId,employeeId])).rows[0];
  if(!current||current.id!==expectedAssignmentId){const error=new Error("ASSIGNMENT_SOURCE_CONFLICT");error.code="ASSIGNMENT_SOURCE_CONFLICT";throw error}
  await client.query(`UPDATE employee_assignments SET status='ended',
    effective_to=GREATEST(effective_from,$3::date-1),ended_by=$4,updated_at=now()
    WHERE organization_id=$1 AND id=$2`,[organizationId,current.id,effectiveFrom,actorUserId]);
  const inserted=(await client.query(`INSERT INTO employee_assignments(
    organization_id,employee_id,organization_unit_id,position_id,manager_employee_id,
    assignment_type_code,status,effective_from,effective_to,source,note,created_by
  ) VALUES($1,$2,$3,$4,$5,'primary','active',$6,$7,$8,$9,$10) RETURNING *`,[
    organizationId,employeeId,resolved.departmentId,resolved.positionId,resolved.managerEmployeeId,
    effectiveFrom,effectiveTo,source,note,actorUserId,
  ])).rows[0];
  await client.query("UPDATE employees SET department_id=$3,position_id=$4,manager_employee_id=$5,updated_at=now() WHERE organization_id=$1 AND id=$2",[
    organizationId,employeeId,resolved.departmentId,resolved.positionId,resolved.managerEmployeeId,
  ]);
  await client.query("UPDATE users SET department_id=$3,position_id=$4,updated_at=now() WHERE organization_id=$1 AND employee_id=$2",[
    organizationId,employeeId,resolved.departmentId,resolved.positionId,
  ]);
  return {assignment:inserted,previousAssignment:current,...resolved};
}

module.exports = { resolveAssignment, syncPrimaryAssignment, applyPrimaryAssignmentChange };
