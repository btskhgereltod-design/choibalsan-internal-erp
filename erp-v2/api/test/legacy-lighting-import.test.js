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
  assert.match(importer,/legacyPointType/);
  assert.match(importer,/startsWith\("ГТ-"\)/);
  assert.match(importer,/legacy_unclassified/);
  assert.match(importer,/legacyCode:clean\(row\.code\)\|\|null/);
  assert.match(importer,/legacyInventoryQuantities/);
  assert.match(importer,/area==="tower-lighting"/);
  assert.match(importer,/poleCount:1,headCountPerPole:total,totalHeadCount:total/);
  assert.match(importer,/area==="ger-area-lighting"/);
  assert.match(importer,/poleCount:total,headCountPerPole:total>0\?1:null,totalHeadCount:total/);
  assert.match(importer,/status=affected===resolved\?"resolved":faultStatus\(row\.status\)/);
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
  assert.match(repair,/legacyInventoryQuantities/);
  assert.match(repair,/area==="tower-lighting"/);
});

test("demo lighting semantics reconciliation is exact, append-evidenced and non-production",()=>{
  const reconcile=read("scripts","reconcile-lighting-demo-evidence.js");
  assert.match(reconcile,/database!=="overva_rehearsal_lighting_demo"/);
  assert.match(reconcile,/road\.length!==36/);
  assert.match(reconcile,/roadTotals\.poles!==1747/);
  assert.match(reconcile,/roadTotals\.heads!==2582/);
  assert.match(reconcile,/roadTotals\.replacements!==43/);
  assert.match(reconcile,/INSERT INTO operational_object_events/);
  assert.match(reconcile,/'corrected'/);
  assert.match(reconcile,/version=version\+1/);
  assert.match(reconcile,/immutableProvenancePreserved:true/);
  assert.match(reconcile,/totalHeadCount:row\.total_heads/);
  assert.match(reconcile,/status=affected===resolved\?"resolved":faultStatus\(row\.status\)/);
  assert.doesNotMatch(reconcile,/UPDATE source_import_records/);
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
  for(const label of ["Нүүр","Гэрэлтүүлгийн объектын бүртгэл","Гэмтэл бүртгэл","Ажлын гүйцэтгэл","Ашиглалтын хяналт","Судалгаа, тайлан"])assert.match(ui,new RegExp(label));
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

test("lighting workspace keeps legacy traffic-signal copies out of the object registry",()=>{
  const route=read("src","routes","lighting.js");
  const ui=read("..","web","lighting.js");
  assert.match(route,/Legacy GD rows are compatibility copies/);
  assert.match(route,/o\.source_table='sl_points'[\s\S]*LIKE chr\(1043\)\|\|chr\(1044\)\|\|'-%'/);
  assert.match(route,/a\.category='[^']+'/);
  assert.match(ui,/state\.lightingAreaFilter==="traffic-signal"\?"Гэрлэн дохионы бүртгэл"/);
  assert.match(ui,/if\(!d\.assets\.length&&!d\.fixedAssets\.length\)return empty/);
  assert.doesNotMatch(ui,/Ашиглалтын объект алга/);
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
