"use strict";

if(process.env.RUN_CAMERA_PROFILE_INTEGRATION!=="1"){
  console.log("Set RUN_CAMERA_PROFILE_INTEGRATION=1 to run");
  process.exit(0);
}

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");
const baseUrl=String(process.env.CAMERA_PROFILE_TEST_BASE_URL||"http://127.0.0.1:4198").replace(/\/$/,"");

async function call(path,headers,options={}){
  const response=await fetch(`${baseUrl}${path}`,{...options,headers:{...headers,...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  return {response,body};
}

async function run(){
  const pool=getPool(),database=(await pool.query("SELECT current_database() database")).rows[0].database;
  if(database!=="overva_test_camera_profile_0102")throw new Error(`Refusing integration test on ${database}`);
  const user=(await pool.query("SELECT id,organization_id FROM users WHERE email='admin@choibalsan.local' LIMIT 1")).rows[0];
  if(!user)throw new Error("Bootstrap user missing");
  for(const moduleCode of ["assets","work-orders","camera-operations"]){
    await pool.query(`INSERT INTO organization_modules(organization_id,module_code,enabled,enabled_by)
      VALUES($1,$2,true,$3) ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true`,[user.organization_id,moduleCode,user.id]);
  }
  let object=(await pool.query("SELECT id,version FROM operational_objects WHERE organization_id=$1 AND code='CAMERA-TEST-001'",[user.organization_id])).rows[0];
  if(!object)object=(await pool.query(`INSERT INTO operational_objects(organization_id,code,name,object_type,domain,location)
    VALUES($1,'CAMERA-TEST-001','Camera integration point','camera_location','camera','Test junction') RETURNING id,version`,[user.organization_id])).rows[0];
  const headers={authorization:`Bearer ${signAccessToken(user.id)}`,"content-type":"application/json"};
  const initial=await call(`/api/camera/objects/${object.id}/dossier`,headers);
  if(!initial.response.ok)throw new Error(`Initial dossier ${initial.response.status}: ${JSON.stringify(initial.body)}`);
  if(Object.hasOwn(initial.body,"incidents")||Object.hasOwn(initial.body,"workOrders"))throw new Error("Camera master leaked operational queues");
  const profile={expectedObjectVersion:Number(initial.body.item.version),note:"Camera profile integration",points:[
    {name:"North pole",poleReference:"CAM-P-01",latitude:48.071111,longitude:114.531111,locationNote:"North side",devices:[
      {deviceType:"Fixed",manufacturer:"Example",model:"F-4MP",quantity:2,resolutionMp:4,lensMm:2.8,supportsPtz:false,nightVision:true,connectivity:"IP/fiber",powerSource:"PoE",note:""},
      {deviceType:"PTZ",manufacturer:"Example",model:"P-8MP",quantity:1,resolutionMp:8,lensMm:4.8,supportsPtz:true,nightVision:true,connectivity:"IP/fiber",powerSource:"PoE+",note:""}
    ]},
    {name:"South pole",poleReference:"CAM-P-02",latitude:48.070111,longitude:114.530111,locationNote:"South side",devices:[
      {deviceType:"Fixed",manufacturer:"Example",model:"F-4MP",quantity:1,resolutionMp:4,lensMm:2.8,supportsPtz:false,nightVision:true,connectivity:"IP/fiber",powerSource:"PoE",note:""}
    ]}
  ]};
  const saved=await call(`/api/camera/objects/${object.id}/specifications`,headers,{method:"POST",body:JSON.stringify(profile)});
  if(saved.response.status!==201)throw new Error(`Save ${saved.response.status}: ${JSON.stringify(saved.body)}`);
  const conflict=await call(`/api/camera/objects/${object.id}/specifications`,headers,{method:"POST",body:JSON.stringify(profile)});
  if(conflict.response.status!==409||conflict.body.code!=="VERSION_CONFLICT")throw new Error("Stale camera profile was accepted");
  const dossier=await call(`/api/camera/objects/${object.id}/dossier`,headers);
  if(!dossier.response.ok||dossier.body.cameraPoints.length!==2||dossier.body.cameraDevices.length!==3)throw new Error("Camera profile did not round trip");
  const total=dossier.body.cameraDevices.reduce((sum,row)=>sum+Number(row.quantity),0);
  if(total!==4)throw new Error(`Expected 4 cameras; got ${total}`);
  const workspace=await call("/api/camera/workspace",headers);
  const projected=workspace.body.assets?.find(row=>row.id===object.id);
  if(!workspace.response.ok||Number(projected?.camera_count)!==4||projected?.classification_state!=="canonical")throw new Error("Workspace did not project canonical camera count");
  const evidence=(await pool.query(`SELECT
    (SELECT count(*)::int FROM operational_object_events WHERE operational_object_id=$1 AND event_type='specification_changed') events,
    (SELECT count(*)::int FROM audit_logs WHERE entity_type='operational_object' AND entity_id=$1::text AND action='operational_object.camera_specification.create') audits`,[object.id])).rows[0];
  if(Number(evidence.events)!==1||Number(evidence.audits)!==1)throw new Error(`Unexpected evidence ${JSON.stringify(evidence)}`);
  console.log(JSON.stringify({database,objectId:object.id,points:2,deviceGroups:3,cameras:4,staleWriteRejected:true,evidence}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);await closePool().catch(()=>{});process.exitCode=1;
});
