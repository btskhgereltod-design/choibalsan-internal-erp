"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireRoles, requireModule } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { loadOperationalObjectActivity } = require("../services/operational-object-activity");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const editableRoles = ["director", "chief_engineer", "storekeeper", "engineer"];
const nullableText = z.union([z.string().trim().max(200), z.null()]).optional();
const fields = {
  code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(250),
  category: z.string().trim().min(1).max(100), serialNumber: nullableText,
  location: z.string().trim().max(250).default(""), responsibleUserId: z.string().uuid().nullable().optional(),
  acquiredAt: z.iso.date().nullable().optional(), notes: z.string().trim().max(5000).default(""),
  allocatableQuantity: z.coerce.number().positive().max(1_000_000_000).default(1),
  allocationUnit: z.string().trim().min(1).max(30).default("ш"),
  status: z.enum(["active", "repair", "inactive", "retired"]).default("active"),
  metadata: z.record(z.string(), z.unknown()).default({}),
};
const createSchema = z.object(fields);
const updateSchema = z.object({
  code: fields.code.optional(), name: fields.name.optional(), category: fields.category.optional(),
  serialNumber: fields.serialNumber, location: fields.location.optional(), responsibleUserId: fields.responsibleUserId,
  acquiredAt: fields.acquiredAt, notes: fields.notes.optional(), status: fields.status.optional(),
  allocatableQuantity: fields.allocatableQuantity.optional(), allocationUnit: fields.allocationUnit.optional(),
}).refine(value => Object.keys(value).length > 0, "No changes supplied");

async function responsibleUser(client, organizationId, userId) {
  if (!userId) return null;
  const result = await client.query(
    "SELECT id,full_name FROM users WHERE organization_id=$1 AND id=$2 AND active=true", [organizationId,userId]
  );
  return result.rows[0] || null;
}

router.use(authenticate, requireModule("assets"));

