"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { emitAutomationEvent } = require("../services/automation");
const { notifyUser, notifyManagement } = require("../services/notifications");
const { canTransition, WORKFLOW_ACTIONS, availableWorkflowActions, canPerformWorkflowAction } = require("../services/work-order-flow");
const {
  WORK_ORDER_PERMISSIONS,
  hasPermission,
  canReadOrder,
  canAssignOrder,
  canProgressOrder,
  canManageScope,
  availableStatusTransitions,
} = require("../services/work-order-authority");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const createSchema = z.object({
  assetId: z.string().uuid().nullable().optional(), operationalObjectId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  workTypeId: z.string().uuid().nullable().optional(), title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).default(""), category: z.string().trim().min(1).max(100),
  priority: z.enum(["low", "normal", "high", "emergency"]).default("normal"), dueAt: z.iso.datetime().nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(["assigned", "in_progress", "pending_review", "completed", "cancelled"]) });
const assignmentSchema = z.object({ assignedTo: z.string().uuid().nullable() });
const noteSchema = z.object({ note: z.string().trim().min(1).max(2000) });
const workflowActionSchema = z.object({ action: z.enum(Object.keys(WORKFLOW_ACTIONS)), note: z.string().trim().max(2000).default("") });
const scopeItemSchema = z.object({
  operationalObjectId:z.string().uuid().nullable().optional(),assetId:z.string().uuid().nullable().optional(),
  itemCode:z.string().trim().min(1).max(80),description:z.string().trim().min(1).max(500),
  unit:z.string().trim().min(1).max(30).default("ш"),plannedQuantity:z.number().positive().max(100000000),
  weight:z.number().positive().max(1000000).default(1)
});
const scopeProgressSchema=z.object({completedQuantity:z.number().min(0),unresolvedQuantity:z.number().min(0),deferredQuantity:z.number().min(0),exceptionReason:z.string().trim().max(2000).default(""),requestException:z.boolean().default(false)});
const exceptionDecisionSchema=z.object({decision:z.enum(["accepted","rejected"]),note:z.string().trim().min(1).max(2000)});

async function scopeClosure(client,organizationId,workOrderId){
  const result=await client.query(`SELECT count(*)::int item_count,
    count(*) FILTER(WHERE outcome_status NOT IN ('completed','closed_with_exception'))::int blocking_count,
    COALESCE(sum(planned_quantity),0) planned,COALESCE(sum(completed_quantity),0) completed,
    COALESCE(sum(unresolved_quantity),0) unresolved,COALESCE(sum(deferred_quantity),0) deferred
    FROM work_order_scope_items WHERE organization_id=$1 AND work_order_id=$2`,[organizationId,workOrderId]);
  return result.rows[0];
}

