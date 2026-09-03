"use strict";

if(process.env.RUN_LIGHTING_INCIDENT_CAPTURE_INTEGRATION!=="1"){
  console.log("Set RUN_LIGHTING_INCIDENT_CAPTURE_INTEGRATION=1 to run");
  process.exit(0);
}

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");
const {createApp}=require("../src/app");
const {signAccessToken}=require("../src/security/token");
const {provisionTenant}=require("../src/services/tenant-provisioning");
const {ensureLightingIncidentConfiguration}=require("../src/services/lighting-configuration");
const runId=String(process.env.LIGHTING_REHEARSAL_RUN_ID||crypto.randomUUID().slice(0,8)).toLowerCase();

async function tenant(client,suffix){
  return provisionTenant(client,{
    slug:`lighting-rehearsal-${suffix}`,
    name:`Lighting Rehearsal ${suffix}`,
    adminName:`Demo Owner ${suffix}`,
    adminEmail:`demo-${suffix}@example.invalid`,
    adminUsername:`demo.${suffix}`,
    adminPassword:`Rehearsal-Only-${suffix}-Password-2026`,
    planCode:"pilot",trialDays:1,enabledModules:["assets","work-orders","lighting-operations"]
  });
}

async function request(base,path,token,options={}){
  const response=await fetch(`${base}${path}`,{
    ...options,
    headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(options.headers||{})}
  });
  return {status:response.status,body:await response.json()};
}

