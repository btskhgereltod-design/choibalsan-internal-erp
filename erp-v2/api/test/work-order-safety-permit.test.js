"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("0094 separates reusable safety authority from tenant checklist data",()=>{
  const migration=read("migrations/0094_work_order_safety_permits.sql");
  assert.match(migration,/CREATE TABLE organization_work_safety_templates/);
  assert.match(migration,/CREATE TABLE organization_work_safety_template_routes/);
  assert.match(migration,/CREATE TABLE work_order_safety_reviews/);
  assert.match(migration,/work_order_safety_reviews_append_only/);
  assert.match(migration,/work_order_safety_reviews_tenant_policy/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/WHERE slug='choibalsan-hugjil'/);
  assert.match(migration,/choibalsan-lighting-field-work/);
  assert.match(migration,/choibalsan-camera-field-work/);
  assert.match(migration,/startManagementRequired.*false/);
  assert.match(migration,/FROM \(SELECT id FROM organizations WHERE slug='choibalsan-hugjil'\) tenant/);
});

test("0094 keeps Work Order creation and return notifications compatible",()=>{
  const migration=read("migrations/0094_work_order_safety_permits.sql");
  const route=read("src/routes/work-orders.js");
  for(const type of [
    "work_assigned","review_requested","work_completed","automation_alert",
    "work_order_workflow","work_order_returned",
  ])assert.match(migration,new RegExp(`'${type}'`));
  assert.match(route,/workflowStage.*notifyAuthority/s);
  assert.match(route,/type:"work_order_returned"/);
});

test("safety decisions require structured evidence and share the workflow transaction",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/safetyReviewSchema/);
  assert.match(route,/recordSafetyReview/);
  assert.match(route,/missingChecklist/);
  assert.match(route,/validateActiveStartPermit/);
  assert.match(route,/SAFETY_PERMIT_INVALID/);
  assert.match(route,/setTenantContext\(client,req\.user\.organization_id\)/);
  assert.match(route,/safety_review_id/);
  assert.match(route,/idempotencyKey:z\.string\(\)\.uuid\(\)/);
  assert.match(route,/pg_advisory_xact_lock/);
  assert.match(route,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(route,/await client\.query\("COMMIT"\)/);
});

test("HSE workspace exposes start, completion, monitored queues and structured review UI",()=>{
  const safetyRoute=read("src/routes/safety.js"),safetyClient=read("../web/safety.js"),app=read("../web/app.js"),html=read("../web/index.html");
  assert.match(safetyRoute,/router\.get\("\/work-orders"/);
  assert.match(safetyRoute,/review-context/);
  assert.match(safetyRoute,/withTenantTransaction/);
  assert.match(safetyClient,/Эхлэх зөвшөөрөл/);
  assert.match(safetyClient,/Дуусгалтын шалгалт/);
  assert.match(safetyClient,/Хяналтад буй ажил/);
  assert.match(app,/submitSafetyReview/);
  assert.match(app,/safety_suspend_execution/);
  assert.match(html,/id="workSafetyReviewDialog"/);
  assert.match(html,/id="workSafetyChecklist"/);
});

test("production runtime cannot rewrite safety review evidence",()=>{
  const script=read("scripts/production-migrate.js");
  assert.match(script,/REVOKE UPDATE,DELETE,TRUNCATE ON[^;]*work_order_safety_reviews/);
});
