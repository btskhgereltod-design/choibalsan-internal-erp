"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
const migration=read("migrations/0028_canonical_employees.sql"),employees=read("src/routes/employees.js"),users=read("src/routes/users.js"),attendance=read("src/routes/attendance.js"),businessApi=read("src/routes/business-modules.js");
const accessUi=read("../web/employee-access.js"),settingsUi=read("../web/business-modules.js"),shell=read("../web/index.html");
test("employee identity is tenant-owned and independent from login access",()=>{assert.match(migration,/CREATE TABLE employees/);assert.match(migration,/users ADD COLUMN employee_id/);assert.match(migration,/FOREIGN KEY\(organization_id,employee_id\)/);assert.match(migration,/users_org_employee_account_uidx/)});
test("new employee does not create a shadow login account",()=>{assert.match(employees,/INSERT INTO employees/);assert.doesNotMatch(employees,/employee\.invalid/);assert.match(employees,/INSERT INTO users[\s\S]*employee_id/)});
test("legacy employee data is backfilled without changing employee ids",()=>{assert.match(migration,/SELECT u\.id,u\.organization_id/);assert.match(migration,/UPDATE users SET employee_id=id/)});
test("HR and attendance use canonical employee ids",()=>{assert.match(migration,/attendance_records ADD COLUMN employee_id/);assert.match(attendance,/FROM employees e/);assert.match(attendance,/ON CONFLICT\(organization_id,employee_id,attendance_date\)/);assert.match(users,/INSERT INTO employees/)});
test("login access updates do not change employment role or status",()=>{
  assert.doesNotMatch(users,/UPDATE employees SET full_name=\$1,job_role=\$2,active=\$3/);
  assert.match(users,/UPDATE employees SET full_name=\$1,updated_at=now\(\)/);
});
test("employee access overview is backed by tenant roles and permissions",()=>{
  assert.match(employees,/LEFT JOIN employee_profiles/);
  assert.match(employees,/count\(DISTINCT rp\.permission_code\)/);
  assert.match(employees,/INSERT INTO user_roles/);
});
test("user access management is nested under settings instead of the main sidebar",()=>{
  assert.match(settingsUi,/data-settings-tab="organization"/);
  assert.match(settingsUi,/data-settings-tab="access"/);
  assert.match(settingsUi,/accessManagementContent\(\)/);
  assert.match(accessUi,/state\.settingsTab="access"/);
  assert.match(accessUi,/employeeAccessSetViewBefore\("settings"\)/);
  assert.match(shell,/id="usersNav"[^>]*display:none!important/);
});
test("audit journal is a primary-admin settings tab instead of a sidebar workspace",()=>{
  assert.match(settingsUi,/data-settings-tab="audit"/);
  assert.match(settingsUi,/auditSettingsContent\(\)/);
  assert.match(accessUi,/state\.settingsTab==="audit"/);
  assert.match(shell,/id="auditNav"[^>]*display:none!important/);
});
test("organization structure mutations require the primary-admin system role",()=>{
  assert.match(businessApi,/post\("\/structure\/departments", primaryAdmin/);
  assert.match(businessApi,/post\("\/structure\/positions", primaryAdmin/);
  assert.match(businessApi,/patch\("\/structure\/users\/:id", primaryAdmin/);
  assert.doesNotMatch(businessApi,/\/structure\/(?:departments|positions|users\/:id)"[^\n]*requireRoles\("director"\)/);
});
