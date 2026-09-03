"use strict";

require("dotenv").config();
const {getPool,closePool}=require("../src/db");

const base64Input=process.argv.includes("--base64");
const clean=value=>String(value??"").trim();
const integer=value=>Number.isInteger(Number(value))?Number(value):0;
const faultStatus=value=>{const text=clean(value).toLowerCase();return text.includes("дуус")||text.includes("хааг")?"resolved":text.includes("явц")?"in_progress":"open"};
const read=()=>new Promise((resolve,reject)=>{
  let body="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data",chunk=>{body+=chunk});
  process.stdin.on("end",()=>{
    try{
      const payload=base64Input?Buffer.from(body.trim(),"base64").toString("utf8"):body;
      resolve(JSON.parse(payload));
    }catch(error){reject(new Error(`Invalid JSON: ${error.message}`))}
  });
  process.stdin.on("error",reject);
});

async function main(){
  const data=await read();
  if(data.format!=="overva.legacy-lighting.v1"||data.sourceSystem!=="choibalsan-legacy-erp"){
    throw new Error("Expected the reviewed read-only Choibalsan legacy lighting export");
  }
  const points=data.points||[],faults=data.faults||[];
  const road=points.filter(row=>clean(row.code).startsWith("ГТ-"));
  const roadTotals=road.reduce((sum,row)=>({
    poles:sum.poles+integer(row.lamp_count),
    heads:sum.heads+integer(row.total_heads),
    replacements:sum.replacements+integer(row.needs_poles)
  }),{poles:0,heads:0,replacements:0});
  if(points.length!==117||faults.length!==212||road.length!==36||
    roadTotals.poles!==1747||roadTotals.heads!==2582||roadTotals.replacements!==43){
    throw new Error("Legacy evidence baseline does not match the reviewed 117/36/1747/2582/43 contract");
  }

  const client=await getPool().connect();
  const counts={objectsCorrected:0,incidentsCorrected:0,objectEvidenceEvents:0,incidentEvidenceEvents:0};
  try{
    await client.query("BEGIN");
    const database=(await client.query("SELECT current_database() AS name")).rows[0].name;
    if(database!=="overva_rehearsal_lighting_demo")throw new Error(`Refusing demo reconciliation on ${database}`);
    const organization=(await client.query("SELECT id FROM organizations WHERE slug='choibalsan-hugjil' FOR UPDATE")).rows[0];
    if(!organization)throw new Error("Choibalsan demo organization not found");
    const organizationId=organization.id,targetSourceSystem="choibalsan-legacy-demo";

    for(const row of points){
      const current=(await client.query(`SELECT id,name,object_type,metadata
        FROM operational_objects
        WHERE organization_id=$1 AND domain='lighting' AND source_system=$2
          AND source_table='sl_points' AND source_id=$3 FOR UPDATE`,
      [organizationId,targetSourceSystem,String(row.id)])).rows[0];
      if(!current)throw new Error(`Demo sl_points object missing: ${row.id}`);
      if(clean(current.name)!==clean(row.name))throw new Error(`Demo/source object identity mismatch: ${row.id}`);
      const legacyCode=clean(row.code),objectType=legacyCode.startsWith("ГТ-")?"lighting_corridor":"legacy_unclassified";
      const evidence={legacyCode,legacyId:row.id,lightType:row.light_type??null,
        poleCount:row.lamp_count??0,headCountPerPole:row.head_count??null,
        totalHeadCount:row.total_heads??0,lampCount:row.lamp_count??0,
        headCount:row.head_count??row.total_heads??0,
        replacementPoleCount:row.needs_poles??0,wattagePerLamp:row.wattage_per_lamp??null};
      const changed=current.object_type!==objectType||current.metadata?.legacyCode!==legacyCode||
        Number(current.metadata?.poleCount??-1)!==integer(row.lamp_count)||
        Number(current.metadata?.totalHeadCount??-1)!==integer(row.total_heads)||
        Number(current.metadata?.replacementPoleCount??0)!==integer(row.needs_poles);
      if(!changed)continue;
      await client.query(`UPDATE operational_objects
        SET object_type=$4,metadata=metadata||$5::jsonb,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND source_system=$3`,
      [organizationId,current.id,targetSourceSystem,objectType,JSON.stringify(evidence)]);
      await client.query(`INSERT INTO operational_object_events(
        organization_id,operational_object_id,actor_user_id,event_type,note,detail)
        VALUES($1,$2,NULL,'note',$3,$4::jsonb)`,[organizationId,current.id,
        "Хуучин ERP-ийн эх кодоор объектын ангиллыг demo-д залруулсан",
        JSON.stringify({reason:"legacy object granularity reconciliation",evidenceSourceSystem:data.sourceSystem,
          targetSourceSystem,sourceTable:"sl_points",sourceId:row.id,legacyCode,objectType,
          poleCount:integer(row.lamp_count),headCountPerPole:integer(row.head_count),
          totalHeadCount:integer(row.total_heads),replacementPoleCount:integer(row.needs_poles)})]);
      counts.objectsCorrected+=1;counts.objectEvidenceEvents+=1;
    }

    for(const row of faults){
      const current=(await client.query(`SELECT id,affected_quantity,resolved_quantity,status,version
        FROM operational_incidents
        WHERE organization_id=$1 AND domain='lighting' AND source_system=$2 AND external_id=$3
        FOR UPDATE`,[organizationId,targetSourceSystem,String(row.id)])).rows[0];
      if(!current)throw new Error(`Demo sl_faults incident missing: ${row.id}`);
      const affected=Math.max(0,integer(row.broken_count));
      const resolved=Math.min(affected,Math.max(0,integer(row.fixed_count)));
      const status=affected===resolved?"resolved":faultStatus(row.status);
      if(Number(current.affected_quantity)===affected&&Number(current.resolved_quantity)===resolved&&current.status===status)continue;
      const updated=(await client.query(`UPDATE operational_incidents
        SET affected_quantity=$3,resolved_quantity=$4,status=$5,version=version+1,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING version`,
      [organizationId,current.id,affected,resolved,status])).rows[0];
      await client.query(`INSERT INTO operational_incident_events(
        organization_id,incident_id,actor_user_id,event_type,quantity,note,detail,incident_version)
        VALUES($1,$2,NULL,'corrected',$3,$4,$5::jsonb,$6)`,[organizationId,current.id,affected,
        "Хуучин ERP-ийн broken_count утгаар demo импортын хэмжээг залруулсан",
        JSON.stringify({reason:"legacy fault quantity reconciliation",evidenceSourceSystem:data.sourceSystem,
          targetSourceSystem,sourceTable:"sl_faults",sourceId:row.id,
          previousAffected:Number(current.affected_quantity),previousResolved:Number(current.resolved_quantity),previousStatus:current.status,
          correctedAffected:affected,correctedResolved:resolved,correctedStatus:status}),updated.version]);
      counts.incidentsCorrected+=1;counts.incidentEvidenceEvents+=1;
    }

    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1,NULL,'demo.legacy_lighting_semantics_reconcile','legacy_import',$1::uuid::text,$2::jsonb)`,
    [organizationId,JSON.stringify({evidenceSourceSystem:data.sourceSystem,targetSourceSystem,
      immutableProvenancePreserved:true,reviewedBaseline:{points:117,roadObjects:36,poles:1747,heads:2582,replacementPoles:43},counts})]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ok:true,database,counts,roadTotals}));
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{
    client.release();
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
