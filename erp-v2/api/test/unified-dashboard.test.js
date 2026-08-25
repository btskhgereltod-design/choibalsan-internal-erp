"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {organizationScale}=require("../src/routes/dashboard");

const root=path.join(__dirname,"..","..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("organization scale keeps small organizations simple and grows progressively",()=>{
  assert.equal(organizationScale(1).code,"micro");
  assert.equal(organizationScale(9).mode,"essential");
  assert.equal(organizationScale(10).code,"small");
  assert.equal(organizationScale(50).code,"medium");
  assert.equal(organizationScale(250).mode,"enterprise");
});

test("unified dashboard remains tenant scoped and excludes private HR detail",()=>{
  const route=read("api/src/routes/dashboard.js");
  assert.match(route,/organization_id=\$1/);
  assert.match(route,/enabled_modules/);
  assert.doesNotMatch(route,/base_salary|id_card_no|personal_email/);
  assert.match(route,/health:\s*\{ score:/);
});

test("workspace uses adaptive dashboard and keeps onboarding under settings",()=>{
  const workspace=read("web/standard-workspace.js");
  const executive=read("web/executive.js");
  const modules=read("web/business-modules.js");
  const index=read("web/index.html");
  assert.match(workspace,/\/api\/dashboard\/overview/);
  assert.match(workspace,/metricLimit=d\.scale\.code==="micro"\?4/);
  assert.match(workspace,/function startSettingsContent/);
  assert.match(workspace,/function organizationHomeBar/);
  assert.match(workspace,/Өнөөдөр/);
  assert.match(executive,/Чиг хандлага/);
  assert.match(modules,/data-settings-tab="start"/);
  assert.match(index,/Байгууллагын нүүр/);
});

test("executive analysis hides inactive product areas",()=>{
  const executive=read("web/executive.js");
  assert.match(executive,/enabled\.has\("fleet"\)/);
  assert.match(executive,/enabled\.has\("iot"\)/);
  assert.match(executive,/enabled\.has\("inventory"\)/);
});
