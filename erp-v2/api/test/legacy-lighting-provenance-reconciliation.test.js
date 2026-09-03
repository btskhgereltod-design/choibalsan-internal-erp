"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {EXPECTED,sourceFingerprint,summarizeSource,desiredObject,isCurrent}=require("../scripts/reconcile-legacy-lighting-provenance");

function fixture(){
  const families=[["ГТ",36],["ГД",12],["ГЧ",25],["НЭ",23],["ЯЗ",18],["НГ",3]];
  let id=0;
  const points=[];
  for(const [prefix,count] of families)for(let index=1;index<=count;index+=1){
    id+=1;
    points.push({id,code:`${prefix}-${String(index).padStart(3,"0")}`,name:`Object ${id}`,location:`Location ${id}`,
      lamp_count:prefix==="ГТ"&&index===1?1747:0,head_count:0,
      total_heads:prefix==="ГТ"&&index===1?2582:0,needs_poles:prefix==="ГТ"&&index===1?43:0,
      light_type:"LED",wattage_per_lamp:100});
  }
  return {format:"overva.legacy-lighting.v1",sourceSystem:"choibalsan-legacy-erp",exportedAt:"ignored",points};
}

test("legacy lighting provenance source requires the exact reviewed baseline",()=>{
  const data=fixture(),summary=summarizeSource(data);
  assert.deepEqual({...summary,fingerprint:undefined},{...EXPECTED,fingerprint:undefined});
  assert.equal(summary.fingerprint.length,64);
  assert.equal(sourceFingerprint(data.points),summary.fingerprint);
  assert.throws(()=>summarizeSource({...data,points:data.points.slice(1)}),/baseline mismatch/i);
  const changed=structuredClone(data);
  changed.points[0].total_heads+=1;
  assert.throws(()=>summarizeSource(changed),/baseline mismatch/i);
});

test("fingerprint is stable across export time but changes with source identity",()=>{
  const first=fixture(),second=fixture();
  second.exportedAt="later";
  assert.equal(summarizeSource(first).fingerprint,summarizeSource(second).fingerprint);
  second.points[0].name="Changed source name";
  assert.notEqual(sourceFingerprint(first.points),sourceFingerprint(second.points));
});

test("recovered object types preserve road, signal-copy and unresolved grains",()=>{
  const data=fixture(),fingerprint=summarizeSource(data).fingerprint;
  assert.equal(desiredObject(data.points.find(row=>row.code.startsWith("ГТ-")),fingerprint).objectType,"lighting_corridor");
  assert.equal(desiredObject(data.points.find(row=>row.code.startsWith("ГД-")),fingerprint).objectType,"traffic_signal_legacy_copy");
  assert.equal(desiredObject(data.points.find(row=>row.code.startsWith("ГЧ-")),fingerprint).objectType,"legacy_unclassified");
});

test("idempotency compares nested reconciliation metadata independent of JSONB key order",()=>{
  const row=fixture().points[0],desired=desiredObject(row,"a".repeat(64));
  const current={object_type:desired.objectType,metadata:{...desired.metadata,
    provenanceReconciliation:{fingerprint:"a".repeat(64),sourceId:String(row.id),sourceTable:"sl_points",sourceSystem:"choibalsan-legacy-erp"}}};
  assert.equal(isCurrent(current,desired),true);
  current.metadata.lightType="changed";
  assert.equal(isCurrent(current,desired),false);
});

test("production reconciliation defaults to preview and requires explicit attributable write gates",()=>{
  const script=fs.readFileSync(path.join(__dirname,"..","scripts","reconcile-legacy-lighting-provenance.js"),"utf8");
  const route=fs.readFileSync(path.join(__dirname,"..","src","routes","lighting.js"),"utf8");
  assert.match(script,/const apply=process\.argv\.includes\("--apply"\)/);
  assert.match(script,/--confirm-write/);
  assert.match(script,/--confirm-production-write/);
  assert.match(script,/--confirm-fingerprint=/);
  assert.match(script,/Database identity mismatch/);
  assert.match(script,/Expected schema 0105/);
  assert.match(script,/operational-objects\.update/);
  assert.match(script,/pg_advisory_xact_lock/);
  assert.match(script,/version=version\+1/);
  assert.match(script,/INSERT INTO operational_object_events/);
  assert.match(script,/INSERT INTO audit_logs/);
  assert.match(script,/immutableSourceSnapshotPreserved:true/);
  assert.doesNotMatch(script,/UPDATE source_import_records/i);
  assert.match(route,/COALESCE\(\s*NULLIF\(o\.metadata->>'legacyCode',''\),\s*NULLIF\(source\.source_snapshot->>'code',''\)/s);
});
