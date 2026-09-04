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
  assert.match(migration,/user_row\.role IN\('director','chief_engineer','engineer','electric'\)/);
  assert.doesNotMatch(migration,/WHEN user_row\.role='safety' THEN 'lighting-incident/);
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

test("legacy road mapping accepts retained code, semantic note or linked source incident and otherwise fails closed",()=>{
  const route=read("src","routes","lighting.js");
  assert.match(route,/NULLIF\(source\.source_snapshot->>'code',''\)/);
  assert.match(route,/NULLIF\(o\.metadata->>'legacyCode',''\)/);
  assert.match(route,/LIKE 'ГТ-%'/);
  assert.match(route,/metadata->>'notes',''\)='Гудамжны гэрэлтүүлэг'/);
  assert.match(route,/marker\.operational_object_id=o\.id/);
  assert.match(route,/marker\.incident_type='Авто замын гэрэл'/);
  assert.match(route,/WHEN o\.source_table='sl_points' THEN 'unclassified'/);
  assert.doesNotMatch(route,/WHEN o\.source_table='sl_points' THEN 'road-lighting'/);
});

test("quick fault sheet uses the correct pole or head basis and keeps governed batch capture",()=>{
  const ui=read("..","web","lighting.js");
  const css=read("..","web","style.css");
  const route=read("src","routes","lighting.js");
  assert.match(ui,/Шинэ гэмтэл бүртгэх/);
  assert.match(ui,/lightingFaultDrafts/);
  assert.match(ui,/Нийт шон/);
  assert.match(ui,/Нийт толгой/);
  assert.match(ui,/data-fault-step/);
  assert.match(ui,/fault-availability/);
  assert.match(ui,/unit==="толгой"\?headCount:unit==="шон"\?poleCount/);
  assert.match(ui,/data-clear-fault/);
  assert.match(ui,/\/api\/lighting\/incidents\/batch/);
  assert.match(ui,/Гэмтэл хадгалах/);
  assert.match(ui,/form="lightingFaultBatchForm"/);
  assert.match(ui,/data-lighting-fault-draft-count/);
  assert.match(ui,/lightingFaultTargets/);
  assert.match(ui,/faultTargetKind==="asset"/);
  assert.match(route,/INVALID_TRAFFIC_SIGNAL_ASSET/);
  assert.match(route,/i\.asset_id=ANY\(\$3::uuid\[\]\)/);
  assert.match(route,/operational_object_id,asset_id,service_area_id/);
  assert.match(route,/a\.category='Гэрлэн дохио'/);
  assert.match(ui,/data-lighting-fault-save/);
  assert.match(ui,/0 тоотой мөр хадгалагдахгүй/);
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

test("lighting fault sheet prepares multiple fault types and reviews them before one batch save",()=>{
  const ui=read("..","web","lighting.js");
  const css=read("..","web","style.css");
  assert.match(ui,/state\.lightingFaultEditors/);
  assert.match(ui,/data-add-fault/);
  assert.match(ui,/objectId,incidentType/);
  assert.match(ui,/data-remove-fault-draft/);
  assert.match(ui,/data-clear-all-fault-drafts/);
  assert.match(ui,/Хадгалах өөрчлөлт/);
  assert.match(ui,/Одоогийн нээлттэй гэмтэл/);
  assert.match(ui,/Object\.values\(state\.lightingFaultDrafts\)/);
  assert.match(css,/\.fault-change-review\{/);
  assert.match(css,/\.fault-open-chip/);
});

test("incorrect saved lighting incidents are cancelled with versioned append-only evidence",()=>{
  const route=read("src","routes","lighting.js");
  const ui=read("..","web","lighting.js");
  const css=read("..","web","style.css");
  assert.match(route,/router\.post\("\/incidents\/:id\/cancel"/);
  assert.match(route,/hasPermission\(req,"operational-incidents\.cancel"\)/);
  assert.match(route,/domain='lighting' FOR UPDATE/);
  assert.match(route,/INCIDENT_VERSION_CONFLICT/);
  assert.match(route,/INCIDENT_HAS_LINKED_WORK/);
  assert.match(route,/event_type,quantity,note,detail,incident_version,request_id/);
  assert.match(route,/writeAudit\(req,"operational_incident\.cancel"/);
  assert.match(route,/operational_incident_command_receipts/);
  assert.match(ui,/data-cancel-lighting-incident/);
  assert.match(ui,/Буруу бүртгэл засах \/ хүчингүй болгох/);
  assert.match(ui,/fault-open-record/);
  assert.match(ui,/state\.lightingFaultView/);
  assert.match(ui,/data-lighting-fault-view/);
  assert.match(ui,/Number\(right\.hasOpen\)-Number\(left\.hasOpen\)/);
  assert.match(ui,/faultyTargetCount/);
  assert.match(ui,/incidentCodes=\[\.\.\.new Set\(records\.map/);
  assert.match(ui,/legacyLabel/);
  assert.match(ui,/quantity_unit:incidentUnit\(record\)/);
  assert.match(css,/\.fault-view-filter/);
  assert.match(css,/\.fault-row-current/);
  assert.match(ui,/Түүх устахгүй/);
});
