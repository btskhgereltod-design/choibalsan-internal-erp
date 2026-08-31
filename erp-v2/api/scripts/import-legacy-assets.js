"use strict";

require("dotenv").config();
const { getPool, closePool } = require("../src/db");

const dryRun=process.argv.includes("--dry-run");
const organizationSlug=process.env.IMPORT_ORG_SLUG||process.env.BOOTSTRAP_ORG_SLUG;

function readStdin(){return new Promise((resolve,reject)=>{let body="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>body+=chunk);process.stdin.on("end",()=>{try{resolve(JSON.parse(body))}catch(error){reject(new Error(`Invalid asset import JSON: ${error.message}`))}});process.stdin.on("error",reject)})}
const text=value=>String(value??"").trim();
function targetStatus(row){const condition=text(row.condition).toLowerCase(),status=text(row.status).toLowerCase();if(condition.includes("татан буулгах"))return "retired";if(condition.includes("засвар"))return "repair";if(status.includes("идэвхгүй"))return "inactive";return "active"}

async function main(){
  const payload=await readStdin();
  if(payload.format!=="overva.legacy-assets.v1"||payload.sourceSystem!=="choibalsan-legacy-demo"||!Array.isArray(payload.assets))throw new Error("Unsupported legacy asset payload");
  if(!organizationSlug)throw new Error("IMPORT_ORG_SLUG is required");
  if(!payload.assets.length||payload.assets.length>5000)throw new Error("Legacy asset count is outside the reviewed range");
  const client=await getPool().connect(),report={source:payload.assets.length,inserted:0,skipped:0,warnings:[]};
  try{
    await client.query("BEGIN");
    const organization=(await client.query("SELECT id FROM organizations WHERE slug=$1 FOR UPDATE",[organizationSlug])).rows[0];
    if(!organization)throw new Error(`Organization not found: ${organizationSlug}`);
    const actor=(await client.query("SELECT id FROM users WHERE organization_id=$1 AND username='admin' AND active=true",[organization.id])).rows[0];
    if(!actor)throw new Error("Local demo administrator not found");
    const userRows=await client.query(`SELECT ep.legacy_user_id,u.id FROM employee_profiles ep JOIN users u
      ON u.organization_id=ep.organization_id AND u.id=ep.user_id WHERE ep.organization_id=$1`,[organization.id]);
    const users=new Map(userRows.rows.map(row=>[Number(row.legacy_user_id),row.id]));
    for(const row of payload.assets){
      const sourceId=String(row.id),code=text(row.asset_code),name=text(row.name);
      if(!sourceId||!code||!name)throw new Error(`Invalid legacy asset: ${sourceId||"unknown"}`);
      const linked=await client.query(`SELECT target_id FROM source_import_records
        WHERE organization_id=$1 AND source_system=$2 AND source_table='assets' AND source_id=$3`,[organization.id,payload.sourceSystem,sourceId]);
      if(linked.rowCount){report.skipped+=1;continue}
      const conflict=await client.query("SELECT id FROM assets WHERE organization_id=$1 AND code=$2",[organization.id,code]);
      const targetCode=conflict.rowCount?`LEGACY-ASSET-${sourceId}`:code;
      if(conflict.rowCount)report.warnings.push(`Asset ${sourceId}: unreadable or duplicate source code replaced with ${targetCode}`);
      const status=targetStatus(row),responsible=users.get(Number(row.assigned_to))||null;
      const metadata={source:payload.sourceSystem,legacyId:row.id,sourceStatus:text(row.status),sourceCondition:text(row.condition),subCategory:text(row.sub_category)||null,bagNo:row.bag_no??null,cameraCount:row.camera_count??null,cameraBrokenCount:row.camera_broken_count??null};
      const inserted=await client.query(`INSERT INTO assets(
        organization_id,code,name,category,status,location,responsible_user_id,acquired_at,notes,metadata,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id`,[
        organization.id,targetCode,name,text(row.category)||"Бусад",status,text(row.location),responsible,
        /^\d{4}-\d{2}-\d{2}/.test(text(row.installed_date))?text(row.installed_date).slice(0,10):null,
        "Хуучин ERP-ээс локал demo хуулбар",JSON.stringify(metadata),users.get(Number(row.created_by))||actor.id,
      ]);
      const assetId=inserted.rows[0].id;
      await client.query(`INSERT INTO asset_events(organization_id,asset_id,actor_user_id,event_type,detail)
        VALUES($1,$2,$3,'created',$4::jsonb)`,[organization.id,assetId,actor.id,JSON.stringify({source:payload.sourceSystem,legacyId:row.id,status})]);
      await client.query(`INSERT INTO source_import_records(
        organization_id,source_system,source_table,source_id,target_type,target_id,source_snapshot,warnings)
        VALUES($1,$2,'assets',$3,'asset',$4,$5::jsonb,'[]'::jsonb)`,[
        organization.id,payload.sourceSystem,sourceId,assetId,JSON.stringify({id:row.id,asset_code:code,name,category:text(row.category),sub_category:text(row.sub_category),location:text(row.location),status:text(row.status),condition:text(row.condition),installed_date:text(row.installed_date)}),
      ]);
      report.inserted+=1;
    }
    await client.query(`INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
      VALUES($1,$2,'asset.legacy_demo_import','asset_import',$3,$4::jsonb)`,[organization.id,actor.id,organization.id,JSON.stringify({sourceSystem:payload.sourceSystem,...report,dryRun})]);
    if(dryRun)await client.query("ROLLBACK");else await client.query("COMMIT");
    console.log(JSON.stringify({mode:dryRun?"dry-run":"import",...report}));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release();await closePool()}
}

main().catch(error=>{console.error(error.message);process.exitCode=1});
