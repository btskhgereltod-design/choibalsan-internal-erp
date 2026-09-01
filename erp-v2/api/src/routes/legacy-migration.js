"use strict";

const express=require("express");
const {z}=require("zod");
const {authenticate,requireModule,requirePermissions}=require("../middleware/auth");
const {withTenantTransaction}=require("../db");
const {reviewProvenanceRecord}=require("../services/legacy-provenance");
const {batchReviewGroups}=require("../services/legacy-review-groups");
const {asyncHandler}=require("../utils/async-handler");

const router=express.Router();
router.use(authenticate,requireModule("hr"));
const read=requirePermissions("legacy_migration.read"),review=requirePermissions("legacy_migration.review");

router.get("/overview",read,asyncHandler(async(req,res)=>{
  const org=req.user.organization_id,classification=String(req.query.classification||""),reviewStatus=String(req.query.reviewStatus||""),legacyTable=String(req.query.legacyTable||""),search=String(req.query.search||"").trim();
  const result=await withTenantTransaction(org,async client=>{
    const params=[org],where=["r.organization_id=$1"];
    if(classification){params.push(classification);where.push(`r.classification=$${params.length}`)}
    if(reviewStatus){params.push(reviewStatus);where.push(`r.review_status=$${params.length}`)}
    if(legacyTable){params.push(legacyTable);where.push(`r.legacy_table=$${params.length}`)}
    if(search){params.push(`%${search}%`);where.push(`(r.legacy_id ILIKE $${params.length} OR r.legacy_table ILIKE $${params.length} OR r.source_summary::text ILIKE $${params.length} OR r.conflict_reason ILIKE $${params.length})`)}
    const summary=await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE imported_at IS NOT NULL)::int imported,count(*) FILTER(WHERE review_status='PENDING')::int unresolved FROM legacy_provenance_records WHERE organization_id=$1`,[org]);
    const reviewCounts=await client.query(`SELECT classification,count(*)::int count FROM legacy_provenance_records WHERE organization_id=$1 GROUP BY classification ORDER BY classification`,[org]);
    const tableCounts=await client.query(`SELECT legacy_table,count(*)::int count,count(*) FILTER(WHERE review_status='PENDING')::int unresolved FROM legacy_provenance_records WHERE organization_id=$1 GROUP BY legacy_table ORDER BY legacy_table`,[org]);
    const items=await client.query(`SELECT r.*,reviewer.full_name reviewed_by_name FROM legacy_provenance_records r LEFT JOIN users reviewer ON reviewer.organization_id=r.organization_id AND reviewer.id=r.reviewed_by WHERE ${where.join(" AND ")} ORDER BY (r.review_status='PENDING') DESC,r.legacy_table,r.legacy_id LIMIT 500`,params);
    return {summary:summary.rows[0],classificationCounts:reviewCounts.rows,tableCounts:tableCounts.rows,items:items.rows};
  });
  res.json(result);
}));

router.get("/review-groups/overview",read,asyncHandler(async(req,res)=>{
  const org=req.user.organization_id,category=String(req.query.category||""),recommendation=String(req.query.recommendation||""),reviewStatus=String(req.query.reviewStatus||"PENDING"),search=String(req.query.search||"").trim(),safeCanonical=req.query.safeCanonical==="true";
  const limit=Math.min(Math.max(Number(req.query.limit)||200,1),300),offset=Math.max(Number(req.query.offset)||0,0);
  const result=await withTenantTransaction(org,async client=>{
    const params=[org],where=["g.organization_id=$1"];
    if(category){params.push(category);where.push(`g.category=$${params.length}`)}
    if(recommendation){params.push(recommendation);where.push(`g.recommendation=$${params.length}`)}
    if(reviewStatus){params.push(reviewStatus);where.push(`g.review_status=$${params.length}`)}
    if(safeCanonical)where.push("g.category IN('ORDER_DECISION','CORRESPONDENCE') AND g.recommendation='IMPORT_NEW' AND g.confidence='HIGH' AND NOT g.requires_external_evidence AND g.external_evidence_status='NOT_REQUIRED'");
    if(search){params.push(`%${search}%`);where.push(`(g.group_key ILIKE $${params.length} OR g.source_summary::text ILIKE $${params.length} OR g.signals::text ILIKE $${params.length})`)}
    const summary=(await client.query(`SELECT count(DISTINCT g.id)::int groups,count(m.id)::int raw_rows,
      count(DISTINCT g.id) FILTER(WHERE g.review_status='PENDING')::int unresolved_groups,
      count(m.id) FILTER(WHERE g.review_status='PENDING')::int unresolved_raw_rows,
      count(DISTINCT g.id) FILTER(WHERE g.review_status='PENDING' AND g.recommendation IN('IMPORT_NEW','LEGACY_ONLY') AND (NOT g.requires_external_evidence OR g.external_evidence_status='VERIFIED'))::int safe_recommended_groups,
      count(m.id) FILTER(WHERE g.review_status='PENDING' AND g.recommendation IN('IMPORT_NEW','LEGACY_ONLY') AND (NOT g.requires_external_evidence OR g.external_evidence_status='VERIFIED'))::int safe_recommended_raw_rows,
      count(DISTINCT g.id) FILTER(WHERE g.review_status='PENDING' AND g.recommendation='MANUAL_REVIEW')::int true_manual_groups,
      count(m.id) FILTER(WHERE g.review_status='PENDING' AND g.recommendation='MANUAL_REVIEW')::int true_manual_raw_rows,
      count(DISTINCT g.id) FILTER(WHERE g.review_status='PENDING' AND g.requires_external_evidence AND g.external_evidence_status='MISSING')::int external_evidence_blocked_groups,
      count(m.id) FILTER(WHERE g.review_status='PENDING' AND g.requires_external_evidence AND g.external_evidence_status='MISSING')::int external_evidence_blocked_raw_rows
      FROM legacy_review_groups g JOIN legacy_review_group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id WHERE g.organization_id=$1`,[org])).rows[0];
    const categoryCounts=await client.query(`SELECT g.category,count(DISTINCT g.id)::int groups,count(m.id)::int raw_rows,
      count(DISTINCT g.id) FILTER(WHERE g.review_status='PENDING')::int unresolved_groups
      FROM legacy_review_groups g JOIN legacy_review_group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id
      WHERE g.organization_id=$1 GROUP BY g.category ORDER BY g.category`,[org]);
    const recommendationCounts=await client.query(`SELECT g.recommendation,count(DISTINCT g.id)::int groups,count(m.id)::int raw_rows
      FROM legacy_review_groups g JOIN legacy_review_group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id
      WHERE g.organization_id=$1 AND g.review_status='PENDING' GROUP BY g.recommendation ORDER BY g.recommendation`,[org]);
    const itemParams=[...params,limit,offset],limitParameter=params.length+1,offsetParameter=params.length+2;
    const items=await client.query(`SELECT g.*,reviewer.full_name reviewed_by_name,count(m.id)::int member_count,
      jsonb_agg(jsonb_build_object('id',m.id,'provenanceId',m.provenance_id,'legacyTable',p.legacy_table,'legacyId',p.legacy_id,
        'memberRole',m.member_role,'recommendedClassification',m.recommended_classification,'recommendationReason',m.recommendation_reason,
        'sourceOrder',m.source_order,'sourceSummary',m.source_summary,'currentClassification',p.classification,'currentReviewStatus',p.review_status,'provenanceVersion',p.version)
        ORDER BY m.source_order,m.id) members
      FROM legacy_review_groups g
      JOIN legacy_review_group_members m ON m.organization_id=g.organization_id AND m.group_id=g.id
      JOIN legacy_provenance_records p ON p.organization_id=m.organization_id AND p.id=m.provenance_id
      LEFT JOIN users reviewer ON reviewer.organization_id=g.organization_id AND reviewer.id=g.reviewed_by
      WHERE ${where.join(" AND ")} GROUP BY g.id,reviewer.full_name
      ORDER BY CASE g.recommendation WHEN 'IMPORT_NEW' THEN 0 WHEN 'LEGACY_ONLY' THEN 1 WHEN 'MANUAL_REVIEW' THEN 2 ELSE 3 END,g.category,g.group_key
      LIMIT $${limitParameter} OFFSET $${offsetParameter}`,itemParams);
    return {summary:{...summary,raw_rows_reduced_by_grouping:Number(summary.raw_rows)-Number(summary.groups)},categoryCounts:categoryCounts.rows,recommendationCounts:recommendationCounts.rows,items:items.rows,paging:{limit,offset,returned:items.rowCount}};
  });
  res.json(result);
}));

router.get("/review-groups/:id",read,asyncHandler(async(req,res)=>{
  const parsed=z.string().uuid().safeParse(req.params.id);if(!parsed.success)return res.status(400).json({error:"LEGACY_REVIEW_GROUP_ID_INVALID"});
  const result=await withTenantTransaction(req.user.organization_id,async client=>{
    const item=await client.query("SELECT * FROM legacy_review_groups WHERE organization_id=$1 AND id=$2",[req.user.organization_id,parsed.data]);if(!item.rowCount)return null;
    const members=await client.query(`SELECT m.*,p.legacy_source,p.legacy_table,p.legacy_id,p.legacy_status,p.source_summary AS provenance_summary,p.classification,p.review_status AS provenance_review_status,p.version AS provenance_version
      FROM legacy_review_group_members m JOIN legacy_provenance_records p ON p.organization_id=m.organization_id AND p.id=m.provenance_id
      WHERE m.organization_id=$1 AND m.group_id=$2 ORDER BY m.source_order,m.id`,[req.user.organization_id,parsed.data]);
    const decisions=await client.query(`SELECT d.*,u.full_name actor_name FROM legacy_review_group_decisions d JOIN users u ON u.organization_id=d.organization_id AND u.id=d.actor_user_id
      WHERE d.organization_id=$1 AND d.group_id=$2 ORDER BY d.decision_version,d.created_at,d.id`,[req.user.organization_id,parsed.data]);
    return {item:item.rows[0],members:members.rows,decisions:decisions.rows};
  });
  if(!result)return res.status(404).json({error:"LEGACY_REVIEW_GROUP_NOT_FOUND"});res.json(result);
}));

router.post("/review-groups/batch-decisions",review,asyncHandler(async(req,res)=>{
  const parsed=z.object({idempotencyKey:z.string().uuid(),action:z.enum(["APPROVE_RECOMMENDATION","MARK_LEGACY_ONLY","SEND_MANUAL_REVIEW"]),
    selections:z.array(z.object({groupId:z.string().uuid(),expectedVersion:z.coerce.number().int().min(0)})).min(1).max(200),note:z.string().trim().max(4000).default("")}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"LEGACY_BATCH_REVIEW_INVALID"});
  const result=await batchReviewGroups({req,...parsed.data});res.status(result.replayed?200:201).json(result);
}));

router.get("/:id",read,asyncHandler(async(req,res)=>{
  const parsed=z.string().uuid().safeParse(req.params.id);if(!parsed.success)return res.status(400).json({error:"LEGACY_RECORD_ID_INVALID"});
  const result=await withTenantTransaction(req.user.organization_id,async client=>{
    const item=await client.query("SELECT * FROM legacy_provenance_records WHERE organization_id=$1 AND id=$2",[req.user.organization_id,parsed.data]);
    if(!item.rowCount)return null;
    const decisions=await client.query(`SELECT d.*,u.full_name actor_name FROM legacy_provenance_decisions d JOIN users u ON u.organization_id=d.organization_id AND u.id=d.actor_user_id WHERE d.organization_id=$1 AND d.provenance_id=$2 ORDER BY d.decision_version,d.created_at,d.id`,[req.user.organization_id,parsed.data]);
    return {item:item.rows[0],decisions:decisions.rows};
  });
  if(!result)return res.status(404).json({error:"LEGACY_RECORD_NOT_FOUND"});res.json(result);
}));

router.post("/:id/decisions",review,asyncHandler(async(req,res)=>{
  const parsed=z.object({
    expectedVersion:z.coerce.number().int().min(0),idempotencyKey:z.string().uuid(),
    classification:z.enum(["MATCH_EXISTING","IMPORT_NEW","REVIEW_REQUIRED","LEGACY_ONLY"]),
    reviewStatus:z.enum(["APPROVED","REJECTED","PENDING"]),targetType:z.string().trim().max(80).nullable().optional(),targetId:z.string().uuid().nullable().optional(),
    reason:z.string().trim().min(1).max(2000),notes:z.string().trim().max(4000).default("")
  }).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"LEGACY_REVIEW_INVALID"});
  const result=await reviewProvenanceRecord({req,provenanceId:req.params.id,...parsed.data});
  res.status(result.replayed?200:201).json(result);
}));

module.exports=router;
