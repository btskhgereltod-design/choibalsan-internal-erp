"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("0096 separates work purpose, assignment kind and workflow routing",()=>{
  const migration=read("migrations/0096_work_routing_and_team_backlog.sql");
  assert.match(migration,/operational_stream IN\('core_service','internal_operation'\)/);
  assert.match(migration,/assignment_kind IN\('normal','special','emergency'\)/);
  assert.match(migration,/CREATE TABLE organization_work_intake_routes/);
  assert.match(migration,/organization_work_intake_routes_tenant_policy/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/assignment_source IN\('api','import','system','self_claim'\)/);
  assert.match(migration,/sourceReconciliation'='legacy-workflow-v2'/);
  assert.doesNotMatch(migration,/UPDATE work_orders[\s\S]*workflow_stage=/);
});

test("intake suggestions are tenant configuration and never create work automatically",()=>{
  const migration=read("migrations/0096_work_routing_and_team_backlog.sql"),route=read("src/routes/work-orders.js");
  assert.match(route,/organization_work_intake_routes ir/);
  assert.match(route,/suggested_work_type_id/);
  assert.match(route,/routing_state:routingState\(item\)/);
  assert.match(route,/router\.post\("\/:id\/claim"/);
  assert.match(route,/source:"self_claim"/);
  assert.match(route,/canClaimOrder\(req\.user,current\)/);
  assert.doesNotMatch(migration,/INSERT INTO work_orders/);
});

test("team claim is visible while exception and safety remain separate dimensions",()=>{
  const app=read("../web/app.js"),html=read("../web/index.html"),engineering=read("src/routes/engineering.js");
  assert.match(app,/workStreamLabels=\{core_service:/);
  assert.match(app,/assignmentKindLabels=\{normal:/);
  assert.match(app,/routing_state==="team_backlog"/);
  assert.match(app,/Ажил авах/);
  assert.match(html,/name="operationalStream"/);
  assert.match(html,/name="assignmentKind"/);
  assert.match(engineering,/w\.operational_stream,w\.assignment_kind/);
});

test("department tabs filter presentation without becoming workflow stages",()=>{
  const app=read("../web/app.js"),html=read("../web/index.html");
  assert.match(app,/function intakeFilterDomain/);
  assert.match(app,/function workFilterDomain/);
  assert.match(app,/work_type_code/);
  assert.match(app,/work-orders\.exception\.decide/);
  assert.match(app,/workIntakeCapabilities\.scope==="organization"/);
  assert.match(html,/app\.js\?v=43/);
  assert.doesNotMatch(app,/\{key:"lighting",title:/);
  assert.doesNotMatch(app,/\{key:"camera",title:/);
});

test("migration rehearsal runner can target only an explicitly disposable database",()=>{
  const runner=read("scripts/rehearse-migrate.js");
  assert.match(runner,/MIGRATION_REHEARSAL_MODE !== "1"/);
  assert.match(runner,/\^overva_\(test\|rehearsal\)_/);
  assert.match(runner,/databaseUrl\.pathname = `\/\$\{databaseName\}`/);
  assert.doesNotMatch(runner,/console\.log\([^\n]*databaseUrl/);
});
