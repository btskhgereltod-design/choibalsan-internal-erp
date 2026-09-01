"use strict";

const crypto=require("node:crypto");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("./audit");

const CLASSIFICATIONS=new Set(["MATCH_EXISTING","IMPORT_NEW","REVIEW_REQUIRED","LEGACY_ONLY"]);
const REVIEW_STATUSES=new Set(["NOT_REQUIRED","PENDING","APPROVED","REJECTED"]);
const TARGET_TABLES={
  employee:"employees",
  department:"departments",
  job:"jobs",
  position:"positions",
  employee_assignment:"employee_assignments",
  document:"documents",
  correspondence:"correspondence_records",
  archive_record:"archive_records",
  attachment:"attachments",
};

class LegacyProvenanceError extends Error{
  constructor(code,status=400){super(code);this.name="LegacyProvenanceError";this.code=code;this.status=status}
}

function canonicalJson(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function sha256Structured(value){return crypto.createHash("sha256").update(typeof value==="string"?value:canonicalJson(value)).digest("hex")}
function sha256Bytes(value){
  if(!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))throw new TypeError("SHA256_BYTES_REQUIRED");
  return crypto.createHash("sha256").update(value).digest("hex");
}
// Backward-compatible name for structured command/source payload hashing.
const sha256=sha256Structured;
function cleanText(value,max=4000){const v=value==null?null:String(value).trim();return v?v.slice(0,max):null}
function assertHash(value,code){const v=String(value||"").toLowerCase();if(!/^[0-9a-f]{64}$/.test(v))throw new LegacyProvenanceError(code);return v}
function assertUuid(value,code){const v=String(value||"").toLowerCase();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))throw new LegacyProvenanceError(code);return v}
function assertClassification(value){const v=String(value||"");if(!CLASSIFICATIONS.has(v))throw new LegacyProvenanceError("LEGACY_CLASSIFICATION_INVALID");return v}
function defaultReviewStatus(classification){return classification==="REVIEW_REQUIRED"?"PENDING":"NOT_REQUIRED"}

async function validateTarget(client,organizationId,targetType,targetId){
  if(!targetType&&!targetId)return null;
  const type=String(targetType||"").trim(),table=TARGET_TABLES[type];
  if(!table||!targetId)throw new LegacyProvenanceError("LEGACY_TARGET_INVALID");
  const id=assertUuid(targetId,"LEGACY_TARGET_INVALID");
  const found=await client.query(`SELECT id FROM ${table} WHERE organization_id=$1 AND id=$2`,[organizationId,id]);
  if(!found.rowCount)throw new LegacyProvenanceError("LEGACY_TARGET_NOT_FOUND",404);
  return {type,id};
}

function normalizeRegistration(record){
  const classification=assertClassification(record.classification||record.suggestedClassification);
  const summary=record.sourceSummary&&typeof record.sourceSummary==="object"&&!Array.isArray(record.sourceSummary)?record.sourceSummary:{};
  const signals=Array.isArray(record.duplicateSignals)?record.duplicateSignals.map(x=>String(x).slice(0,160)).slice(0,40):[];
  return {
    legacySource:cleanText(record.legacySource,120),legacyTable:cleanText(record.legacyTable,120),legacyId:cleanText(record.legacyId,240),
    legacyStatus:cleanText(record.legacyStatus,500),sourceSha256:assertHash(record.sourceSha256,"LEGACY_SOURCE_HASH_INVALID"),
    payloadHash:assertHash(record.payloadHash,"LEGACY_PAYLOAD_HASH_INVALID"),sourceSummary:summary,
    suggestedClassification:assertClassification(record.suggestedClassification||classification),classification,
    targetType:cleanText(record.targetType,80),targetId:record.targetId||null,
    matchCandidateType:cleanText(record.matchCandidateType,80),matchCandidateId:record.matchCandidateId||null,
    matchReason:cleanText(record.matchReason,2000)||"",conflictReason:cleanText(record.conflictReason,2000)||"",duplicateSignals:signals,
  };
}

