"use strict";

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

const baseUrl=String(process.env.LIGHTING_DEMO_BASE_URL||"http://localhost:4200").replace(/\/$/,"");
const organization=String(process.env.LIGHTING_DEMO_ORGANIZATION||"choibalsan-hugjil");
const username=String(process.env.LIGHTING_DEMO_USERNAME||"").trim();

async function run(){
  if(!username)throw new Error("LIGHTING_DEMO_USERNAME is required");
  const databaseState=(await getPool().query("SELECT current_database() database,(SELECT max(version) FROM schema_migrations) schema")).rows[0];
  const database=databaseState.database;
  if(database!=="overva_rehearsal_lighting_demo")throw new Error(`Refusing demo smoke on ${database}`);
  if(databaseState.schema!=="0105")throw new Error(`Expected demo schema 0105; got ${databaseState.schema}`);
  const user=await getPool().query(`SELECT user_account.id FROM users user_account
    JOIN organizations organization ON organization.id=user_account.organization_id
    WHERE organization.slug=$1 AND user_account.username=$2 AND user_account.active=true LIMIT 1`,[organization,username]);
  if(!user.rowCount)throw new Error("Demo user not found");
  const headers={authorization:`Bearer ${signAccessToken(user.rows[0].id)}`};
  const workspaceResponse=await fetch(`${baseUrl}/api/lighting/workspace`,{headers});
  const workspace=await workspaceResponse.json();
  if(!workspaceResponse.ok)throw new Error(`Workspace ${workspaceResponse.status}: ${JSON.stringify(workspace)}`);
  const road=workspace.assets.filter(item=>item.service_area_code==="road-lighting");
  if(road.length!==36)throw new Error(`Expected 36 road objects; got ${road.length}`);
  const unclassified=workspace.assets.filter(item=>!item.service_area_code);
  if(unclassified.length!==69)throw new Error(`Expected 69 genuinely unclassified lighting objects; got ${unclassified.length}`);
  const duplicatedSignals=workspace.assets.filter(item=>String(item.display_code||"").startsWith("\u0413\u0414-"));
  if(duplicatedSignals.length)throw new Error(`Legacy traffic-signal copies leaked into the registry: ${duplicatedSignals.length}`);
  const trafficSignals=workspace.fixedAssets.filter(item=>item.service_area_code==="traffic-signal");
  if(trafficSignals.length!==12)throw new Error(`Expected 12 canonical traffic signals; got ${trafficSignals.length}`);
  const dossierResponse=await fetch(`${baseUrl}/api/lighting/objects/${road[0].id}/dossier`,{headers});
  const dossier=await dossierResponse.json();
  if(!dossierResponse.ok)throw new Error(`Dossier ${dossierResponse.status}: ${JSON.stringify(dossier)}`);
  if(Object.hasOwn(dossier,"incidents")||Object.hasOwn(dossier,"workOrders"))throw new Error("Master dossier leaked incident/work payloads");
  if(!dossier.capabilities.canUpdate||!dossier.capabilities.canRetire)throw new Error("Demo owner lacks object master lifecycle permissions");
  if(!dossier.capabilities.canManageMedia)throw new Error("Demo owner lacks object media permission");
  for(const collection of ["lampGroups","supplyPoints","media"]){
    if(!Array.isArray(dossier[collection]))throw new Error(`Dossier ${collection} is not an array`);
  }
  console.log(JSON.stringify({database,schema:databaseState.schema,objects:workspace.assets.length,roadObjects:road.length,
    roadPoles:road.reduce((sum,item)=>sum+Number(item.pole_count||0),0),
    roadHeads:road.reduce((sum,item)=>sum+Number(item.head_count||0),0),unclassifiedObjects:unclassified.length,
    canonicalTrafficSignals:trafficSignals.length,legacyTrafficSignalCopies:duplicatedSignals.length,
    dossierVersion:Number(dossier.item.version),masterOnly:true,capabilities:dossier.capabilities}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);
  await closePool().catch(()=>{});
  process.exitCode=1;
});
