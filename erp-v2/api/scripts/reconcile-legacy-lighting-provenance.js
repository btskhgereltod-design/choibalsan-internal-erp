"use strict";

require("dotenv").config();
const crypto=require("node:crypto");
const {isDeepStrictEqual}=require("node:util");
const {getPool,closePool}=require("../src/db");

const EXPECTED={points:117,road:36,signals:12,unresolved:69,poles:1747,heads:2582,replacements:43,
  prefixes:{"ГТ":36,"ГД":12,"ГЧ":25,"НЭ":23,"ЯЗ":18,"НГ":3}};
const ACTION="legacy_lighting.provenance_reconcile";
const base64Input=process.argv.includes("--base64");
const apply=process.argv.includes("--apply");
const confirmWrite=process.argv.includes("--confirm-write");
const confirmProductionWrite=process.argv.includes("--confirm-production-write");
const fingerprintArgument=process.argv.find(value=>value.startsWith("--confirm-fingerprint="));
const confirmedFingerprint=fingerprintArgument?.slice("--confirm-fingerprint=".length)||"";
const clean=value=>String(value??"").trim();
const integer=value=>Number.isInteger(Number(value))?Number(value):0;
const stablePoint=row=>({id:String(row.id),code:clean(row.code),name:clean(row.name),location:clean(row.location),
  lampCount:integer(row.lamp_count),headCount:integer(row.head_count),totalHeads:integer(row.total_heads),
  replacementPoles:integer(row.needs_poles),lightType:clean(row.light_type),wattagePerLamp:Number(row.wattage_per_lamp)||0});
const sourceFingerprint=points=>crypto.createHash("sha256").update(JSON.stringify(points.map(stablePoint)
  .sort((left,right)=>left.id.localeCompare(right.id,"en",{numeric:true})))).digest("hex");

function summarizeSource(data){
  if(data?.format!=="overva.legacy-lighting.v1"||data?.sourceSystem!=="choibalsan-legacy-erp"){
    throw new Error("Expected the reviewed read-only Choibalsan legacy lighting export");
  }
  const points=Array.isArray(data.points)?data.points:[];
  const ids=new Set(),codes=new Set(),prefixes={};
  for(const row of points){
    const id=String(row.id),code=clean(row.code),prefix=code.split("-")[0];
    if(!id||ids.has(id))throw new Error(`Duplicate or empty legacy point id: ${id}`);
    if(!code||codes.has(code))throw new Error(`Duplicate or empty legacy point code: ${code}`);
    ids.add(id);codes.add(code);prefixes[prefix]=(prefixes[prefix]||0)+1;
  }
  const road=points.filter(row=>clean(row.code).startsWith("ГТ-"));
  const signals=points.filter(row=>clean(row.code).startsWith("ГД-"));
  const roadTotals=road.reduce((sum,row)=>({poles:sum.poles+integer(row.lamp_count),
    heads:sum.heads+integer(row.total_heads),replacements:sum.replacements+integer(row.needs_poles)}),
  {poles:0,heads:0,replacements:0});
  const unresolved=points.length-road.length-signals.length;
  const summary={points:points.length,road:road.length,signals:signals.length,unresolved,
    poles:roadTotals.poles,heads:roadTotals.heads,replacements:roadTotals.replacements,prefixes};
  for(const key of ["points","road","signals","unresolved","poles","heads","replacements"]){
    if(summary[key]!==EXPECTED[key])throw new Error(`Legacy baseline mismatch: ${key}=${summary[key]}, expected ${EXPECTED[key]}`);
  }
  const actualPrefixes=Object.keys(prefixes).sort(),expectedPrefixes=Object.keys(EXPECTED.prefixes).sort();
  if(JSON.stringify(actualPrefixes)!==JSON.stringify(expectedPrefixes))throw new Error(`Unexpected legacy prefixes: ${actualPrefixes.join(",")}`);
  for(const prefix of expectedPrefixes)if(prefixes[prefix]!==EXPECTED.prefixes[prefix]){
    throw new Error(`Legacy prefix mismatch: ${prefix}=${prefixes[prefix]}, expected ${EXPECTED.prefixes[prefix]}`);
  }
  return {...summary,fingerprint:sourceFingerprint(points)};
}

const read=()=>new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");
  process.stdin.on("data",chunk=>{body+=chunk});process.stdin.on("end",()=>{try{
    const payload=base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body;
    resolve(JSON.parse(payload));
  }catch(error){reject(new Error(`Invalid reconciliation input: ${error.message}`))}});process.stdin.on("error",reject)});

