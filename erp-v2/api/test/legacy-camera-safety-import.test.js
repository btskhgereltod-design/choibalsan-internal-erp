"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("pilot capability reconciliation is tenant scoped and repeatable",()=>{
  const migration=read("migrations","0068_choibalsan_connected_operations.sql");
  assert.match(migration,/slug='choibalsan-hugjil'/);
  assert.match(migration,/ON CONFLICT\(organization_id,module_code\) DO UPDATE/);
  assert.match(migration,/camera-operations/);
  assert.match(migration,/work-orders\.workflow\.safety/);
  assert.match(migration,/work-orders\.workflow\.approve/);
  assert.doesNotMatch(migration,/CROSS JOIN organizations/);
});

test("legacy camera and safety export is read only and excludes credentials and private GPS",()=>{
  const exporter=read("..","ops","export-legacy-camera-safety.js");
  assert.match(exporter,/sqlite3\.OPEN_READONLY/);
  assert.match(exporter,/SELECT id,full_name,role FROM users/);
  assert.match(exporter,/--base64/);
  assert.doesNotMatch(exporter,/password_hash|signature_code|gps_lat|gps_lng/);
});

test("camera and safety import preserves source records and master asset allocation",()=>{
  const importer=read("scripts","import-legacy-camera-safety.js");
  for(const token of ["--dry-run","source_import_records","camera_device_group","camera_daily_status","safety_reports","safety_acknowledgements"]){
    assert.match(importer,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  }
  assert.match(importer,/allocatable_quantity=GREATEST/);
  assert.match(importer,/category='camera\.repair'/);
  assert.match(importer,/source_system IN \(\$2,'choibalsan-legacy-erp'\)/);
  assert.match(importer,/GPS and file paths intentionally excluded/);
});

test("camera and safety UTF-8 repair preserves immutable evidence and appends visible corrections",()=>{
  const repair=read("scripts","repair-legacy-camera-safety-encoding.js");
  assert.match(repair,/--dry-run/);
  assert.match(repair,/--base64/);
  assert.match(repair,/correctsEventId/);
  assert.match(repair,/legacy_camera_safety\.encoding_repair/);
  assert.doesNotMatch(repair,/UPDATE work_order_approvals|UPDATE safety_acknowledgements|UPDATE source_import_records/);
});

test("camera workspace exposes quantities, history and object dossiers",()=>{
  const route=read("src","routes","camera.js"),ui=read("..","web","camera.js");
  assert.match(route,/domain='camera'/);
  assert.match(route,/operational_domain_snapshots/);
  assert.match(route,/operational_object_components/);
  assert.match(ui,/data-camera-dossier/);
  assert.match(ui,/Камерын өдрийн төлөвийн түүх/);
  assert.match(ui,/Объектын хувийн хэрэг/);
});

test("safety overview includes imported documents, acknowledgements and routes",()=>{
  const route=read("src","routes","safety.js"),ui=read("..","web","safety.js");
  assert.match(route,/safety_documents/);
  assert.match(route,/safety_acknowledgements/);
  assert.match(route,/safety_route_plans/);
  assert.match(ui,/Сургалт ба зааварчилгааны нотолгоо/);
  assert.match(ui,/Аюулгүй маршрут/);
});
