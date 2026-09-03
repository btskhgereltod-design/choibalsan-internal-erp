"use strict";

const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");
const baseUrl=String(process.env.CAMERA_DEMO_BASE_URL||"http://127.0.0.1:4200").replace(/\/$/,"");
const organization=String(process.env.CAMERA_DEMO_ORGANIZATION||"choibalsan-hugjil");
const username=String(process.env.CAMERA_DEMO_USERNAME||"").trim();
const expectedDatabase=String(process.env.CAMERA_DEMO_DATABASE||"overva_rehearsal_lighting_demo");
const lightingProvenanceFingerprint=String(process.env.LIGHTING_PROVENANCE_FINGERPRINT||"").trim();
const expectedCameraStates={attention:Number(process.env.CAMERA_EXPECT_ATTENTION||20),
  decision:Number(process.env.CAMERA_EXPECT_DECISION||10),normal:Number(process.env.CAMERA_EXPECT_NORMAL||80)};

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
  if(Object.entries(expectedCameraStates).some(([key,value])=>operationalStates[key]!==value)){
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
  let lightingProvenance=null;
  if(lightingProvenanceFingerprint){
    const road=lighting.assets.filter(item=>item.service_area_code==="road-lighting");
    const unresolved=lighting.assets.filter(item=>item.classification_state==="unclassified");
    if(road.length!==36||unresolved.length!==69||lighting.fixedAssets.length!==12){
      throw new Error(`Unexpected reconciled lighting projection road=${road.length} unresolved=${unresolved.length} signals=${lighting.fixedAssets.length}`);
    }
    const totals=road.reduce((sum,item)=>({poles:sum.poles+Number(item.pole_count||0),
      heads:sum.heads+Number(item.head_count||0),replacements:sum.replacements+Number(item.replacement_pole_count||0)}),
    {poles:0,heads:0,replacements:0});
    if(totals.poles!==1747||totals.heads!==2582||totals.replacements!==43){
      throw new Error(`Unexpected reconciled road-lighting totals ${JSON.stringify(totals)}`);
    }
    const evidence=(await getPool().query(`WITH organization AS(
        SELECT id FROM organizations WHERE slug=$1
      ),source_rows AS(
        SELECT source.source_snapshot,o.object_type,o.metadata
        FROM operational_objects o JOIN organization ON organization.id=o.organization_id
        JOIN source_import_records source ON source.organization_id=o.organization_id
          AND source.source_system=o.source_system AND source.source_table=o.source_table AND source.source_id=o.source_id
        WHERE o.domain='lighting' AND o.source_system='choibalsan-legacy-erp' AND o.source_table='sl_points'
      ) SELECT count(*)::int objects,
        count(*) FILTER(WHERE object_type='lighting_corridor')::int road,
        count(*) FILTER(WHERE object_type='traffic_signal_legacy_copy')::int signals,
        count(*) FILTER(WHERE object_type='legacy_unclassified')::int unresolved,
        count(*) FILTER(WHERE metadata->'provenanceReconciliation'->>'fingerprint'=$2)::int fingerprint_rows,
        count(*) FILTER(WHERE encode(convert_to(left(source_snapshot->>'code',3),'UTF8'),'hex')='3f3f2d')::int immutable_corrupt_snapshots,
        (SELECT count(*)::int FROM operational_object_events event,organization
          WHERE event.organization_id=organization.id AND event.detail->>'sourceFingerprint'=$2) events,
        (SELECT count(*)::int FROM audit_logs audit,organization
          WHERE audit.organization_id=organization.id AND audit.action='legacy_lighting.provenance_reconcile'
            AND audit.detail->>'sourceFingerprint'=$2 AND audit.user_id IS NOT NULL) audits
      FROM source_rows`,[organization,lightingProvenanceFingerprint])).rows[0];
    const expectedEvidence={objects:117,road:36,signals:12,unresolved:69,fingerprint_rows:117,
      immutable_corrupt_snapshots:117,events:117,audits:1};
    for(const [key,value] of Object.entries(expectedEvidence))if(Number(evidence[key])!==value){
      throw new Error(`Unexpected reconciliation evidence ${key}=${evidence[key]}, expected ${value}`);
    }
    lightingProvenance={fingerprint:lightingProvenanceFingerprint,road:road.length,unresolved:unresolved.length,
      signals:lighting.fixedAssets.length,...totals,evidence};
  }
  console.log(JSON.stringify({database:state.database,schema:state.schema,cameraObjects:camera.assets.length,
    legacyCameraReferences:Number(camera.summary.devices),incidentTypes:camera.incidentTypes.length,
    sourceGroups:Object.fromEntries(groupCounts),operationalStates,
    canReportIncidents:camera.capabilities.canReportIncidents,cameraMasterOnly:true,panelBoardHidden:true,
    lightingProvenance,capabilities:dossier.capabilities}));
}

run().then(closePool).catch(async error=>{
  console.error(error.message);await closePool().catch(()=>{});process.exitCode=1;
});
