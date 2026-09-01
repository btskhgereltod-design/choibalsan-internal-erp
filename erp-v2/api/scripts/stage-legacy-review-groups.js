"use strict";

// Stages deterministic review cases only. It never writes domain, employee,
// master, attendance, document, correspondence, archive, or workflow tables.
require("dotenv").config({path:require("node:path").resolve(__dirname,"..","..",".env"),quiet:true});
const fs=require("node:fs");
const {getPool,closePool,setTenantContext}=require("../src/db");
const {registerReviewGroup}=require("../src/services/legacy-review-groups");
const {writeAudit}=require("../src/services/audit");

function argument(name,fallback=null){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:fallback}
const dryRun=process.argv.includes("--dry-run"),organizationSlug=argument("--organization",process.env.LEGACY_TARGET_ORGANIZATION_SLUG||"choibalsan-hugjil"),inputFile=argument("--input");
function readInput(){return inputFile?fs.readFileSync(inputFile,"utf8"):fs.readFileSync(0,"utf8")}

async function main(){
  const payload=JSON.parse(readInput());
  if(payload.format!=="overva-legacy-review-groups-v1"||!Array.isArray(payload.groups))throw new Error("Unsupported legacy review-group input");
  const pool=getPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const organization=(await client.query("SELECT id FROM organizations WHERE slug=$1",[organizationSlug])).rows[0];
    if(!organization)throw new Error("Target organization not found");
    await setTenantContext(client,organization.id);
    const actor=(await client.query(`SELECT id FROM users WHERE organization_id=$1 AND active=true ORDER BY CASE WHEN role IN('director','admin') THEN 0 ELSE 1 END,created_at,id LIMIT 1`,[organization.id])).rows[0];
    if(!actor)throw new Error("Active staging actor not found");
    const result={totalGroups:payload.groups.length,rawRows:0,created:0,replayed:0,categories:{},recommendations:{},noDomainImport:true};
    for(const sourceGroup of payload.groups){
      const group={...sourceGroup,members:[]};
      for(const sourceMember of sourceGroup.members||[]){
        const found=await client.query(`SELECT id FROM legacy_provenance_records WHERE organization_id=$1 AND legacy_source=$2 AND legacy_table=$3 AND legacy_id=$4`,[
          organization.id,sourceMember.legacySource,sourceMember.legacyTable,String(sourceMember.legacyId)]);
        if(found.rowCount!==1)throw new Error(`Staged provenance not found: ${sourceMember.legacyTable}/${sourceMember.legacyId}`);
        group.members.push({...sourceMember,provenanceId:found.rows[0].id});
      }
      result.rawRows+=group.members.length;
      const staged=await registerReviewGroup({organizationId:organization.id,actorUserId:actor.id,group,client});
      result[staged.replayed?"replayed":"created"]++;
      const category=result.categories[staged.item.category]||(result.categories[staged.item.category]={groups:0,rawRows:0});category.groups++;category.rawRows+=group.members.length;
      const recommendation=result.recommendations[staged.item.recommendation]||(result.recommendations[staged.item.recommendation]={groups:0,rawRows:0});recommendation.groups++;recommendation.rawRows+=group.members.length;
    }
    result.rawRowsReducedByGrouping=result.rawRows-result.totalGroups;
    if(dryRun)await client.query("ROLLBACK");
    else{
      await writeAudit({user:{organization_id:organization.id,id:actor.id},ip:null},"legacy_migration.review_groups_staged","legacy_review_group_batch",null,{source:payload.legacySource,databaseSha256:payload.databaseSha256,deterministicVersion:payload.deterministicVersion,...result},client);
      await client.query("COMMIT");
    }
    console.log(JSON.stringify({...result,dryRun,organizationSlug},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}

main().then(closePool).catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
