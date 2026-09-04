"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("object dossier keeps assets as master data and records dated allocations",()=>{
  const migration=read("migrations","0066_operational_object_dossier.sql");
  assert.match(migration,/operational_object_components_active_unique_idx/);
  assert.match(migration,/WHERE removed_at IS NULL/);
  assert.match(migration,/CREATE TABLE operational_object_events/);
  assert.match(migration,/operational_object_events_append_only/);
  assert.match(migration,/component_assigned/);
  assert.match(migration,/component_removed/);
  assert.doesNotMatch(migration,/DELETE FROM assets|UPDATE assets/);
});

test("asset capacity prevents object allocations from exceeding the master quantity",()=>{
  const migration=read("migrations","0067_asset_allocatable_quantity.sql");
  const assets=read("src","routes","assets.js");
  const lighting=read("src","routes","lighting.js");
  assert.match(migration,/allocatable_quantity/);
  assert.match(migration,/allocation_unit/);
  assert.match(lighting,/FOR UPDATE/);
  assert.match(lighting,/v\.quantity>available/);
  assert.match(lighting,/v\.unit!==asset\.allocation_unit/);
  assert.match(assets,/allocated>Number\(next\.allocatableQuantity\)/);
});

test("object dossier APIs are tenant scoped, authorized and auditable",()=>{
  const route=read("src","routes","lighting.js");
  for(const permission of ["operational-objects.read","operational-objects.components.manage","operational-objects.notes.create"]){
    assert.match(route,new RegExp(permission.replaceAll(".","\\.")));
  }
  assert.match(route,/organization_id=\$1 AND operational_object_id=\$2/);
  assert.match(route,/INSERT INTO operational_object_components/);
  assert.match(route,/removed_at=current_date/);
  assert.match(route,/operational_object\.component\.assign/);
  assert.match(route,/operational_object\.component\.remove/);
  assert.doesNotMatch(route,/req\.body\.organizationId|req\.body\.organization_id/);
});

test("lighting UI opens one understandable object dossier",()=>{
  const ui=read("..","web","lighting.js");
  const shell=read("..","web","index.html");
  assert.match(ui,/data-object-dossier/);
  assert.match(ui,/data-asset-id="\$\{x\.id\}">Хувийн хэрэг/);
  assert.match(ui,/data-object-dossier="\$\{x\.id\}">Хувийн хэрэг/);
  assert.match(ui,/Бүрэлдэхүүн хөрөнгө/);
  assert.match(ui,/Өөрчлөлтийн audit түүх/);
  assert.match(ui,/Гэмтэл ба ажлын түүх/);
  assert.match(ui,/data-dossier-print/);
  assert.match(ui,/data-dossier-download/);
  assert.doesNotMatch(ui.slice(ui.indexOf("function lightingDossierHtml"),ui.indexOf("async function openLightingDossier")),/d\.incidents|d\.workOrders/);
  assert.match(ui,/Хөрөнгийн мастер бүртгэлийг нүүлгэхгүй/);
  assert.match(shell,/lightingDossierDialog/);
});

test("object dossier activity is permission scoped and reuses domain authorities",()=>{
  const service=read("src","services","operational-object-activity.js");
  const assets=read("src","routes","assets.js");
  const lighting=read("src","routes","lighting.js");
  const camera=read("src","routes","camera.js");
  assert.match(service,/incident\.operational_object_id=\$2/);
  assert.match(service,/incident\.asset_id=\$3/);
  assert.match(service,/source\.operational_object_id=\$2/);
  assert.match(service,/source\.asset_id=\$3/);
  assert.match(service,/operational_incident_events/);
  assert.match(service,/reported_note/);
  assert.match(service,/canReadOrder\(user, work\)/);
  assert.match(service,/permission\.startsWith\("work-orders\."\)/);
  assert.match(service,/WORKFLOW_SAFETY/);
  assert.match(service,/WORKFLOW_APPROVE/);
  assert.doesNotMatch(service,/UPDATE |INSERT INTO |DELETE FROM /);
  assert.match(lighting,/loadOperationalObjectActivity/);
  assert.match(camera,/loadOperationalObjectActivity/);
  assert.match(assets,/loadOperationalObjectActivity/);
  assert.match(assets,/assetId: id\.data/);
});

test("object and fixed-asset dossier UI shows incident notes and the append-only incident timeline",()=>{
  const ui=read("..","web","lighting.js");
  const app=read("..","web","app.js");
  const shell=read("..","web","index.html");
  assert.match(ui,/activity\.incidentEvents/);
  assert.match(ui,/item\.reported_note/);
  assert.match(ui,/Гэмтлийн бүртгэл зассан/);
  assert.match(app,/assetOperationalActivity/);
  assert.match(app,/operationalDossierActivity\(result\)/);
  assert.match(shell,/id="assetOperationalActivity"/);
});

test("encoding repair preserves UUIDs and supersedes damaged visible notes append-only",()=>{
  const assetRepair=read("scripts","repair-legacy-assets-encoding.js");
  const lightingRepair=read("scripts","repair-legacy-lighting-encoding.js");
  const workOrders=read("src","routes","work-orders.js");
  assert.match(assetRepair,/UPDATE assets SET code/);
  assert.match(assetRepair,/INSERT INTO asset_events/);
  assert.doesNotMatch(assetRepair,/DELETE FROM assets/);
  assert.match(lightingRepair,/correctsEventId/);
  assert.match(workOrders,/correction\.detail->>'correctsEventId'=e\.id::text/);
});
