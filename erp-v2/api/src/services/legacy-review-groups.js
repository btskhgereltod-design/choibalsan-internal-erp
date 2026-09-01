"use strict";

const crypto=require("node:crypto");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("./audit");
const {LegacyProvenanceError,canonicalJson,sha256,assertUuid,cleanText,applyProvenanceDecisionInTransaction}=require("./legacy-provenance");

const CATEGORIES=new Set(["ATTENDANCE","INACTIVE_USER","ORDER_DECISION","CORRESPONDENCE","DOCUMENT_ATTACHMENT"]);
const RECOMMENDATIONS=new Set(["IMPORT_NEW","LEGACY_ONLY","MANUAL_REVIEW","RECONCILE_REQUIRED"]);
const CONFIDENCE=new Set(["HIGH","MEDIUM","LOW"]);
const BATCH_ACTIONS=new Set(["APPROVE_RECOMMENDATION","MARK_LEGACY_ONLY","SEND_MANUAL_REVIEW"]);
const SAFE_CANONICAL_IMPORT_CATEGORIES=new Set(["ORDER_DECISION","CORRESPONDENCE"]);

function deterministicUuid(namespace,value){
  const bytes=crypto.createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=bytes.toString("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function stringArray(value,max=80){return Array.isArray(value)?[...new Set(value.map(item=>cleanText(item,160)).filter(Boolean))].slice(0,max):[]}
function objectValue(value){return value&&typeof value==="object"&&!Array.isArray(value)?value:{}}
function normalizeGroup(input){
  const category=String(input.category||""),recommendation=String(input.recommendation||""),confidence=String(input.confidence||"");
  if(!CATEGORIES.has(category)||!RECOMMENDATIONS.has(recommendation)||!CONFIDENCE.has(confidence))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_INVALID");
  const groupKey=cleanText(input.groupKey,500),deterministicVersion=cleanText(input.deterministicVersion,80),reason=cleanText(input.recommendationReason,4000);
  if(!groupKey||!deterministicVersion||!reason)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_INVALID");
  const requiresExternalEvidence=Boolean(input.requiresExternalEvidence),externalEvidenceStatus=String(input.externalEvidenceStatus||"");
  if(requiresExternalEvidence&&!['MISSING','VERIFIED'].includes(externalEvidenceStatus))throw new LegacyProvenanceError("LEGACY_EXTERNAL_EVIDENCE_INVALID");
  if(!requiresExternalEvidence&&externalEvidenceStatus!=="NOT_REQUIRED")throw new LegacyProvenanceError("LEGACY_EXTERNAL_EVIDENCE_INVALID");
  const members=Array.isArray(input.members)?input.members:[];
  if(!members.length)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBERS_REQUIRED");
  return {category,groupKey,deterministicVersion,groupHash:String(input.groupHash||"").toLowerCase(),sourceSummary:objectValue(input.sourceSummary),signals:stringArray(input.signals),recommendation,recommendationReason:reason,confidence,requiresExternalEvidence,externalEvidenceStatus,members};
}
function recommendationHash(group){return sha256({recommendation:group.recommendation,reason:group.recommendation_reason,confidence:group.confidence,requiresExternalEvidence:group.requires_external_evidence,externalEvidenceStatus:group.external_evidence_status,groupHash:group.group_hash.trim()})}

async function registerReviewGroup({organizationId,actorUserId,group,client=null}){
  const org=assertUuid(organizationId,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(actorUserId,"LEGACY_ACTOR_INVALID"),value=normalizeGroup(group);
  if(!/^[0-9a-f]{64}$/.test(value.groupHash))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_HASH_INVALID");
  return withTenantTransaction(org,async tx=>{
    const prior=await tx.query("SELECT * FROM legacy_review_groups WHERE organization_id=$1 AND category=$2 AND group_key=$3",[org,value.category,value.groupKey]);
    if(prior.rowCount){
      if(prior.rows[0].group_hash.trim()!==value.groupHash)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_CONFLICT",409);
      return {item:prior.rows[0],replayed:true};
    }
    const provenanceIds=value.members.map(item=>assertUuid(item.provenanceId,"LEGACY_RECORD_ID_INVALID"));
    if(new Set(provenanceIds).size!==provenanceIds.length)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_DUPLICATE",409);
    const found=await tx.query("SELECT id,classification,review_status FROM legacy_provenance_records WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE",[org,provenanceIds]);
    if(found.rowCount!==provenanceIds.length)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_NOT_FOUND",404);
    const invalid=found.rows.find(row=>row.classification!=="REVIEW_REQUIRED"||row.review_status!=="PENDING");
    if(invalid)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_NOT_PENDING",409);
    const inserted=await tx.query(`INSERT INTO legacy_review_groups(organization_id,category,group_key,deterministic_version,group_hash,source_summary,signals,
      recommendation,recommendation_reason,confidence,requires_external_evidence,external_evidence_status,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(organization_id,category,group_key) DO NOTHING RETURNING *`,[org,value.category,value.groupKey,value.deterministicVersion,value.groupHash,
      JSON.stringify(value.sourceSummary),JSON.stringify(value.signals),value.recommendation,value.recommendationReason,value.confidence,value.requiresExternalEvidence,value.externalEvidenceStatus,actor]);
    if(!inserted.rowCount){
      const existing=(await tx.query("SELECT * FROM legacy_review_groups WHERE organization_id=$1 AND category=$2 AND group_key=$3",[org,value.category,value.groupKey])).rows[0];
      if(existing.group_hash.trim()!==value.groupHash)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_CONFLICT",409);
      return {item:existing,replayed:true};
    }
    const item=inserted.rows[0];
    for(let index=0;index<value.members.length;index++){
      const source=value.members[index],role=String(source.memberRole||"MEMBER"),classification=source.recommendedClassification||null;
      if(!["MEMBER","PRIMARY_CANDIDATE","SUPERSEDED_CANDIDATE"].includes(role))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_INVALID");
      if(classification&&!['MATCH_EXISTING','IMPORT_NEW','REVIEW_REQUIRED','LEGACY_ONLY'].includes(classification))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_INVALID");
      await tx.query(`INSERT INTO legacy_review_group_members(organization_id,group_id,provenance_id,member_role,recommended_classification,recommendation_reason,source_order,source_summary)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[org,item.id,provenanceIds[index],role,classification,cleanText(source.recommendationReason,2000)||"",Number.isInteger(source.sourceOrder)?source.sourceOrder:index,JSON.stringify(objectValue(source.sourceSummary))]);
    }
    const registrationId=deterministicUuid("legacy-review-group-registration",`${org}:${item.id}`),snapshotHash=recommendationHash(item);
    await tx.query(`INSERT INTO legacy_review_group_decisions(organization_id,group_id,decision_version,action,to_review_status,recommendation,recommendation_hash,reason,actor_user_id,idempotency_key,payload_hash)
      VALUES($1,$2,0,'REGISTERED','PENDING',$3,$4,'Deterministic review recommendation staged; no import performed',$5,$6,$7)`,[org,item.id,item.recommendation,snapshotHash,actor,registrationId,sha256({groupId:item.id,groupHash:value.groupHash})]);
    return {item,replayed:false};
  },{client});
}

async function batchReviewGroups({req,idempotencyKey,action,selections,note=""}){
  const org=assertUuid(req.user.organization_id,"TENANT_CONTEXT_REQUIRED"),actor=assertUuid(req.user.id,"LEGACY_ACTOR_INVALID"),requestId=assertUuid(idempotencyKey,"LEGACY_IDEMPOTENCY_KEY_INVALID");
  const normalizedAction=String(action||"");if(!BATCH_ACTIONS.has(normalizedAction))throw new LegacyProvenanceError("LEGACY_BATCH_ACTION_INVALID");
  if(!Array.isArray(selections)||!selections.length||selections.length>200)throw new LegacyProvenanceError("LEGACY_BATCH_SELECTION_INVALID");
  const normalizedSelections=selections.map(item=>({groupId:assertUuid(item.groupId,"LEGACY_REVIEW_GROUP_ID_INVALID"),expectedVersion:Number(item.expectedVersion)})).sort((a,b)=>a.groupId.localeCompare(b.groupId));
  if(normalizedSelections.some(item=>!Number.isInteger(item.expectedVersion)||item.expectedVersion<0)||new Set(normalizedSelections.map(item=>item.groupId)).size!==normalizedSelections.length)throw new LegacyProvenanceError("LEGACY_BATCH_SELECTION_INVALID");
  const reviewerNote=cleanText(note,4000)||"",command={action:normalizedAction,selections:normalizedSelections,note:reviewerNote},commandHash=sha256(command);
  return withTenantTransaction(org,async client=>{
    // Serialize the same tenant/idempotency identity before reading its receipt,
    // so simultaneous exact retries converge on replay rather than stale state.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:${requestId}`]);
    const replay=await client.query("SELECT * FROM legacy_review_batch_commands WHERE organization_id=$1 AND idempotency_key=$2",[org,requestId]);
    if(replay.rowCount){if(replay.rows[0].payload_hash.trim()!==commandHash)throw new LegacyProvenanceError("LEGACY_IDEMPOTENCY_CONFLICT",409);return {batch:replay.rows[0],replayed:true}}
    const ids=normalizedSelections.map(item=>item.groupId);
    const groupResult=await client.query("SELECT * FROM legacy_review_groups WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[org,ids]);
    if(groupResult.rowCount!==ids.length)throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_NOT_FOUND",404);
    const expected=new Map(normalizedSelections.map(item=>[item.groupId,item.expectedVersion]));
    for(const group of groupResult.rows){
      if(Number(group.version)!==expected.get(group.id))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_VERSION_CONFLICT",409);
      if(group.review_status!=="PENDING")throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_ALREADY_DECIDED",409);
      if(normalizedAction!=="SEND_MANUAL_REVIEW"&&group.requires_external_evidence&&group.external_evidence_status!=="VERIFIED")throw new LegacyProvenanceError("LEGACY_EXTERNAL_EVIDENCE_REQUIRED",409);
      if(normalizedAction==="APPROVE_RECOMMENDATION"&&!['IMPORT_NEW','LEGACY_ONLY'].includes(group.recommendation))throw new LegacyProvenanceError("LEGACY_RECOMMENDATION_NOT_APPROVABLE",409);
      if(normalizedAction==="APPROVE_RECOMMENDATION"&&group.recommendation==="IMPORT_NEW"&&(
        !SAFE_CANONICAL_IMPORT_CATEGORIES.has(group.category)||group.confidence!=="HIGH"||group.requires_external_evidence||group.external_evidence_status!=="NOT_REQUIRED"
      ))throw new LegacyProvenanceError("LEGACY_SAFE_IMPORT_RECOMMENDATION_REQUIRED",409);
      if(normalizedAction==="MARK_LEGACY_ONLY"&&group.category==="ATTENDANCE")throw new LegacyProvenanceError("LEGACY_ATTENDANCE_FINAL_DECISION_BLOCKED",409);
    }
    const memberResult=await client.query(`SELECT m.*,p.version AS provenance_version,p.classification,p.review_status AS provenance_review_status
      FROM legacy_review_group_members m JOIN legacy_provenance_records p ON p.organization_id=m.organization_id AND p.id=m.provenance_id
      WHERE m.organization_id=$1 AND m.group_id=ANY($2::uuid[]) ORDER BY m.provenance_id FOR UPDATE OF p`,[org,ids]);
    const mutatesMembers=normalizedAction!=="SEND_MANUAL_REVIEW";
    if(mutatesMembers&&memberResult.rows.some(row=>row.classification!=="REVIEW_REQUIRED"||row.provenance_review_status!=="PENDING"))throw new LegacyProvenanceError("LEGACY_REVIEW_GROUP_MEMBER_ALREADY_DECIDED",409);
    const affectedRecordCount=mutatesMembers?memberResult.rowCount:0;
    const nextStatus=normalizedAction==="SEND_MANUAL_REVIEW"?"MANUAL_REVIEW":normalizedAction==="MARK_LEGACY_ONLY"?"LEGACY_ONLY":null;
    const resultSummary={selectedGroups:ids.length,affectedRecords:affectedRecordCount,action:normalizedAction,noImport:true};
    const batch=(await client.query(`INSERT INTO legacy_review_batch_commands(organization_id,idempotency_key,action,payload_hash,selected_group_ids,selected_group_count,affected_record_count,note,actor_user_id,result_summary)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb) RETURNING *`,[org,requestId,normalizedAction,commandHash,JSON.stringify(ids),ids.length,affectedRecordCount,reviewerNote,actor,JSON.stringify(resultSummary)])).rows[0];
    const membersByGroup=new Map();for(const memberRow of memberResult.rows){const rows=membersByGroup.get(memberRow.group_id)||[];rows.push(memberRow);membersByGroup.set(memberRow.group_id,rows)}
    for(const group of groupResult.rows){
      const groupStatus=nextStatus||(group.recommendation==="LEGACY_ONLY"?"LEGACY_ONLY":"APPROVED");
      const decisionVersion=Number(group.version)+1,decisionId=deterministicUuid("legacy-review-group-decision",`${requestId}:${group.id}`);
      const decisionPayload={action:normalizedAction,groupId:group.id,from:group.review_status,to:groupStatus,note:reviewerNote,recommendation:group.recommendation};
      await client.query(`INSERT INTO legacy_review_group_decisions(organization_id,group_id,decision_version,action,from_review_status,to_review_status,recommendation,recommendation_hash,reason,notes,actor_user_id,idempotency_key,payload_hash,batch_command_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[org,group.id,decisionVersion,normalizedAction,group.review_status,groupStatus,group.recommendation,recommendationHash(group),
        normalizedAction==="APPROVE_RECOMMENDATION"?"Reviewer approved the deterministic recommendation.":normalizedAction==="MARK_LEGACY_ONLY"?"Reviewer retained selected evidence as legacy-only.":"Reviewer routed selected cases to manual review.",reviewerNote,actor,decisionId,sha256(decisionPayload),batch.id]);
      await client.query("UPDATE legacy_review_groups SET review_status=$3,reviewed_by=$4,reviewed_at=now(),review_notes=$5,version=$6 WHERE organization_id=$1 AND id=$2",[org,group.id,groupStatus,actor,reviewerNote,decisionVersion]);
      if(mutatesMembers){
        const classification=normalizedAction==="MARK_LEGACY_ONLY"?"LEGACY_ONLY":group.recommendation;
        for(const memberRow of membersByGroup.get(group.id)||[]){
          await applyProvenanceDecisionInTransaction({client,req,organizationId:org,actorUserId:actor,provenanceId:memberRow.provenance_id,expectedVersion:Number(memberRow.provenance_version),
            idempotencyKey:deterministicUuid("legacy-review-member-decision",`${requestId}:${memberRow.provenance_id}`),classification,reviewStatus:"APPROVED",
            reason:`Grouped review: ${normalizedAction}. ${group.recommendation_reason}`,notes:reviewerNote});
        }
      }
    }
    await writeAudit(req,"legacy_migration.batch_review","legacy_review_batch_command",batch.id,{action:normalizedAction,selectedGroupCount:ids.length,affectedRecordCount,idempotencyKey:requestId,noImport:true},client);
    return {batch,replayed:false};
  });
}

module.exports={CATEGORIES,RECOMMENDATIONS,CONFIDENCE,BATCH_ACTIONS,SAFE_CANONICAL_IMPORT_CATEGORIES,deterministicUuid,normalizeGroup,recommendationHash,registerReviewGroup,batchReviewGroups};
