"use strict";

// Stages provenance/review evidence only. It contains no writes to employee,
// master, attendance, document, correspondence, archive, or workflow tables.
require("dotenv").config({path:require("node:path").resolve(__dirname,"..","..",".env"),quiet:true});
const fs=require("node:fs");
const {getPool,closePool,setTenantContext}=require("../src/db");
const {registerProvenanceRecord}=require("../src/services/legacy-provenance");
const {writeAudit}=require("../src/services/audit");

function argument(name,fallback=null){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:fallback}
const dryRun=process.argv.includes("--dry-run"),organizationSlug=argument("--organization",process.env.LEGACY_TARGET_ORGANIZATION_SLUG||"choibalsan-hugjil");
const inputFile=argument("--input");
function readInput(){return inputFile?fs.readFileSync(inputFile,"utf8"):fs.readFileSync(0,"utf8")}

async function employeeByLegacyId(client,organizationId,legacyUserId){
  const result=await client.query(`SELECT e.id FROM employee_profiles ep JOIN employees e ON e.organization_id=ep.organization_id AND e.id=ep.employee_id WHERE ep.organization_id=$1 AND ep.legacy_user_id=$2 AND e.active=true`,[organizationId,Number(legacyUserId)]);
  return result.rowCount===1?result.rows[0].id:null;
}
async function resolveLookup(client,organizationId,lookup){
  if(!lookup)return null;
  if(lookup.type==="employee"){const id=await employeeByLegacyId(client,organizationId,lookup.legacyUserId);return id?{type:"employee",id}:null}
  if(lookup.type==="employee_assignment"){
    const employeeId=await employeeByLegacyId(client,organizationId,lookup.legacyUserId);if(!employeeId)return null;
    const result=await client.query(`SELECT id FROM employee_assignments WHERE organization_id=$1 AND employee_id=$2 AND status='active' AND assignment_type_code='primary'`,[organizationId,employeeId]);
    return result.rowCount===1?{type:"employee_assignment",id:result.rows[0].id}:null;
  }
  if(!["department","job","position"].includes(lookup.type)||!Array.isArray(lookup.memberLegacyUserIds)||!lookup.memberLegacyUserIds.length)return null;
  const ids=lookup.memberLegacyUserIds.map(Number);
  const column=lookup.type==="department"?"ea.organization_unit_id":lookup.type==="position"?"ea.position_id":"p.job_id";
  const joins=lookup.type==="job"?"JOIN positions p ON p.organization_id=ea.organization_id AND p.id=ea.position_id":"";
  const result=await client.query(`SELECT array_agg(DISTINCT ${column}) FILTER(WHERE ${column} IS NOT NULL) ids,count(DISTINCT ep.legacy_user_id)::int matched FROM employee_profiles ep JOIN employees e ON e.organization_id=ep.organization_id AND e.id=ep.employee_id JOIN employee_assignments ea ON ea.organization_id=e.organization_id AND ea.employee_id=e.id AND ea.status='active' AND ea.assignment_type_code='primary' ${joins} WHERE ep.organization_id=$1 AND ep.legacy_user_id=ANY($2::int[]) AND e.active=true`,[organizationId,ids]);
  const targetIds=result.rows[0]?.ids||[];
  if(Number(result.rows[0]?.matched)!==ids.length||targetIds.length!==1)return null;
  const table=lookup.type==="department"?"departments":lookup.type==="job"?"jobs":"positions";
  // The target is proven by all member employees' immutable legacy IDs and
  // their one active primary assignment. The display name is never a merge key.
  const target=await client.query(`SELECT id FROM ${table} WHERE organization_id=$1 AND id=$2`,[organizationId,targetIds[0]]);
  return target.rowCount===1?{type:lookup.type,id:target.rows[0].id}:null;
}

async function main(){
  const payload=JSON.parse(readInput());
  if(payload.format!=="overva-legacy-provenance-v1"||!Array.isArray(payload.records))throw new Error("Unsupported legacy provenance input");
  const pool=getPool(),client=await pool.connect();
  try{
    await client.query("BEGIN");
    const organization=(await client.query("SELECT id FROM organizations WHERE slug=$1",[organizationSlug])).rows[0];
    if(!organization)throw new Error("Target organization not found");
    await setTenantContext(client,organization.id);
    const actor=(await client.query(`SELECT id FROM users WHERE organization_id=$1 AND active=true ORDER BY CASE WHEN role IN('director','admin') THEN 0 ELSE 1 END,created_at,id LIMIT 1`,[organization.id])).rows[0];
    if(!actor)throw new Error("Active staging actor not found");
    const result={total:payload.records.length,created:0,replayed:0,reclassifiedForSafety:0,counts:{},unresolved:0};
    for(const sourceRecord of payload.records){
      const record={...sourceRecord};delete record.matchLookup;delete record.matchCandidateLookup;
      const target=await resolveLookup(client,organization.id,sourceRecord.matchLookup),candidate=await resolveLookup(client,organization.id,sourceRecord.matchCandidateLookup);
      if(record.classification==="MATCH_EXISTING"&&!target){
        record.classification="REVIEW_REQUIRED";record.suggestedClassification="REVIEW_REQUIRED";
        record.conflictReason=[record.conflictReason,"Expected existing target could not be proven by a stable identifier and corroborating relationships."].filter(Boolean).join(" ");
        record.duplicateSignals=[...(record.duplicateSignals||[]),"EXPECTED_TARGET_NOT_PROVEN"];result.reclassifiedForSafety++;
      }
      if(target){record.targetType=target.type;record.targetId=target.id}
      if(candidate){record.matchCandidateType=candidate.type;record.matchCandidateId=candidate.id}
      const staged=await registerProvenanceRecord({organizationId:organization.id,actorUserId:actor.id,record,client});
      result[staged.replayed?"replayed":"created"]++;
      result.counts[staged.item.classification]=(result.counts[staged.item.classification]||0)+1;
      if(staged.item.review_status==="PENDING")result.unresolved++;
    }
    if(dryRun)await client.query("ROLLBACK");
    else{
      await writeAudit({user:{organization_id:organization.id,id:actor.id},ip:null},"legacy_migration.provenance_staged","legacy_provenance_batch",null,{source:payload.source,databaseSha256:payload.databaseSha256,total:result.total,created:result.created,replayed:result.replayed,classificationCounts:result.counts,noDomainImport:true},client);
      await client.query("COMMIT");
    }
    console.log(JSON.stringify({...result,dryRun,organizationSlug},null,2));
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}

main().then(closePool).catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
