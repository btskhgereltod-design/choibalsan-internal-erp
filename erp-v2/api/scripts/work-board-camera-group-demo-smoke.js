"use strict";

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

const baseUrl=String(process.env.WORK_BOARD_DEMO_BASE_URL||"http://127.0.0.1:4100").replace(/\/$/,"");
const organization=String(process.env.WORK_BOARD_DEMO_ORGANIZATION||"choibalsan-hugjil");
const username=String(process.env.WORK_BOARD_DEMO_USERNAME||"").trim();

async function json(path,headers){
  const response=await fetch(`${baseUrl}${path}`,{headers});
  const body=await response.json();
  if(!response.ok)throw new Error(`${path} ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function grouped(items){
  const counts={};
  for(const item of items){
    const code=String(item.camera_source_group_code||"unclassified");
    counts[code]=(counts[code]||0)+1;
  }
  return counts;
}

async function run(){
  if(!username)throw new Error("WORK_BOARD_DEMO_USERNAME is required");
  const state=(await getPool().query("SELECT current_database() database,(SELECT max(version) FROM schema_migrations) schema")).rows[0];
  if(state.database!=="overva_rehearsal_lighting_demo"||state.schema!=="0105"){
    throw new Error(`Unexpected demo target ${state.database}/${state.schema}`);
  }
  const user=await getPool().query(`SELECT user_account.id FROM users user_account
    JOIN organizations organization ON organization.id=user_account.organization_id
    WHERE organization.slug=$1 AND user_account.username=$2 AND user_account.active=true LIMIT 1`,[organization,username]);
  if(!user.rowCount)throw new Error("Demo user not found");
  const headers={authorization:`Bearer ${signAccessToken(user.rows[0].id)}`};
  const [options,intake,orders]=await Promise.all([
    json("/api/work-orders/options",headers),
    json("/api/work-orders/intake",headers),
    json("/api/work-orders",headers)
  ]);
  const cameraGroups=(options.cameraGroups||[]).map(item=>String(item.code));
  if(cameraGroups.join(",")!=="3,5,7,8,9,98,99")throw new Error(`Unexpected camera groups ${cameraGroups.join(",")}`);
  const cameraIncidents=intake.items.filter(item=>item.domain==="camera"),incidentGroups=grouped(cameraIncidents);
  if(cameraIncidents.length!==30||incidentGroups["7"]!==5||incidentGroups["98"]!==21||incidentGroups["99"]!==4){
    throw new Error(`Unexpected camera incident projection ${JSON.stringify(incidentGroups)}`);
  }
  if(cameraIncidents.some(item=>!item.camera_source_group_code))throw new Error("Camera intake row is missing its source group");
  const activeCameraWork=orders.items.filter(item=>(item.service_area_domain==="camera"||String(item.work_type_code||"").startsWith("camera-"))
    &&!["completed","cancelled"].includes(item.status));
  const workGroups=grouped(activeCameraWork);
  if(activeCameraWork.length!==6||workGroups["7"]!==2||workGroups["8"]!==1||workGroups["98"]!==2||workGroups.unclassified!==1){
    throw new Error(`Unexpected active camera work projection ${JSON.stringify(workGroups)}`);
  }
  console.log(JSON.stringify({database:state.database,schema:state.schema,cameraGroups,
    cameraOpenIncidents:cameraIncidents.length,incidentGroups,activeCameraWork:activeCameraWork.length,
    workGroups}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);
  await closePool().catch(()=>{});
  process.exitCode=1;
});
