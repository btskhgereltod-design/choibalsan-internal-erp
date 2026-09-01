"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("tenant provisioning returns plain organization, owner and subscription records",()=>{
  const service=read("src/services/tenant-provisioning.js");
  assert.match(service,/organization,\s*owner: owner\.rows\[0\],\s*subscription: subscription\.rows\[0\]/s);
});

test("Platform organization creation preserves the flat response contract",()=>{
  const route=read("src/routes/platform.js");
  assert.match(route,/item: \{ \.\.\.organization, \.\.\.subscription \}/);
  assert.doesNotMatch(route,/\.\.\.organization, \.\.\.subscription\.rows\[0\]/);
});

test("broad HTTP fixture uses the canonical tenant provisioning contract",()=>{
  const harness=read("scripts/integration-test.js");
  assert.match(harness,/const \{ provisionTenant \} = require\("\.\.\/src\/services\/tenant-provisioning"\)/);
  assert.match(harness,/const provisioned = await provisionTenant\(client,/);
  assert.doesNotMatch(harness,/INSERT INTO subscriptions\(organization_id, plan_code, status\)/);
});

test("legacy direct status completion keeps its assignee notification contract",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/SELECT id,title,status,assigned_to,workflow_policy_id FROM work_orders/);
  assert.match(route,/parsed\.data\.status==="completed"&&current\.assigned_to\)await notifyUser\(client,\{organizationId:req\.user\.organization_id,userId:current\.assigned_to,type:"work_completed"/);
});
