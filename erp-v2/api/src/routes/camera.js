"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule, requireWorkspace } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate, requireModule("camera-operations"), requireWorkspace("camera"));

router.get("/objects/:id/dossier", asyncHandler(async (req, res) => {
  const allowed = new Set(req.user.permissions || []).has("operational-objects.read") || new Set(req.user.system_roles || []).has("owner");
  if (!allowed) return res.status(403).json({ error: "Operational object read permission required" });
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid camera object" });
  const org = req.user.organization_id;
  const object = await getPool().query(`SELECT o.*,parent.name parent_name
    FROM operational_objects o LEFT JOIN operational_objects parent
      ON parent.organization_id=o.organization_id AND parent.id=o.parent_object_id
    WHERE o.organization_id=$1 AND o.id=$2 AND o.domain='camera'`, [org, id.data]);
  if (!object.rowCount) return res.status(404).json({ error: "Camera object not found" });
  const [components, incidents, orders, events, children] = await Promise.all([
    getPool().query(`SELECT c.*,a.code asset_code,a.name asset_name,a.category asset_category,a.status asset_status
      FROM operational_object_components c JOIN assets a ON a.organization_id=c.organization_id AND a.id=c.asset_id
      WHERE c.organization_id=$1 AND c.operational_object_id=$2 ORDER BY c.removed_at NULLS FIRST,c.created_at DESC`, [org, id.data]),
    getPool().query(`SELECT id,title,incident_type,status,affected_quantity,resolved_quantity,reported_at
      FROM operational_incidents WHERE organization_id=$1 AND operational_object_id=$2 ORDER BY reported_at DESC LIMIT 100`, [org, id.data]),
    getPool().query(`SELECT id,title,status,priority,workflow_stage,created_at,due_at
      FROM work_orders WHERE organization_id=$1 AND operational_object_id=$2 ORDER BY created_at DESC LIMIT 100`, [org, id.data]),
    getPool().query(`SELECT e.*,u.full_name actor_name FROM operational_object_events e
      LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
      WHERE e.organization_id=$1 AND e.operational_object_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 200`, [org, id.data]),
    getPool().query(`SELECT id,code,name,object_type,status FROM operational_objects
      WHERE organization_id=$1 AND parent_object_id=$2 ORDER BY name`, [org, id.data]),
  ]);
  res.json({ item: object.rows[0], components: components.rows, incidents: incidents.rows,
    workOrders: orders.rows, events: events.rows, children: children.rows, assetOptions: [],
    capabilities: { canManageComponents: false, canCreateNote: false } });
}));

router.get("/workspace", asyncHandler(async (req, res) => {
  const organizationId = req.user.organization_id;
  const enabled = new Set(req.user.enabled_modules || []);
  if (!enabled.has("assets") || !enabled.has("work-orders")) {
    return res.status(403).json({ error: "Камерын ажлын талбарт хөрөнгө болон ажлын урсгалын эрх шаардлагатай." });
  }

  const [capability, objects, incidents, workOrders, snapshots] = await Promise.all([
    getPool().query(`SELECT EXISTS(
      SELECT 1 FROM organization_work_types
      WHERE organization_id=$1 AND active=true
        AND code IN ('camera-inspection','camera-repair','camera-maintenance','camera-network-repair','network-repair')
      UNION ALL
      SELECT 1 FROM operational_objects WHERE organization_id=$1 AND domain='camera'
    ) available`, [organizationId]),
    getPool().query(`SELECT id,code,name,object_type,domain,status,location,metadata,updated_at
      FROM operational_objects
      WHERE organization_id=$1 AND domain='camera'
      ORDER BY name LIMIT 1000`, [organizationId]),
    getPool().query(`SELECT i.*,o.code asset_code,o.name asset_name
      FROM operational_incidents i
      LEFT JOIN operational_objects o
        ON o.organization_id=i.organization_id AND o.id=i.operational_object_id
      WHERE i.organization_id=$1 AND i.domain='camera'
      ORDER BY i.reported_at DESC LIMIT 500`, [organizationId]),
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
      LEFT JOIN LATERAL (
        SELECT count(*) item_count,sum(planned_quantity) planned,sum(completed_quantity) completed,
          sum(unresolved_quantity) unresolved,sum(deferred_quantity) deferred,
          count(*) FILTER (WHERE exception_status='requested') exception_pending
        FROM work_order_scope_items si
        WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id
      ) m ON true
      WHERE w.organization_id=$1
        AND (wt.code IN ('camera-inspection','camera-repair','camera-maintenance','camera-network-repair','network-repair') OR w.category LIKE 'camera.%')
      ORDER BY w.created_at DESC LIMIT 500`, [organizationId]),
    getPool().query(`SELECT snapshot_date,metrics FROM operational_domain_snapshots
      WHERE organization_id=$1 AND domain='camera' ORDER BY snapshot_date DESC LIMIT 120`, [organizationId]),
  ]);

  const assetRows = objects.rows;
  const incidentRows = incidents.rows;
  const orderRows = workOrders.rows;
  res.json({
    available: Boolean(capability.rows[0]?.available),
    summary: {
      locations: assetRows.length,
      devices: assetRows.reduce((total,item)=>total+Number(item.metadata?.cameraCount||0),0),
      activeDevices: assetRows.reduce((total,item)=>total+Math.max(0,Number(item.metadata?.cameraCount||0)-Number(item.metadata?.brokenCount||0)),0),
      openIncidents: incidentRows.filter((item) => ["open", "in_progress"].includes(item.status)).length,
      affectedDevices: incidentRows
        .filter((item) => ["open", "in_progress"].includes(item.status))
        .reduce((total, item) => total + Number(item.affected_quantity || 0) - Number(item.resolved_quantity || 0), 0),
      openWork: orderRows.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
      completedWork: orderRows.filter((item) => item.status === "completed").length,
    },
    assets: assetRows,
    incidents: incidentRows,
    workOrders: orderRows,
    snapshots: snapshots.rows,
  });
}));

module.exports = router;
