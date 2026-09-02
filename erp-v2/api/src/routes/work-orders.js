"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool, setTenantContext, withTenantTransaction } = require("../db");
const { authenticate, requireModule } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { emitAutomationEvent } = require("../services/automation");
const { notifyUser, notifyManagement } = require("../services/notifications");
const { payloadHash } = require("../services/workflow-coordination");
const { canTransition, WORKFLOW_ACTIONS, availableWorkflowActions, canPerformWorkflowAction, resolveWorkflowAction } = require("../services/work-order-flow");
const { canTransitionMaterial } = require("../services/work-order-material-flow");
const {
  activeAssignee,
  assignmentState,
  recordInitialAssignment,
  replayAssignment,
  changeAssignment,
} = require("../services/work-order-assignment");
const {
  WORK_ORDER_PERMISSIONS,
  hasPermission,
  canReadOrder,
  canAssignOrder,
  canClaimOrder,
  canProgressOrder,
  canManageScope,
  availableStatusTransitions,
} = require("../services/work-order-authority");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const createSchema = z.object({
  assetId: z.string().uuid().nullable().optional(), operationalObjectId: z.string().uuid().nullable().optional(),
  incidentId: z.string().uuid().nullable().optional(),
  serviceAreaId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  workTypeId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1).max(300),
  operationalStream: z.enum(["core_service", "internal_operation"]).nullable().optional(),
  assignmentKind: z.enum(["normal", "special", "emergency"]).default("normal"),
  description: z.string().trim().max(5000).default(""), category: z.string().trim().min(1).max(100),
  priority: z.enum(["low", "normal", "high", "emergency"]).default("normal"), dueAt: z.iso.datetime().nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(["assigned", "in_progress", "pending_review", "completed", "cancelled"]) });
const assignmentSchema = z.object({
  assignedTo: z.string().uuid().nullable(),
  reason: z.string().trim().max(2000).default(""),
  idempotencyKey: z.string().uuid().nullable().optional(),
});
const claimSchema = z.object({ idempotencyKey: z.string().uuid() });
const noteSchema = z.object({ note: z.string().trim().min(1).max(2000) });
const safetyChecklistItemSchema=z.object({code:z.string().trim().min(1).max(120),checked:z.boolean(),note:z.string().trim().max(1000).default("")});
const safetyReviewSchema=z.object({
  templateId:z.string().uuid(),reviewType:z.enum(["start","completion"]),
  likelihood:z.coerce.number().int().min(1).max(5).nullable().optional(),severity:z.coerce.number().int().min(1).max(5).nullable().optional(),
  hazards:z.array(z.string().trim().min(1).max(500)).max(50).default([]),controls:z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  ppe:z.array(z.string().trim().min(1).max(200)).max(50).default([]),checklist:z.array(safetyChecklistItemSchema).max(100),
  validUntil:z.union([z.iso.datetime(),z.null()]).optional(),note:z.string().trim().min(1).max(2000),
});
const workflowActionSchema = z.object({
  action: z.enum(Object.keys(WORKFLOW_ACTIONS)), note: z.string().trim().max(2000).default(""),
  idempotencyKey:z.string().uuid(),
  safetyReview:safetyReviewSchema.optional(),
});
const scopeItemSchema = z.object({
  operationalObjectId:z.string().uuid().nullable().optional(),assetId:z.string().uuid().nullable().optional(),
  itemCode:z.string().trim().min(1).max(80),description:z.string().trim().min(1).max(500),
  unit:z.string().trim().min(1).max(30).default("ш"),plannedQuantity:z.number().positive().max(100000000),
  weight:z.number().positive().max(1000000).default(1)
});
const scopeProgressSchema=z.object({completedQuantity:z.number().min(0),unresolvedQuantity:z.number().min(0),deferredQuantity:z.number().min(0),exceptionReason:z.string().trim().max(2000).default(""),requestException:z.boolean().default(false)});
const exceptionDecisionSchema=z.object({decision:z.enum(["accepted","rejected"]),note:z.string().trim().min(1).max(2000)});
const materialRequestSchema=z.object({
  inventoryItemId:z.string().uuid(),quantity:z.coerce.number().positive().max(100000000),
  reason:z.string().trim().min(1).max(2000),idempotencyKey:z.string().uuid(),
});
const materialDecisionSchema=z.object({
  decision:z.enum(["approved","rejected"]),approvedQuantity:z.coerce.number().positive().max(100000000).optional(),
  note:z.string().trim().max(2000).default(""),
}).superRefine((value,ctx)=>{
  if(value.decision==="approved"&&!value.approvedQuantity)ctx.addIssue({code:"custom",path:["approvedQuantity"],message:"Approved quantity is required"});
  if(value.decision==="rejected"&&!value.note)ctx.addIssue({code:"custom",path:["note"],message:"Rejection note is required"});
});
const materialIssueSchema=z.object({warehouseId:z.string().uuid(),idempotencyKey:z.string().uuid()});

async function scopeClosure(client,organizationId,workOrderId){
  const result=await client.query(`SELECT count(*)::int item_count,
    count(*) FILTER(WHERE outcome_status NOT IN ('completed','closed_with_exception'))::int blocking_count,
    COALESCE(sum(planned_quantity),0) planned,COALESCE(sum(completed_quantity),0) completed,
    COALESCE(sum(unresolved_quantity),0) unresolved,COALESCE(sum(deferred_quantity),0) deferred
    FROM work_order_scope_items WHERE organization_id=$1 AND work_order_id=$2`,[organizationId,workOrderId]);
  return result.rows[0];
}