function desiredObject(row,fingerprint){
  const legacyCode=clean(row.code),prefix=legacyCode.split("-")[0];
  const objectType=prefix==="ГТ"?"lighting_corridor":prefix==="ГД"?"traffic_signal_legacy_copy":"legacy_unclassified";
  return {objectType,metadata:{legacyCode,legacyId:row.id,lightType:row.light_type??null,
    poleCount:integer(row.lamp_count),headCountPerPole:row.head_count??null,totalHeadCount:integer(row.total_heads),
    lampCount:integer(row.lamp_count),headCount:row.head_count??row.total_heads??0,
    replacementPoleCount:integer(row.needs_poles),wattagePerLamp:row.wattage_per_lamp??null,
    provenanceReconciliation:{sourceSystem:"choibalsan-legacy-erp",sourceTable:"sl_points",sourceId:String(row.id),fingerprint}}};
}

function isCurrent(current,desired){
  const metadata=current.metadata||{};
  return current.object_type===desired.objectType&&Object.entries(desired.metadata)
    .every(([key,value])=>isDeepStrictEqual(metadata[key]??null,value??null));
}

async function main(){
  const data=await read(),summary=summarizeSource(data),points=[...data.points].sort((a,b)=>String(a.id).localeCompare(String(b.id),"en",{numeric:true}));
  const targetDatabase=clean(process.env.RECONCILE_TARGET_DATABASE);
  const targetEnvironment=clean(process.env.RECONCILE_TARGET_ENVIRONMENT);
  const organizationSlug=clean(process.env.RECONCILE_TARGET_ORGANIZATION);
  const targetSourceSystem=clean(process.env.RECONCILE_TARGET_SOURCE_SYSTEM);
  const actorUsername=clean(process.env.RECONCILE_ACTOR_USERNAME);
  if(!targetDatabase||!organizationSlug||!targetSourceSystem||!actorUsername)throw new Error(
    "RECONCILE_TARGET_DATABASE, RECONCILE_TARGET_ORGANIZATION, RECONCILE_TARGET_SOURCE_SYSTEM and RECONCILE_ACTOR_USERNAME are required");
  if(!new Set(["rehearsal","production"]).has(targetEnvironment))throw new Error("RECONCILE_TARGET_ENVIRONMENT must be rehearsal or production");
  if(targetSourceSystem!==data.sourceSystem)throw new Error("Target source system does not match export source system");
  if(apply&&(!confirmWrite||confirmedFingerprint!==summary.fingerprint))throw new Error(
    "Apply requires --confirm-write and the exact --confirm-fingerprint value from dry-run");
  if(apply&&targetEnvironment==="production"&&!confirmProductionWrite)throw new Error(
    "Production apply additionally requires --confirm-production-write");

  const client=await getPool().connect();
  try{
    await client.query(apply?"BEGIN ISOLATION LEVEL SERIALIZABLE":"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state=(await client.query("SELECT current_database() database,(SELECT max(version) FROM schema_migrations) schema")).rows[0];
    if(state.database!==targetDatabase)throw new Error(`Database identity mismatch: ${state.database}`);
    if(state.schema!=="0105")throw new Error(`Expected schema 0105; got ${state.schema}`);
    const organization=(await client.query(
      `SELECT id FROM organizations WHERE slug=$1${apply?" FOR UPDATE":""}`,[organizationSlug])).rows[0];
    if(!organization)throw new Error(`Organization not found: ${organizationSlug}`);
    const organizationId=organization.id;
    if(apply)await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[organizationId,ACTION]);
    const actor=(await client.query(`SELECT u.id FROM users u WHERE u.organization_id=$1 AND lower(u.username)=lower($2)
      AND u.active=true AND EXISTS(SELECT 1 FROM user_roles ur JOIN organization_roles r
        ON r.organization_id=ur.organization_id AND r.id=ur.role_id JOIN organization_role_permissions rp
        ON rp.organization_id=r.organization_id AND rp.role_id=r.id
        WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id
          AND rp.permission_code='operational-objects.update')`,[organizationId,actorUsername])).rows[0];
    if(!actor)throw new Error("Attributed actor lacks operational-objects.update");
    const currentRows=(await client.query(`SELECT o.id,o.source_id,o.name,o.object_type,o.metadata,o.version,
        source.source_snapshot->>'code' snapshot_code
      FROM operational_objects o JOIN source_import_records source
        ON source.organization_id=o.organization_id AND source.source_system=o.source_system
        AND source.source_table=o.source_table AND source.source_id=o.source_id
      WHERE o.organization_id=$1 AND o.domain='lighting' AND o.source_system=$2 AND o.source_table='sl_points'
      ORDER BY o.source_id`,[organizationId,targetSourceSystem])).rows;
    if(currentRows.length!==EXPECTED.points)throw new Error(`Target sl_points count ${currentRows.length}; expected ${EXPECTED.points}`);
    const currentBySourceId=new Map(currentRows.map(row=>[String(row.source_id),row]));
    if(currentBySourceId.size!==EXPECTED.points)throw new Error("Target sl_points source ids are not unique");
    let corruptedSnapshotCodes=0,alreadyCurrent=0;
    const changes=[];
    for(const row of points){
      const current=currentBySourceId.get(String(row.id));
      if(!current)throw new Error(`Target object missing for legacy id ${row.id}`);
      if(clean(current.name)!==clean(row.name))throw new Error(`Object/source name mismatch for legacy id ${row.id}`);
      if(Buffer.from(clean(current.snapshot_code).slice(0,3),"utf8").toString("hex")==="3f3f2d")corruptedSnapshotCodes+=1;
      const desired=desiredObject(row,summary.fingerprint);
      if(isCurrent(current,desired)){alreadyCurrent+=1;continue}
      changes.push({row,current,desired});
    }
    if(corruptedSnapshotCodes!==EXPECTED.points)throw new Error(
      `Expected 117 literal ??- source codes before reconciliation; got ${corruptedSnapshotCodes}`);
    const previous=(await client.query(`SELECT id,detail FROM audit_logs WHERE organization_id=$1 AND action=$2
      AND detail->>'sourceFingerprint'=$3 ORDER BY id DESC LIMIT 1`,[organizationId,ACTION,summary.fingerprint])).rows[0];
    if(previous&&changes.length)throw new Error("Reconciliation receipt exists but target objects no longer match it");
    if(apply&&!previous&&!changes.length)throw new Error("Targets are current but the attributable reconciliation receipt is missing");
    const counts={objects:changes.length,road:changes.filter(x=>x.desired.objectType==="lighting_corridor").length,
      signalCopies:changes.filter(x=>x.desired.objectType==="traffic_signal_legacy_copy").length,
      unresolved:changes.filter(x=>x.desired.objectType==="legacy_unclassified").length,events:0,audits:0};
    if(apply&&!previous){
      for(const change of changes){
        const updated=(await client.query(`UPDATE operational_objects SET object_type=$4,
          metadata=metadata||$5::jsonb,version=version+1,updated_at=now()
          WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING version`,
        [organizationId,change.current.id,change.current.version,change.desired.objectType,JSON.stringify(change.desired.metadata)])).rows[0];
        if(!updated)throw new Error(`Concurrent object change for legacy id ${change.row.id}`);
        await client.query(`INSERT INTO operational_object_events(
          organization_id,operational_object_id,actor_user_id,event_type,note,detail)
          VALUES($1,$2,$3,'updated',$4,$5::jsonb)`,[organizationId,change.current.id,actor.id,
          "Хуучин ERP-ийн эх кодоор объектын provenance ангиллыг сэргээв",
          JSON.stringify({reason:"legacy lighting provenance reconciliation",sourceFingerprint:summary.fingerprint,
            sourceSystem:data.sourceSystem,sourceTable:"sl_points",sourceId:String(change.row.id),
            legacyCode:change.desired.metadata.legacyCode,previousObjectType:change.current.object_type,
            objectType:change.desired.objectType,previousVersion:Number(change.current.version),objectVersion:Number(updated.version)})]);
        counts.events+=1;
      }
      await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
        VALUES($1,$2,$3,'legacy_import',$1::uuid::text,$4::jsonb)`,[organizationId,actor.id,ACTION,
        JSON.stringify({sourceFingerprint:summary.fingerprint,sourceSystem:data.sourceSystem,targetSourceSystem,
          immutableSourceSnapshotPreserved:true,reviewedBaseline:EXPECTED,counts})]);
      counts.audits=1;
    }
    if(apply)await client.query("COMMIT");else await client.query("ROLLBACK");
    console.log(JSON.stringify({ok:true,mode:apply?"apply":"dry-run",environment:targetEnvironment,database:state.database,
      organization:organizationSlug,targetSourceSystem,sourceFingerprint:summary.fingerprint,summary,
      target:{objects:currentRows.length,corruptedSnapshotCodes,alreadyCurrent},changes:counts,replay:Boolean(previous)},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1});

module.exports={EXPECTED,sourceFingerprint,summarizeSource,desiredObject,isCurrent};
