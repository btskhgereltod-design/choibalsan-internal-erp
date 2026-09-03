"use strict";

if(process.env.RUN_OBJECT_PROFILE_INTEGRATION!=="1"){
  console.log("Set RUN_OBJECT_PROFILE_INTEGRATION=1 to run");
  process.exit(0);
}

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

const baseUrl=String(process.env.OBJECT_PROFILE_TEST_BASE_URL||"http://127.0.0.1:4199").replace(/\/$/,"");

async function request(path,options={}){
  const response=await fetch(`${baseUrl}${path}`,options);
  const contentType=response.headers.get("content-type")||"";
  const body=contentType.includes("application/json")?await response.json():await response.arrayBuffer();
  return {response,body};
}

async function run(){
  const database=(await getPool().query("SELECT current_database() database")).rows[0].database;
  if(database!=="overva_test_object_profile_0101")throw new Error(`Refusing integration test on ${database}`);
  const user=(await getPool().query("SELECT id,organization_id FROM users WHERE email='admin@choibalsan.local' LIMIT 1")).rows[0];
  const object=(await getPool().query("SELECT id,version FROM operational_objects WHERE organization_id=$1 AND code='ROAD-001'",[user.organization_id])).rows[0];
  if(!user||!object)throw new Error("Integration fixtures are missing");
  const headers={authorization:`Bearer ${signAccessToken(user.id)}`};

  const initial=await request(`/api/lighting/objects/${object.id}/dossier`,{headers});
  if(!initial.response.ok)throw new Error(`Initial dossier ${initial.response.status}: ${JSON.stringify(initial.body)}`);

  const payload={
    expectedObjectVersion:Number(initial.body.item.version),
    poleCount:200,
    linearLengthM:5000,
    note:"Integration technical profile",
    lampGroups:[
      {lampType:"LED",wattageW:150,headCount:200},
      {lampType:"LED",wattageW:50,headCount:200},
    ],
    supplyPoints:[1,2,3,4,5].map((number,index)=>({
      name:`Supply ${number}`,
      panelAssetId:null,
      panelReference:`PANEL-${number}`,
      meterAssetId:null,
      meterNumber:`METER-${number}`,
      latitude:48.07+(index/1000),
      longitude:114.53+(index/1000),
      locationNote:`Point ${number}`,
    })),
  };
  const saved=await request(`/api/lighting/objects/${object.id}/specifications`,{
    method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(payload),
  });
  if(saved.response.status!==201)throw new Error(`Save profile ${saved.response.status}: ${JSON.stringify(saved.body)}`);

  const conflict=await request(`/api/lighting/objects/${object.id}/specifications`,{
    method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(payload),
  });
  if(conflict.response.status!==409||conflict.body.code!=="VERSION_CONFLICT")throw new Error("Stale object version was accepted");

  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  const form=new FormData();
  form.append("file",new Blob([png],{type:"image/png"}),"location.png");
  const uploaded=await request(`/api/lighting/objects/${object.id}/media/location_scheme`,{method:"POST",headers,body:form});
  if(uploaded.response.status!==201)throw new Error(`Upload media ${uploaded.response.status}: ${JSON.stringify(uploaded.body)}`);

  const dossier=await request(`/api/lighting/objects/${object.id}/dossier`,{headers});
  if(!dossier.response.ok)throw new Error(`Final dossier ${dossier.response.status}: ${JSON.stringify(dossier.body)}`);
  if(Number(dossier.body.item.specification_pole_count)!==200)throw new Error("Pole count did not round trip");
  if(dossier.body.lampGroups.length!==2||dossier.body.lampGroups.reduce((sum,row)=>sum+Number(row.head_count),0)!==400)throw new Error("Lamp groups did not round trip");
  if(dossier.body.supplyPoints.length!==5)throw new Error("Supply points did not round trip");
  const scheme=dossier.body.media.find(item=>item.relation_type==="location_scheme");
  if(!scheme)throw new Error("Canonical scheme link is missing");
  const downloaded=await request(`/api/lighting/objects/${object.id}/media/${scheme.id}/file`,{headers});
  if(!downloaded.response.ok||!downloaded.response.headers.get("content-type")?.startsWith("image/png"))throw new Error("Scheme download failed");

  const evidence=(await getPool().query(`SELECT
    (SELECT count(*)::int FROM operational_object_specifications WHERE operational_object_id=$1) specifications,
    (SELECT count(*)::int FROM operational_object_events WHERE operational_object_id=$1 AND event_type IN('specification_changed','media_added')) object_events,
    (SELECT count(*)::int FROM audit_logs WHERE entity_type='operational_object' AND entity_id=$1::text
      AND action IN('operational_object.specification.create','operational_object.media.add')) audits,
    (SELECT count(*)::int FROM document_links WHERE entity_type='operational_object' AND entity_id=$1::text) document_links`,[object.id])).rows[0];
  if(Number(evidence.specifications)!==1||Number(evidence.object_events)!==2||Number(evidence.audits)!==2||Number(evidence.document_links)!==1){
    throw new Error(`Unexpected evidence: ${JSON.stringify(evidence)}`);
  }
  console.log(JSON.stringify({database,objectId:object.id,poles:200,heads:400,supplyPoints:5,
    staleWriteRejected:true,schemeDownloaded:true,evidence}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);
  await closePool().catch(()=>{});
  process.exitCode=1;
});
