"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname,"..",file),"utf8");
const migration = read("migrations/0038_core_hr_operations.sql");
const skillCategoryMigration = read("migrations/0039_organization_skill_category.sql");
const route = read("src/routes/hr-operations.js");
const attachments = read("src/routes/attachments.js");
const attendance = read("src/routes/attendance.js");
const ui = read("../web/administration.js");

test("Core HR operations extend the canonical employee master", () => {
  for (const table of ["hr_leave_requests","hr_work_schedules","employee_schedule_assignments","attendance_correction_requests","employee_skills","employee_training_records","employee_performance_reviews","employee_transition_checklists"]) {
    assert.match(migration,new RegExp(`CREATE TABLE ${table}`));
  }
  assert.doesNotMatch(migration,/CREATE TABLE hr_employees/);
  assert.match(migration,/REFERENCES employees\(organization_id,id\)/g);
});

test("HR approval and correction histories are append-only and audited", () => {
  for (const table of ["hr_leave_events","employee_schedule_assignments","attendance_correction_events"]) {
    assert.match(migration,new RegExp(`${table}_append_only`));
  }
  for (const action of ["hr.leave.requested","hr.leave.${parsed.data.decision}","hr.attendance_correction.requested","hr.attendance_correction.${parsed.data.decision}"]) {
    assert.ok(route.includes(action),`missing ${action}`);
  }
  assert.match(attendance,/ATTENDANCE_CORRECTION_REQUIRED/);
  assert.doesNotMatch(attendance,/DELETE FROM attendance_records/);
});

test("Employee skills and files do not depend on a login account", () => {
  assert.match(migration,/CREATE TABLE employee_skills/);
  assert.match(migration,/employee_id UUID NOT NULL/);
  assert.match(attachments,/employees:"employees"/);
  assert.match(attachments,/employee_id/);
  assert.match(attachments,/Personnel-file attachments are retained as history/);
  assert.match(skillCategoryMigration,/ADD COLUMN IF NOT EXISTS category/);
  assert.match(skillCategoryMigration,/organization_skills_org_category_name_idx/);
});

test("Core HR is presented as a single tabbed workspace", () => {
  for (const marker of ["hr-workspace-tabs","hrLeaveForm","hrCorrectionForm","hrScheduleForm","hrEmployeeSkillForm","hrTrainingForm","hrPerformanceForm","hrChecklistForm"]) {
    assert.match(ui,new RegExp(marker));
  }
  assert.match(ui,/\/api\/hr\/operations/);
  assert.match(ui,/function hrOperationsHeader\(title,description\)\{return `\$\{hrWorkspaceTabs\(\)\}\$\{header\(/);
});
