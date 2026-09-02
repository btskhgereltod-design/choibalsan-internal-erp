"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("engineering center keeps Work Orders as its operational truth",()=>{
  const route=read("src/routes/engineering.js");
  assert.match(route,/FROM work_orders w/);
  assert.match(route,/work_order_material_requests/);
  assert.match(route,/work_order_events/);
  assert.match(route,/work_order_scope_items/);
  assert.match(route,/WORK_ORDER_PERMISSIONS\.READ_ALL/);
  assert.match(route,/availableWorkflowActions/);
  assert.doesNotMatch(route,/req\.user\.role\s*===\s*["']chief_engineer/);
});

test("monthly engineering commentary is tenant-scoped and audited",()=>{
  const migration=read("migrations/0069_engineering_operations_center.sql"),route=read("src/routes/engineering.js");
  assert.match(migration,/UNIQUE\(organization_id,review_year,review_month\)/);
  assert.match(migration,/FOREIGN KEY\(organization_id,created_by\)/);
  assert.match(route,/engineering\.monthly-review\.saved/);
  assert.match(route,/WORK_ORDER_PERMISSIONS\.WORKFLOW_APPROVE/);
  assert.match(route,/WHERE organization_id=\$1 AND review_year=\$2 AND review_month=\$3/);
});

test("tenant shell wires the chief-engineer center without duplicating a module",()=>{
  const html=read("../web/index.html"),docker=read("../web/Dockerfile"),client=read("../web/engineering.js");
  assert.match(html,/id="engineeringNav"[^>]*data-module="work-orders"/);
  assert.match(html,/engineering\.js\?v=3/);
  assert.match(docker,/COPY engineering\.js/);
  assert.match(client,/viewModules\.engineering="work-orders"/);
  assert.match(client,/\/api\/engineering\/overview/);
  assert.match(client,/data-workflow-action/);
  assert.match(client,/function engineeringNeedsManagement/);
  assert.match(client,/!item\.workflow_policy_id&&item\.status==="pending_review"/);
});
