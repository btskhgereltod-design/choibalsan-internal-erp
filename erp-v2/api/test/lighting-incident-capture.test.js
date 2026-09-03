"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const read=(...parts)=>fs.readFileSync(path.join(__dirname,"..",...parts),"utf8");

test("lighting incident capture has bounded reference data and explicit permissions",()=>{
  const migration=read("migrations","0099_lighting_incident_capture.sql");
  const grants=read("scripts","production-migrate.js");
  assert.match(migration,/CREATE TABLE organization_operational_incident_types/);
  assert.match(migration,/UNIQUE\(organization_id,domain,code\)/);
  assert.match(migration,/organization_operational_incident_types_tenant_policy/);
  assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
  assert.match(migration,/'operational-incidents\.report'/);
  assert.match(migration,/'operational-incidents\.correct'/);
  assert.match(migration,/'operational-incidents\.cancel'/);
  assert.match(migration,/lighting-incident-reporter/);
  assert.match(migration,/lighting-incident-supervisor/);
  assert.match(grants,/REVOKE UPDATE,DELETE,TRUNCATE ON[^`]*operational_incident_command_receipts/);
});

test("new tenant and later module activation provision lighting references",()=>{
  const service=read("src","services","lighting-configuration.js");
  const tenant=read("src","services","tenant-provisioning.js");
  const builder=read("src","services","builder-engine.js");
  const modules=read("src","routes","developer-platform.js");
  assert.match(service,/organization_operational_incident_types/);
  assert.match(service,/organization_id=\$1 AND module_code='lighting-operations' AND enabled=true/);
  assert.match(tenant,/ensureLightingIncidentConfiguration/);
  assert.match(builder,/ensureLightingIncidentConfiguration/);
  assert.match(modules,/ensureLightingIncidentConfiguration/);
  assert.match(modules,/withTenantTransaction\(req\.user\.organization_id/);
});

test("incident report batch is tenant-derived, atomic, idempotent and audited",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/router\.post\("\/incidents\/batch"/);
  assert.match(route,/hasPermission\(req,"operational-incidents\.report"\)/);
  assert.match(route,/withTenantTransaction\(org/);
  assert.match(route,/pg_advisory_xact_lock/);
  assert.match(route,/payloadHash\(value\)/);
  assert.match(route,/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(route,/o\.organization_id=\$1 AND o\.domain='lighting'/);
  assert.match(route,/organization_operational_incident_types/);
  assert.match(route,/operational_incident_events/);
  assert.match(route,/writeAudit\(req,"operational_incident\.report"/);
  assert.match(route,/operational_incident_command_receipts/);
  assert.match(route,/DUPLICATE_INCIDENT_TARGET/);
  assert.match(route,/FUTURE_REPORTED_AT/);
  assert.doesNotMatch(route,/organizationId\s*:\s*z\./);
});

test("legacy road mapping fails closed outside the known GT object codes",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/NULLIF\(source\.source_snapshot->>'code',''\)/);
  assert.match(route,/NULLIF\(o\.metadata->>'legacyCode',''\)/);
  assert.match(route,/LIKE 'ГТ-%' THEN 'road-lighting'/);
  assert.match(route,/WHEN o\.source_table='sl_points' THEN 'unclassified'/);
  assert.doesNotMatch(route,/WHEN o\.source_table='sl_points' THEN 'road-lighting'/);
});

test("quick fault sheet uses the correct pole or head basis and keeps governed batch capture",()=>{
  const ui=read("..","web","lighting.js");
  const css=read("..","web","style.css");
  const route=read("src","routes","lighting.js");
  assert.match(ui,/Гэмтлийг тоогоор хурдан бүртгэх/);
  assert.match(ui,/lightingFaultDrafts/);
  assert.match(ui,/Нийт шон/);
  assert.match(ui,/Нийт толгой/);
  assert.match(ui,/data-fault-step/);
  assert.match(ui,/fault-availability/);
  assert.match(ui,/unit==="толгой"\?headCount:unit==="шон"\?poleCount/);
  assert.match(ui,/data-clear-fault/);
  assert.match(ui,/\/api\/lighting\/incidents\/batch/);
  assert.match(ui,/0 бол шинэ гэмтэл нэмэхгүй/);
  assert.match(ui,/нээлттэй гэмтлийн мөр/);
  assert.match(ui,/гэмтэлтэй нэгж/);
  assert.match(ui,/Number\(item\.affected_quantity\) - Number\(item\.resolved_quantity\) > 0/);
  assert.match(route,/INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY/);
  assert.match(route,/head_capacity_known/);
  assert.match(route,/pole_capacity_known/);
  assert.match(route,/classified\.code='tower-lighting' THEN 1/);
  assert.match(route,/classified\.code IN\('ger-area-lighting','tower-lighting'\) THEN \$\{legacyInventoryTotalSql\}/);
  assert.match(route,/classified\.code='tower-lighting' THEN '1'/);
  assert.match(route,/NULLIF\(o\.metadata->>'lightType',''\)/);
  assert.match(css,/\.lighting-fault-scroll\{[^}]*overflow:auto/);
  assert.match(css,/\.lighting-fault-table th\{[^}]*position:sticky/);
  assert.match(css,/\.lighting-fault-table \.fault-object-cell\{[^}]*position:sticky/);
  assert.match(css,/\.fault-stepper\{/);
});

test("linked Work Order state changes advance incident versions",()=>{
  const route=read("src","routes","work-orders.js");
  assert.match(route,/status='in_progress',version=version\+1/);
  assert.match(route,/status='resolved',resolved_quantity=affected_quantity,version=version\+1/);
  assert.match(route,/incident_version/);
});
