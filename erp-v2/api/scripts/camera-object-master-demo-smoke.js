"use strict";

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");
const baseUrl=String(process.env.CAMERA_DEMO_BASE_URL||"http://127.0.0.1:4200").replace(/\/$/,"");
const organization=String(process.env.CAMERA_DEMO_ORGANIZATION||"choibalsan-hugjil");
const username=String(process.env.CAMERA_DEMO_USERNAME||"").trim();
const expectedDatabase=String(process.env.CAMERA_DEMO_DATABASE||"overva_rehearsal_lighting_demo");

async function json(path,headers){
  const response=await fetch(`${baseUrl}${path}`,{headers}),body=await response.json();
  if(!response.ok)throw new Error(`${path} ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function run(){
  if(!username)throw new Error("CAMERA_DEMO_USERNAME is required");
  const state=(await getPool().query("SELECT current_database() database,(SELECT max(version) FROM schema_migrations) schema")).rows[0];
  if(state.database!==expectedDatabase||state.schema!=="0105")throw new Error(`Unexpected demo target ${state.database}/${state.schema}`);
  const user=await getPool().query(`SELECT user_account.id FROM users user_account JOIN organizations organization
    ON organization.id=user_account.organization_id WHERE organization.slug=$1 AND user_account.username=$2 AND user_account.active=true LIMIT 1`,[organization,username]);
  if(!user.rowCount)throw new Error("Demo user not found");
  const headers={authorization:`Bearer ${signAccessToken(user.rows[0].id)}`};
  const camera=await json("/api/camera/workspace",headers),lighting=await json("/api/lighting/workspace",headers);
  if(camera.assets.length!==110)throw new Error(`Expected 110 camera objects; got ${camera.assets.length}`);
  if(Number(camera.summary.devices)!==302)throw new Error(`Expected 302 legacy camera references; got ${camera.summary.devices}`);
  const groupCounts=new Map(),operationalStates={attention:0,decision:0,normal:0};
  for(const item of camera.assets){
    const group=String(item.source_group_code||"unclassified");
    groupCounts.set(group,(groupCounts.get(group)||0)+1);
    if(/татан буулгах|нүүлгэх/i.test(item.source_condition||""))operationalStates.decision++;
    else if(Number(item.open_incident_count)>0)operationalStates.attention++;
    else operationalStates.normal++;
  }
  const expectedGroups={3:1,5:1,7:15,8:9,9:21,98:43,99:20};
  for(const [group,count] of Object.entries(expectedGroups))if(groupCounts.get(group)!==count){
    throw new Error(`Expected camera source group ${group}=${count}; got ${groupCounts.get(group)||0}`);
  }
  if(operationalStates.attention!==20||operationalStates.decision!==10||operationalStates.normal!==80){
    throw new Error(`Unexpected camera operational state projection ${JSON.stringify(operationalStates)}`);
  }
  if(camera.incidentTypes.length!==6)throw new Error(`Expected 6 camera incident types; got ${camera.incidentTypes.length}`);
  if(!camera.capabilities.canReportIncidents)throw new Error("Demo owner lacks camera incident report permission");
  const dossier=await json(`/api/camera/objects/${camera.assets[0].id}/dossier`,headers);
  if(Object.hasOwn(dossier,"incidents")||Object.hasOwn(dossier,"workOrders"))throw new Error("Camera master dossier leaked operational queues");
  if(!Array.isArray(dossier.cameraPoints)||!Array.isArray(dossier.cameraDevices))throw new Error("Camera master collections missing");
  if(!dossier.capabilities.canUpdate||!dossier.capabilities.canRetire)throw new Error("Demo owner lacks camera master permissions");
  if(lighting.serviceAreas.some(area=>area.code==="panel-board"))throw new Error("Panel/board still appears as a lighting service area");
  if(lighting.fixedAssets.some(asset=>asset.category==="Шит/Самбар"))throw new Error("Panel/board still appears as a parallel lighting registry row");
  console.log(JSON.stringify({database:state.database,schema:state.schema,cameraObjects:camera.assets.length,
    legacyCameraReferences:Number(camera.summary.devices),incidentTypes:camera.incidentTypes.length,
    sourceGroups:Object.fromEntries(groupCounts),operationalStates,
    canReportIncidents:camera.capabilities.canReportIncidents,cameraMasterOnly:true,panelBoardHidden:true,capabilities:dossier.capabilities}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);await closePool().catch(()=>{});process.exitCode=1;
});
