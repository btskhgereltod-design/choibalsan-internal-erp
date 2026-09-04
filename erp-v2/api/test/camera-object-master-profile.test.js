"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("camera master reuses the object specification version and normalizes points and devices",()=>{
  const migration=read("migrations","0102_camera_object_master_profile.sql");
  assert.match(migration,/ADD COLUMN profile_kind/);
  assert.match(migration,/CREATE TABLE operational_object_camera_points/);
  assert.match(migration,/CREATE TABLE operational_object_camera_devices/);
  assert.match(migration,/camera_point_id UUID NOT NULL/);
  assert.match(migration,/resolution_mp NUMERIC/);
  assert.match(migration,/supports_ptz BOOLEAN/);
  assert.match(migration,/night_vision BOOLEAN/);
  assert.match(migration,/operational_object_camera_points_append_only/);
  assert.match(migration,/operational_object_camera_devices_append_only/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
});

test("camera dossier keeps master writes separate while projecting authorized activity",()=>{
  const route=read("src","routes","camera.js");
  const dossier=route.slice(route.indexOf('router.get("/objects/:id/dossier"'),route.indexOf('router.patch("/objects/:id"'));
  assert.match(dossier,/withTenantTransaction\(org/);
  assert.match(dossier,/cameraPoints/);
  assert.match(dossier,/cameraDevices/);
  assert.match(dossier,/loadOperationalObjectActivity/);
  assert.match(route,/router\.post\("\/objects\/:id\/specifications"/);
  assert.match(route,/profile_kind\)\s*VALUES[\s\S]*'camera'/);
  assert.match(route,/totalCameras=devices\.reduce/);
  assert.match(route,/operational_object\.camera_specification\.create/);
  assert.match(route,/VERSION_CONFLICT/);
});

test("camera UI edits mount points GPS and per-point device specifications",()=>{
  const shared=read("..","web","lighting.js"),camera=read("..","web","camera.js"),route=read("src","routes","camera.js");
  for(const marker of ["dossierCameraTechnicalForm","cameraPointRow","cameraDeviceRow","poleReference","latitude","longitude","deviceType","manufacturer","model","resolutionMp","lensMm","supportsPtz","nightVision","connectivity","powerSource"]){
    assert.match(shared,new RegExp(marker));
  }
  assert.match(camera,/Камерын объектын бүртгэл/);
  assert.match(camera,/classification_state/);
  assert.match(camera,/cameraScopeNavigation/);
  assert.match(camera,/camera-scope-panel/);
  assert.match(camera,/lighting-object-summary/);
  assert.match(camera,/data-camera-group/);
  assert.doesNotMatch(camera,/cameraCategoryNavigation|data-camera-category|ОБЪЕКТЫН АНГИЛАЛ/);
  assert.match(camera,/Хувийн хэрэг/);
  assert.match(route,/camera_point_count/);
  assert.match(route,/gps_point_count/);
});

test("panel board is retired as a Choibalsan view dimension without deleting history",()=>{
  const migration=read("migrations","0102_camera_object_master_profile.sql"),lighting=read("src","routes","lighting.js"),app=read("..","web","app.js");
  assert.match(migration,/code='panel-board'/);
  assert.match(migration,/SET active=false/);
  assert.doesNotMatch(migration,/DELETE FROM organization_work_service_areas/);
  assert.match(lighting,/a\.category='Гэрлэн дохио'/);
  assert.doesNotMatch(app,/цамхаг, шит\/самбар, гэрлэн дохио/);
});

test("runtime cannot rewrite camera master history",()=>{
  const grants=read("scripts","production-migrate.js");
  assert.match(grants,/operational_object_camera_points,operational_object_camera_devices/);
});