async function activeAssignee(client, organizationId, userId) {
  if (!userId) return null;
  const result = await client.query("SELECT id,full_name,role,department_id,employee_id FROM users WHERE organization_id=$1 AND id=$2 AND active=true AND can_login=true", [organizationId,userId]);
  return result.rows[0] || null;
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

router.use(authenticate, requireModule("work-orders"));

router.get("/options", asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT wt.id,wt.code,wt.name,wt.category,r.organization_unit_id AS department_id,
    d.name AS department_name,r.workflow_policy_id,p.name AS workflow_name
    FROM organization_work_types wt
    LEFT JOIN organization_work_type_routes r ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true
    LEFT JOIN departments d ON d.organization_id=r.organization_id AND d.id=r.organization_unit_id
    LEFT JOIN organization_workflow_policies p ON p.organization_id=r.organization_id AND p.id=r.workflow_policy_id AND p.active=true
    WHERE wt.organization_id=$1 AND wt.active=true ORDER BY wt.category,wt.name`,[req.user.organization_id]);
  res.json({items:result.rows});
}));

router.get("/", asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT w.id,w.asset_id,w.operational_object_id,w.work_type_id,w.department_id,w.workflow_policy_id,w.workflow_stage,
    w.title,w.description,w.category,w.priority,w.status,w.assigned_to,w.created_by,w.due_at,w.created_at,w.updated_at,
    COALESCE(oo.code,a.code) AS asset_code,COALESCE(oo.name,a.name) AS asset_name,
    oo.code AS operational_object_code,oo.name AS operational_object_name,
    a.code AS fixed_asset_code,a.name AS fixed_asset_name,wt.name AS work_type_name,d.name AS department_name,
    p.name AS workflow_name,p.config AS workflow_config,assignee.full_name AS assigned_name,
    assignee.role AS assigned_role,creator.full_name AS created_by_name
    FROM work_orders w
    LEFT JOIN operational_objects oo ON oo.organization_id=w.organization_id AND oo.id=w.operational_object_id
    LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id
    LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
    LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
    LEFT JOIN organization_workflow_policies p ON p.organization_id=w.organization_id AND p.id=w.workflow_policy_id
    LEFT JOIN users assignee ON assignee.organization_id=w.organization_id AND assignee.id=w.assigned_to
    LEFT JOIN users creator ON creator.organization_id=w.organization_id AND creator.id=w.created_by
    WHERE w.organization_id=$1 AND ($2::boolean OR w.department_id IS NULL OR w.department_id=$3 OR w.assigned_to=$4 OR w.created_by=$4)
    ORDER BY w.created_at DESC LIMIT 500`,[req.user.organization_id,hasPermission(req.user,WORK_ORDER_PERMISSIONS.READ_ALL),req.user.department_id||null,req.user.id]);
  res.json({items:result.rows.map(item=>({...item,
    can_assign:canAssignOrder(req.user,item)&&!["completed","cancelled"].includes(item.status),
    available_statuses:availableStatusTransitions(req.user,item),
    available_actions:item.workflow_policy_id?availableWorkflowActions({
      stage:item.workflow_stage,permissions:req.user.permissions||[],userId:req.user.id,assignedTo:item.assigned_to,config:item.workflow_config||{}
    }):[]
  }))});
}));

router.get("/:id/history", asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"Invalid work order"});
  const order=await getPool().query("SELECT id,title,department_id,assigned_to,created_by FROM work_orders WHERE organization_id=$1 AND id=$2",[req.user.organization_id,id.data]);
  if(!order.rowCount)return res.status(404).json({error:"Work order not found"});
  if(!canReadOrder(req.user,order.rows[0]))return deny(res,WORK_ORDER_PERMISSIONS.READ_ALL);
  const [events,scopeItems]=await Promise.all([getPool().query(`SELECT e.id,e.event_type,e.from_status,e.to_status,e.note,e.detail,e.created_at,
    u.full_name AS actor_name,u.role AS actor_role FROM work_order_events e
    LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
    WHERE e.organization_id=$1 AND e.work_order_id=$2 ORDER BY e.created_at,e.id`,[req.user.organization_id,id.data]),
    getPool().query(`SELECT si.*,o.name operational_object_name,a.name asset_name,u.full_name exception_accepted_by_name
      FROM work_order_scope_items si
      LEFT JOIN operational_objects o ON o.organization_id=si.organization_id AND o.id=si.operational_object_id
      LEFT JOIN assets a ON a.organization_id=si.organization_id AND a.id=si.asset_id
      LEFT JOIN users u ON u.organization_id=si.organization_id AND u.id=si.exception_accepted_by
      WHERE si.organization_id=$1 AND si.work_order_id=$2 ORDER BY si.item_code`,[req.user.organization_id,id.data])]);
  res.json({item:order.rows[0],events:events.rows,scopeItems:scopeItems.rows});
}));