async function main(){
  const pool=getPool(),client=await pool.connect();
  let first,second,firstObject,towerObject,secondObject;
  try{
    const database=(await client.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database,/^overva_(test|rehearsal)_[a-z0-9_]+$/i);
    await client.query("BEGIN");
    first=await tenant(client,`${runId}-one`);
    await ensureLightingIncidentConfiguration(client,first.organization.id);
    await client.query(`INSERT INTO organization_work_service_areas(organization_id,domain,code,name,icon)
      VALUES($1,'lighting','road-lighting','Авто замын гэрэл','💡'),
        ($1,'lighting','tower-lighting','Цамхагийн гэрэл','🗼')`,[first.organization.id]);
    firstObject=(await client.query(`INSERT INTO operational_objects(
      organization_id,code,name,object_type,domain,location,metadata)
      VALUES($1,'ROAD-001','Чойбалсангийн гудамж','lighting_corridor','lighting','Чойбалсан',
        '{"lampCount":200,"headCount":400}'::jsonb) RETURNING id`,[first.organization.id])).rows[0];
    towerObject=(await client.query(`INSERT INTO operational_objects(
      organization_id,code,name,object_type,domain,location,metadata,source_system,source_table,source_id)
      VALUES($1,'TOWER-001','Туршилтын цамхаг','lighting_group','lighting','Чойбалсан',
        '{"lampCount":6,"headCount":0}'::jsonb,'legacy-rehearsal','sl_ger_inventory','tower-1') RETURNING id`,
    [first.organization.id])).rows[0];
    await client.query(`INSERT INTO source_import_records(
      organization_id,source_system,source_table,source_id,target_type,target_id,source_snapshot)
      VALUES($1,'legacy-rehearsal','sl_ger_inventory','tower-1','operational_object',$2,
        '{"category":"Цамхаг","total_count":6,"head_count":0}'::jsonb)`,[first.organization.id,towerObject.id]);
    await client.query("COMMIT");
    await client.query("BEGIN");
    second=await tenant(client,`${runId}-two`);
    await ensureLightingIncidentConfiguration(client,second.organization.id);
    secondObject=(await client.query(`INSERT INTO operational_objects(
      organization_id,code,name,object_type,domain,location)
      VALUES($1,'ROAD-002','Өөр tenant-ийн гудамж','lighting_corridor','lighting','Бусад') RETURNING id`,
    [second.organization.id])).rows[0];
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}

  const server=createApp().listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
  const base=`http://127.0.0.1:${server.address().port}`,token=signAccessToken(first.owner.id);
  try{
    const workspace=await request(base,"/api/lighting/workspace",token);
    assert.equal(workspace.status,200);
    assert.equal(workspace.body.incidentTypes.length,8);
    assert.equal(workspace.body.capabilities.canReportIncidents,true);
    const projectedTower=workspace.body.assets.find(item=>item.id===towerObject.id);
    assert.equal(projectedTower.service_area_code,"tower-lighting");
    assert.equal(Number(projectedTower.pole_count),1);
    assert.equal(Number(projectedTower.head_count),6);
    assert.equal(Number(projectedTower.head_count_per_pole),6);
    const towerDossier=await request(base,`/api/lighting/objects/${towerObject.id}/dossier`,token);
    assert.equal(towerDossier.status,200);
    assert.equal(Number(towerDossier.body.item.legacy_pole_count),1);
    assert.equal(Number(towerDossier.body.item.legacy_total_head_count),6);
    assert.equal(Number(towerDossier.body.item.legacy_head_count_per_pole),6);
    const idempotencyKey=crypto.randomUUID(),rowKey=crypto.randomUUID();
    const payload={idempotencyKey,rows:[{rowKey,operationalObjectId:firstObject.id,
      incidentType:"lamp_out",affectedQuantity:3,reportedAt:"2026-09-03T04:00:00.000Z",note:"Rehearsal observation"}]};
    const created=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify(payload)});
    assert.equal(created.status,201);
    assert.equal(created.body.replayed,false);
    assert.equal(created.body.items.length,1);
    const replay=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify(payload)});
    assert.equal(replay.status,200);
    assert.equal(replay.body.replayed,true);
    const conflict=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",
      body:JSON.stringify({...payload,rows:[{...payload.rows[0],affectedQuantity:4}]})});
    assert.equal(conflict.status,409);
    assert.equal(conflict.body.error,"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    const duplicateTarget=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[payload.rows[0],{...payload.rows[0],rowKey:crypto.randomUUID()}]
    })});
    assert.equal(duplicateTarget.status,400);
    assert.equal(duplicateTarget.body.code,"DUPLICATE_INCIDENT_TARGET");
    const future=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),reportedAt:new Date(Date.now()+10*60*1000).toISOString()}]
    })});
    assert.equal(future.status,400);
    assert.equal(future.body.code,"FUTURE_REPORTED_AT");
    const overCapacity=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),affectedQuantity:398}]
    })});
    assert.equal(overCapacity.status,409);
    assert.equal(overCapacity.body.code,"INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY");
    assert.equal(overCapacity.body.quantityUnit,"толгой");
    assert.equal(overCapacity.body.referenceQuantity,400);
    assert.equal(overCapacity.body.openQuantity,3);
    const towerHeadCapacity=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),operationalObjectId:towerObject.id,affectedQuantity:7}]
    })});
    assert.equal(towerHeadCapacity.status,409);
    assert.equal(towerHeadCapacity.body.referenceQuantity,6);
    assert.equal(towerHeadCapacity.body.quantityUnit,"толгой");
    const towerPoleCapacity=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),operationalObjectId:towerObject.id,
        incidentType:"pole_damage",affectedQuantity:2}]
    })});
    assert.equal(towerPoleCapacity.status,409);
    assert.equal(towerPoleCapacity.body.referenceQuantity,1);
    assert.equal(towerPoleCapacity.body.quantityUnit,"шон");
    const crossTenant=await request(base,"/api/lighting/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),operationalObjectId:secondObject.id}]
    })});
    assert.equal(crossTenant.status,409);
    assert.equal(crossTenant.body.code,"INVALID_LIGHTING_OBJECT");
    const evidence=await pool.query(`SELECT
      (SELECT count(*) FROM operational_incidents WHERE organization_id=$1 AND domain='lighting') incidents,
      (SELECT count(*) FROM operational_incident_events WHERE organization_id=$1 AND event_type='reported') events,
      (SELECT count(*) FROM operational_incident_command_receipts WHERE organization_id=$1) receipts,
      (SELECT count(*) FROM audit_logs WHERE organization_id=$1 AND action='operational_incident.report') audits`,
    [first.organization.id]);
    assert.deepEqual(Object.fromEntries(Object.entries(evidence.rows[0]).map(([key,value])=>[key,Number(value)])),
      {incidents:1,events:1,receipts:1,audits:1});
    console.log(JSON.stringify({ok:true,incidentTypes:8,towerProjection:{poles:1,heads:6},idempotent:true,crossTenantBlocked:true,evidence:evidence.rows[0]}));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
