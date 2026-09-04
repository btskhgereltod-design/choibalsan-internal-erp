"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),"utf8");

test("operational object lifecycle is versioned, permissioned and append-only",()=>{
  const migration=read("migrations","0100_operational_object_master_lifecycle.sql");
  assert.match(migration,/ADD COLUMN version BIGINT NOT NULL DEFAULT 1/);
  assert.match(migration,/operational-objects\.update/);
  assert.match(migration,/operational-objects\.retire/);
  assert.match(migration,/event_type IN\('component_assigned','component_removed','note','updated','retired'\)/);
  assert.doesNotMatch(migration,/DELETE FROM operational_objects/i);
});

test("lighting object edit and retirement are tenant scoped, audited and dependency guarded",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/router\.patch\("\/objects\/:id"/);
  assert.match(route,/router\.post\("\/objects\/:id\/retire"/);
  assert.match(route,/withTenantTransaction\(org/);
  assert.match(route,/VERSION_CONFLICT/);
  assert.match(route,/OBJECT_RETIRE_BLOCKED/);
  assert.match(route,/active_components/);
  assert.match(route,/active_incidents/);
  assert.match(route,/active_work/);
  assert.match(route,/operational_object\.update/);
  assert.match(route,/operational_object\.retire/);
  assert.match(route,/o\.status<>'retired'/);
  assert.doesNotMatch(route,/DELETE FROM operational_objects/i);
});

test("object registry keeps master writes separate and labels the activity projection as a dossier",()=>{
  const web=read("..","web","lighting.js");
  const start=web.indexOf("function lightingDossierHtml");
  const end=web.indexOf("async function openLightingDossier",start);
  const dossier=web.slice(start,end);
  assert.match(web,/objectRegistry=state\.lightingTab==="assets"/);
  assert.match(web,/Хувийн хэрэг/);
  assert.match(dossier,/dossierObjectEditForm/);
  assert.match(dossier,/dossierObjectRetireForm/);
  assert.match(dossier,/Бүрэлдэхүүн хөрөнгө/);
  assert.match(dossier,/operationalDossierActivity\(d\)/);
});
