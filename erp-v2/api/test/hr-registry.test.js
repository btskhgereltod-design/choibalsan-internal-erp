"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname,"..",file),"utf8");
const route = read("src/routes/hr.js");
const ui = read("../web/administration.js");
const workspace = read("../web/standard-workspace.js");
const shell = read("../web/index.html");
const lifecycleMigration = read("migrations/0037_hr_lifecycle_foundation.sql");

test("HR registry exposes the imported employee profile without creating duplicate identity data", () => {
  for (const field of ["gender","work_condition","education","contract_type","tenure_years","salary","register_no"]) {
    assert.match(route,new RegExp(`ep\\.${field}`));
  }
  assert.match(route,/FROM employees e/);
  assert.match(route,/LEFT JOIN employee_profiles ep/);
  assert.match(route,/WHERE e\.organization_id=\$1/);
});

test("HR employee creation keeps login access optional and synchronizes the primary assignment", () => {
  assert.match(route,/router\.post\("\/employees"/);
  assert.match(route,/INSERT INTO employees/);
  assert.match(route,/syncPrimaryAssignment/);
  assert.doesNotMatch(route,/INSERT INTO users/);
  assert.match(route,/hr\.employee_create/);
});

test("HR registry UI provides real search, filters, profile editing and legacy-compatible columns", () => {
  for (const marker of ["data-hr-search","data-hr-department","data-hr-status","data-hr-edit","hrEmployeeForm"]) {
    assert.match(ui,new RegExp(marker));
  }
  for (const label of ["Ажлын нөхцөл","Боловсрол","Гэрээ","Ажилласан","Цалин"]) {
    assert.match(ui,new RegExp(label));
  }
});

test("HR is the single people-master workspace when the tenant has HR access", () => {
  assert.match(workspace,/allowed\.has\("hr"\)\?"hr":"employees"/);
  assert.match(workspace,/view==="employees"&&state\.allowedViews\.includes\("hr"\)/);
  assert.match(workspace,/duplicatePeopleEntry=item\.dataset\.view==="employees"&&peopleView==="hr"/);
  assert.match(shell,/id="employeesNav"[^>]+data-view="employees"[^>]*><span>♙<\/span>Ажилтны бүртгэл/);
});

test("HR lifecycle records extend rather than duplicate the canonical employee master", () => {
  for (const table of ["employment_contracts","employee_compensation_history","position_description_versions","employment_lifecycle_events"]) {
    assert.match(lifecycleMigration,new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(lifecycleMigration,/FOREIGN KEY\(organization_id,employee_id\) REFERENCES employees/);
  assert.match(lifecycleMigration,/append_only BEFORE UPDATE OR DELETE/g);
  assert.doesNotMatch(lifecycleMigration,/CREATE TABLE hr_employees/);
});

test("HR API exposes tenant-scoped employee file histories with immutable audits", () => {
  for (const endpoint of ["/employees/:id/file","/employees/:id/contracts","/employees/:id/compensation","/employees/:id/lifecycle","/employees/:id/documents","/positions/:id/descriptions"]) {
    assert.ok(route.includes(endpoint),`missing ${endpoint}`);
  }
  for (const action of ["hr.contract_version_create","hr.compensation_create","hr.lifecycle_transition","hr.employee_document_create","hr.position_description_version_create"]) {
    assert.ok(route.includes(action),`missing audit ${action}`);
  }
  assert.match(route,/Compensation effective dates overlap/);
  assert.match(route,/lifecycleTransitions/);
});

test("HR employee dialog manages versioned lifecycle records", () => {
  for (const marker of ["hrContractForm","hrCompensationForm","hrLifecycleForm","hrDocumentForm","hrPositionDescriptionForm"]) {
    assert.match(ui,new RegExp(marker));
  }
  assert.match(ui,/\/api\/hr\/employees\/\$\{id\}\/file/);
});