async function resolveLinkedIncidents(client,{organizationId,workOrderId,userId}){
  const linked=await client.query(`SELECT i.id,i.affected_quantity,i.resolved_quantity
    FROM operational_incident_work_orders l
    JOIN operational_incidents i ON i.organization_id=l.organization_id AND i.id=l.incident_id
    WHERE l.organization_id=$1 AND l.work_order_id=$2 AND i.status IN('open','in_progress')
    FOR UPDATE OF i`,[organizationId,workOrderId]);
  const resolved=[];
  for(const incident of linked.rows){
    const remaining=await client.query(`SELECT count(*)::int AS count
      FROM operational_incident_work_orders l
      JOIN work_orders w ON w.organization_id=l.organization_id AND w.id=l.work_order_id
      WHERE l.organization_id=$1 AND l.incident_id=$2 AND w.status NOT IN('completed','cancelled')`,
    [organizationId,incident.id]);
    if(remaining.rows[0].count)continue;
    const quantity=Math.max(0,Number(incident.affected_quantity)-Number(incident.resolved_quantity));
    await client.query(`UPDATE operational_incidents SET status='resolved',resolved_quantity=affected_quantity,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,[organizationId,incident.id]);
    await client.query(`INSERT INTO operational_incident_events(organization_id,incident_id,actor_user_id,event_type,quantity,note,detail)
      VALUES($1,$2,$3,'resolved',$4,$5,$6::jsonb)`,[organizationId,incident.id,userId,quantity,
      'Холбогдсон ажил Ерөнхий инженерийн хүлээн авалтаар хаагдсан',JSON.stringify({workOrderId})]);
    resolved.push(incident.id);
  }
  return resolved;
}

const safetyActionReviewType=Object.freeze({
  safety_authorize_start:"start",safety_return_start:"start",safety_suspend_execution:"start",
  safety_accept_completion:"completion",safety_return_to_execution:"completion",
});

async function recordSafetyReview(client,{organizationId,userId,work,action,value}){
  const reviewType=safetyActionReviewType[action];
  if(!reviewType)return null;
  if(work.config?.safetyReviewRequired!==true)return null;
  if(!value)return {error:"Энэ шатанд ХАБЭА-ийн бүтэцтэй шалгалт, нотолгоо шаардлагатай"};
  if(value.reviewType!==reviewType)return {error:"ХАБЭА шалгалтын төрөл одоогийн шаттай тохирохгүй байна"};
  const template=(await client.query(`SELECT t.* FROM organization_work_safety_template_routes r
    JOIN organization_work_safety_templates t ON t.organization_id=r.organization_id AND t.id=r.safety_template_id
    WHERE r.organization_id=$1 AND r.work_type_id=$2 AND r.active=true AND t.active=true AND t.id=$3`,
  [organizationId,work.work_type_id,value.templateId])).rows[0];
  if(!template)return {error:"Энэ ажлын төрөлд тохирох идэвхтэй ХАБЭА checklist олдсонгүй"};
  const decision=action==="safety_suspend_execution"?"revoked":action.includes("return")?"returned":"approved";
  const required=reviewType==="start"?template.start_checklist:template.completion_checklist;
  const supplied=new Map(value.checklist.map(item=>[item.code,item]));
  const unknown=value.checklist.find(item=>!required.some(expected=>expected.code===item.code));
  if(unknown)return {error:`Checklist-д үл таних мөр байна: ${unknown.code}`};
  if(decision==="approved"){
    const missing=required.filter(item=>item.required!==false&&!supplied.get(item.code)?.checked);
    if(missing.length)return {error:"Заавал шалгах бүх нөхцөлийг хангаагүй байна",missingChecklist:missing.map(item=>item.code)};
    if(reviewType==="start"&&(!value.likelihood||!value.severity||!value.hazards.length||!value.controls.length||!value.ppe.length))return {error:"Эхлэх зөвшөөрөлд эрсдэл, хамгаалах арга хэмжээ, PPE болон үнэлгээ бүрэн шаардлагатай"};
    if(reviewType==="start"&&(!value.validUntil||new Date(value.validUntil)<=new Date()))return {error:"Эхлэх зөвшөөрлийн хүчинтэй хугацаа ирээдүйд байх шаардлагатай"};
  }
  const scope=(await client.query(`SELECT count(*)::int AS count,COALESCE(max(updated_at)::text,'') AS changed_at
    FROM work_order_scope_items WHERE organization_id=$1 AND work_order_id=$2`,[organizationId,work.id])).rows[0];
  const snapshot={assignedTo:work.assigned_to,workTypeId:work.work_type_id,departmentId:work.department_id,
    operationalObjectId:work.operational_object_id,assetId:work.asset_id,title:work.title,dueAt:work.due_at,
    scopeCount:scope.count,scopeChangedAt:scope.changed_at};
  const inserted=await client.query(`INSERT INTO work_order_safety_reviews(
    organization_id,work_order_id,safety_template_id,template_version,review_type,decision,likelihood,severity,
    hazards,controls,ppe,checklist,note,valid_until,work_snapshot,actor_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15::jsonb,$16) RETURNING *`,
  [organizationId,work.id,template.id,template.version,reviewType,decision,value.likelihood||null,value.severity||null,
    JSON.stringify(value.hazards),JSON.stringify(value.controls),JSON.stringify(value.ppe),JSON.stringify(value.checklist),value.note,value.validUntil||null,JSON.stringify(snapshot),userId]);
  return {item:inserted.rows[0],template};
}

async function validateActiveStartPermit(client,organizationId,work){
  if(work.config?.safetyReviewRequired!==true)return null;
  const review=(await client.query(`SELECT * FROM work_order_safety_reviews
    WHERE organization_id=$1 AND work_order_id=$2 AND review_type='start'
    ORDER BY created_at DESC,id DESC LIMIT 1`,[organizationId,work.id])).rows[0];
  if(!review||review.decision!=="approved")return "Хүчинтэй ХАБЭА эхлэх зөвшөөрөл байхгүй байна";
  if(!review.valid_until||new Date(review.valid_until)<=new Date())return "ХАБЭА эхлэх зөвшөөрлийн хугацаа дууссан байна";
  const snapshot=review.work_snapshot||{},scope=(await client.query(`SELECT count(*)::int AS count,COALESCE(max(updated_at)::text,'') AS changed_at
    FROM work_order_scope_items WHERE organization_id=$1 AND work_order_id=$2`,[organizationId,work.id])).rows[0];
  if(snapshot.assignedTo!==work.assigned_to||snapshot.workTypeId!==work.work_type_id||snapshot.departmentId!==work.department_id||
    snapshot.operationalObjectId!==work.operational_object_id||snapshot.assetId!==work.asset_id||
    Number(snapshot.scopeCount||0)!==Number(scope.count)||String(snapshot.scopeChangedAt||"")!==String(scope.changed_at||"")){
    return "Ажлын хариуцагч, объект эсвэл scope өөрчлөгдсөн тул ХАБЭА зөвшөөрлийг дахин авна уу";
  }
  return null;
}

async function notifyAuthority(client, { organizationId, permission, excludeUserId, title, message, entityId }) {
  if (!permission) return;
  await client.query(`INSERT INTO notifications(organization_id,user_id,type,title,message,entity_id)
    SELECT DISTINCT u.organization_id,u.id,'work_order_workflow',$3,$4,$5
    FROM users u
    JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
    JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id AND r.active=true
    JOIN organization_role_permissions rp ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
    WHERE u.organization_id=$1 AND u.active=true AND u.can_login=true
      AND rp.permission_code=$2 AND u.id<>$6`,
  [organizationId,permission,title,message,entityId,excludeUserId]);
}

function deny(res, permission) {
  return res.status(403).json({error:"Work order permission required",code:"WORK_ORDER_PERMISSION_REQUIRED",permission});
}

function requireInventory(req,res) {
  if((req.user.enabled_modules||[]).includes("inventory"))return true;
  res.status(403).json({error:"Inventory module is not enabled for this organization",code:"MODULE_DISABLED",module:"inventory"});
  return false;
}

router.use(authenticate, requireModule("work-orders"));

router.get("/options", asyncHandler(async(req,res)=>{
  const [result,serviceAreas]=await withTenantTransaction(req.user.organization_id,client=>Promise.all([client.query(`SELECT wt.id,wt.code,wt.name,wt.category,wt.operational_stream,r.organization_unit_id AS department_id,
    d.name AS department_name,r.workflow_policy_id,p.name AS workflow_name
    FROM organization_work_types wt
    LEFT JOIN organization_work_type_routes r ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true
    LEFT JOIN departments d ON d.organization_id=r.organization_id AND d.id=r.organization_unit_id
    LEFT JOIN organization_workflow_policies p ON p.organization_id=r.organization_id AND p.id=r.workflow_policy_id AND p.active=true
    WHERE wt.organization_id=$1 AND wt.active=true ORDER BY wt.category,wt.name`,[req.user.organization_id]),
  client.query(`SELECT id,domain,code,name,icon,sort_order
    FROM organization_work_service_areas
    WHERE organization_id=$1 AND active=true ORDER BY domain,sort_order,name`,[req.user.organization_id])]));
  res.json({items:result.rows,serviceAreas:serviceAreas.rows});
}));

router.get("/intake", asyncHandler(async(req,res)=>{
  const canReadAll=hasPermission(req.user,WORK_ORDER_PERMISSIONS.READ_ALL);
  const canTriage=hasPermission(req.user,WORK_ORDER_PERMISSIONS.CREATE)
    &&(canReadAll||Boolean(req.user.department_id));
  if(!canTriage)return res.json({items:[],capabilities:{canTriage:false}});
  const result=await withTenantTransaction(req.user.organization_id,client=>client.query(`SELECT i.id,i.domain,i.incident_type,i.title,i.location,
    i.affected_quantity,i.resolved_quantity,(i.affected_quantity-i.resolved_quantity) AS remaining_quantity,
    i.status,i.reported_at,i.operational_object_id,i.asset_id,i.service_area_id,i.detail,
    area.domain AS service_area_domain,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon,
    COALESCE(oo.code,a.code) AS object_code,COALESCE(oo.name,a.name) AS object_name,
    COALESCE(related.open_count,0)::int AS related_open_work_count,
    related.first_work_id AS related_work_order_id,related.first_work_title AS related_work_order_title,
    suggestion.work_type_id AS suggested_work_type_id,suggestion.work_type_name AS suggested_work_type_name,
    suggestion.operational_stream AS suggested_operational_stream,suggestion.department_id AS suggested_department_id,
    suggestion.department_name AS suggested_department_name,
    suggestion.workflow_name AS suggested_workflow_name
    FROM operational_incidents i
    LEFT JOIN organization_work_service_areas area
      ON area.organization_id=i.organization_id AND area.id=i.service_area_id AND area.active=true
    LEFT JOIN operational_objects oo ON oo.organization_id=i.organization_id AND oo.id=i.operational_object_id
    LEFT JOIN assets a ON a.organization_id=i.organization_id AND a.id=i.asset_id
    LEFT JOIN LATERAL(
      SELECT wt.id AS work_type_id,wt.name AS work_type_name,wt.operational_stream,
        wr.organization_unit_id AS department_id,d.name AS department_name,p.name AS workflow_name
      FROM organization_work_intake_routes ir
      JOIN organization_work_types wt ON wt.organization_id=ir.organization_id AND wt.id=ir.work_type_id AND wt.active=true
      LEFT JOIN organization_work_type_routes wr ON wr.organization_id=wt.organization_id AND wr.work_type_id=wt.id AND wr.active=true
      LEFT JOIN departments d ON d.organization_id=wr.organization_id AND d.id=wr.organization_unit_id
      LEFT JOIN organization_workflow_policies p ON p.organization_id=wr.organization_id AND p.id=wr.workflow_policy_id AND p.active=true
      WHERE ir.organization_id=i.organization_id AND ir.incident_domain=i.domain AND ir.active=true
      LIMIT 1
    ) suggestion ON true
    LEFT JOIN LATERAL(
      SELECT count(*)::int AS open_count,(array_agg(w.id ORDER BY w.created_at DESC))[1] AS first_work_id,
        (array_agg(w.title ORDER BY w.created_at DESC))[1] AS first_work_title
      FROM work_orders w
      WHERE w.organization_id=i.organization_id AND w.status NOT IN('completed','cancelled')
        AND ((i.operational_object_id IS NOT NULL AND w.operational_object_id=i.operational_object_id)
          OR (i.operational_object_id IS NULL AND i.asset_id IS NOT NULL AND w.asset_id=i.asset_id))
    ) related ON true
    WHERE i.organization_id=$1 AND i.status IN('open','in_progress')
      AND ($2::boolean OR suggestion.department_id=$3::uuid)
      AND NOT EXISTS(
        SELECT 1 FROM operational_incident_work_orders l
        JOIN work_orders linked ON linked.organization_id=l.organization_id AND linked.id=l.work_order_id
        WHERE l.organization_id=i.organization_id AND l.incident_id=i.id
          AND linked.status NOT IN('completed','cancelled')
      )
    ORDER BY CASE i.status WHEN 'open' THEN 0 ELSE 1 END,i.reported_at DESC,i.id
    LIMIT 300`,[req.user.organization_id,canReadAll,req.user.department_id||null]));
  res.json({items:result.rows,capabilities:{canTriage:true,scope:canReadAll?"organization":"department"}});
}));

function routingState(item){
  if(["completed","cancelled"].includes(item.status))return "closed";
  if(item.assigned_to)return "assigned";
  if(item.status==="new"&&item.department_id&&item.work_type_id&&item.operational_stream&&item.assignment_kind==="normal")return "team_backlog";
  return "exception";
}

router.get("/", asyncHandler(async(req,res)=>{
  const result=await withTenantTransaction(req.user.organization_id,client=>client.query(`SELECT w.id,w.asset_id,w.operational_object_id,w.work_type_id,w.department_id,w.workflow_policy_id,w.workflow_stage,
    w.operational_stream,w.assignment_kind,w.service_area_id,w.title,w.description,w.category,w.priority,w.status,w.assigned_to,w.created_by,w.due_at,w.created_at,w.updated_at,
    area.domain AS service_area_domain,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon,
    COALESCE(oo.code,a.code) AS asset_code,COALESCE(oo.name,a.name) AS asset_name,
    oo.code AS operational_object_code,oo.name AS operational_object_name,
    a.code AS fixed_asset_code,a.name AS fixed_asset_name,wt.code AS work_type_code,wt.name AS work_type_name,d.name AS department_name,
    p.name AS workflow_name,p.config AS workflow_config,assignee.full_name AS assigned_name,
    assignee.role AS assigned_role,creator.full_name AS created_by_name
    FROM work_orders w
    LEFT JOIN organization_work_service_areas area
      ON area.organization_id=w.organization_id AND area.id=w.service_area_id AND area.active=true
    LEFT JOIN operational_objects oo ON oo.organization_id=w.organization_id AND oo.id=w.operational_object_id
    LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id
    LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
    LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
    LEFT JOIN organization_workflow_policies p ON p.organization_id=w.organization_id AND p.id=w.workflow_policy_id
    LEFT JOIN users assignee ON assignee.organization_id=w.organization_id AND assignee.id=w.assigned_to
    LEFT JOIN users creator ON creator.organization_id=w.organization_id AND creator.id=w.created_by
    WHERE w.organization_id=$1 AND ($2::boolean OR w.department_id IS NULL OR w.department_id=$3 OR w.assigned_to=$4 OR w.created_by=$4)
    ORDER BY w.created_at DESC LIMIT 500`,[req.user.organization_id,hasPermission(req.user,WORK_ORDER_PERMISSIONS.READ_ALL),req.user.department_id||null,req.user.id]));
  res.json({items:result.rows.map(item=>({...item,
    can_assign:canAssignOrder(req.user,item)&&!["completed","cancelled"].includes(item.status),
    can_claim:canClaimOrder(req.user,item),routing_state:routingState(item),
    available_statuses:availableStatusTransitions(req.user,item),
    available_actions:item.workflow_policy_id?availableWorkflowActions({
      stage:item.workflow_stage,permissions:req.user.permissions||[],userId:req.user.id,assignedTo:item.assigned_to,config:item.workflow_config||{}
    }):[]
  }))});
}));

router.get("/:id/history", asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"Invalid work order"});
  const order=await getPool().query("SELECT id,title,status,department_id,assigned_to,created_by FROM work_orders WHERE organization_id=$1 AND id=$2",[req.user.organization_id,id.data]);
  if(!order.rowCount)return res.status(404).json({error:"Work order not found"});
  if(!canReadOrder(req.user,order.rows[0]))return deny(res,WORK_ORDER_PERMISSIONS.READ_ALL);
  const inventoryEnabled=(req.user.enabled_modules||[]).includes("inventory");
  const canRequestMaterial=inventoryEnabled&&hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_REQUEST)&&canManageScope(req.user,order.rows[0])&&!['completed','cancelled'].includes(order.rows[0].status);
  const [events,scopeItems,materials,materialOptions,safetyReviews]=await Promise.all([getPool().query(`SELECT e.id,e.event_type,e.from_status,e.to_status,e.note,e.detail,e.created_at,
    e.assignment_history_version,e.assignment_operation,e.assignment_source,
    e.from_assignee_user_id,e.to_assignee_user_id,e.from_assignee_employee_id,e.to_assignee_employee_id,
    e.assignment_reason,
    u.full_name AS actor_name,u.role AS actor_role FROM work_order_events e
    LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
    WHERE e.organization_id=$1 AND e.work_order_id=$2
      AND NOT EXISTS(SELECT 1 FROM work_order_events correction
        WHERE correction.organization_id=e.organization_id
          AND correction.detail->>'correctsEventId'=e.id::text)
    ORDER BY e.created_at,e.id`,[req.user.organization_id,id.data]),
    getPool().query(`SELECT si.*,o.name operational_object_name,a.name asset_name,u.full_name exception_accepted_by_name
      FROM work_order_scope_items si
      LEFT JOIN operational_objects o ON o.organization_id=si.organization_id AND o.id=si.operational_object_id
      LEFT JOIN assets a ON a.organization_id=si.organization_id AND a.id=si.asset_id
      LEFT JOIN users u ON u.organization_id=si.organization_id AND u.id=si.exception_accepted_by
      WHERE si.organization_id=$1 AND si.work_order_id=$2 ORDER BY si.item_code`,[req.user.organization_id,id.data]),
    getPool().query(`SELECT mr.*,i.sku,i.name AS item_name,
      requester.full_name AS requested_by_name,decider.full_name AS decided_by_name,
      issuer.full_name AS issued_by_name,consumer.full_name AS consumed_by_name,
      sm.id AS stock_movement_id,sm.from_warehouse_id,w.name AS warehouse_name
      FROM work_order_material_requests mr
      JOIN inventory_items i ON i.organization_id=mr.organization_id AND i.id=mr.inventory_item_id
      LEFT JOIN users requester ON requester.organization_id=mr.organization_id AND requester.id=mr.requested_by
      LEFT JOIN users decider ON decider.organization_id=mr.organization_id AND decider.id=mr.decided_by
      LEFT JOIN users issuer ON issuer.organization_id=mr.organization_id AND issuer.id=mr.issued_by
      LEFT JOIN users consumer ON consumer.organization_id=mr.organization_id AND consumer.id=mr.consumed_by
      LEFT JOIN stock_movements sm ON sm.organization_id=mr.organization_id AND sm.work_order_material_request_id=mr.id
      LEFT JOIN warehouses w ON w.organization_id=sm.organization_id AND w.id=sm.from_warehouse_id
      WHERE mr.organization_id=$1 AND mr.work_order_id=$2 ORDER BY mr.requested_at,mr.id`,[req.user.organization_id,id.data]),
    canRequestMaterial?getPool().query(`SELECT i.id,i.sku,i.name,i.unit,COALESCE(sum(b.quantity),0)::numeric AS total_quantity
      FROM inventory_items i LEFT JOIN inventory_balances b ON b.organization_id=i.organization_id AND b.item_id=i.id
      WHERE i.organization_id=$1 AND i.active=true GROUP BY i.id ORDER BY i.name`,[req.user.organization_id]):Promise.resolve({rows:[]}),
    withTenantTransaction(req.user.organization_id,async client=>client.query(`SELECT r.id,r.review_type,r.decision,r.risk_score,r.hazards,r.controls,r.ppe,r.checklist,r.note,r.valid_until,r.created_at,
      t.name AS template_name,t.version AS template_version,u.full_name AS actor_name
      FROM work_order_safety_reviews r
      JOIN organization_work_safety_templates t ON t.organization_id=r.organization_id AND t.id=r.safety_template_id
      JOIN users u ON u.organization_id=r.organization_id AND u.id=r.actor_user_id
      WHERE r.organization_id=$1 AND r.work_order_id=$2 ORDER BY r.created_at,r.id`,[req.user.organization_id,id.data]))]);
  res.json({item:order.rows[0],events:events.rows,scopeItems:scopeItems.rows,materials:materials.rows,materialOptions:materialOptions.rows,
    safetyReviews:safetyReviews.rows,
    materialCapabilities:{canRequest:canRequestMaterial,canApprove:hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_APPROVE),canConsume:hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_CONSUME)&&canManageScope(req.user,order.rows[0])}});
}));

router.post("/:id/materials",asyncHandler(async(req,res)=>{
  if(!requireInventory(req,res))return;
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_REQUEST))return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_REQUEST);
  const id=z.string().uuid().safeParse(req.params.id),parsed=materialRequestSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid material request",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const work=(await client.query("SELECT id,status,department_id,assigned_to,created_by FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,id.data])).rows[0];
    if(!work){await client.query("ROLLBACK");return res.status(404).json({error:"Work order not found"});}
    if(!canManageScope(req.user,work)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_REQUEST);}
    if(['completed','cancelled'].includes(work.status)){await client.query("ROLLBACK");return res.status(409).json({error:"Closed work cannot request material"});}
    const item=(await client.query("SELECT id,unit FROM inventory_items WHERE organization_id=$1 AND id=$2 AND active=true",[req.user.organization_id,v.inventoryItemId])).rows[0];
    if(!item){await client.query("ROLLBACK");return res.status(404).json({error:"Inventory item not found"});}
    const inserted=await client.query(`INSERT INTO work_order_material_requests(organization_id,work_order_id,inventory_item_id,requested_quantity,unit,reason,request_idempotency_key,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,request_idempotency_key) DO NOTHING RETURNING *`,
      [req.user.organization_id,id.data,item.id,v.quantity,item.unit,v.reason,v.idempotencyKey,req.user.id]);
    if(!inserted.rowCount){
      const existing=(await client.query("SELECT * FROM work_order_material_requests WHERE organization_id=$1 AND request_idempotency_key=$2",[req.user.organization_id,v.idempotencyKey])).rows[0];
      const same=existing?.work_order_id===id.data&&existing.inventory_item_id===item.id&&Number(existing.requested_quantity)===v.quantity&&existing.reason===v.reason;
      await client.query("COMMIT");
      if(!same)return res.status(409).json({error:"Idempotency key was already used for another material request",code:"IDEMPOTENCY_CONFLICT"});
      return res.json({item:existing,replayed:true});
    }
    const material=inserted.rows[0];
    await client.query(`INSERT INTO work_order_material_events(organization_id,material_request_id,work_order_id,actor_user_id,action,detail)
      VALUES($1,$2,$3,$4,'requested',$5::jsonb)`,[req.user.organization_id,material.id,id.data,req.user.id,JSON.stringify({quantity:v.quantity,unit:item.unit,reason:v.reason})]);
    await writeAudit(req,"work_order.material.request","work_order_material_request",material.id,{workOrderId:id.data,itemId:item.id,quantity:v.quantity},client);
    await client.query("COMMIT");res.status(201).json({item:material});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/:id/materials/:materialId/decision",asyncHandler(async(req,res)=>{
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_APPROVE))return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_APPROVE);
  const id=z.string().uuid().safeParse(req.params.id),materialId=z.string().uuid().safeParse(req.params.materialId),parsed=materialDecisionSchema.safeParse(req.body);
  if(!id.success||!materialId.success||!parsed.success)return res.status(400).json({error:"Invalid material decision",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");
    const current=(await client.query("SELECT * FROM work_order_material_requests WHERE organization_id=$1 AND work_order_id=$2 AND id=$3 FOR UPDATE",[req.user.organization_id,id.data,materialId.data])).rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Material request not found"});}
    if(!canTransitionMaterial(current.status,v.decision)){await client.query("ROLLBACK");return res.status(409).json({error:"Material request is not awaiting a decision"});}
    const approved=v.decision==="approved"?v.approvedQuantity:0;
    if(approved>Number(current.requested_quantity)){await client.query("ROLLBACK");return res.status(400).json({error:"Approved quantity cannot exceed requested quantity"});}
    const updated=await client.query(`UPDATE work_order_material_requests SET status=$1,approved_quantity=$2,decision_note=$3,decided_by=$4,decided_at=now(),updated_at=now()
      WHERE organization_id=$5 AND id=$6 RETURNING *`,[v.decision,approved,v.note,req.user.id,req.user.organization_id,materialId.data]);
    await client.query(`INSERT INTO work_order_material_events(organization_id,material_request_id,work_order_id,actor_user_id,action,detail)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[req.user.organization_id,materialId.data,id.data,req.user.id,v.decision,JSON.stringify({approvedQuantity:approved,note:v.note})]);
    await writeAudit(req,`work_order.material.${v.decision}`,"work_order_material_request",materialId.data,{workOrderId:id.data,approvedQuantity:approved,note:v.note},client);
    await client.query("COMMIT");res.json({item:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/:id/materials/:materialId/issue",asyncHandler(async(req,res)=>{
  if(!requireInventory(req,res))return;
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_ISSUE))return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_ISSUE);
  const id=z.string().uuid().safeParse(req.params.id),materialId=z.string().uuid().safeParse(req.params.materialId),parsed=materialIssueSchema.safeParse(req.body);
  if(!id.success||!materialId.success||!parsed.success)return res.status(400).json({error:"Invalid material issue",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");
    const replay=(await client.query("SELECT * FROM stock_movements WHERE organization_id=$1 AND idempotency_key=$2 FOR UPDATE",[req.user.organization_id,v.idempotencyKey])).rows[0];
    if(replay){await client.query("COMMIT");if(replay.work_order_material_request_id!==materialId.data)return res.status(409).json({error:"Idempotency key was already used for another stock movement",code:"IDEMPOTENCY_CONFLICT"});return res.json({item:replay,replayed:true});}
    const current=(await client.query("SELECT * FROM work_order_material_requests WHERE organization_id=$1 AND work_order_id=$2 AND id=$3 FOR UPDATE",[req.user.organization_id,id.data,materialId.data])).rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Material request not found"});}
    if(current.status==="issued"){
      const concurrentReplay=(await client.query("SELECT * FROM stock_movements WHERE organization_id=$1 AND work_order_material_request_id=$2 AND idempotency_key=$3",[req.user.organization_id,materialId.data,v.idempotencyKey])).rows[0];
      if(concurrentReplay){await client.query("COMMIT");return res.json({item:concurrentReplay,replayed:true});}
    }
    if(!canTransitionMaterial(current.status,"issued")){await client.query("ROLLBACK");return res.status(409).json({error:"Only an approved material request can be issued"});}
    const balance=(await client.query("SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE",[req.user.organization_id,v.warehouseId,current.inventory_item_id])).rows[0];
    const quantity=Number(current.approved_quantity);
    if(!balance||Number(balance.quantity)<quantity){await client.query("ROLLBACK");return res.status(409).json({error:"Insufficient stock; the approved request remains unchanged",code:"INSUFFICIENT_STOCK",available:Number(balance?.quantity||0),required:quantity});}
    await client.query("UPDATE inventory_balances SET quantity=quantity-$4,updated_at=now() WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3",[req.user.organization_id,v.warehouseId,current.inventory_item_id,quantity]);
    const movement=await client.query(`INSERT INTO stock_movements(organization_id,item_id,from_warehouse_id,movement_type,quantity,reference,note,created_by,work_order_id,work_order_material_request_id,idempotency_key)
      VALUES($1,$2,$3,'issue',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.user.organization_id,current.inventory_item_id,v.warehouseId,quantity,`WORK:${id.data}`,current.reason,req.user.id,id.data,materialId.data,v.idempotencyKey]);
    const updated=await client.query(`UPDATE work_order_material_requests SET status='issued',issued_quantity=approved_quantity,issued_by=$1,issued_at=now(),updated_at=now()
      WHERE organization_id=$2 AND id=$3 RETURNING *`,[req.user.id,req.user.organization_id,materialId.data]);
    await client.query(`INSERT INTO work_order_material_events(organization_id,material_request_id,work_order_id,actor_user_id,action,detail)
      VALUES($1,$2,$3,$4,'issued',$5::jsonb)`,[req.user.organization_id,materialId.data,id.data,req.user.id,JSON.stringify({warehouseId:v.warehouseId,quantity,stockMovementId:movement.rows[0].id,idempotencyKey:v.idempotencyKey})]);
    await writeAudit(req,"work_order.material.issued","work_order_material_request",materialId.data,{workOrderId:id.data,warehouseId:v.warehouseId,quantity,stockMovementId:movement.rows[0].id,idempotencyKey:v.idempotencyKey},client);
    await client.query("COMMIT");res.status(201).json({item:updated.rows[0],movement:movement.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/:id/materials/:materialId/consume",asyncHandler(async(req,res)=>{
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.MATERIAL_CONSUME))return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_CONSUME);
  const id=z.string().uuid().safeParse(req.params.id),materialId=z.string().uuid().safeParse(req.params.materialId);
  if(!id.success||!materialId.success)return res.status(400).json({error:"Invalid consumption confirmation"});
  const client=await getPool().connect();try{await client.query("BEGIN");
    const current=(await client.query(`SELECT mr.*,w.department_id,w.assigned_to,w.created_by FROM work_order_material_requests mr
      JOIN work_orders w ON w.organization_id=mr.organization_id AND w.id=mr.work_order_id
      WHERE mr.organization_id=$1 AND mr.work_order_id=$2 AND mr.id=$3 FOR UPDATE`,[req.user.organization_id,id.data,materialId.data])).rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Material request not found"});}
    if(!canManageScope(req.user,current)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.MATERIAL_CONSUME);}
    if(!canTransitionMaterial(current.status,"consumed")){await client.query("ROLLBACK");return res.status(409).json({error:"Only issued material can be confirmed as consumed"});}
    const updated=await client.query(`UPDATE work_order_material_requests SET status='consumed',consumed_quantity=issued_quantity,consumed_by=$1,consumed_at=now(),updated_at=now()
      WHERE organization_id=$2 AND id=$3 RETURNING *`,[req.user.id,req.user.organization_id,materialId.data]);
    await client.query(`INSERT INTO work_order_material_events(organization_id,material_request_id,work_order_id,actor_user_id,action,detail)
      VALUES($1,$2,$3,$4,'consumed',$5::jsonb)`,[req.user.organization_id,materialId.data,id.data,req.user.id,JSON.stringify({quantity:Number(current.issued_quantity)})]);
    await writeAudit(req,"work_order.material.consumed","work_order_material_request",materialId.data,{workOrderId:id.data,quantity:Number(current.issued_quantity)},client);
    await client.query("COMMIT");res.json({item:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/",asyncHandler(async(req,res)=>{
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.CREATE))return deny(res,WORK_ORDER_PERMISSIONS.CREATE);
  const parsed=createSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid work order",issues:parsed.error.issues});
  if(parsed.data.assignedTo&&!hasPermission(req.user,WORK_ORDER_PERMISSIONS.ASSIGN))return deny(res,WORK_ORDER_PERMISSIONS.ASSIGN);
  const value=parsed.data,client=await getPool().connect();
  try{
    await client.query("BEGIN");
    await setTenantContext(client,req.user.organization_id);
    let incident=null;
    if(value.incidentId){
      incident=(await client.query(`SELECT * FROM operational_incidents
        WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[req.user.organization_id,value.incidentId])).rows[0];
      if(!incident){await client.query("ROLLBACK");return res.status(404).json({error:"Асуудал, хэрэгцээний бүртгэл олдсонгүй"});}
      if(!['open','in_progress'].includes(incident.status)){await client.query("ROLLBACK");return res.status(409).json({error:"Хаагдсан асуудлаас шинэ ажил үүсгэх боломжгүй"});}
      const activeLink=await client.query(`SELECT w.id,w.title FROM operational_incident_work_orders l
        JOIN work_orders w ON w.organization_id=l.organization_id AND w.id=l.work_order_id
        WHERE l.organization_id=$1 AND l.incident_id=$2 AND w.status NOT IN('completed','cancelled') LIMIT 1`,
      [req.user.organization_id,incident.id]);
      if(activeLink.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ асуудал аль хэдийн нээлттэй ажилтай холбогдсон",workOrder:activeLink.rows[0]});}
      if(value.operationalObjectId&&incident.operational_object_id&&value.operationalObjectId!==incident.operational_object_id){
        await client.query("ROLLBACK");return res.status(409).json({error:"Ажлын объект эх асуудлын объекттой зөрж байна"});
      }
      if(value.assetId&&incident.asset_id&&value.assetId!==incident.asset_id){
        await client.query("ROLLBACK");return res.status(409).json({error:"Ажлын хөрөнгө эх асуудлын хөрөнгөтэй зөрж байна"});
      }
    }
    const assignee=await activeAssignee(client,req.user.organization_id,value.assignedTo||null);
    if(value.assignedTo&&!assignee){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан олдсонгүй"});}
    let workType=null;
    if(value.workTypeId){
      const routed=await client.query(`SELECT wt.id,wt.category,wt.operational_stream,r.organization_unit_id,r.workflow_policy_id
        FROM organization_work_types wt LEFT JOIN organization_work_type_routes r
        ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true
        WHERE wt.organization_id=$1 AND wt.id=$2 AND wt.active=true`,[req.user.organization_id,value.workTypeId]);
      if(!routed.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Ажлын төрөл олдсонгүй"});}
      workType=routed.rows[0];
      if(workType.organization_unit_id&&assignee&&assignee.department_id!==workType.organization_unit_id){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан энэ ажлын нэгжид харьяалагдахгүй байна"});}
    }
    if(incident&&!hasPermission(req.user,WORK_ORDER_PERMISSIONS.READ_ALL)){
      const ownRoute=workType&&workType.organization_unit_id===req.user.department_id
        ?await client.query(`SELECT 1 FROM organization_work_intake_routes
          WHERE organization_id=$1 AND incident_domain=$2 AND work_type_id=$3 AND active=true`,
        [req.user.organization_id,incident.domain,workType.id]):{rowCount:0};
      if(!ownRoute.rowCount){await client.query("ROLLBACK");return res.status(403).json({
        error:"Энэ асуудал танай багийн батлагдсан чиглэлд хамаарахгүй байна",code:"WORK_INTAKE_ROUTE_FORBIDDEN"});}
    }
    if(workType?.operational_stream&&value.operationalStream&&workType.operational_stream!==value.operationalStream){
      await client.query("ROLLBACK");return res.status(400).json({error:"Ажлын зорилгын ангилал сонгосон Work Type-тэй зөрж байна"});
    }
    const serviceAreaId=value.serviceAreaId||incident?.service_area_id||null;
    if(value.serviceAreaId&&incident?.service_area_id&&value.serviceAreaId!==incident.service_area_id){
      await client.query("ROLLBACK");return res.status(409).json({error:"Үйлчилгээний чиглэл эх асуудлын ангилалтай зөрж байна"});
    }
    if(serviceAreaId){
      const serviceArea=await client.query(`SELECT id,domain FROM organization_work_service_areas
        WHERE organization_id=$1 AND id=$2 AND active=true`,[req.user.organization_id,serviceAreaId]);
      if(!serviceArea.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Үйлчилгээний чиглэл олдсонгүй"});}
      if(incident&&serviceArea.rows[0].domain!==incident.domain){
        await client.query("ROLLBACK");return res.status(409).json({error:"Үйлчилгээний чиглэл эх асуудлын төрөлтэй тохирохгүй байна"});
      }
    }
    const operationalObjectId=value.operationalObjectId||incident?.operational_object_id||null;
    const assetId=value.assetId||incident?.asset_id||null;
    if(operationalObjectId){
      const object=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND status<>'retired'",[req.user.organization_id,operationalObjectId]);
      if(!object.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Ашиглалтын объект олдсонгүй"});}
    }
    const operationalStream=workType?.operational_stream||value.operationalStream||null;
    const assignmentKind=value.priority==="emergency"?"emergency":value.assignmentKind;
    const status=assignee?"assigned":"new",workflowStage=workType?.workflow_policy_id&&assignee?"awaiting_safety_start":null;
    const result=await client.query(`INSERT INTO work_orders(organization_id,asset_id,operational_object_id,work_type_id,department_id,workflow_policy_id,workflow_stage,
      operational_stream,assignment_kind,service_area_id,title,description,category,priority,status,assigned_to,due_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [req.user.organization_id,assetId,operationalObjectId,workType?.id||null,workType?.organization_unit_id||null,workType?.workflow_policy_id||null,
      workflowStage,operationalStream,assignmentKind,serviceAreaId,value.title,value.description,workType?.category||value.category,value.priority,status,assignee?.id||null,value.dueAt||null,req.user.id]);
    const item=result.rows[0];
    if(incident){
      await client.query(`INSERT INTO operational_incident_work_orders(organization_id,incident_id,work_order_id,link_role,linked_by,detail)
        VALUES($1,$2,$3,'origin',$4,$5::jsonb)`,[req.user.organization_id,incident.id,item.id,req.user.id,
        JSON.stringify({sourceStatus:incident.status,sourceDomain:incident.domain})]);
      await client.query(`UPDATE operational_incidents SET status='in_progress',updated_at=now()
        WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,incident.id]);
      await client.query(`INSERT INTO operational_incident_events(organization_id,incident_id,actor_user_id,event_type,note,detail)
        VALUES($1,$2,$3,'progress',$4,$5::jsonb)`,[req.user.organization_id,incident.id,req.user.id,
        'Асуудлыг ажлын урсгалд оруулав',JSON.stringify({workOrderId:item.id})]);
    }
    await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status,detail)
      VALUES($1,$2,$3,'created',$4,$5::jsonb)`,[req.user.organization_id,item.id,req.user.id,status,JSON.stringify({assignedTo:assignee?.id||null,assignedName:assignee?.full_name||null,workflowStage,operationalStream,assignmentKind,serviceAreaId})]);
    await recordInitialAssignment(client,{
      organizationId:req.user.organization_id,workOrderId:item.id,actorUserId:req.user.id,
      assignee,status,source:"api",
    });
    if(assignee&&assignee.id!==req.user.id)await notifyUser(client,{organizationId:req.user.organization_id,userId:assignee.id,type:"work_assigned",title:"Шинэ ажил хуваарилагдлаа",message:value.title,entityId:item.id});
    if(workflowStage){const policy=await client.query("SELECT config FROM organization_workflow_policies WHERE organization_id=$1 AND id=$2",[req.user.organization_id,item.workflow_policy_id]);const config=policy.rows[0]?.config||{};await notifyAuthority(client,{organizationId:req.user.organization_id,permission:config.startSafetyPermission,excludeUserId:req.user.id,title:"Ажил эхлүүлэх зөвшөөрөл хүлээгдэж байна",message:value.title,entityId:item.id});}
    await writeAudit(req,"work_order.create","work_order",item.id,{title:value.title,assignedTo:assignee?.id||null,workflowStage,operationalStream,assignmentKind,serviceAreaId,incidentId:incident?.id||null},client);
    await client.query("COMMIT");
    await emitAutomationEvent({organizationId:req.user.organization_id,eventType:"work_order.created",payload:{id:item.id,title:item.title,priority:item.priority,status:item.status,category:item.category},sourceEntityType:"work_order",sourceEntityId:item.id,sourceDeliveryKey:`work-order.created:${item.id}`}).catch(error=>console.error("[automation]",error));
    res.status(201).json({item});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/:id/claim",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=claimSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Ажил авах хүсэлт буруу байна"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");await setTenantContext(client,req.user.organization_id);
    const current=await assignmentState(client,req.user.organization_id,id.data);
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Ажил олдсонгүй"});}
    const replay=await replayAssignment(client,{organizationId:req.user.organization_id,workOrderId:id.data,
      assigneeUserId:req.user.id,actorUserId:req.user.id,source:"self_claim",reason:"team_backlog_claim",idempotencyKey:parsed.data.idempotencyKey});
    if(replay){await client.query("COMMIT");return res.json({item:current,replayed:true});}
    if(!canClaimOrder(req.user,current)){await client.query("ROLLBACK");return res.status(409).json({
      error:"Энэ ажил танай багийн авах боломжтой backlog-д байхгүй байна",code:"WORK_ORDER_NOT_CLAIMABLE"});}
    const assignee=await activeAssignee(client,req.user.organization_id,req.user.id);
    if(!assignee){await client.query("ROLLBACK");return res.status(409).json({error:"Идэвхтэй ажилтны эрх олдсонгүй"});}
    const assignment=await changeAssignment(client,{organizationId:req.user.organization_id,current,assignee,
      actorUserId:req.user.id,source:"self_claim",reason:"team_backlog_claim",idempotencyKey:parsed.data.idempotencyKey});
    let item=assignment.item;
    if(current.workflow_policy_id&&!current.workflow_stage){
      item=(await client.query(`UPDATE work_orders SET workflow_stage='awaiting_safety_start',updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data])).rows[0];
      const config=(await client.query("SELECT config FROM organization_workflow_policies WHERE organization_id=$1 AND id=$2",
        [req.user.organization_id,current.workflow_policy_id])).rows[0]?.config||{};
      await notifyAuthority(client,{organizationId:req.user.organization_id,permission:config.startSafetyPermission,
        excludeUserId:req.user.id,title:"Ажил эхлүүлэх зөвшөөрөл хүлээгдэж байна",message:current.title,entityId:id.data});
    }
    await writeAudit(req,"work_order.claim","work_order",id.data,{assignmentEventId:assignment.event?.id||null,departmentId:current.department_id},client);
    await client.query("COMMIT");res.json({item,replayed:false});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.patch("/:id/assign",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=assignmentSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid assignment"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    await setTenantContext(client,req.user.organization_id);
    const current=await assignmentState(client,req.user.organization_id,id.data);
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Work order not found"});}
    if(!canAssignOrder(req.user,current)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.ASSIGN);}
    const replay=await replayAssignment(client,{
      organizationId:req.user.organization_id,workOrderId:id.data,
      assigneeUserId:parsed.data.assignedTo,actorUserId:req.user.id,
      source:"api",reason:parsed.data.reason,idempotencyKey:parsed.data.idempotencyKey||null,
    });
    if(replay){await client.query("COMMIT");return res.json({item:current,replayed:true});}
    if(["completed","cancelled"].includes(current.status)){await client.query("ROLLBACK");return res.status(409).json({error:"Дууссан эсвэл цуцалсан ажлыг хуваарилах боломжгүй"});}
    const assignee=await activeAssignee(client,req.user.organization_id,parsed.data.assignedTo);
    if(parsed.data.assignedTo&&!assignee){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан олдсонгүй"});}
    if(current.department_id&&assignee&&assignee.department_id!==current.department_id){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан тухайн нэгжид харьяалагдахгүй байна"});}
    const assignment=await changeAssignment(client,{
      organizationId:req.user.organization_id,current,assignee,actorUserId:req.user.id,
      source:"api",reason:parsed.data.reason,idempotencyKey:parsed.data.idempotencyKey||null,
    });
    let assignmentItem=assignment.item;
    if(assignment.changed&&assignee&&current.workflow_policy_id&&!current.workflow_stage){
      assignmentItem=(await client.query(`UPDATE work_orders SET workflow_stage='awaiting_safety_start',updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data])).rows[0];
      const policy=(await client.query("SELECT config FROM organization_workflow_policies WHERE organization_id=$1 AND id=$2",
        [req.user.organization_id,current.workflow_policy_id])).rows[0]?.config||{};
      await notifyAuthority(client,{organizationId:req.user.organization_id,permission:policy.startSafetyPermission,
        excludeUserId:req.user.id,title:"Ажил эхлүүлэх зөвшөөрөл хүлээгдэж байна",message:current.title,entityId:id.data});
    }else if(assignment.changed&&!assignee&&current.workflow_stage==='awaiting_safety_start'){
      const reviews=await client.query(`SELECT 1 FROM work_order_safety_reviews
        WHERE organization_id=$1 AND work_order_id=$2 AND review_type='start' LIMIT 1`,[req.user.organization_id,id.data]);
      if(!reviews.rowCount)assignmentItem=(await client.query(`UPDATE work_orders SET workflow_stage=NULL,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data])).rows[0];
    }
    if(assignment.changed)await writeAudit(req,"work_order.assign","work_order",id.data,{
      fromAssignedTo:current.assigned_to,assignedTo:assignee?.id||null,
      assignmentEventId:assignment.event?.id||null,reason:parsed.data.reason,
    },client);
    await client.query("COMMIT");res.json({item:assignmentItem,changed:assignment.changed});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/:id/notes",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=noteSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Тэмдэглэл хоосон байна"});
  const order=await getPool().query("SELECT id,department_id,assigned_to,created_by FROM work_orders WHERE organization_id=$1 AND id=$2",[req.user.organization_id,id.data]);
  if(!order.rowCount)return res.status(404).json({error:"Work order not found"});
  if(!canReadOrder(req.user,order.rows[0]))return deny(res,WORK_ORDER_PERMISSIONS.READ_ALL);
  const result=await getPool().query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,note)
    SELECT $1,id,$3,'note',$4 FROM work_orders WHERE organization_id=$1 AND id=$2 RETURNING id,event_type,note,created_at`,[req.user.organization_id,id.data,req.user.id,parsed.data.note]);
  if(!result.rowCount)return res.status(404).json({error:"Work order not found"});
  await writeAudit(req,"work_order.note","work_order",id.data,{});res.status(201).json({item:result.rows[0]});
}));

router.patch("/:id/status",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=statusSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid status request"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    await setTenantContext(client,req.user.organization_id);
    const found=await client.query("SELECT id,title,status,assigned_to,workflow_policy_id FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,id.data]);
    const current=found.rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Work order not found"});}
    if(current.workflow_policy_id){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ ажил баталгаажуулалтын шаттай. Тухайн шатны үйлдлийг ашиглана уу."});}
    if(!canProgressOrder(req.user,current)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.PROGRESS);}
    if(!canTransition(current.status,parsed.data.status)){await client.query("ROLLBACK");return res.status(409).json({error:`Transition ${current.status} -> ${parsed.data.status} is not allowed`});}
    if(parsed.data.status==="completed"&&!hasPermission(req.user,WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.WORKFLOW_APPROVE);}
    if(parsed.data.status==="completed"){const closure=await scopeClosure(client,req.user.organization_id,id.data);if(closure.item_count&&closure.blocking_count){await client.query("ROLLBACK");return res.status(409).json({error:"Хэмжигдэх үр дүн бүрэн хаагдаагүй байна",outcome:closure});}}
    const updated=await client.query("UPDATE work_orders SET status=$1,updated_at=now() WHERE organization_id=$2 AND id=$3 RETURNING *",[parsed.data.status,req.user.organization_id,id.data]);
    await client.query("INSERT INTO work_order_events(organization_id,actor_user_id,work_order_id,event_type,from_status,to_status) VALUES($1,$2,$3,'status_changed',$4,$5)",[req.user.organization_id,req.user.id,id.data,current.status,parsed.data.status]);
    if(parsed.data.status==="pending_review")await notifyManagement(client,{organizationId:req.user.organization_id,excludeUserId:req.user.id,type:"review_requested",title:"Ажил хянуулах хүсэлт ирлээ",message:`Ажлын дугаар: ${id.data}`,entityId:id.data});
    if(parsed.data.status==="completed")await resolveLinkedIncidents(client,{organizationId:req.user.organization_id,workOrderId:id.data,userId:req.user.id});
    if(parsed.data.status==="completed"&&current.assigned_to)await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_completed",title:"Ажил баталгаажиж хаагдлаа",message:current.title,entityId:id.data});
    await writeAudit(req,"work_order.status_change","work_order",id.data,{from:current.status,to:parsed.data.status},client);
    await client.query("COMMIT");res.json({item:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/:id/workflow-action",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=workflowActionSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Ажлын урсгалын хүсэлт буруу байна"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    await setTenantContext(client,req.user.organization_id);
    const commandHash=payloadHash({workOrderId:id.data,action:parsed.data.action,note:parsed.data.note,safetyReview:parsed.data.safetyReview||null});
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${req.user.organization_id}:work-order-workflow:${parsed.data.idempotencyKey}`]);
    const replay=(await client.query(`SELECT actor_user_id,payload_sha256 FROM work_order_approvals
      WHERE organization_id=$1 AND idempotency_key=$2`,[req.user.organization_id,parsed.data.idempotencyKey])).rows[0];
    if(replay){
      if(replay.actor_user_id!==req.user.id||String(replay.payload_sha256||"").trim()!==commandHash){
        await client.query("ROLLBACK");return res.status(409).json({error:"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"});
      }
      const item=(await client.query("SELECT * FROM work_orders WHERE organization_id=$1 AND id=$2",[req.user.organization_id,id.data])).rows[0];
      await client.query("COMMIT");return res.json({item,replayed:true});
    }
    const result=await client.query(`SELECT w.*,p.config FROM work_orders w JOIN organization_workflow_policies p
      ON p.organization_id=w.organization_id AND p.id=w.workflow_policy_id AND p.active=true
      WHERE w.organization_id=$1 AND w.id=$2 FOR UPDATE`,[req.user.organization_id,id.data]);
    const current=result.rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Батлах урсгалтай ажил олдсонгүй"});}
    const action=parsed.data.action,rule=resolveWorkflowAction(action,current.config||{});
    if(!current.assigned_to){await client.query("ROLLBACK");return res.status(409).json({error:"Эхлээд хариуцагч ажилтан онооно уу"});}
    if(!canPerformWorkflowAction({action,stage:current.workflow_stage,permissions:req.user.permissions||[],userId:req.user.id,assignedTo:current.assigned_to,config:current.config||{}})){
      await client.query("ROLLBACK");return res.status(403).json({error:"Энэ шатны үйлдлийг хийх эрх эсвэл дараалал тохирохгүй байна"});
    }
    const safetyReview=await recordSafetyReview(client,{organizationId:req.user.organization_id,userId:req.user.id,work:current,action,value:parsed.data.safetyReview});
    if(safetyReview?.error){await client.query("ROLLBACK");return res.status(409).json({error:safetyReview.error,missingChecklist:safetyReview.missingChecklist||[]});}
    if(action==="submit_completion"){
      const permitError=await validateActiveStartPermit(client,req.user.organization_id,current);
      if(permitError){await client.query("ROLLBACK");return res.status(409).json({error:permitError,code:"SAFETY_PERMIT_INVALID"});}
    }
    const nextStatus=rule.status||current.status;
    if(rule.to==="completed"){const closure=await scopeClosure(client,req.user.organization_id,id.data);if(closure.item_count&&closure.blocking_count){await client.query("ROLLBACK");return res.status(409).json({error:"Шийдэгдээгүй эсвэл хойшлуулсан хэмжээг зөвшөөрөлгүйгээр ажил хаах боломжгүй",outcome:closure});}}
    const updated=await client.query("UPDATE work_orders SET workflow_stage=$1,status=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 RETURNING *",[rule.to,nextStatus,req.user.organization_id,id.data]);
    const detail={action,fromStage:current.workflow_stage,toStage:rule.to,fromStatus:current.status,toStatus:nextStatus,
      safetyReviewId:safetyReview?.item?.id||null,riskScore:safetyReview?.item?.risk_score||null,templateVersion:safetyReview?.item?.template_version||null};
    const actionNote=safetyReview?.item?.note||parsed.data.note;
    await client.query(`INSERT INTO work_order_approvals(organization_id,work_order_id,workflow_stage,action_code,decision,actor_user_id,note,detail,safety_review_id,idempotency_key,payload_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,[req.user.organization_id,id.data,current.workflow_stage,action,rule.decision,req.user.id,actionNote,JSON.stringify(detail),safetyReview?.item?.id||null,parsed.data.idempotencyKey,commandHash]);
    await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,note,detail)
      VALUES($1,$2,$3,'workflow_action',$4,$5,$6,$7::jsonb)`,[req.user.organization_id,id.data,req.user.id,current.status,nextStatus,actionNote,JSON.stringify(detail)]);
    const nextAuthority={
      awaiting_management_start:{permission:current.config.startApprovalPermission},
      awaiting_safety_completion:{permission:current.config.completionSafetyPermission},
      awaiting_management_completion:{permission:current.config.completionApprovalPermission},
    }[rule.to];
    if(nextAuthority)await notifyAuthority(client,{organizationId:req.user.organization_id,...nextAuthority,excludeUserId:req.user.id,title:"Ажлын баталгаажуулалт хүлээгдэж байна",message:current.title,entityId:id.data});
    if(rule.to==="execution")await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_order_workflow",title:"Ажил гүйцэтгэх шатанд шилжлээ",message:current.title,entityId:id.data});
    if(rule.decision==="returned")await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_order_returned",title:"Ажил ХАБЭА эсвэл удирдлагын шалгалтаас буцаагдлаа",message:actionNote||current.title,entityId:id.data});
    if(rule.to==="completed")await resolveLinkedIncidents(client,{organizationId:req.user.organization_id,workOrderId:id.data,userId:req.user.id});
    if(rule.to==="completed")await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_completed",title:"Ажил баталгаажиж хаагдлаа",message:current.title,entityId:id.data});
    await writeAudit(req,`work_order.workflow.${action}`,"work_order",id.data,detail,client);
    await client.query("COMMIT");res.json({item:updated.rows[0],replayed:false});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/:id/scope-items",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=scopeItemSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Хэмжих ажлын мөр буруу байна",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");
    const work=await client.query("SELECT id,assigned_to,department_id,status FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,id.data]);
    if(!work.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Ажил олдсонгүй"});}
    if(['completed','cancelled'].includes(work.rows[0].status)){await client.query("ROLLBACK");return res.status(409).json({error:"Хаагдсан ажилд хэмжих мөр нэмэхгүй"});}
    if(!canManageScope(req.user,work.rows[0])){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.SCOPE_MANAGE);}
    const item=await client.query(`INSERT INTO work_order_scope_items(organization_id,work_order_id,operational_object_id,asset_id,item_code,description,unit,planned_quantity,weight,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,[req.user.organization_id,id.data,v.operationalObjectId||null,v.assetId||null,v.itemCode,v.description,v.unit,v.plannedQuantity,v.weight,req.user.id]);
    await client.query(`INSERT INTO work_order_scope_item_events(organization_id,work_order_id,scope_item_id,actor_user_id,event_type,detail) VALUES($1,$2,$3,$4,'created',$5::jsonb)`,[req.user.organization_id,id.data,item.rows[0].id,req.user.id,JSON.stringify({plannedQuantity:v.plannedQuantity,unit:v.unit})]);
    await writeAudit(req,"work_order.scope_item.create","work_order_scope_item",item.rows[0].id,{workOrderId:id.data},client);await client.query("COMMIT");res.status(201).json({item:item.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.patch("/:id/scope-items/:scopeId",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),scopeId=z.string().uuid().safeParse(req.params.scopeId),parsed=scopeProgressSchema.safeParse(req.body);
  if(!id.success||!scopeId.success||!parsed.success)return res.status(400).json({error:"Гүйцэтгэлийн хэмжилт буруу байна",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");const found=await client.query(`SELECT si.*,w.assigned_to,w.department_id,w.status work_status FROM work_order_scope_items si JOIN work_orders w ON w.organization_id=si.organization_id AND w.id=si.work_order_id WHERE si.organization_id=$1 AND si.work_order_id=$2 AND si.id=$3 FOR UPDATE`,[req.user.organization_id,id.data,scopeId.data]);const item=found.rows[0];
    if(!item){await client.query("ROLLBACK");return res.status(404).json({error:"Хэмжих мөр олдсонгүй"});}if(['completed','cancelled'].includes(item.work_status)){await client.query("ROLLBACK");return res.status(409).json({error:"Хаагдсан ажлын үр дүнг өөрчлөхгүй"});}
    if(item.exception_status==='accepted'){await client.query("ROLLBACK");return res.status(409).json({error:"Зөвшөөрсөн үл хамаарах нөхцөлийн үр дүн өөрчлөгдөхгүй. Шинэ хэмжилтийн мөр үүсгэнэ үү."});}
    if(!canManageScope(req.user,item)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.SCOPE_MANAGE);}
    const accounted=v.completedQuantity+v.unresolvedQuantity+v.deferredQuantity;if(accounted>Number(item.planned_quantity)){await client.query("ROLLBACK");return res.status(400).json({error:"Гүйцэтгэсэн, шийдэгдээгүй, хойшлуулсан нийлбэр төлөвлөсөн хэмжээнээс их байна"});}
    if(v.requestException&&(v.unresolvedQuantity+v.deferredQuantity<=0||!v.exceptionReason)){await client.query("ROLLBACK");return res.status(400).json({error:"Үлдэгдлийн шалтгааныг тодорхой бичнэ үү"});}
    const outcome=v.completedQuantity===Number(item.planned_quantity)?'completed':v.unresolvedQuantity>0?'blocked':v.deferredQuantity>0?'deferred':v.completedQuantity>0?'in_progress':'pending',exception=v.requestException?'requested':item.exception_status;
    const updated=await client.query(`UPDATE work_order_scope_items SET completed_quantity=$1,unresolved_quantity=$2,deferred_quantity=$3,outcome_status=$4,exception_status=$5,exception_reason=$6,updated_by=$7,updated_at=now() WHERE organization_id=$8 AND id=$9 RETURNING *`,[v.completedQuantity,v.unresolvedQuantity,v.deferredQuantity,outcome,exception,v.exceptionReason||item.exception_reason,req.user.id,req.user.organization_id,scopeId.data]);
    await client.query(`INSERT INTO work_order_scope_item_events(organization_id,work_order_id,scope_item_id,actor_user_id,event_type,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[req.user.organization_id,id.data,scopeId.data,req.user.id,v.requestException?'exception_requested':'progress',JSON.stringify({completed:v.completedQuantity,unresolved:v.unresolvedQuantity,deferred:v.deferredQuantity,reason:v.exceptionReason})]);
    await writeAudit(req,"work_order.scope_item.progress","work_order_scope_item",scopeId.data,{workOrderId:id.data,completed:v.completedQuantity,unresolved:v.unresolvedQuantity,deferred:v.deferredQuantity},client);await client.query("COMMIT");res.json({item:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/:id/scope-items/:scopeId/exception",asyncHandler(async(req,res)=>{
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.EXCEPTION_DECIDE))return deny(res,WORK_ORDER_PERMISSIONS.EXCEPTION_DECIDE);
  const id=z.string().uuid().safeParse(req.params.id),scopeId=z.string().uuid().safeParse(req.params.scopeId),parsed=exceptionDecisionSchema.safeParse(req.body);if(!id.success||!scopeId.success||!parsed.success)return res.status(400).json({error:"Үл хамаарах нөхцөлийн шийдвэр буруу байна"});
  const client=await getPool().connect();try{await client.query("BEGIN");const found=await client.query("SELECT * FROM work_order_scope_items WHERE organization_id=$1 AND work_order_id=$2 AND id=$3 FOR UPDATE",[req.user.organization_id,id.data,scopeId.data]);const item=found.rows[0];if(!item){await client.query("ROLLBACK");return res.status(404).json({error:"Хэмжих мөр олдсонгүй"});}if(item.exception_status!=='requested'){await client.query("ROLLBACK");return res.status(409).json({error:"Шийдвэр хүлээж буй хүсэлт алга"});}
    const accepted=parsed.data.decision==='accepted',accounted=Number(item.completed_quantity)+Number(item.unresolved_quantity)+Number(item.deferred_quantity),outcome=accepted&&accounted===Number(item.planned_quantity)?'closed_with_exception':item.outcome_status;
    const updated=await client.query(`UPDATE work_order_scope_items SET exception_status=$1,exception_accepted_by=$2,exception_accepted_at=$3,outcome_status=$4,updated_by=$5,updated_at=now() WHERE organization_id=$6 AND id=$7 RETURNING *`,[parsed.data.decision,accepted?req.user.id:null,accepted?new Date():null,outcome,req.user.id,req.user.organization_id,scopeId.data]);
    await client.query(`INSERT INTO work_order_scope_item_events(organization_id,work_order_id,scope_item_id,actor_user_id,event_type,detail) VALUES($1,$2,$3,$4,'exception_decided',$5::jsonb)`,[req.user.organization_id,id.data,scopeId.data,req.user.id,JSON.stringify({decision:parsed.data.decision,note:parsed.data.note})]);await writeAudit(req,"work_order.scope_item.exception_decided","work_order_scope_item",scopeId.data,{workOrderId:id.data,decision:parsed.data.decision,note:parsed.data.note},client);await client.query("COMMIT");res.json({item:updated.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

module.exports = router;
