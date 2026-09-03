"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("camera workspace projects legacy bag evidence without rewriting camera master",()=>{
  const route=read("src","routes","camera.js");
  assert.match(route,/source_snapshot->>'bag_no'/);
  assert.match(route,/source_group_code/);
  assert.match(route,/record\.source_table='camera_assets'/);
  assert.match(route,/record\.target_type='operational_object'/);
  assert.match(route,/open_incident_count/);
  assert.match(route,/affected_camera_count/);
  assert.match(route,/open_work_count/);
  assert.doesNotMatch(route,/UPDATE source_import_records/);
});

test("camera UI uses source location group and canonical operating state as one compact navigator",()=>{
  const ui=read("..","web","camera.js");
  for(const marker of ["cameraGroupFilter","cameraOperationalFilter","cameraSearch","cameraScopeNavigation","cameraOperationalStateOf"]){
    assert.match(ui,new RegExp(marker));
  }
  assert.doesNotMatch(ui,/cameraCategoryFilter|cameraCategoryNavigation|data-camera-category|ОБЪЕКТЫН АНГИЛАЛ/);
  assert.match(ui,/Баг \/ үйлчилгээний бүс/);
  assert.match(ui,/Баг нь нотлогдоогүй объект энэ хэсэгт “Ангилал тодорхойгүй” гэж үлдэнэ/);
  assert.match(ui,/Засвар шаардлагатай/);
  assert.match(ui,/Шийдвэр хүлээж буй/);
  assert.match(ui,/нээлттэй canonical гэмтлээс тооцогдоно/);
  assert.match(ui,/master lifecycle-д шууд бичилгүй/);
});