router.post("/",asyncHandler(async(req,res)=>{
  if(!hasPermission(req.user,WORK_ORDER_PERMISSIONS.CREATE))return deny(res,WORK_ORDER_PERMISSIONS.CREATE);
  const parsed=createSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid work order",issues:parsed.error.issues});
  if(parsed.data.assignedTo&&!hasPermission(req.user,WORK_ORDER_PERMISSIONS.ASSIGN))return deny(res,WORK_ORDER_PERMISSIONS.ASSIGN);
  const value=parsed.data,client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const assignee=await activeAssignee(client,req.user.organization_id,value.assignedTo||null);
    if(value.assignedTo&&!assignee){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан олдсонгүй"});}
    let workType=null;
    if(value.workTypeId){
      const routed=await client.query(`SELECT wt.id,wt.category,r.organization_unit_id,r.workflow_policy_id
        FROM organization_work_types wt LEFT JOIN organization_work_type_routes r
        ON r.organization_id=wt.organization_id AND r.work_type_id=wt.id AND r.active=true
        WHERE wt.organization_id=$1 AND wt.id=$2 AND wt.active=true`,[req.user.organization_id,value.workTypeId]);
      if(!routed.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Ажлын төрөл олдсонгүй"});}
      workType=routed.rows[0];
      if(workType.organization_unit_id&&assignee&&assignee.department_id!==workType.organization_unit_id){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан энэ ажлын нэгжид харьяалагдахгүй байна"});}
    }
    if(value.operationalObjectId){
      const object=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND status<>'retired'",[req.user.organization_id,value.operationalObjectId]);
      if(!object.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Ашиглалтын объект олдсонгүй"});}
    }
    const status=assignee?"assigned":"new",workflowStage=workType?.workflow_policy_id?"awaiting_safety_start":null;
    const result=await client.query(`INSERT INTO work_orders(organization_id,asset_id,operational_object_id,work_type_id,department_id,workflow_policy_id,workflow_stage,
      title,description,category,priority,status,assigned_to,due_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.user.organization_id,value.assetId||null,value.operationalObjectId||null,workType?.id||null,workType?.organization_unit_id||null,workType?.workflow_policy_id||null,
      workflowStage,value.title,value.description,workType?.category||value.category,value.priority,status,assignee?.id||null,value.dueAt||null,req.user.id]);
    const item=result.rows[0];
    await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status,detail)
      VALUES($1,$2,$3,'created',$4,$5::jsonb)`,[req.user.organization_id,item.id,req.user.id,status,JSON.stringify({assignedTo:assignee?.id||null,assignedName:assignee?.full_name||null,workflowStage})]);
    if(assignee&&assignee.id!==req.user.id)await notifyUser(client,{organizationId:req.user.organization_id,userId:assignee.id,type:"work_assigned",title:"Шинэ ажил хуваарилагдлаа",message:value.title,entityId:item.id});
    if(workflowStage){const policy=await client.query("SELECT config FROM organization_workflow_policies WHERE organization_id=$1 AND id=$2",[req.user.organization_id,item.workflow_policy_id]);const config=policy.rows[0]?.config||{};await notifyAuthority(client,{organizationId:req.user.organization_id,permission:config.startSafetyPermission,excludeUserId:req.user.id,title:"Ажил эхлүүлэх зөвшөөрөл хүлээгдэж байна",message:value.title,entityId:item.id});}
    await writeAudit(req,"work_order.create","work_order",item.id,{title:value.title,assignedTo:assignee?.id||null,workflowStage},client);
    await client.query("COMMIT");
    await emitAutomationEvent({organizationId:req.user.organization_id,eventType:"work_order.created",payload:{id:item.id,title:item.title,priority:item.priority,status:item.status,category:item.category},sourceEntityType:"work_order",sourceEntityId:item.id}).catch(error=>console.error("[automation]",error));
    res.status(201).json({item});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.patch("/:id/assign",asyncHandler(async(req,res)=>{
  const id=z.string().uuid().safeParse(req.params.id),parsed=assignmentSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid assignment"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const found=await client.query("SELECT id,status,assigned_to,department_id FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,id.data]);
    const current=found.rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Work order not found"});}
    if(["completed","cancelled"].includes(current.status)){await client.query("ROLLBACK");return res.status(409).json({error:"Дууссан эсвэл цуцалсан ажлыг хуваарилах боломжгүй"});}
    if(!canAssignOrder(req.user,current)){await client.query("ROLLBACK");return deny(res,WORK_ORDER_PERMISSIONS.ASSIGN);}
    const assignee=await activeAssignee(client,req.user.organization_id,parsed.data.assignedTo);
    if(parsed.data.assignedTo&&!assignee){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан олдсонгүй"});}
    if(current.department_id&&assignee&&assignee.department_id!==current.department_id){await client.query("ROLLBACK");return res.status(400).json({error:"Хариуцагч ажилтан тухайн нэгжид харьяалагдахгүй байна"});}
    const nextStatus=current.status==="new"&&assignee?"assigned":current.status==="assigned"&&!assignee?"new":current.status;
    const updated=await client.query("UPDATE work_orders SET assigned_to=$1,status=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 RETURNING *",[assignee?.id||null,nextStatus,req.user.organization_id,id.data]);
    await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,detail)
      VALUES($1,$2,$3,'assigned',$4,$5,$6::jsonb)`,[req.user.organization_id,id.data,req.user.id,current.status,nextStatus,JSON.stringify({fromAssignee:current.assigned_to,toAssignee:assignee?.id||null,assignedName:assignee?.full_name||null})]);
    await writeAudit(req,"work_order.assign","work_order",id.data,{assignedTo:assignee?.id||null},client);
    await client.query("COMMIT");res.json({item:updated.rows[0]});
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
    const found=await client.query("SELECT id,status,assigned_to,workflow_policy_id FROM work_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,id.data]);
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
    const result=await client.query(`SELECT w.*,p.config FROM work_orders w JOIN organization_workflow_policies p
      ON p.organization_id=w.organization_id AND p.id=w.workflow_policy_id AND p.active=true
      WHERE w.organization_id=$1 AND w.id=$2 FOR UPDATE`,[req.user.organization_id,id.data]);
    const current=result.rows[0];
    if(!current){await client.query("ROLLBACK");return res.status(404).json({error:"Батлах урсгалтай ажил олдсонгүй"});}
    const action=parsed.data.action,rule=WORKFLOW_ACTIONS[action];
    if(!current.assigned_to){await client.query("ROLLBACK");return res.status(409).json({error:"Эхлээд хариуцагч ажилтан онооно уу"});}
    if(!canPerformWorkflowAction({action,stage:current.workflow_stage,permissions:req.user.permissions||[],userId:req.user.id,assignedTo:current.assigned_to,config:current.config||{}})){
      await client.query("ROLLBACK");return res.status(403).json({error:"Энэ шатны үйлдлийг хийх эрх эсвэл дараалал тохирохгүй байна"});
    }
    const nextStatus=rule.status||current.status;
    if(rule.to==="completed"){const closure=await scopeClosure(client,req.user.organization_id,id.data);if(closure.item_count&&closure.blocking_count){await client.query("ROLLBACK");return res.status(409).json({error:"Шийдэгдээгүй эсвэл хойшлуулсан хэмжээг зөвшөөрөлгүйгээр ажил хаах боломжгүй",outcome:closure});}}
    const updated=await client.query("UPDATE work_orders SET workflow_stage=$1,status=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 RETURNING *",[rule.to,nextStatus,req.user.organization_id,id.data]);
    const detail={action,fromStage:current.workflow_stage,toStage:rule.to,fromStatus:current.status,toStatus:nextStatus};
    await client.query(`INSERT INTO work_order_approvals(organization_id,work_order_id,workflow_stage,action_code,decision,actor_user_id,note,detail)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[req.user.organization_id,id.data,current.workflow_stage,action,rule.decision,req.user.id,parsed.data.note,JSON.stringify(detail)]);
    await client.query(`INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,from_status,to_status,note,detail)
      VALUES($1,$2,$3,'workflow_action',$4,$5,$6,$7::jsonb)`,[req.user.organization_id,id.data,req.user.id,current.status,nextStatus,parsed.data.note,JSON.stringify(detail)]);
    const nextAuthority={
      awaiting_management_start:{permission:current.config.startApprovalPermission},
      awaiting_safety_completion:{permission:current.config.completionSafetyPermission},
      awaiting_management_completion:{permission:current.config.completionApprovalPermission},
    }[rule.to];
    if(nextAuthority)await notifyAuthority(client,{organizationId:req.user.organization_id,...nextAuthority,excludeUserId:req.user.id,title:"Ажлын баталгаажуулалт хүлээгдэж байна",message:current.title,entityId:id.data});
    if(rule.to==="execution")await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_order_workflow",title:"Ажил гүйцэтгэх шатанд шилжлээ",message:current.title,entityId:id.data});
    if(rule.to==="completed")await notifyUser(client,{organizationId:req.user.organization_id,userId:current.assigned_to,type:"work_completed",title:"Ажил баталгаажиж хаагдлаа",message:current.title,entityId:id.data});
    await writeAudit(req,`work_order.workflow.${action}`,"work_order",id.data,detail,client);
    await client.query("COMMIT");res.json({item:updated.rows[0]});
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
