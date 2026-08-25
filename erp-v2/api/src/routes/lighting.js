"use strict";

const express=require("express");
const {getPool}=require("../db");
const {authenticate,requireModule}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const router=express.Router();

router.use(authenticate,requireModule("lighting-operations"));

router.get("/workspace",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const enabled=new Set(req.user.enabled_modules||[]);
  if(!enabled.has("assets")||!enabled.has("work-orders"))return res.status(403).json({error:"Гэрэлтүүлгийн ажлын талбарт хөрөнгө ба ажлын урсгал шаардлагатай"});
  const [capability,objects,incidents,work]=await Promise.all([
    getPool().query(`SELECT EXISTS(
      SELECT 1 FROM organization_work_types WHERE organization_id=$1 AND active=true AND code IN ('lighting-inspection','lighting-repair','traffic-signal-repair')
      UNION ALL SELECT 1 FROM operational_objects WHERE organization_id=$1 AND domain='lighting'
    ) available`,[org]),
    getPool().query(`SELECT id,code,name,object_type,domain,status,location,linear_length_m,metadata,updated_at
      FROM operational_objects WHERE organization_id=$1 AND domain='lighting' ORDER BY name LIMIT 1000`,[org]),
    getPool().query(`SELECT i.*,o.code asset_code,o.name asset_name FROM operational_incidents i
      LEFT JOIN operational_objects o ON o.organization_id=i.organization_id AND o.id=i.operational_object_id
      WHERE i.organization_id=$1 AND i.domain='lighting' ORDER BY i.reported_at DESC LIMIT 500`,[org]),
    getPool().query(`SELECT w.id,w.title,w.status,w.priority,w.workflow_stage,w.due_at,w.created_at,
      o.code asset_code,o.name asset_name,u.full_name assigned_name,d.name department_name,
      COALESCE(m.item_count,0)::int measurement_item_count,
      COALESCE(m.planned,0) planned_quantity,COALESCE(m.completed,0) completed_quantity,
      COALESCE(m.unresolved,0) unresolved_quantity,COALESCE(m.deferred,0) deferred_quantity,
      COALESCE(m.exception_pending,0)::int exception_pending
      FROM work_orders w
      LEFT JOIN operational_objects o ON o.organization_id=w.organization_id AND o.id=w.operational_object_id
      LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
      LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
      LEFT JOIN LATERAL(SELECT count(*) item_count,sum(planned_quantity) planned,
        sum(completed_quantity) completed,sum(unresolved_quantity) unresolved,sum(deferred_quantity) deferred,
        count(*) FILTER(WHERE exception_status='requested') exception_pending
        FROM work_order_scope_items si WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id) m ON true
      WHERE w.organization_id=$1 AND (wt.code IN ('lighting-inspection','lighting-repair','traffic-signal-repair') OR w.category LIKE 'lighting.%')
      ORDER BY w.created_at DESC LIMIT 500`,[org])
  ]);
  const items=objects.rows,issues=incidents.rows,orders=work.rows;
  res.json({available:Boolean(capability.rows[0]?.available),summary:{
    assets:items.length,activeAssets:items.filter(x=>x.status==='active').length,
    openIncidents:issues.filter(x=>['open','in_progress'].includes(x.status)).length,
    affectedLights:issues.filter(x=>['open','in_progress'].includes(x.status)).reduce((n,x)=>n+Number(x.affected_quantity)-Number(x.resolved_quantity),0),
    openWork:orders.filter(x=>!['completed','cancelled'].includes(x.status)).length,
    completedWork:orders.filter(x=>x.status==='completed').length
  },assets:items,incidents:issues,workOrders:orders});
}));

module.exports=router;
