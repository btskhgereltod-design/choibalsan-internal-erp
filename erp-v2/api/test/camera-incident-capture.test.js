"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("camera incidents use tenant-owned reference types and explicit camera roles",()=>{
  const migration=read("migrations","0103_camera_incident_capture.sql");
  assert.match(migration,/domain,code,name,quantity_unit/);
  assert.match(migration,/SELECT om\.organization_id,'camera'/);
  assert.match(migration,/'device_unavailable','Камер ажиллахгүй','камер'/);
  assert.match(migration,/'power_fault','Тэжээлийн гэмтэл','тохиолдол'/);
  assert.match(migration,/camera-incident-reporter/);
  assert.match(migration,/camera-incident-supervisor/);
  assert.match(migration,/module_code=NULL/);
  assert.match(migration,/user_row\.role='camera_engineer'/);
});

test("incorrect camera incidents use the same governed cancellation contract",()=>{
  const route=read("src","routes","camera.js");
  const ui=read("..","web","camera.js");
  assert.match(route,/router\.post\("\/incidents\/:id\/cancel"/);
  assert.match(route,/hasPermission\(req,"operational-incidents\.cancel"\)/);
  assert.match(route,/domain='camera' FOR UPDATE/);
  assert.match(route,/INCIDENT_VERSION_CONFLICT/);
  assert.match(route,/INCIDENT_HAS_LINKED_WORK/);
  assert.match(route,/event_type,quantity,note,detail,incident_version,request_id/);
  assert.match(route,/commandType=`cancel_camera_incident:/);
  assert.match(route,/writeAudit\(req,"operational_incident\.cancel"/);
  assert.match(route,/canCancelIncidents:hasPermission/);
  assert.match(ui,/data-cancel-camera-incident/);
  assert.match(ui,/cancelIncident\.dataset\.cancelCameraIncident/);
});

test("camera reference configuration follows provisioning and module activation",()=>{
  const service=read("src","services","lighting-configuration.js");
  const tenant=read("src","services","tenant-provisioning.js");
  const builder=read("src","services","builder-engine.js");
  const modules=read("src","routes","developer-platform.js");
  assert.match(service,/ensureCameraIncidentConfiguration/);
  assert.match(service,/module_code='camera-operations' AND enabled=true/);
  assert.match(tenant,/enabledModules\.includes\("camera-operations"\)/);
  assert.match(builder,/enabled\.includes\("camera-operations"\)/);
  assert.match(modules,/req\.params\.code==="camera-operations"/);
});

test("camera batch capture is tenant-derived, bounded, idempotent and audited",()=>{
  const route=read("src","routes","camera.js");
  assert.match(route,/router\.post\("\/incidents\/batch"/);
  assert.match(route,/hasPermission\(req,"operational-incidents\.report"\)/);
  assert.match(route,/withTenantTransaction\(org/);
  assert.match(route,/object_row\.organization_id=\$1 AND object_row\.domain='camera'/);
  assert.match(route,/domain='camera' AND active=true/);
  assert.match(route,/command_type='report_camera_batch'/);
  assert.match(route,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(route,/INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY/);
  assert.match(route,/unit==='камер'/);
  assert.match(route,/operational_incident_events/);
  assert.match(route,/writeAudit\(req,"operational_incident\.report"/);
  assert.doesNotMatch(route,/organizationId\s*:\s*z\./);
});

test("camera fault tab mirrors the quick numeric lighting interaction at camera grain",()=>{
  const ui=read("..","web","camera.js");
  const css=read("..","web","style.css");
  assert.match(ui,/Камерын гэмтлийг тоогоор хурдан бүртгэх/);
  assert.match(ui,/cameraFaultDrafts/);
  assert.match(ui,/Шон \/ цэг/);
  assert.match(ui,/Нийт камер/);
  assert.match(ui,/data-camera-fault-step/);
  assert.match(ui,/cameraFaultBatchForm/);
  assert.match(ui,/\/api\/camera\/incidents\/batch/);
  assert.match(ui,/unit==="камер"\?cameraCount:null/);
  assert.match(ui,/operational-incidents\.report/);
  assert.match(ui,/state\.cameraFaultEditors/);
  assert.match(ui,/state\.cameraFaultView/);
  assert.match(ui,/data-add-camera-fault/);
  assert.match(ui,/data-remove-camera-fault-draft/);
  assert.match(ui,/data-clear-all-camera-fault-drafts/);
  assert.match(ui,/data-camera-fault-view/);
  assert.match(ui,/showFaultyOnly=state\.cameraFaultView==='faulty'&&faultyObjectCount>0/);
  assert.match(ui,/faultyObjectCount\?'':'disabled aria-disabled="true"/);
  assert.match(ui,/Шинэ гэмтэл бүртгэх \$\{data\.assets\.length\} объектыг бүгдийг харуулж байна/);
  assert.match(ui,/Number\(right\.hasOpen\)-Number\(left\.hasOpen\)/);
  assert.match(ui,/fault-change-review/);
  assert.match(css,/\.fault-view-filter/);
  assert.match(ui,/Бүртгэгдсэн гэмтлийн түүх/);
});
