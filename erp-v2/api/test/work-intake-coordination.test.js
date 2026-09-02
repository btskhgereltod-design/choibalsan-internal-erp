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

test("intake is tenant scoped, department bounded for specialists, and duplicate safe",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/router\.get\("\/intake"/);
  assert.match(route,/const canReadAll=hasPermission\(req\.user,WORK_ORDER_PERMISSIONS\.READ_ALL\)/);
  assert.match(route,/WORK_ORDER_PERMISSIONS\.CREATE/);
  assert.match(route,/\$2::boolean OR suggestion\.department_id=\$3::uuid/);
  assert.match(route,/scope:canReadAll\?"organization":"department"/);
  assert.match(route,/organization_work_intake_routes[\s\S]*incident_domain=\$2 AND work_type_id=\$3/);
  assert.match(route,/WORK_INTAKE_ROUTE_FORBIDDEN/);
  assert.match(route,/withTenantTransaction\(req\.user\.organization_id/);
  assert.match(route,/linked\.status NOT IN\('completed','cancelled'\)/);
  assert.match(route,/Энэ асуудал аль хэдийн нээлттэй ажилтай холбогдсон/);
  assert.match(route,/INSERT INTO operational_incident_work_orders/);
  assert.match(route,/Асуудлыг ажлын урсгалд оруулав/);
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
  assert.match(app,/Гэрэлтүүлгийн тасгийн ажил/);
  assert.match(app,/Тасгийн ажилд авах/);
  assert.match(app,/data-claim-work/);
  assert.match(app,/data-intake-filter/);
  assert.match(app,/Шийдвэр шаардсан/);
  assert.match(app,/camera_engineer:"camera",electric:"lighting",safety:"other"/);
  assert.match(app,/workBoardLanes\.filter\(x=>!\["closed","decision"\]\.includes\(x\.key\)\)/);
  assert.match(css,/repeat\(7/);
  assert.match(css,/work-intake-tabs/);
});

test("lighting service areas are tenant configuration and filter the same canonical flow",()=>{
  const migration=read("migrations/0097_work_service_areas.sql");
  const route=read("src/routes/work-orders.js");
  const app=read("../web/app.js"),html=read("../web/index.html"),css=read("../web/workflow.css");
  assert.match(migration,/CREATE TABLE organization_work_service_areas/);
  assert.match(migration,/organization_work_service_areas_tenant_policy/);
  assert.match(migration,/ALTER TABLE organization_work_service_areas ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/ALTER TABLE operational_incidents ADD COLUMN service_area_id UUID/);
  assert.match(migration,/ALTER TABLE work_orders ADD COLUMN service_area_id UUID/);
  assert.match(migration,/WHERE o\.slug='choibalsan-hugjil'/);
  for(const name of ["Авто замын гэрэл","Гэр хорооллын гэрэл","Цамхагийн гэрэл","Шит/Самбар","Гэрлэн дохио"]){
    assert.match(migration,new RegExp(name));
  }
  assert.match(route,/serviceAreaId: z\.string\(\)\.uuid\(\)/);
  assert.match(route,/incident\?\.service_area_id/);
  assert.match(route,/area\.domain AS service_area_domain/);
  assert.match(route,/router\.get\("\/options"[\s\S]*withTenantTransaction\(req\.user\.organization_id,client=>Promise\.all/);
  assert.match(route,/router\.get\("\/"[\s\S]*withTenantTransaction\(req\.user\.organization_id,client=>client\.query/);
  assert.match(app,/data-work-area-filter/);
  assert.match(app,/esc\(area\.name\)/);
  assert.match(app,/workAreaMatches/);
  assert.match(app,/Тоонууд нь хөрөнгийн нийт бүртгэл биш/);
  assert.match(html,/name="serviceAreaId"/);
  assert.match(css,/work-area-tabs/);
});

test("final acceptance resolves its linked source without inventing approval history",()=>{
  const route=read("src/routes/work-orders.js");
  assert.match(route,/resolveLinkedIncidents/);
  assert.match(route,/status='resolved',resolved_quantity=affected_quantity/);
  assert.match(route,/event_type,quantity,note,detail/);
  assert.match(route,/rule\.to==="completed"/);
});
