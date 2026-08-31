"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../scripts/import-legacy-employees.js"),"utf8");

test("legacy employee import follows canonical job, employee, and assignment masters",()=>{
  assert.match(source,/INSERT INTO jobs\(organization_id,code,name,metadata\)/);
  assert.match(source,/INSERT INTO positions\(organization_id,department_id,job_id/);
  assert.match(source,/INSERT INTO employees\(organization_id,full_name,job_role,active\)/);
  assert.match(source,/UPDATE users SET employee_id=\$3,person_type='employee'/);
  assert.match(source,/organization_id,user_id,employee_id,legacy_user_id/);
  assert.match(source,/syncPrimaryAssignment\(client,/);
  assert.match(source,/source:"import"/);
});
