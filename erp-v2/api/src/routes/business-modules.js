"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, authenticatePlatform, requireRoles, requireModule, requirePermissions, requireSystemRoles, requirePlatformPermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { syncPrimaryAssignment } = require("../services/employee-assignment");
const { asyncHandler } = require("../utils/async-handler");

const tenantRouter = express.Router();
const platformRouter = express.Router();
const uuid = z.string().uuid();
const optionalUuid = uuid.nullable().optional();
const management = requireRoles("director", "chief_engineer");
const primaryAdmin = requireSystemRoles("owner");
const inventoryEditors = requirePermissions("inventory.manage");
const procurementApprovers = requireRoles("director", "chief_engineer", "accountant");
const text = (max = 250) => z.string().trim().min(1).max(max);
const emptyText = (max = 2000) => z.string().trim().max(max).default("");
const optionalPositiveInteger = (max) => z.preprocess(
  value => value === "" || value === null || value === undefined ? undefined : value,
  z.coerce.number().int().positive().max(max).optional()
);
// Organization-defined position rank drives hierarchy. Legacy profession names
// must never define the universal OVERVA structure.
const hierarchyOrderSql = `CASE WHEN e.active=false THEN 1000 ELSE COALESCE(p.rank_level,500) END`;

tenantRouter.use(authenticate);
tenantRouter.use("/structure", requireModule("structure"));
tenantRouter.use("/inventory", requireModule("inventory"), requirePermissions("inventory.read"));
tenantRouter.use("/maintenance", requireModule("maintenance"));
tenantRouter.use("/procurement", requireModule("procurement"));

// Organization structure
tenantRouter.get("/structure", asyncHandler(async (req, res) => {
  const org = req.user.organization_id;
  const [departments, positions, people, unitTypes] = await Promise.all([
    getPool().query(`SELECT d.*,p.name AS parent_name FROM departments d LEFT JOIN departments p ON p.organization_id=d.organization_id AND p.id=d.parent_id WHERE d.organization_id=$1 ORDER BY d.name`, [org]),
    getPool().query(`SELECT p.*,d.name AS department_name,j.name AS job_name FROM positions p LEFT JOIN departments d ON d.organization_id=p.organization_id AND d.id=p.department_id JOIN jobs j ON j.organization_id=p.organization_id AND j.id=p.job_id WHERE p.organization_id=$1 ORDER BY p.rank_level,p.title`, [org]),
    getPool().query(`SELECT e.id,e.full_name,u.email,e.job_role AS role,e.active,e.department_id,e.position_id,e.manager_employee_id AS manager_user_id,d.name AS department_name,p.title AS position_title,m.full_name AS manager_name,${hierarchyOrderSql} AS hierarchy_order FROM employees e LEFT JOIN users u ON u.organization_id=e.organization_id AND u.employee_id=e.id LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id LEFT JOIN employees m ON m.organization_id=e.organization_id AND m.id=e.manager_employee_id WHERE e.organization_id=$1 ORDER BY hierarchy_order,COALESCE(p.rank_level,20),p.title NULLS LAST,e.full_name`, [org]),
    getPool().query(`SELECT code,name FROM reference_values WHERE set_code='organization_unit_type' AND active=true AND (valid_to IS NULL OR valid_to>=CURRENT_DATE) ORDER BY sort_order,name`),
  ]);
  res.json({ departments:departments.rows, positions:positions.rows, people:people.rows, unitTypes:unitTypes.rows });
}));

