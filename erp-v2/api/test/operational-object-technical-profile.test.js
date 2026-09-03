"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("technical profile is normalized, versioned and append only",()=>{
  const migration=read("migrations","0101_operational_object_technical_profile.sql");
  assert.match(migration,/CREATE TABLE operational_object_specifications/);
  assert.match(migration,/CREATE TABLE operational_object_lamp_groups/);
  assert.match(migration,/wattage_w NUMERIC/);
  assert.match(migration,/head_count INTEGER/);
  assert.match(migration,/CREATE TABLE operational_object_supply_points/);
  assert.match(migration,/panel_asset_id UUID/);
  assert.match(migration,/meter_number TEXT/);
  assert.match(migration,/latitude NUMERIC\(9,6\)/);
  assert.match(migration,/longitude NUMERIC\(10,6\)/);
  assert.match(migration,/current_specification_id/);
  assert.match(migration,/operational_object_specifications_append_only/);
  assert.match(migration,/operational_object_lamp_groups_append_only/);
  assert.match(migration,/operational_object_supply_points_append_only/);
  for(const table of ["operational_object_specifications","operational_object_lamp_groups","operational_object_supply_points"]){
    assert.match(migration,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(migration,/DELETE FROM operational_object/);
});

test("technical write is tenant scoped, version guarded and derives totals from lamp groups",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/router\.post\("\/objects\/:id\/specifications"/);
  assert.match(route,/router\.get\("\/objects\/:id\/dossier"[\s\S]*withTenantTransaction\(org/);
  assert.match(route,/expectedObjectVersion/);
  assert.match(route,/SUPPLY_ASSET_NOT_ALLOCATED/);
  assert.match(route,/INSERT INTO operational_object_specifications/);
  assert.match(route,/INSERT INTO operational_object_lamp_groups/);
  assert.match(route,/INSERT INTO operational_object_supply_points/);
  assert.match(route,/totalHeads=lamps\.reduce/);
  assert.match(route,/operational_object\.specification\.create/);
  assert.match(route,/specification_changed/);
});

test("object images reuse canonical documents and never create an anonymous media store",()=>{
  const route=read("src","routes","lighting.js"),migration=read("migrations","0101_operational_object_technical_profile.sql");
  assert.match(route,/INSERT INTO documents/);
  assert.match(route,/INSERT INTO document_versions/);
  assert.match(route,/INSERT INTO document_links/);
  assert.match(route,/content_sha256/);
  assert.match(route,/location_scheme/);
  assert.match(route,/site_photo/);
  assert.match(route,/operational_object\.media\.add/);
  assert.doesNotMatch(migration,/CREATE TABLE operational_object_media/);
});

test("dossier edits pole, wattage, heads, line length, supply GPS and images",()=>{
  const ui=read("..","web","lighting.js");
  for(const marker of ["dossierTechnicalForm","poleCount","wattageW","headCount","linearLengthM","panelAssetId","meterNumber","latitude","longitude","dossierMediaForm","Байршлын схем","Ерөнхий фото"]){
    assert.match(ui,new RegExp(marker));
  }
  assert.match(ui,/Нийт толгой нь доорх мөрүүдийн нийлбэрээр автоматаар бодогдоно/);
});

test("runtime cannot rewrite technical history and tenant configuration grants the manager",()=>{
  const grants=read("scripts","production-migrate.js"),configuration=read("src","services","lighting-configuration.js");
  assert.match(grants,/operational_object_specifications,operational_object_lamp_groups,operational_object_supply_points/);
  assert.match(configuration,/work-order-manager','operational-objects\.media\.manage/);
  assert.match(configuration,/work-order-manager','operational-objects\.update/);
});
