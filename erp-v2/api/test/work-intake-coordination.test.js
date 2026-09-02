"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("0095 links intake truth to execution truth without weakening tenant boundaries",()=>{
  const migration=read("migrations/0095_work_intake_coordination.sql");
  const productionMigrate=read("scripts/production-migrate.js");
  assert.match(migration,/CREATE TABLE operational_incident_work_orders/);
  assert.match(migration,/FOREIGN KEY\(organization_id,incident_id\)/);
  assert.match(migration,/FOREIGN KEY\(organization_id,work_order_id\)/);
  assert.match(migration,/operational_incident_work_orders_append_only/);
  assert.match(migration,/operational_incident_work_orders_tenant_policy/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration,/INSERT INTO operational_incident_work_orders[\s\S]*SELECT/i);
  assert.match(productionMigrate,/REVOKE UPDATE,DELETE,TRUNCATE ON[^;]*operational_incident_work_orders/);
});

test("chief-engineer intake is permission-gated, tenant-scoped and duplicate-safe",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/router\.get\("\/intake"/);
  assert.match(route,/WORK_ORDER_PERMISSIONS\.READ_ALL/);
  assert.match(route,/WORK_ORDER_PERMISSIONS\.CREATE/);
  assert.match(route,/withTenantTransaction\(req\.user\.organization_id/);
  assert.match(route,/linked\.status NOT IN\('completed','cancelled'\)/);
  assert.match(route,/Энэ асуудал аль хэдийн нээлттэй ажилтай холбогдсон/);
  assert.match(route,/INSERT INTO operational_incident_work_orders/);
  assert.match(route,/Ерөнхий инженер ажлын урсгалд оруулав/);
  assert.match(route,/incidentId:incident\?\.id\|\|null/);
});

test("assignment starts governed safety only after the chief engineer has chosen an owner",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/workflowStage=workType\?\.workflow_policy_id&&assignee\?"awaiting_safety_start":null/);
  assert.match(route,/assignment\.changed&&assignee&&current\.workflow_policy_id&&!current\.workflow_stage/);
  assert.match(route,/SET workflow_stage='awaiting_safety_start'/);
  assert.match(route,/startSafetyPermission/);
});

test("unified board exposes intake, exception decision, team backlog, governed checks, acceptance and done",()=>{
  const app=read("../web/app.js"),html=read("../web/index.html"),css=read("../web/workflow.css");
  for(const title of ["Асуудал ба хэрэгцээ","Ерөнхий инженерийн шийдвэр","ХАБЭА эхлэх зөвшөөрөл",
    "Гүйцэтгэж буй","ХАБЭА дуусгалтын шалгалт","Ерөнхий инженерийн хүлээн авалт","Дууссан"]){
    assert.match(app,new RegExp(title));
  }
  assert.match(app,/api\("\/api\/work-orders\/intake"\)/);
  assert.match(app,/data-intake-id/);
  assert.match(app,/related_open_work_count/);
  assert.match(html,/name="incidentId"/);
  assert.match(app,/Багийн хийх ажлууд/);
  assert.match(app,/data-claim-work/);
  assert.match(css,/repeat\(8/);
});

test("final acceptance resolves its linked source without inventing approval history",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/resolveLinkedIncidents/);
  assert.match(route,/status='resolved',resolved_quantity=affected_quantity/);
  assert.match(route,/event_type,quantity,note,detail/);
  assert.match(route,/rule\.to==="completed"/);
});