async function registerProvenanceRecord({organizationId,actorUserId,record,client=null}){
  const org=assertUuid(organizationId,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(actorUserId,"LEGACY_ACTOR_INVALID"),v=normalizeRegistration(record);
  if(!v.legacySource||!v.legacyTable||!v.legacyId)throw new LegacyProvenanceError("LEGACY_SOURCE_KEY_INVALID");
  return withTenantTransaction(org,async tx=>{
    const target=await validateTarget(tx,org,v.targetType,v.targetId);
    const candidate=await validateTarget(tx,org,v.matchCandidateType,v.matchCandidateId);
    if(v.classification==="MATCH_EXISTING"&&!target)throw new LegacyProvenanceError("LEGACY_MATCH_TARGET_REQUIRED");
    const reviewStatus=defaultReviewStatus(v.classification);
    const inserted=await tx.query(`INSERT INTO legacy_provenance_records(
      organization_id,legacy_source,legacy_table,legacy_id,legacy_status,source_sha256,payload_hash,source_summary,
      suggested_classification,classification,target_type,target_id,match_candidate_type,match_candidate_id,
      match_reason,conflict_reason,duplicate_signals,review_status,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
      ON CONFLICT(organization_id,legacy_source,legacy_table,legacy_id) DO NOTHING RETURNING *`,[
      org,v.legacySource,v.legacyTable,v.legacyId,v.legacyStatus,v.sourceSha256,v.payloadHash,JSON.stringify(v.sourceSummary),
      v.suggestedClassification,v.classification,target?.type||null,target?.id||null,candidate?.type||null,candidate?.id||null,
      v.matchReason,v.conflictReason,JSON.stringify(v.duplicateSignals),reviewStatus,actor]);
    if(!inserted.rowCount){
      const existing=(await tx.query(`SELECT * FROM legacy_provenance_records WHERE organization_id=$1 AND legacy_source=$2 AND legacy_table=$3 AND legacy_id=$4`,[org,v.legacySource,v.legacyTable,v.legacyId])).rows[0];
      if(existing.source_sha256.trim()!==v.sourceSha256||existing.payload_hash.trim()!==v.payloadHash)throw new LegacyProvenanceError("LEGACY_PAYLOAD_CONFLICT",409);
      return {item:existing,replayed:true};
    }
    const item=inserted.rows[0],registrationPayload={action:"REGISTERED",classification:v.classification,reviewStatus,target};
    await tx.query(`INSERT INTO legacy_provenance_decisions(organization_id,provenance_id,decision_version,action,
      to_classification,to_review_status,to_target_type,to_target_id,reason,actor_user_id,idempotency_key,payload_hash)
      VALUES($1,$2,0,'REGISTERED',$3,$4,$5,$6,'Source evidence staged; no domain import performed',$7,$8,$9)`,[
      org,item.id,v.classification,reviewStatus,target?.type||null,target?.id||null,actor,crypto.randomUUID(),sha256(registrationPayload)]);
    return {item,replayed:false};
  },{client});
}

async function applyProvenanceDecisionInTransaction({client,req,organizationId,actorUserId,provenanceId,expectedVersion,idempotencyKey,classification,reviewStatus,targetType=null,targetId=null,reason,notes=""}){
  const org=assertUuid(organizationId,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(actorUserId,"LEGACY_ACTOR_INVALID"),id=assertUuid(provenanceId,"LEGACY_RECORD_ID_INVALID");
  const nextClassification=assertClassification(classification),nextReview=String(reviewStatus||"");
  if(!REVIEW_STATUSES.has(nextReview)||!Number.isInteger(Number(expectedVersion))||Number(expectedVersion)<0)throw new LegacyProvenanceError("LEGACY_REVIEW_INVALID");
  const requestId=assertUuid(idempotencyKey,"LEGACY_IDEMPOTENCY_KEY_INVALID"),decisionReason=cleanText(reason,2000);
  if(!decisionReason)throw new LegacyProvenanceError("LEGACY_REVIEW_REASON_REQUIRED");
  const command={classification:nextClassification,reviewStatus:nextReview,targetType:targetType||null,targetId:targetId||null,reason:decisionReason,notes:cleanText(notes,4000)||""};
  const commandHash=sha256(command);
  const replay=await client.query(`SELECT r.*,d.payload_hash AS decision_payload_hash,d.decision_version,d.action AS decision_action FROM legacy_provenance_decisions d JOIN legacy_provenance_records r ON r.organization_id=d.organization_id AND r.id=d.provenance_id WHERE d.organization_id=$1 AND d.provenance_id=$2 AND d.idempotency_key=$3`,[org,id,requestId]);
  if(replay.rowCount){if(replay.rows[0].decision_payload_hash.trim()!==commandHash)throw new LegacyProvenanceError("LEGACY_IDEMPOTENCY_CONFLICT",409);return {item:replay.rows[0],replayed:true}}
  const currentResult=await client.query("SELECT * FROM legacy_provenance_records WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id]);
  if(!currentResult.rowCount)throw new LegacyProvenanceError("LEGACY_RECORD_NOT_FOUND",404);
  const current=currentResult.rows[0];
  if(Number(current.version)!==Number(expectedVersion))throw new LegacyProvenanceError("LEGACY_VERSION_CONFLICT",409);
  const target=await validateTarget(client,org,targetType,targetId);
  if(nextClassification==="MATCH_EXISTING"&&!target)throw new LegacyProvenanceError("LEGACY_MATCH_TARGET_REQUIRED");
  if(nextClassification!=="MATCH_EXISTING"&&target)throw new LegacyProvenanceError("LEGACY_TARGET_NOT_ALLOWED");
  const nextVersion=Number(current.version)+1;
  await client.query(`INSERT INTO legacy_provenance_decisions(organization_id,provenance_id,decision_version,action,
      from_classification,to_classification,from_review_status,to_review_status,from_target_type,from_target_id,
      to_target_type,to_target_id,reason,notes,actor_user_id,idempotency_key,payload_hash)
      VALUES($1,$2,$3,'REVIEW_DECISION',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[
    org,id,nextVersion,current.classification,nextClassification,current.review_status,nextReview,current.target_type,current.target_id,
    target?.type||null,target?.id||null,decisionReason,command.notes,actor,requestId,commandHash]);
  const updated=(await client.query(`UPDATE legacy_provenance_records SET classification=$3,review_status=$4,target_type=$5,target_id=$6,
      reviewed_by=$7,reviewed_at=now(),review_notes=$8,version=$9 WHERE organization_id=$1 AND id=$2 RETURNING *`,[
    org,id,nextClassification,nextReview,target?.type||null,target?.id||null,actor,command.notes,nextVersion])).rows[0];
  await writeAudit(req,"legacy_migration.review_decision","legacy_provenance_record",id,{fromClassification:current.classification,toClassification:nextClassification,fromReviewStatus:current.review_status,toReviewStatus:nextReview,version:nextVersion,idempotencyKey:requestId},client);
  return {item:updated,replayed:false};
}

async function reviewProvenanceRecord(args){
  const org=assertUuid(args.req.user.organization_id,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(args.req.user.id,"LEGACY_ACTOR_INVALID");
  return withTenantTransaction(org,client=>applyProvenanceDecisionInTransaction({...args,client,organizationId:org,actorUserId:actor}));
}

module.exports={CLASSIFICATIONS,REVIEW_STATUSES,TARGET_TABLES,LegacyProvenanceError,canonicalJson,sha256,sha256Structured,sha256Bytes,registerProvenanceRecord,reviewProvenanceRecord,applyProvenanceDecisionInTransaction,validateTarget,assertUuid,cleanText};
