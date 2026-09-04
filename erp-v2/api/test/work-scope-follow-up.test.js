"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("accepted unresolved scope has one append-only tenant disposition",()=>{
  const migration=read("migrations","0108_work_scope_disposition_follow_up.sql");
  const release=read("scripts","production-migrate.js");
  assert.match(migration,/CREATE TABLE work_order_scope_dispositions/);
  assert.match(migration,/UNIQUE\(organization_id,source_scope_item_id\)/);
  assert.match(migration,/disposition_type IN\('follow_up','accepted_end'\)/);
  assert.match(migration,/work_order_scope_dispositions_append_only/);
  assert.match(migration,/work_order_scope_dispositions_tenant_policy/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(release,/work_order_scope_dispositions/);
});

test("follow-up disposition creates one measurable work item and retains incident links atomically",()=>{
  const route=read("src","routes","work-orders.js"),assignmentSource=read("migrations","0110_work_assignment_source_follow_up.sql");
  assert.match(route,/Үлдэгдлийг хаах эсвэл дараагийн ажилд шилжүүлэх шийдвэр шаардлагатай/);
  assert.match(route,/INSERT INTO work_order_scope_dispositions/);
  assert.match(route,/Үргэлжлүүлэх — \$\{item\.work_title\}/);
  assert.match(route,/INSERT INTO work_order_scope_items/);
  assert.match(route,/INSERT INTO operational_incident_work_orders/);
  assert.match(route,/followUpOfWorkOrderId/);
  assert.match(route,/Үлдэгдлийг дараагийн ажилд шилжүүлэв/);
  assert.match(route,/undisposed_count/);
  assert.match(route,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(route,/\$6='incident:'\|\|link\.incident_id::text/);
  assert.match(route,/item\.item_code/);
  assert.match(assignmentSource,/work_order_events_assignment_source_check/);
  assert.match(assignmentSource,/'scope_follow_up'/);
});

test("a follow-up keeps only the incident represented by its source scope row",()=>{
  const route=read("src","routes","work-orders.js");
  assert.match(route,/WHERE link\.organization_id=\$1 AND link\.work_order_id=\$2[\s\S]*AND \$6='incident:'\|\|link\.incident_id::text/);
});

test("work UI records measured outcome and offers explicit follow-up or accepted end",()=>{
  const app=read("..","web","app.js"),shell=read("..","web","index.html"),css=read("..","web","work-history.css");
  assert.match(app,/data-scope-progress/);
  assert.match(app,/Үлдэгдлийг самбарт буцаах/);
  assert.match(app,/Үндэслэлтэй дуусгах/);
  assert.match(app,/workScopeDecisionForm/);
  assert.match(app,/pending_exception_count/);
  assert.match(shell,/id="workScopeItems"/);
  assert.match(shell,/id="workScopeDecisionDialog"/);
  assert.match(css,/work-scope-disposition/);
});
