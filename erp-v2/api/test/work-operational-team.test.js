"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("work operational participants are tenant scoped and assignment evidence is append only",()=>{
  const migration=read("migrations","0109_work_order_operational_team.sql");
  const release=read("scripts","production-migrate.js");
  assert.match(migration,/CREATE TABLE work_order_participants/);
  assert.match(migration,/participant_role IN\('responsible','executor'\)/);
  assert.match(migration,/work_order_participants_one_responsible_uidx/);
  assert.match(migration,/CREATE TABLE work_order_participant_events/);
  assert.match(migration,/work_order_participant_events_append_only/);
  assert.match(migration,/work_order_participants_tenant_policy/);
  assert.match(migration,/work_order_participant_events_tenant_policy/);
  assert.match(release,/work_order_participant_events/);
});

test("work creation validates canonical employees against the routed department",()=>{
  const route=read("src","routes","work-orders.js");
  assert.match(route,/responsibleEmployeeId/);
  assert.match(route,/executorEmployeeIds/);
  assert.match(route,/FROM employees employee/);
  assert.match(route,/WORK_PARTICIPANT_DEPARTMENT_MISMATCH/);
  assert.match(route,/INCIDENT_WORK_TYPE_DOMAIN_MISMATCH/);
  assert.match(route,/INSERT INTO work_order_participants/);
  assert.match(route,/INSERT INTO work_order_participant_events/);
  assert.match(route,/source:'scope_follow_up'/);
});

test("new work UI separates responsible employee and executing crew by selected department",()=>{
  const app=read("..","web","app.js"),html=read("..","web","index.html"),css=read("..","web","style.css");
  assert.match(html,/id="workOrderResponsibleEmployee"/);
  assert.match(html,/id="workOrderExecutors"/);
  assert.match(app,/state\.workEmployees\.filter\(employee=>employee\.department_id===type\.department_id\)/);
  assert.match(app,/executorEmployeeIds=/);
  assert.match(app,/workTypeOptions\(item\.domain\)/);
  assert.match(app,/workOrderAssetField.*hidden/);
  assert.match(app,/renderWorkParticipants/);
  assert.match(css,/work-team-picker/);
});
