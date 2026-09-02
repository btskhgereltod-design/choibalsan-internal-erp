"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("lighting is an opt-in tenant specialization",()=>{
  const migration=read("migrations","0043_operational_incidents_and_legacy_provenance.sql");
  const route=read("src","routes","lighting.js");
  const shell=read("..","web","index.html");
  const app=read("..","web","app.js");
  assert.match(migration,/'lighting-operations'/);
  assert.match(migration,/slug='choibalsan-hugjil'/);
  assert.doesNotMatch(migration,/CROSS JOIN module_catalog/);
  assert.match(route,/requireModule\("lighting-operations"\)/);
  assert.match(shell,/data-view="lighting" data-module="lighting-operations"/);
  assert.match(app,/lighting:"lighting-operations"/);
});

test("lighting workspace is tenant scoped and uses linked operational records",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/withTenantTransaction\(org/);
  assert.match(route,/FROM operational_objects o/);
  assert.match(route,/o\.organization_id=\$1 AND o\.domain='lighting'/);
  assert.match(route,/i\.operational_object_id/);
  assert.match(route,/w\.operational_object_id/);
  assert.doesNotMatch(route,/FROM assets WHERE organization_id=\$1 AND category LIKE 'lighting\.%'/);
  assert.match(route,/i\.organization_id=\$1 AND i\.domain='lighting'/);
  assert.match(route,/w\.organization_id=\$1/);
  assert.match(route,/workflow_stage/);
});

test("legacy export is read-only and excludes credentials",()=>{
  const exporter=read("..","ops","export-legacy-lighting.js");
  assert.match(exporter,/sqlite3\.OPEN_READONLY/);
  assert.match(exporter,/SELECT id,full_name,role FROM users/);
  assert.match(exporter,/--all-work/);
  assert.match(exporter,/--base64/);
  assert.match(exporter,/SELECT \* FROM asset_events ORDER BY id/);
  assert.doesNotMatch(exporter,/password_hash|passwordHash/);
});

test("legacy import is idempotent, provenance preserving and progress safe",()=>{
  const migration=read("migrations","0044_operational_objects_and_measured_outcomes.sql");
  const importer=read("scripts","import-legacy-lighting.js");
  assert.match(migration,/UNIQUE\(organization_id,source_system,source_table,source_id\)/);
  assert.match(migration,/CREATE TABLE operational_objects/);
  assert.match(migration,/CREATE TABLE work_order_scope_items/);
  assert.match(migration,/completed_quantity \+ unresolved_quantity \+ deferred_quantity <= planned_quantity/);
  assert.match(migration,/work_order_scope_item_events_append_only/);
  assert.match(importer,/--dry-run/);
  assert.match(importer,/Legacy manual progress preserved only in provenance/);
  assert.match(importer,/legacyAssetTable/);
  assert.match(importer,/INSERT INTO operational_objects/);
  assert.doesNotMatch(importer,/progress\) VALUES/);
  assert.match(importer,/includes\("дуус"\)/);
});

test("legacy lighting encoding repair is scoped, auditable and preserves provenance",()=>{
  const repair=read("scripts","repair-legacy-lighting-encoding.js");
  assert.match(repair,/organization_id=\$1/);
  assert.match(repair,/source_system=\$2/);
  assert.match(repair,/legacy_lighting\.encoding_repair/);
  assert.match(repair,/INSERT INTO asset_events/);
  assert.match(repair,/--dry-run/);
  assert.doesNotMatch(repair,/UPDATE source_import_records/);
});

test("accounting fixed assets stay separate from operational objects",()=>{
  const migration=read("migrations","0044_operational_objects_and_measured_outcomes.sql");
  const assets=read("src","routes","assets.js");
  const workOrders=read("src","routes","work-orders.js");
  assert.match(migration,/CREATE TABLE operational_object_components/);
  assert.match(migration,/REFERENCES assets\(organization_id,id\)/);
  assert.match(migration,/'excludedFromAssetMaster',true/);
  assert.match(assets,/excludedFromAssetMaster/);
  assert.match(workOrders,/operationalObjectId/);
  assert.match(workOrders,/exception_status/);
});

test("lighting UI explains the standard end-to-end flow",()=>{
  const ui=read("..","web","lighting.js");
  for(const label of ["Нүүр","Объект ба тоноглол","Гэмтэл, үзлэг","Ажлын гүйцэтгэл","Ашиглалтын хяналт","Судалгаа, тайлан"])assert.match(ui,new RegExp(label));
  assert.match(ui,/объект → асуудал → ажил → нотолгоо → ХАБЭА → баталгаажуулалт/i);
  assert.doesNotMatch(ui,/organizationHomeBar/);
});

test("lighting workspace reuses tenant service areas without creating a second work engine",()=>{
  const route=read("src","routes","lighting.js");
  const ui=read("..","web","lighting.js");
  const smoke=read("scripts","lighting-workspace-smoke.js");
  assert.match(route,/FROM organization_work_service_areas/);
  assert.match(route,/serviceAreas:serviceAreas\.rows/);
  assert.match(route,/fixedAssets:equipment/);
  assert.match(ui,/data-lighting-area/);
  assert.match(ui,/Ашиглалтын бүртгэл/);
  assert.match(ui,/Нэгдсэн Ажлын самбараас зөвхөн гэрэлтүүлэгтэй холбоотой/);
  assert.match(ui,/Асалтын хуваарь/);
  assert.match(ui,/Сарын тоолуурын уншилт/);
  assert.match(ui,/Цахилгааны төлбөр/);
  assert.doesNotMatch(ui,/method:\s*["']POST["'].*\/api\/lighting\/workspace/s);
  assert.match(smoke,/\/api\/lighting\/workspace/);
  assert.doesNotMatch(smoke,/method:\s*["']POST["']/);
});

test("lighting is one top-level workspace with scoped internal navigation",()=>{
  const shell=read("..","web","index.html");
  const app=read("..","web","app.js");
  const lighting=read("..","web","lighting.js");
  const dockerfile=read("..","web","Dockerfile");
  assert.equal((shell.match(/data-view="lighting"/g)||[]).length,1);
  assert.match(shell,/Ажлын самбар/);
  assert.match(shell,/Нэгдсэн тайлан/);
  assert.match(app,/state\.view==="lighting"&&typeof lightingView==="function"\?lightingView\(\)/);
  assert.match(lighting,/Гэрэлтүүлгийн тайлангийн эх өгөгдөл/);
  assert.match(dockerfile,/COPY lighting\.js \/usr\/share\/nginx\/html\/lighting\.js/);
});
