"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { WORK_ORDER_PERMISSIONS, hasPermission } = require("../services/work-order-authority");
const { availableWorkflowActions } = require("../services/work-order-flow");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});
const reviewSchema = periodSchema.extend({
  summaryNote: z.string().trim().max(5000).default(""),
  issueNote: z.string().trim().max(5000).default(""),
  resourceNote: z.string().trim().max(5000).default(""),
  nextPlanNote: z.string().trim().max(5000).default(""),
  conclusionNote: z.string().trim().max(5000).default(""),
});

router.use(authenticate, requireModule("work-orders"));

router.get("/overview", requirePermissions(WORK_ORDER_PERMISSIONS.READ_ALL), asyncHandler(async(req,res)=>{
  const now=new Date();
  const parsed=periodSchema.safeParse({year:req.query.year||now.getFullYear(),month:req.query.month||now.getMonth()+1});
  if(!parsed.success)return res.status(400).json({error:"Тайлангийн хугацаа буруу байна",issues:parsed.error.issues});
  const {year,month}=parsed.data,params=[req.user.organization_id,year,month];
  const [orders,review]=await Promise.all([
    getPool().query(`SELECT w.id,w.asset_id,w.operational_object_id,w.work_type_id,w.department_id,w.workflow_policy_id,
      w.workflow_stage,w.title,w.description,w.category,w.priority,w.status,w.assigned_to,w.created_by,w.due_at,w.created_at,w.updated_at,
      COALESCE(oo.code,a.code) asset_code,COALESCE(oo.name,a.name) asset_name,
      wt.name work_type_name,d.name department_name,p.name workflow_name,p.config workflow_config,
      assignee.full_name assigned_name,creator.full_name created_by_name,
      CASE
        WHEN lower(concat_ws(' ',wt.code,wt.name,d.name,w.category,w.title)) ~ '(камер|camera|сүлжээ)' THEN 'camera'
        WHEN lower(concat_ws(' ',wt.code,wt.name,d.name,w.category,w.title)) ~ '(гэрэл|lighting|цахилгаан|шонт)' THEN 'lighting'
        ELSE 'other'
      END engineering_domain,
      COALESCE(materials.request_count,0)::int material_request_count,
      COALESCE(materials.pending_count,0)::int material_pending_count,
      COALESCE(materials.issued_count,0)::int material_issued_count,
      COALESCE(evidence.attachment_count,0)::int attachment_count,
      COALESCE(evidence.event_count,0)::int evidence_event_count,
      COALESCE(scope.scope_count,0)::int scope_count,
      COALESCE(scope.planned_quantity,0)::numeric planned_quantity,
      COALESCE(scope.completed_quantity,0)::numeric completed_quantity
      FROM work_orders w
      LEFT JOIN operational_objects oo ON oo.organization_id=w.organization_id AND oo.id=w.operational_object_id
      LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id
      LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
      LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
      LEFT JOIN organization_workflow_policies p ON p.organization_id=w.organization_id AND p.id=w.workflow_policy_id
      LEFT JOIN users assignee ON assignee.organization_id=w.organization_id AND assignee.id=w.assigned_to
      LEFT JOIN users creator ON creator.organization_id=w.organization_id AND creator.id=w.created_by
      LEFT JOIN LATERAL(SELECT count(*) request_count,count(*) FILTER(WHERE status IN('requested','approved')) pending_count,
        count(*) FILTER(WHERE status IN('issued','consumed')) issued_count FROM work_order_material_requests mr
        WHERE mr.organization_id=w.organization_id AND mr.work_order_id=w.id) materials ON true
      LEFT JOIN LATERAL(SELECT
        (SELECT count(*) FROM attachments at WHERE at.organization_id=w.organization_id AND at.work_order_id=w.id) attachment_count,
        (SELECT count(*) FROM work_order_events we WHERE we.organization_id=w.organization_id AND we.work_order_id=w.id
          AND (nullif(trim(we.note),'') IS NOT NULL OR we.event_type LIKE 'workflow_%')) event_count) evidence ON true
      LEFT JOIN LATERAL(SELECT count(*) scope_count,COALESCE(sum(planned_quantity),0) planned_quantity,
        COALESCE(sum(completed_quantity),0) completed_quantity FROM work_order_scope_items si
        WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id) scope ON true
      WHERE w.organization_id=$1 AND (
        (extract(year FROM w.created_at)=$2::int AND extract(month FROM w.created_at)=$3::int)
        OR w.status NOT IN('completed','cancelled')
        OR (w.updated_at>=make_date($2::int,$3::int,1) AND w.updated_at<make_date($2::int,$3::int,1)+interval '1 month')
      ) ORDER BY CASE w.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        w.due_at NULLS LAST,w.created_at DESC LIMIT 500`,params),
    getPool().query(`SELECT r.*,creator.full_name created_by_name,updater.full_name updated_by_name
      FROM engineering_monthly_reviews r
      LEFT JOIN users creator ON creator.organization_id=r.organization_id AND creator.id=r.created_by
      LEFT JOIN users updater ON updater.organization_id=r.organization_id AND updater.id=r.updated_by
      WHERE r.organization_id=$1 AND r.review_year=$2 AND r.review_month=$3`,params),
  ]);
  const items=orders.rows.map(item=>({...item,available_actions:item.workflow_policy_id?availableWorkflowActions({
    stage:item.workflow_stage,permissions:req.user.permissions||[],userId:req.user.id,assignedTo:item.assigned_to,config:item.workflow_config||{}
  }):[]}));
  res.json({period:{year,month},items,review:review.rows[0]||null,
    capabilities:{canCreate:hasPermission(req.user,WORK_ORDER_PERMISSIONS.CREATE),canAssign:hasPermission(req.user,WORK_ORDER_PERMISSIONS.ASSIGN),canReview:hasPermission(req.user,WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE)}});
}));

router.put("/monthly-review",requirePermissions(WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE),asyncHandler(async(req,res)=>{
  const parsed=reviewSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Сарын дүгнэлтийн мэдээлэл буруу байна",issues:parsed.error.issues});
  const v=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const previous=(await client.query("SELECT * FROM engineering_monthly_reviews WHERE organization_id=$1 AND review_year=$2 AND review_month=$3 FOR UPDATE",
      [req.user.organization_id,v.year,v.month])).rows[0]||null;
    const result=await client.query(`INSERT INTO engineering_monthly_reviews
      (organization_id,review_year,review_month,summary_note,issue_note,resource_note,next_plan_note,conclusion_note,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT(organization_id,review_year,review_month) DO UPDATE SET
        summary_note=EXCLUDED.summary_note,issue_note=EXCLUDED.issue_note,resource_note=EXCLUDED.resource_note,
        next_plan_note=EXCLUDED.next_plan_note,conclusion_note=EXCLUDED.conclusion_note,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING *`,[req.user.organization_id,v.year,v.month,v.summaryNote,v.issueNote,v.resourceNote,v.nextPlanNote,v.conclusionNote,req.user.id]);
    await writeAudit(req,"engineering.monthly-review.saved","engineering_monthly_review",result.rows[0].id,
      {period:`${v.year}-${String(v.month).padStart(2,"0")}`,created:!previous,previousUpdatedAt:previous?.updated_at||null},client);
    await client.query("COMMIT");res.json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

module.exports=router;
