"use strict";

const express=require("express");
const {z}=require("zod");
const {getPool,withTenantTransaction}=require("../db");
const {authenticate,requireModule}=require("../middleware/auth");
const {writeAudit}=require("../services/audit");
const {asyncHandler}=require("../utils/async-handler");
const router=express.Router();

router.use(authenticate,requireModule("lighting-operations"));

const objectId=z.string().uuid();
const componentSchema=z.object({assetId:z.string().uuid(),componentRole:z.string().trim().min(1).max(100),
  quantity:z.coerce.number().positive().max(1_000_000_000),unit:z.string().trim().min(1).max(30),
  installedAt:z.iso.date().nullable().optional(),note:z.string().trim().max(1000).default("")});
const noteSchema=z.object({note:z.string().trim().min(1).max(5000)});
const hasPermission=(req,permission)=>new Set(req.user.permissions||[]).has(permission)||new Set(req.user.system_roles||[]).has("owner");
const deny=(res,permission)=>res.status(403).json({error:"Insufficient permission",permission});

router.get("/objects/:id/dossier",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.read"))return deny(res,"operational-objects.read");
  const id=objectId.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid operational object"});
  const org=req.user.organization_id;
  const object=await getPool().query(`SELECT o.*,parent.name parent_name
    FROM operational_objects o LEFT JOIN operational_objects parent
      ON parent.organization_id=o.organization_id AND parent.id=o.parent_object_id
    WHERE o.organization_id=$1 AND o.id=$2 AND o.domain='lighting'`,[org,id.data]);
  if(!object.rowCount)return res.status(404).json({error:"Operational object not found"});
  const [components,incidents,orders,events,children,assetOptions]=await Promise.all([
    getPool().query(`SELECT c.*,a.code asset_code,a.name asset_name,a.category asset_category,a.status asset_status,
      u.full_name assigned_by_name FROM operational_object_components c
      JOIN assets a ON a.organization_id=c.organization_id AND a.id=c.asset_id
      LEFT JOIN LATERAL(SELECT actor_user_id FROM operational_object_events e
        WHERE e.organization_id=c.organization_id AND e.operational_object_id=c.operational_object_id
          AND e.event_type='component_assigned' AND e.detail->>'componentId'=c.id::text ORDER BY e.id LIMIT 1) source ON true
      LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=source.actor_user_id
      WHERE c.organization_id=$1 AND c.operational_object_id=$2
      ORDER BY c.removed_at NULLS FIRST,c.created_at DESC`,[org,id.data]),
    getPool().query(`SELECT id,title,incident_type,status,affected_quantity,resolved_quantity,reported_at
      FROM operational_incidents WHERE organization_id=$1 AND operational_object_id=$2 ORDER BY reported_at DESC LIMIT 100`,[org,id.data]),
    getPool().query(`SELECT id,title,status,priority,workflow_stage,created_at,due_at
      FROM work_orders WHERE organization_id=$1 AND operational_object_id=$2 ORDER BY created_at DESC LIMIT 100`,[org,id.data]),
    getPool().query(`SELECT e.*,u.full_name actor_name FROM operational_object_events e
      LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
      WHERE e.organization_id=$1 AND e.operational_object_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,[org,id.data]),
    getPool().query(`SELECT id,code,name,object_type,status FROM operational_objects
      WHERE organization_id=$1 AND parent_object_id=$2 ORDER BY name`,[org,id.data]),
    getPool().query(`SELECT a.id,a.code,a.name,a.category,a.status,a.location,a.allocatable_quantity,a.allocation_unit,
      COALESCE(allocated.quantity,0) allocated_quantity,a.allocatable_quantity-COALESCE(allocated.quantity,0) available_quantity
      FROM assets a LEFT JOIN LATERAL(SELECT sum(c.quantity) quantity FROM operational_object_components c
        WHERE c.organization_id=a.organization_id AND c.asset_id=a.id AND c.removed_at IS NULL) allocated ON true
      WHERE a.organization_id=$1 AND a.status<>'retired' AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'
      ORDER BY a.name LIMIT 1000`,[org]),
  ]);
  res.json({item:object.rows[0],components:components.rows,incidents:incidents.rows,workOrders:orders.rows,
    events:events.rows,children:children.rows,assetOptions:assetOptions.rows,capabilities:{
      canManageComponents:hasPermission(req,"operational-objects.components.manage"),
      canCreateNote:hasPermission(req,"operational-objects.notes.create")}});
}));

router.post("/objects/:id/components",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.components.manage"))return deny(res,"operational-objects.components.manage");
  const id=objectId.safeParse(req.params.id),parsed=componentSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid component allocation",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const object=(await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND domain='lighting' AND status<>'retired' FOR UPDATE",[org,id.data])).rows[0];
    const asset=(await client.query("SELECT id,code,name,status,allocatable_quantity,allocation_unit FROM assets WHERE organization_id=$1 AND id=$2 AND status<>'retired' FOR UPDATE",[org,v.assetId])).rows[0];
    if(!object||!asset){await client.query("ROLLBACK");return res.status(404).json({error:"Object or asset not found"});}
    const allocated=Number((await client.query(`SELECT COALESCE(sum(quantity),0) total FROM operational_object_components
      WHERE organization_id=$1 AND asset_id=$2 AND removed_at IS NULL`,[org,v.assetId])).rows[0].total);
    const available=Number(asset.allocatable_quantity)-allocated;
    if(v.unit!==asset.allocation_unit){await client.query("ROLLBACK");return res.status(409).json({error:`Энэ хөрөнгийг зөвхөн ${asset.allocation_unit} нэгжээр онооно`});}
    if(v.quantity>available){await client.query("ROLLBACK");return res.status(409).json({error:`Оноож болох үлдэгдэл ${available} ${asset.allocation_unit}`});}
    const inserted=await client.query(`INSERT INTO operational_object_components(
      organization_id,operational_object_id,asset_id,component_role,quantity,unit,installed_at,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,[org,id.data,v.assetId,v.componentRole,v.quantity,v.unit,
      v.installedAt||null,JSON.stringify({allocationNote:v.note})]);
    const component=inserted.rows[0];
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'component_assigned',$4,$5::jsonb)`,[org,id.data,req.user.id,v.note,JSON.stringify({
      componentId:component.id,assetId:asset.id,assetCode:asset.code,assetName:asset.name,
      componentRole:v.componentRole,quantity:v.quantity,unit:v.unit,installedAt:v.installedAt||null})]);
    await writeAudit(req,"operational_object.component.assign","operational_object",id.data,{componentId:component.id,assetId:asset.id,quantity:v.quantity,unit:v.unit},client);
    await client.query("COMMIT");res.status(201).json({item:component});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/objects/:id/components/:componentId/remove",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.components.manage"))return deny(res,"operational-objects.components.manage");
  const id=objectId.safeParse(req.params.id),componentId=objectId.safeParse(req.params.componentId),parsed=noteSchema.safeParse(req.body);
  if(!id.success||!componentId.success||!parsed.success)return res.status(400).json({error:"Invalid component removal"});
  const org=req.user.organization_id,client=await getPool().connect();
  try{await client.query("BEGIN");
    const removed=await client.query(`UPDATE operational_object_components SET removed_at=current_date
      WHERE organization_id=$1 AND operational_object_id=$2 AND id=$3 AND removed_at IS NULL RETURNING *`,[org,id.data,componentId.data]);
    if(!removed.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active component not found"});}
    const component=removed.rows[0];
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'component_removed',$4,$5::jsonb)`,[org,id.data,req.user.id,parsed.data.note,JSON.stringify({
      componentId:component.id,assetId:component.asset_id,removedAt:component.removed_at})]);
    await writeAudit(req,"operational_object.component.remove","operational_object",id.data,{componentId:component.id,assetId:component.asset_id},client);
    await client.query("COMMIT");res.json({item:component});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/objects/:id/notes",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.notes.create"))return deny(res,"operational-objects.notes.create");
  const id=objectId.safeParse(req.params.id),parsed=noteSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid dossier note"});
  const client=await getPool().connect();try{await client.query("BEGIN");
    const exists=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND domain='lighting'",[req.user.organization_id,id.data]);
    if(!exists.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Operational object not found"});}
    const event=await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note)
      VALUES($1,$2,$3,'note',$4) RETURNING *`,[req.user.organization_id,id.data,req.user.id,parsed.data.note]);
    await writeAudit(req,"operational_object.note.create","operational_object",id.data,{},client);await client.query("COMMIT");res.status(201).json({item:event.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.get("/workspace",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const enabled=new Set(req.user.enabled_modules||[]);
  if(!enabled.has("assets")||!enabled.has("work-orders"))return res.status(403).json({error:"Гэрэлтүүлгийн ажлын талбарт хөрөнгө ба ажлын урсгал шаардлагатай"});
  const result=await withTenantTransaction(org,async client=>{
    const [capability,serviceAreas,objects,fixedAssets,incidents,work]=await Promise.all([
    client.query(`SELECT EXISTS(
      SELECT 1 FROM organization_work_types WHERE organization_id=$1 AND active=true AND code IN ('lighting-inspection','lighting-repair','traffic-signal-repair')
      UNION ALL SELECT 1 FROM operational_objects WHERE organization_id=$1 AND domain='lighting'
    ) available`,[org]),
    client.query(`SELECT id,domain,code,name,icon,sort_order
      FROM organization_work_service_areas
      WHERE organization_id=$1 AND domain='lighting' AND active=true
      ORDER BY sort_order,name`,[org]),
    client.query(`SELECT o.id,o.code,o.name,o.object_type,o.domain,o.status,o.location,o.linear_length_m,o.metadata,o.updated_at,
      area.id AS service_area_id,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM operational_objects o
      LEFT JOIN source_import_records source
        ON source.organization_id=o.organization_id AND source.source_system=o.source_system
        AND source.source_table=o.source_table AND source.source_id=o.source_id
      LEFT JOIN LATERAL(SELECT CASE
        WHEN o.source_table='sl_points' THEN 'road-lighting'
        WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN(
          'Гэр хороолол','Гэр хорооллын гэрэл','??? ????????'
        ) THEN 'ger-area-lighting'
        WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN(
          'Цамхаг','Цамхагийн гэрэл','??????'
        ) THEN 'tower-lighting'
      END AS code) classified ON true
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=o.organization_id AND area.domain='lighting'
        AND area.code=classified.code AND area.active=true
      WHERE o.organization_id=$1 AND o.domain='lighting' ORDER BY o.name LIMIT 1000`,[org]),
    client.query(`SELECT a.id,a.code,a.name,a.category,a.status,a.location,a.metadata,a.allocatable_quantity,a.allocation_unit,
      area.id AS service_area_id,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM assets a
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=a.organization_id AND area.domain='lighting' AND area.active=true
        AND area.code=CASE a.category WHEN 'Шит/Самбар' THEN 'panel-board' WHEN 'Гэрлэн дохио' THEN 'traffic-signal' END
      WHERE a.organization_id=$1 AND a.category IN('Шит/Самбар','Гэрлэн дохио')
        AND a.status<>'retired' AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'
      ORDER BY a.name LIMIT 1000`,[org]),
    client.query(`SELECT i.*,o.code asset_code,o.name asset_name,
      area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM operational_incidents i
      LEFT JOIN operational_objects o ON o.organization_id=i.organization_id AND o.id=i.operational_object_id
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=i.organization_id AND area.id=i.service_area_id AND area.active=true
      WHERE i.organization_id=$1 AND i.domain='lighting' ORDER BY i.reported_at DESC LIMIT 500`,[org]),
    client.query(`SELECT w.id,w.title,w.status,w.priority,w.workflow_stage,w.due_at,w.created_at,w.service_area_id,
      o.code asset_code,o.name asset_name,u.full_name assigned_name,d.name department_name,
      area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon,
      COALESCE(m.item_count,0)::int measurement_item_count,
      COALESCE(m.planned,0) planned_quantity,COALESCE(m.completed,0) completed_quantity,
      COALESCE(m.unresolved,0) unresolved_quantity,COALESCE(m.deferred,0) deferred_quantity,
      COALESCE(m.exception_pending,0)::int exception_pending
      FROM work_orders w
      LEFT JOIN operational_objects o ON o.organization_id=w.organization_id AND o.id=w.operational_object_id
      LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
      LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=w.organization_id AND area.id=w.service_area_id AND area.active=true
      LEFT JOIN LATERAL(SELECT count(*) item_count,sum(planned_quantity) planned,
        sum(completed_quantity) completed,sum(unresolved_quantity) unresolved,sum(deferred_quantity) deferred,
        count(*) FILTER(WHERE exception_status='requested') exception_pending
        FROM work_order_scope_items si WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id) m ON true
      WHERE w.organization_id=$1 AND (wt.code IN ('lighting-inspection','lighting-repair','traffic-signal-repair') OR w.category LIKE 'lighting.%')
      ORDER BY w.created_at DESC LIMIT 500`,[org])
    ]);
    const items=objects.rows,equipment=fixedAssets.rows,issues=incidents.rows,orders=work.rows;
    return {available:Boolean(capability.rows[0]?.available),summary:{
      operationalRecords:items.length,fixedEquipment:equipment.length,
      openIncidents:issues.filter(x=>['open','in_progress'].includes(x.status)).length,
      affectedLights:issues.filter(x=>['open','in_progress'].includes(x.status)).reduce((n,x)=>n+Number(x.affected_quantity)-Number(x.resolved_quantity),0),
      openWork:orders.filter(x=>!['completed','cancelled'].includes(x.status)).length,
      completedWork:orders.filter(x=>x.status==='completed').length
    },serviceAreas:serviceAreas.rows,assets:items,fixedAssets:equipment,incidents:issues,workOrders:orders};
  });
  res.json(result);
}));

module.exports=router;
