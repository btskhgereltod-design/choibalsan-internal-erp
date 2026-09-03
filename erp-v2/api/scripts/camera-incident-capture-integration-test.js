"use strict";

if(process.env.RUN_CAMERA_INCIDENT_CAPTURE_INTEGRATION!=="1"){
  console.log("Set RUN_CAMERA_INCIDENT_CAPTURE_INTEGRATION=1 to run");
  process.exit(0);
}

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");
const {createApp}=require("../src/app");
const {signAccessToken}=require("../src/security/token");
const {provisionTenant}=require("../src/services/tenant-provisioning");
const runId=String(process.env.CAMERA_REHEARSAL_RUN_ID||crypto.randomUUID().slice(0,8)).toLowerCase();

async function tenant(client,suffix){
  return provisionTenant(client,{slug:`camera-rehearsal-${suffix}`,name:`Camera Rehearsal ${suffix}`,
    adminName:`Demo Owner ${suffix}`,adminEmail:`demo-${suffix}@example.invalid`,adminUsername:`demo.${suffix}`,
    adminPassword:`Rehearsal-Only-${suffix}-Password-2026`,planCode:"pilot",trialDays:1,
    enabledModules:["assets","work-orders","camera-operations"]});
}

async function request(base,path,token,options={}){
  const response=await fetch(`${base}${path}`,{...options,
    headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(options.headers||{})}});
  return {status:response.status,body:await response.json()};
}

async function main(){
  const pool=getPool(),client=await pool.connect();
  let first,second,firstObject,secondObject;
  try{
    const database=(await client.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database,/^overva_(test|rehearsal)_[a-z0-9_]+$/i);
    await client.query("BEGIN");
    first=await tenant(client,`${runId}-one`);
    firstObject=(await client.query(`INSERT INTO operational_objects(
      organization_id,code,name,object_type,domain,location,metadata)
      VALUES($1,'CAM-001','Туршилтын камерын объект','camera_site','camera','Чойбалсан','{"cameraCount":4,"subCategory":"Авто зам"}'::jsonb)
      RETURNING id`,[first.organization.id])).rows[0];
    await client.query("COMMIT");
    await client.query("BEGIN");
    second=await tenant(client,`${runId}-two`);
    secondObject=(await client.query(`INSERT INTO operational_objects(
      organization_id,code,name,object_type,domain,location,metadata)
      VALUES($1,'CAM-002','Өөр tenant-ийн камер','camera_site','camera','Бусад','{"cameraCount":2}'::jsonb) RETURNING id`,
    [second.organization.id])).rows[0];
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}

  const server=createApp().listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
  const base=`http://127.0.0.1:${server.address().port}`,token=signAccessToken(first.owner.id);
  try{
    const workspace=await request(base,"/api/camera/workspace",token);
    assert.equal(workspace.status,200);
    assert.equal(workspace.body.incidentTypes.length,6);
    assert.equal(workspace.body.capabilities.canReportIncidents,true);
    const idempotencyKey=crypto.randomUUID(),rowKey=crypto.randomUUID();
    const payload={idempotencyKey,rows:[{rowKey,operationalObjectId:firstObject.id,
      incidentType:"device_unavailable",affectedQuantity:2,reportedAt:new Date().toISOString(),note:"Rehearsal"}]};
    const created=await request(base,"/api/camera/incidents/batch",token,{method:"POST",body:JSON.stringify(payload)});
    assert.equal(created.status,201);
    assert.equal(created.body.replayed,false);
    const replay=await request(base,"/api/camera/incidents/batch",token,{method:"POST",body:JSON.stringify(payload)});
    assert.equal(replay.status,200);
    assert.equal(replay.body.replayed,true);
    const conflict=await request(base,"/api/camera/incidents/batch",token,{method:"POST",
      body:JSON.stringify({...payload,rows:[{...payload.rows[0],affectedQuantity:1}]})});
    assert.equal(conflict.status,409);
    assert.equal(conflict.body.error,"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
    const overCapacity=await request(base,"/api/camera/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),affectedQuantity:3}]
    })});
    assert.equal(overCapacity.status,409);
    assert.equal(overCapacity.body.code,"INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY");
    assert.equal(overCapacity.body.referenceQuantity,4);
    assert.equal(overCapacity.body.openQuantity,2);
    const occurrence=await request(base,"/api/camera/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),incidentType:"network_fault",affectedQuantity:20}]
    })});
    assert.equal(occurrence.status,201);
    const crossTenant=await request(base,"/api/camera/incidents/batch",token,{method:"POST",body:JSON.stringify({
      idempotencyKey:crypto.randomUUID(),rows:[{...payload.rows[0],rowKey:crypto.randomUUID(),operationalObjectId:secondObject.id}]
    })});
    assert.equal(crossTenant.status,409);
    assert.equal(crossTenant.body.code,"INVALID_CAMERA_OBJECT");
    const evidence=await pool.query(`SELECT
      (SELECT count(*) FROM operational_incidents WHERE organization_id=$1 AND domain='camera') incidents,
      (SELECT count(*) FROM operational_incident_events WHERE organization_id=$1 AND event_type='reported') events,
      (SELECT count(*) FROM operational_incident_command_receipts WHERE organization_id=$1 AND command_type='report_camera_batch') receipts,
      (SELECT count(*) FROM audit_logs WHERE organization_id=$1 AND action='operational_incident.report') audits`,[first.organization.id]);
    assert.deepEqual(Object.fromEntries(Object.entries(evidence.rows[0]).map(([key,value])=>[key,Number(value)])),
      {incidents:2,events:2,receipts:2,audits:2});
    console.log(JSON.stringify({ok:true,incidentTypes:6,idempotent:true,capacityBounded:true,
      occurrenceUnbounded:true,crossTenantBlocked:true,evidence:evidence.rows[0]}));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