router.get("/", asyncHandler(async (req, res) => {
  const result = await getPool().query(
    `SELECT a.id,a.code,a.name,a.category,a.status,a.serial_number,a.location,a.responsible_user_id,
            a.allocatable_quantity,a.allocation_unit,
            a.acquired_at,a.notes,a.metadata,a.created_at,a.updated_at,u.full_name AS responsible_name
       FROM assets a LEFT JOIN users u ON u.organization_id=a.organization_id AND u.id=a.responsible_user_id
      WHERE a.organization_id=$1 AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'
      ORDER BY a.created_at DESC LIMIT 500`, [req.user.organization_id]
  );
  res.json({ items: result.rows });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid asset" });
  const asset = await getPool().query(
    `SELECT a.*,u.full_name AS responsible_name,creator.full_name AS created_by_name
       FROM assets a
       LEFT JOIN users u ON u.organization_id=a.organization_id AND u.id=a.responsible_user_id
       LEFT JOIN users creator ON creator.organization_id=a.organization_id AND creator.id=a.created_by
      WHERE a.organization_id=$1 AND a.id=$2`, [req.user.organization_id,id.data]
  );
  if (!asset.rowCount) return res.status(404).json({ error: "Asset not found" });
  const [orders,events,activity] = await Promise.all([
    getPool().query(
      `SELECT id,title,status,priority,assigned_to,due_at,created_at
         FROM work_orders WHERE organization_id=$1 AND asset_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [req.user.organization_id,id.data]
    ),
    getPool().query(
      `SELECT e.id,e.event_type,e.detail,e.created_at,u.full_name AS actor_name
         FROM asset_events e LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
        WHERE e.organization_id=$1 AND e.asset_id=$2 ORDER BY e.created_at DESC LIMIT 100`,
      [req.user.organization_id,id.data]
    ),
    loadOperationalObjectActivity(getPool(), {
      organizationId: req.user.organization_id,
      assetId: id.data,
      user: req.user,
    }),
  ]);
  res.json({ item: asset.rows[0], workOrders: orders.rows, events: events.rows, activity });
}));

router.post("/", requireRoles(...editableRoles), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid asset", issues: parsed.error.issues });
  const value = parsed.data, client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const responsible = await responsibleUser(client,req.user.organization_id,value.responsibleUserId);
    if (value.responsibleUserId&&!responsible) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Хариуцагч хэрэглэгч олдсонгүй" }); }
    const result = await client.query(
      `INSERT INTO assets(organization_id,code,name,category,status,serial_number,location,responsible_user_id,acquired_at,notes,metadata,created_by,allocatable_quantity,allocation_unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
       RETURNING *`,
      [req.user.organization_id,value.code,value.name,value.category,value.status,value.serialNumber||null,value.location,
        responsible?.id||null,value.acquiredAt||null,value.notes,JSON.stringify(value.metadata),req.user.id,value.allocatableQuantity,value.allocationUnit]
    );
    const asset = result.rows[0];
    await client.query(
      `INSERT INTO asset_events(organization_id,asset_id,actor_user_id,event_type,detail)
       VALUES ($1,$2,$3,'created',$4::jsonb)`,
      [req.user.organization_id,asset.id,req.user.id,JSON.stringify({code:value.code,status:value.status,responsibleName:responsible?.full_name||null})]
    );
    await client.query("COMMIT");
    await writeAudit(req,"asset.create","asset",asset.id,{code:value.code});
    res.status(201).json({ item: asset });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}));

router.patch("/:id", requireRoles(...editableRoles), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id), parsed = updateSchema.safeParse(req.body);
  if (!id.success||!parsed.success) return res.status(400).json({ error: "Invalid asset update" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query("SELECT * FROM assets WHERE organization_id=$1 AND id=$2 FOR UPDATE", [req.user.organization_id,id.data]);
    const current = currentResult.rows[0];
    if (!current) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Asset not found" }); }
    const value = parsed.data, hasResponsible = Object.hasOwn(value,"responsibleUserId");
    const responsible = hasResponsible?await responsibleUser(client,req.user.organization_id,value.responsibleUserId):null;
    if (hasResponsible&&value.responsibleUserId&&!responsible) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Хариуцагч хэрэглэгч олдсонгүй" }); }
    const next = {
      code:value.code??current.code,name:value.name??current.name,category:value.category??current.category,
      serialNumber:Object.hasOwn(value,"serialNumber")?value.serialNumber:current.serial_number,
      location:value.location??current.location,responsibleUserId:hasResponsible?(value.responsibleUserId||null):current.responsible_user_id,
      acquiredAt:Object.hasOwn(value,"acquiredAt")?value.acquiredAt:current.acquired_at,
      notes:value.notes??current.notes,status:value.status??current.status,
      allocatableQuantity:value.allocatableQuantity??current.allocatable_quantity,
      allocationUnit:value.allocationUnit??current.allocation_unit,
    };
    const allocated=Number((await client.query(`SELECT COALESCE(sum(quantity),0) total FROM operational_object_components
      WHERE organization_id=$1 AND asset_id=$2 AND removed_at IS NULL`,[req.user.organization_id,id.data])).rows[0].total);
    if(allocated>Number(next.allocatableQuantity)){await client.query("ROLLBACK");return res.status(409).json({error:`Одоогоор ${allocated} ${current.allocation_unit} объектод оноосон тул нийт хэмжээг үүнээс бага болгох боломжгүй`});}
    if(allocated>0&&next.allocationUnit!==current.allocation_unit){await client.query("ROLLBACK");return res.status(409).json({error:"Идэвхтэй объектын оноолттой хөрөнгийн нэгжийг өөрчлөх боломжгүй"});}
    const updated = await client.query(
      `UPDATE assets SET code=$1,name=$2,category=$3,serial_number=$4,location=$5,responsible_user_id=$6,
              acquired_at=$7,notes=$8,status=$9,allocatable_quantity=$10,allocation_unit=$11,updated_at=now()
        WHERE organization_id=$12 AND id=$13 RETURNING *`,
      [next.code,next.name,next.category,next.serialNumber||null,next.location,next.responsibleUserId,next.acquiredAt||null,next.notes,next.status,next.allocatableQuantity,next.allocationUnit,req.user.organization_id,id.data]
    );
    await client.query(
      `INSERT INTO asset_events(organization_id,asset_id,actor_user_id,event_type,detail)
       VALUES ($1,$2,$3,'updated',$4::jsonb)`,
      [req.user.organization_id,id.data,req.user.id,JSON.stringify({before:{status:current.status,location:current.location,responsibleUserId:current.responsible_user_id},after:{status:next.status,location:next.location,responsibleUserId:next.responsibleUserId}})]
    );
    await client.query("COMMIT");
    await writeAudit(req,"asset.update","asset",id.data,{status:next.status});
    res.json({ item: updated.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}));

module.exports = router;