tenantRouter.post("/structure/departments", primaryAdmin, asyncHandler(async (req, res) => {
  const parsed = z.object({ code:text(40).transform(v => v.toUpperCase()), name:text(200), parentId:optionalUuid,
    unitTypeCode:z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/).default("department") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Хэлтсийн мэдээлэл буруу байна" });
  const v = parsed.data;
  const result = await getPool().query(`INSERT INTO departments(organization_id,code,name,parent_id,unit_type_code) VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.user.organization_id,v.code,v.name,v.parentId||null,v.unitTypeCode]);
  await writeAudit(req,"organization_unit.create","organization_unit",result.rows[0].id,{code:v.code,name:v.name,unitTypeCode:v.unitTypeCode});
  res.status(201).json({ item: result.rows[0] });
}));

tenantRouter.post("/structure/positions", primaryAdmin, asyncHandler(async (req, res) => {
  const parsed = z.object({ code:text(40).transform(v => v.toUpperCase()), title:text(200), departmentId:optionalUuid,
    rankLevel:z.coerce.number().int().min(1).max(20).default(1), headcountLimit:optionalPositiveInteger(100000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Албан тушаалын мэдээлэл буруу байна" });
  const v=parsed.data,client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const job=await client.query(`INSERT INTO jobs(organization_id,code,name) VALUES($1,$2,$3)
      ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,updated_at=now() RETURNING id`,
      [req.user.organization_id,v.code,v.title]);
    const result=await client.query(`INSERT INTO positions(organization_id,code,title,department_id,rank_level,job_id,headcount_limit)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.organization_id,v.code,v.title,v.departmentId||null,v.rankLevel,job.rows[0].id,v.headcountLimit||null]);
    await writeAudit(req,"position.create","position",result.rows[0].id,{code:v.code,title:v.title,jobId:job.rows[0].id,headcountLimit:v.headcountLimit||null},client);
    await client.query("COMMIT");
    res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

tenantRouter.patch("/structure/users/:id", primaryAdmin, asyncHandler(async (req,res)=>{
  const id=uuid.safeParse(req.params.id), parsed=z.object({departmentId:optionalUuid,positionId:optionalUuid,managerUserId:optionalUuid}).safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Бүтцийн мэдээлэл буруу байна"});
  if(id.data===parsed.data.managerUserId)return res.status(409).json({error:"Хэрэглэгч өөрийн удирдлага байж болохгүй"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const result=await client.query(`SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[req.user.organization_id,id.data]);
    if(!result.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Ажилтан олдсонгүй"});}
    const assignment=await syncPrimaryAssignment(client,{organizationId:req.user.organization_id,employeeId:id.data,
      departmentId:parsed.data.departmentId||null,positionId:parsed.data.positionId||null,
      managerEmployeeId:parsed.data.managerUserId||null,actorUserId:req.user.id});
    await writeAudit(req,"organization.assignment","employee",id.data,assignment,client);
    await client.query("COMMIT");
    res.json({ok:true,assignment});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

// Inventory and warehouses
tenantRouter.get("/inventory", asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const canIssueWorkMaterial=(req.user.permissions||[]).includes("work-orders.material.issue");
  const [warehouses,items,movements,workMaterialRequests]=await Promise.all([
    getPool().query(`SELECT w.*,COALESCE(sum(b.quantity),0)::numeric AS total_quantity,count(b.item_id)::int AS item_count FROM warehouses w LEFT JOIN inventory_balances b ON b.organization_id=w.organization_id AND b.warehouse_id=w.id WHERE w.organization_id=$1 GROUP BY w.id ORDER BY w.name`,[org]),
    getPool().query(`SELECT i.*,COALESCE(sum(b.quantity),0)::numeric AS total_quantity,jsonb_agg(jsonb_build_object('warehouseId',w.id,'warehouseName',w.name,'quantity',b.quantity)) FILTER(WHERE b.warehouse_id IS NOT NULL) AS balances FROM inventory_items i LEFT JOIN inventory_balances b ON b.organization_id=i.organization_id AND b.item_id=i.id LEFT JOIN warehouses w ON w.organization_id=b.organization_id AND w.id=b.warehouse_id WHERE i.organization_id=$1 GROUP BY i.id ORDER BY i.name`,[org]),
    getPool().query(`SELECT m.*,i.name AS item_name,i.sku,fw.name AS from_name,tw.name AS to_name,u.full_name AS created_by_name FROM stock_movements m JOIN inventory_items i ON i.organization_id=m.organization_id AND i.id=m.item_id LEFT JOIN warehouses fw ON fw.organization_id=m.organization_id AND fw.id=m.from_warehouse_id LEFT JOIN warehouses tw ON tw.organization_id=m.organization_id AND tw.id=m.to_warehouse_id LEFT JOIN users u ON u.organization_id=m.organization_id AND u.id=m.created_by WHERE m.organization_id=$1 ORDER BY m.created_at DESC LIMIT 100`,[org]),
    canIssueWorkMaterial?getPool().query(`SELECT mr.id,mr.work_order_id,mr.approved_quantity,mr.unit,mr.reason,mr.requested_at,
      wo.title AS work_order_title,i.id AS item_id,i.sku,i.name AS item_name,
      COALESCE(jsonb_agg(jsonb_build_object('warehouseId',w.id,'warehouseName',w.name,'quantity',b.quantity) ORDER BY w.name)
        FILTER(WHERE b.warehouse_id IS NOT NULL),'[]'::jsonb) AS balances
      FROM work_order_material_requests mr
      JOIN work_orders wo ON wo.organization_id=mr.organization_id AND wo.id=mr.work_order_id
      JOIN inventory_items i ON i.organization_id=mr.organization_id AND i.id=mr.inventory_item_id
      LEFT JOIN inventory_balances b ON b.organization_id=mr.organization_id AND b.item_id=mr.inventory_item_id
      LEFT JOIN warehouses w ON w.organization_id=b.organization_id AND w.id=b.warehouse_id
      WHERE mr.organization_id=$1 AND mr.status='approved'
      GROUP BY mr.id,wo.id,i.id ORDER BY mr.requested_at`,[org]):Promise.resolve({rows:[]})
  ]);
  res.json({warehouses:warehouses.rows,items:items.rows,movements:movements.rows,workMaterialRequests:workMaterialRequests.rows,canIssueWorkMaterial});
}));

tenantRouter.post("/inventory/warehouses", inventoryEditors, asyncHandler(async(req,res)=>{
  const parsed=z.object({code:text(40).transform(v=>v.toUpperCase()),name:text(200),location:emptyText(250)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Агуулахын мэдээлэл буруу байна"}); const v=parsed.data;
  const result=await getPool().query(`INSERT INTO warehouses(organization_id,code,name,location) VALUES($1,$2,$3,$4) RETURNING *`,[req.user.organization_id,v.code,v.name,v.location]);
  await writeAudit(req,"warehouse.create","warehouse",result.rows[0].id,v); res.status(201).json({item:result.rows[0]});
}));

tenantRouter.post("/inventory/items", inventoryEditors, asyncHandler(async(req,res)=>{
  const parsed=z.object({sku:text(80).transform(v=>v.toUpperCase()),name:text(250),category:text(100),unit:text(20),minimumStock:z.coerce.number().min(0).default(0)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Барааны мэдээлэл буруу байна"}); const v=parsed.data;
  const result=await getPool().query(`INSERT INTO inventory_items(organization_id,sku,name,category,unit,minimum_stock) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.organization_id,v.sku,v.name,v.category,v.unit,v.minimumStock]);
  await writeAudit(req,"inventory_item.create","inventory_item",result.rows[0].id,v); res.status(201).json({item:result.rows[0]});
}));

tenantRouter.post("/inventory/movements", inventoryEditors, asyncHandler(async(req,res)=>{
  const parsed=z.object({itemId:uuid,type:z.enum(["receipt","issue","transfer","adjustment_in","adjustment_out"]),fromWarehouseId:optionalUuid,toWarehouseId:optionalUuid,quantity:z.coerce.number().positive().max(1000000000),reference:text(120),note:text(1000)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Орлого, зарлагын мэдээлэл буруу байна"}); const v=parsed.data;
  const needsFrom=["issue","transfer","adjustment_out"].includes(v.type),needsTo=["receipt","transfer","adjustment_in"].includes(v.type);
  if((needsFrom&&!v.fromWarehouseId)||(needsTo&&!v.toWarehouseId)||(v.type==="transfer"&&v.fromWarehouseId===v.toWarehouseId))return res.status(400).json({error:"Эхлэх болон хүлээн авах агуулахыг зөв сонгоно уу"});
  const client=await getPool().connect(); try{await client.query("BEGIN");
    if(needsFrom){const balance=await client.query(`SELECT quantity FROM inventory_balances WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE`,[req.user.organization_id,v.fromWarehouseId,v.itemId]);if(!balance.rowCount||Number(balance.rows[0].quantity)<v.quantity){await client.query("ROLLBACK");return res.status(409).json({error:"Үлдэгдэл хүрэлцэхгүй байна"});}await client.query(`UPDATE inventory_balances SET quantity=quantity-$4,updated_at=now() WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3`,[req.user.organization_id,v.fromWarehouseId,v.itemId,v.quantity]);}
    if(needsTo)await client.query(`INSERT INTO inventory_balances(organization_id,warehouse_id,item_id,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,warehouse_id,item_id) DO UPDATE SET quantity=inventory_balances.quantity+EXCLUDED.quantity,updated_at=now()`,[req.user.organization_id,v.toWarehouseId,v.itemId,v.quantity]);
    const result=await client.query(`INSERT INTO stock_movements(organization_id,item_id,from_warehouse_id,to_warehouse_id,movement_type,quantity,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.organization_id,v.itemId,v.fromWarehouseId||null,v.toWarehouseId||null,v.type,v.quantity,v.reference,v.note,req.user.id]);await client.query("COMMIT");
    await writeAudit(req,"stock.movement","stock_movement",result.rows[0].id,{type:v.type,quantity:v.quantity,itemId:v.itemId});res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

// Preventive maintenance
tenantRouter.get("/maintenance", asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT p.*,a.code AS asset_code,a.name AS asset_name,u.full_name AS assigned_name,(p.next_due_date<CURRENT_DATE) AS overdue,(SELECT count(*)::int FROM maintenance_executions e WHERE e.organization_id=p.organization_id AND e.plan_id=p.id) AS completion_count FROM maintenance_plans p JOIN assets a ON a.organization_id=p.organization_id AND a.id=p.asset_id LEFT JOIN users u ON u.organization_id=p.organization_id AND u.id=p.assigned_to WHERE p.organization_id=$1 ORDER BY p.active DESC,p.next_due_date`,[req.user.organization_id]);res.json({items:result.rows});
}));
tenantRouter.post("/maintenance", management, asyncHandler(async(req,res)=>{
  const parsed=z.object({assetId:uuid,title:text(250),instructions:emptyText(3000),frequencyDays:z.coerce.number().int().min(1).max(3650),nextDueDate:z.iso.date(),assignedTo:optionalUuid}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Засварын төлөвлөгөө буруу байна"});const v=parsed.data;
  const result=await getPool().query(`INSERT INTO maintenance_plans(organization_id,asset_id,title,instructions,frequency_days,next_due_date,assigned_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.user.organization_id,v.assetId,v.title,v.instructions,v.frequencyDays,v.nextDueDate,v.assignedTo||null,req.user.id]);await writeAudit(req,"maintenance.create","maintenance_plan",result.rows[0].id,v);res.status(201).json({item:result.rows[0]});
}));
tenantRouter.post("/maintenance/:id/complete", asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=z.object({note:emptyText(2000),meterReading:emptyText(100)}).safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Гүйцэтгэлийн мэдээлэл буруу байна"});
  const client=await getPool().connect();try{await client.query("BEGIN");const plan=await client.query(`SELECT * FROM maintenance_plans WHERE organization_id=$1 AND id=$2 AND active=true FOR UPDATE`,[req.user.organization_id,id.data]);if(!plan.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Төлөвлөгөө олдсонгүй"});}const p=plan.rows[0];if(!["director","chief_engineer"].includes(req.user.role)&&p.assigned_to!==req.user.id){await client.query("ROLLBACK");return res.status(403).json({error:"Энэ ажлыг гүйцэтгэх эрхгүй"});}
    const next=await client.query(`SELECT (GREATEST($1::date,CURRENT_DATE)+($2::text||' days')::interval)::date AS date`,[p.next_due_date,p.frequency_days]);await client.query(`INSERT INTO maintenance_executions(organization_id,plan_id,completed_by,meter_reading,note,next_due_date) VALUES($1,$2,$3,$4,$5,$6)`,[req.user.organization_id,p.id,req.user.id,parsed.data.meterReading,parsed.data.note,next.rows[0].date]);await client.query(`UPDATE maintenance_plans SET next_due_date=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,p.id,next.rows[0].date]);await client.query("COMMIT");await writeAudit(req,"maintenance.complete","maintenance_plan",p.id,{nextDueDate:next.rows[0].date});res.json({ok:true,nextDueDate:next.rows[0].date});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

// Procurement approvals
tenantRouter.get("/procurement", asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT r.*,u.full_name AS requested_by_name,d.name AS department_name,du.full_name AS decided_by_name,(SELECT jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity,'unit',l.unit,'unitPrice',l.unit_price) ORDER BY l.description) FROM purchase_request_lines l WHERE l.organization_id=r.organization_id AND l.request_id=r.id) AS lines FROM purchase_requests r LEFT JOIN users u ON u.organization_id=r.organization_id AND u.id=r.requested_by LEFT JOIN users du ON du.organization_id=r.organization_id AND du.id=r.decided_by LEFT JOIN departments d ON d.organization_id=r.organization_id AND d.id=r.department_id WHERE r.organization_id=$1 ORDER BY r.created_at DESC LIMIT 300`,[req.user.organization_id]);res.json({items:result.rows});
}));
tenantRouter.post("/procurement", asyncHandler(async(req,res)=>{
  const parsed=z.object({title:text(250),justification:emptyText(3000),departmentId:optionalUuid,neededBy:z.iso.date().nullable().optional(),currency:z.enum(["MNT","USD","CNY"]).default("MNT"),submit:z.boolean().default(true),lines:z.array(z.object({description:text(500),quantity:z.coerce.number().positive(),unit:text(20),unitPrice:z.coerce.number().min(0)})).min(1).max(100)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Худалдан авалтын хүсэлт буруу байна"});const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");const seq=await client.query(`SELECT COALESCE(max(substring(request_no from '[0-9]+$')::int),0)+1 AS next FROM purchase_requests WHERE organization_id=$1`,[req.user.organization_id]);const requestNo=`PR-${new Date().getFullYear()}-${String(seq.rows[0].next).padStart(5,"0")}`,total=v.lines.reduce((s,l)=>s+l.quantity*l.unitPrice,0),status=v.submit?"submitted":"draft";const result=await client.query(`INSERT INTO purchase_requests(organization_id,request_no,title,justification,department_id,requested_by,status,total_amount,currency,needed_by,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $7='submitted' THEN now() END) RETURNING *`,[req.user.organization_id,requestNo,v.title,v.justification,v.departmentId||null,req.user.id,status,total,v.currency,v.neededBy||null]);for(const line of v.lines)await client.query(`INSERT INTO purchase_request_lines(organization_id,request_id,description,quantity,unit,unit_price) VALUES($1,$2,$3,$4,$5,$6)`,[req.user.organization_id,result.rows[0].id,line.description,line.quantity,line.unit,line.unitPrice]);await client.query(`INSERT INTO purchase_approval_events(organization_id,request_id,actor_user_id,action,note) VALUES($1,$2,$3,'created',$4)`,[req.user.organization_id,result.rows[0].id,req.user.id,v.justification]);if(v.submit)await client.query(`INSERT INTO purchase_approval_events(organization_id,request_id,actor_user_id,action) VALUES($1,$2,$3,'submitted')`,[req.user.organization_id,result.rows[0].id,req.user.id]);await client.query("COMMIT");await writeAudit(req,"procurement.create","purchase_request",result.rows[0].id,{requestNo,total,status});res.status(201).json({item:result.rows[0]});}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));
tenantRouter.post("/procurement/:id/decision", procurementApprovers, asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=z.object({action:z.enum(["approved","rejected","ordered","received","cancelled"]),note:emptyText(2000)}).safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Шийдвэр буруу байна"});const allowed={submitted:["approved","rejected","cancelled"],approved:["ordered","cancelled"],ordered:["received","cancelled"]};const client=await getPool().connect();try{await client.query("BEGIN");const current=await client.query(`SELECT status FROM purchase_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[req.user.organization_id,id.data]);if(!current.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Хүсэлт олдсонгүй"});}if(!(allowed[current.rows[0].status]||[]).includes(parsed.data.action)){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ төлөвөөс сонгосон үйлдэл хийх боломжгүй"});}await client.query(`UPDATE purchase_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,updated_at=now() WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,id.data,parsed.data.action,req.user.id,parsed.data.note]);await client.query(`INSERT INTO purchase_approval_events(organization_id,request_id,actor_user_id,action,note) VALUES($1,$2,$3,$4,$5)`,[req.user.organization_id,id.data,req.user.id,parsed.data.action,parsed.data.note]);await client.query("COMMIT");await writeAudit(req,`procurement.${parsed.data.action}`,"purchase_request",id.data,{note:parsed.data.note});res.json({ok:true});}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

// Tenant settings and billing view
tenantRouter.get("/settings", requireSystemRoles("owner"), asyncHandler(async(req,res)=>{await getPool().query(`INSERT INTO organization_settings(organization_id,short_name) VALUES($1,$2) ON CONFLICT DO NOTHING`,[req.user.organization_id,req.user.organization_name]);const result=await getPool().query(`SELECT o.name,o.slug,o.timezone,s.* FROM organizations o JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=$1`,[req.user.organization_id]);res.json({item:result.rows[0]});}));
tenantRouter.patch("/settings", requireSystemRoles("owner"), asyncHandler(async(req,res)=>{const parsed=z.object({name:text(200),shortName:emptyText(100),logoUrl:z.string().trim().max(1000).default(""),primaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),accentColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),address:emptyText(500),phone:emptyText(100),email:z.union([z.string().trim().email(),z.literal("")]),registrationNo:emptyText(100)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Тохиргооны мэдээлэл буруу байна"});const v=parsed.data,client=await getPool().connect();try{await client.query("BEGIN");await client.query(`UPDATE organizations SET name=$2,updated_at=now() WHERE id=$1`,[req.user.organization_id,v.name]);const result=await client.query(`UPDATE organization_settings SET short_name=$2,logo_url=$3,primary_color=$4,accent_color=$5,address=$6,phone=$7,email=$8,registration_no=$9,updated_by=$10,updated_at=now() WHERE organization_id=$1 RETURNING *`,[req.user.organization_id,v.shortName,v.logoUrl,v.primaryColor,v.accentColor,v.address,v.phone,v.email,v.registrationNo,req.user.id]);await client.query("COMMIT");await writeAudit(req,"organization.settings","organization",req.user.organization_id,{name:v.name,primaryColor:v.primaryColor});res.json({item:result.rows[0]});}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}));
tenantRouter.get("/billing", requireRoles("director","accountant"), asyncHandler(async(req,res)=>{const [subscription,plans,invoices]=await Promise.all([getPool().query(`SELECT s.*,p.name AS plan_name,p.monthly_price,p.user_limit,p.storage_gb,p.features FROM subscriptions s LEFT JOIN plan_catalog p ON p.code=s.plan_code WHERE s.organization_id=$1`,[req.user.organization_id]),getPool().query(`SELECT * FROM plan_catalog WHERE active=true ORDER BY monthly_price`),getPool().query(`SELECT i.*,COALESCE(sum(p.amount),0)::numeric AS paid_amount FROM billing_invoices i LEFT JOIN billing_payments p ON p.organization_id=i.organization_id AND p.invoice_id=i.id WHERE i.organization_id=$1 GROUP BY i.id ORDER BY i.period_start DESC LIMIT 100`,[req.user.organization_id])]);res.json({subscription:subscription.rows[0],plans:plans.rows,invoices:invoices.rows});}));

// Platform billing operations
platformRouter.use(authenticatePlatform);
platformRouter.get("/overview", requirePlatformPermissions("platform.billing.read"), asyncHandler(async(_req,res)=>{const [plans,invoices,summary]=await Promise.all([getPool().query(`SELECT * FROM plan_catalog ORDER BY monthly_price`),getPool().query(`SELECT i.*,o.name AS organization_name,o.slug,COALESCE(sum(p.amount),0)::numeric AS paid_amount FROM billing_invoices i JOIN organizations o ON o.id=i.organization_id LEFT JOIN billing_payments p ON p.organization_id=i.organization_id AND p.invoice_id=i.id GROUP BY i.id,o.id ORDER BY i.created_at DESC LIMIT 300`),getPool().query(`SELECT COALESCE(sum(amount) FILTER(WHERE status='paid'),0)::numeric AS paid_total,COALESCE(sum(amount) FILTER(WHERE status IN('issued','overdue')),0)::numeric AS receivable_total,count(*) FILTER(WHERE status IN('issued','overdue'))::int AS unpaid_count FROM billing_invoices`)]);res.json({plans:plans.rows,invoices:invoices.rows,summary:summary.rows[0]});}));
platformRouter.post("/invoices", requirePlatformPermissions("platform.billing.manage"), asyncHandler(async(req,res)=>{const parsed=z.object({organizationId:uuid,periodStart:z.iso.date(),periodEnd:z.iso.date(),dueDate:z.iso.date(),amount:z.coerce.number().min(0),note:emptyText(1000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Нэхэмжлэхийн мэдээлэл буруу байна"});const v=parsed.data,no=`INV-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;const result=await getPool().query(`INSERT INTO billing_invoices(organization_id,invoice_no,period_start,period_end,due_date,amount,note,status) VALUES($1,$2,$3,$4,$5,$6,$7,'issued') RETURNING *`,[v.organizationId,no,v.periodStart,v.periodEnd,v.dueDate,v.amount,v.note]);res.status(201).json({item:result.rows[0]});}));
platformRouter.post("/invoices/:id/payments", requirePlatformPermissions("platform.billing.manage"), asyncHandler(async(req,res)=>{const id=uuid.safeParse(req.params.id),parsed=z.object({amount:z.coerce.number().positive(),reference:emptyText(200),paymentMethod:z.enum(["bank_transfer","cash","card","other"]).default("bank_transfer")}).safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Төлбөрийн мэдээлэл буруу байна"});const client=await getPool().connect();try{await client.query("BEGIN");const invoice=await client.query(`SELECT * FROM billing_invoices WHERE id=$1 FOR UPDATE`,[id.data]);if(!invoice.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Нэхэмжлэх олдсонгүй"});}const i=invoice.rows[0];await client.query(`INSERT INTO billing_payments(organization_id,invoice_id,amount,payment_method,reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6)`,[i.organization_id,i.id,parsed.data.amount,parsed.data.paymentMethod,parsed.data.reference,req.platformAdmin.id]);const total=await client.query(`SELECT COALESCE(sum(amount),0)::numeric AS total FROM billing_payments WHERE organization_id=$1 AND invoice_id=$2`,[i.organization_id,i.id]);if(Number(total.rows[0].total)>=Number(i.amount))await client.query(`UPDATE billing_invoices SET status='paid',paid_at=now(),updated_at=now() WHERE id=$1`,[i.id]);await client.query("COMMIT");res.json({ok:true,paidAmount:total.rows[0].total});}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}));

module.exports = { tenantRouter, platformRouter };
