"use strict";

const express = require("express");
const { getPool } = require("../db");
const { authenticate, requireModule, requireWorkspace } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate, requireModule("camera-operations"), requireWorkspace("camera"));

router.get("/workspace", asyncHandler(async (req, res) => {
  const organizationId = req.user.organization_id;
  const enabled = new Set(req.user.enabled_modules || []);
  if (!enabled.has("assets") || !enabled.has("work-orders")) {
    return res.status(403).json({ error: "Камерын ажлын талбарт хөрөнгө болон ажлын урсгалын эрх шаардлагатай." });
  }

  const [capability, objects, incidents, workOrders] = await Promise.all([
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
  ]);

  const assetRows = objects.rows;
  const incidentRows = incidents.rows;
  const orderRows = workOrders.rows;
  res.json({
    available: Boolean(capability.rows[0]?.available),
    summary: {
      assets: assetRows.length,
      activeAssets: assetRows.filter((item) => item.status === "active").length,
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
  });
}));

module.exports = router;
