"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const periodSchema = z.object({ days: z.coerce.number().int().refine(value => [14, 30, 90].includes(value)).default(30) });
router.use(authenticate, requireModule("executive"));

function numberRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, value === null ? null : Number(value)]));
}
function addAlert(alerts, condition, level, module, message, view) {
  if (condition) alerts.push({ level, module, message, view });
}

router.get("/overview", asyncHandler(async (req, res) => {
  const parsed = periodSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Хугацааг 14, 30 эсвэл 90 хоногоор сонгоно уу" });
  const systemRoles = new Set(req.user.system_roles || []);
  const allowed = systemRoles.has("owner") || ["director", "chief_engineer", "accountant"].includes(req.user.role);
  if (!allowed) return res.status(403).json({ error: "Чиг хандлагын мэдээлэл харах эрх хүрэлцэхгүй байна" });

  const org = req.user.organization_id, days = parsed.data.days;
  const enabled = new Set(req.user.enabled_modules || []);
  const operationsAccess = systemRoles.has("owner") || ["director", "chief_engineer"].includes(req.user.role);
  const peopleAccess = systemRoles.has("owner") || req.user.role === "director";
  const financeAccess = systemRoles.has("owner") || ["director", "accountant"].includes(req.user.role);
  const pool = getPool();
  const [work, workTrend, attendance, camera, lighting, safety, inventory, finance, obligations] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER(WHERE created_at>=CURRENT_DATE-make_interval(days=>$2))::int AS created_current,
      count(*) FILTER(WHERE created_at>=CURRENT_DATE-make_interval(days=>$2*2) AND created_at<CURRENT_DATE-make_interval(days=>$2))::int AS created_previous,
      count(*) FILTER(WHERE status IN('new','assigned','in_progress','pending_review') AND created_at>=CURRENT_DATE-make_interval(days=>$2))::int AS recent_open,
      count(*) FILTER(WHERE status IN('new','assigned','in_progress','pending_review') AND created_at<CURRENT_DATE-make_interval(days=>$2))::int AS historical_open,
      count(*) FILTER(WHERE due_at<now() AND created_at>=CURRENT_DATE-make_interval(days=>$2) AND status NOT IN('completed','cancelled'))::int AS overdue_recent,
      count(*) FILTER(WHERE priority='emergency' AND created_at>=CURRENT_DATE-make_interval(days=>$2) AND status NOT IN('completed','cancelled'))::int AS emergency_recent,
      count(*) FILTER(WHERE assigned_to IS NULL AND created_at>=CURRENT_DATE-make_interval(days=>$2) AND status NOT IN('completed','cancelled'))::int AS unassigned_recent,
      (SELECT count(*) FROM work_order_events e WHERE e.organization_id=$1 AND e.event_type='status_changed' AND e.to_status='completed' AND e.created_at>=CURRENT_DATE-make_interval(days=>$2))::int AS completed_current,
      (SELECT count(*) FROM work_order_events e WHERE e.organization_id=$1 AND e.event_type='status_changed' AND e.to_status='completed' AND e.created_at>=CURRENT_DATE-make_interval(days=>$2*2) AND e.created_at<CURRENT_DATE-make_interval(days=>$2))::int AS completed_previous
      FROM work_orders WHERE organization_id=$1`, [org, days]),
    pool.query(`SELECT to_char(day,'MM-DD') AS day,COALESCE(created,0)::int AS created,COALESCE(completed,0)::int AS completed
      FROM generate_series(CURRENT_DATE-make_interval(days=>$2-1),CURRENT_DATE,interval '1 day') day
      LEFT JOIN(SELECT date(created_at) d,count(*) created FROM work_orders WHERE organization_id=$1 AND created_at>=CURRENT_DATE-make_interval(days=>$2-1) GROUP BY 1)c ON c.d=day
      LEFT JOIN(SELECT date(created_at) d,count(*) completed FROM work_order_events WHERE organization_id=$1 AND event_type='status_changed' AND to_status='completed' AND created_at>=CURRENT_DATE-make_interval(days=>$2-1) GROUP BY 1)x ON x.d=day
      ORDER BY day`, [org, days]),
    pool.query(`SELECT
      count(*) FILTER(WHERE attendance_date>=CURRENT_DATE-make_interval(days=>$2))::int AS records_current,
      count(*) FILTER(WHERE attendance_date>=CURRENT_DATE-make_interval(days=>$2) AND status IN('worked','late','remote'))::int AS present_current,
      count(*) FILTER(WHERE attendance_date>=CURRENT_DATE-make_interval(days=>$2) AND status='late')::int AS late_current,
      count(*) FILTER(WHERE attendance_date>=CURRENT_DATE-make_interval(days=>$2*2) AND attendance_date<CURRENT_DATE-make_interval(days=>$2))::int AS records_previous,
      count(*) FILTER(WHERE attendance_date>=CURRENT_DATE-make_interval(days=>$2*2) AND attendance_date<CURRENT_DATE-make_interval(days=>$2) AND status IN('worked','late','remote'))::int AS present_previous,
      (SELECT count(*) FROM employees WHERE organization_id=$1 AND active)::int AS active_employees
      FROM attendance_records WHERE organization_id=$1`, [org, days]),
    pool.query(`SELECT
      count(*)::int AS locations,
      COALESCE(sum(CASE WHEN metadata->>'cameraCount' ~ '^[0-9]+$' THEN (metadata->>'cameraCount')::int ELSE 0 END),0)::int AS devices,
      COALESCE(sum(CASE WHEN metadata->>'brokenCount' ~ '^[0-9]+$' THEN (metadata->>'brokenCount')::int ELSE 0 END),0)::int AS broken,
      (SELECT count(*) FROM operational_incidents WHERE organization_id=$1 AND domain='camera' AND reported_at>=CURRENT_DATE-make_interval(days=>$2))::int AS reported_current,
      (SELECT count(*) FROM operational_incidents WHERE organization_id=$1 AND domain='camera' AND reported_at>=CURRENT_DATE-make_interval(days=>$2*2) AND reported_at<CURRENT_DATE-make_interval(days=>$2))::int AS reported_previous,
      (SELECT count(*) FROM operational_incident_events e JOIN operational_incidents i ON i.organization_id=e.organization_id AND i.id=e.incident_id WHERE e.organization_id=$1 AND i.domain='camera' AND e.event_type='resolved' AND e.occurred_at>=CURRENT_DATE-make_interval(days=>$2))::int AS resolved_current
      FROM operational_objects WHERE organization_id=$1 AND domain='camera' AND status<>'retired'`, [org, days]),
    pool.query(`SELECT count(*) FILTER(WHERE status IN('open','in_progress'))::int AS open_now,
      COALESCE(sum(affected_quantity-resolved_quantity) FILTER(WHERE status IN('open','in_progress')),0)::int AS affected_now,
      count(*) FILTER(WHERE reported_at>=CURRENT_DATE-make_interval(days=>$2))::int AS reported_current,
      count(*) FILTER(WHERE reported_at>=CURRENT_DATE-make_interval(days=>$2*2) AND reported_at<CURRENT_DATE-make_interval(days=>$2))::int AS reported_previous,
      (SELECT count(*) FROM operational_incident_events e JOIN operational_incidents i ON i.organization_id=e.organization_id AND i.id=e.incident_id WHERE e.organization_id=$1 AND i.domain='lighting' AND e.event_type='resolved' AND e.occurred_at>=CURRENT_DATE-make_interval(days=>$2))::int AS resolved_current
      FROM operational_incidents WHERE organization_id=$1 AND domain='lighting'`, [org, days]),
    pool.query(`SELECT count(*) FILTER(WHERE status<>'closed')::int AS open_now,
      count(*) FILTER(WHERE status<>'closed' AND risk_score>=17)::int AS critical_now,
      count(*) FILTER(WHERE created_at>=CURRENT_DATE-make_interval(days=>$2))::int AS reported_current,
      count(*) FILTER(WHERE created_at>=CURRENT_DATE-make_interval(days=>$2*2) AND created_at<CURRENT_DATE-make_interval(days=>$2))::int AS reported_previous,
      count(*) FILTER(WHERE closed_at>=CURRENT_DATE-make_interval(days=>$2))::int AS closed_current
      FROM safety_risks WHERE organization_id=$1`, [org, days]),
    pool.query(`SELECT count(*) FILTER(WHERE minimum_stock>0 AND total_quantity<minimum_stock)::int AS low_stock,
      count(*) FILTER(WHERE minimum_stock>0)::int AS threshold_configured,count(*)::int AS item_count,
      COALESCE(sum(total_quantity*unit_cost),0)::numeric AS inventory_value
      FROM (SELECT i.id,i.minimum_stock,i.unit_cost,COALESCE(sum(b.quantity),0) total_quantity FROM inventory_items i
      LEFT JOIN inventory_balances b ON b.organization_id=i.organization_id AND b.item_id=i.id
      WHERE i.organization_id=$1 GROUP BY i.id) q`, [org]),
    pool.query(`SELECT
      COALESCE(sum(amount) FILTER(WHERE transaction_type='income' AND transaction_date>=CURRENT_DATE-make_interval(days=>$2)),0)::numeric AS income_current,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='expense' AND transaction_date>=CURRENT_DATE-make_interval(days=>$2)),0)::numeric AS expense_current,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='income' AND transaction_date>=CURRENT_DATE-make_interval(days=>$2*2) AND transaction_date<CURRENT_DATE-make_interval(days=>$2)),0)::numeric AS income_previous,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='expense' AND transaction_date>=CURRENT_DATE-make_interval(days=>$2*2) AND transaction_date<CURRENT_DATE-make_interval(days=>$2)),0)::numeric AS expense_previous,
      count(*) FILTER(WHERE transaction_date>=CURRENT_DATE-make_interval(days=>$2))::int AS transactions_current
      FROM finance_transactions WHERE organization_id=$1`, [org, days]),
    pool.query(`SELECT
      COALESCE(sum(total_amount-settled_amount) FILTER(WHERE direction='payable' AND status IN('open','partial')),0)::numeric AS payable_open,
      COALESCE(sum(total_amount-settled_amount) FILTER(WHERE direction='receivable' AND status IN('open','partial')),0)::numeric AS receivable_open
      FROM finance_obligations WHERE organization_id=$1`, [org])
  ]);

  const rows = {
    work: numberRow(work.rows[0]), attendance: numberRow(attendance.rows[0]), camera: numberRow(camera.rows[0]),
    lighting: numberRow(lighting.rows[0]), safety: numberRow(safety.rows[0]), inventory: numberRow(inventory.rows[0]),
    finance: numberRow(finance.rows[0]), obligations: numberRow(obligations.rows[0])
  };
  rows.attendance.rate_current = rows.attendance.records_current ? Math.round(rows.attendance.present_current / rows.attendance.records_current * 100) : null;
  rows.attendance.rate_previous = rows.attendance.records_previous ? Math.round(rows.attendance.present_previous / rows.attendance.records_previous * 100) : null;
  rows.finance.net_current = rows.finance.income_current - rows.finance.expense_current;
  rows.finance.net_previous = rows.finance.income_previous - rows.finance.expense_previous;

  const sections = {};
  if (operationsAccess && enabled.has("work-orders")) sections.work = rows.work;
  if (peopleAccess && enabled.has("attendance")) sections.attendance = rows.attendance;
  if (operationsAccess && enabled.has("camera-operations")) sections.camera = rows.camera;
  if (operationsAccess && enabled.has("lighting-operations")) sections.lighting = rows.lighting;
  if (operationsAccess && enabled.has("safety")) sections.safety = rows.safety;
  if (financeAccess && enabled.has("inventory")) sections.inventory = rows.inventory;
  if (financeAccess && enabled.has("finance")) sections.finance = { ...rows.finance, ...rows.obligations };

  const alerts = [];
  if (sections.work) {
    addAlert(alerts, rows.work.emergency_recent > 0, "critical", "Ажлын самбар", `${rows.work.emergency_recent} яаралтай ажил энэ хугацаанд нээлттэй байна`, "work-orders");
    addAlert(alerts, rows.work.overdue_recent > 0, "warning", "Ажлын самбар", `${rows.work.overdue_recent} шинэ ажил хугацаа хэтэрсэн`, "work-orders");
    addAlert(alerts, rows.work.unassigned_recent > 0, "warning", "Ажлын самбар", `${rows.work.unassigned_recent} ажил хариуцагчгүй байна`, "work-orders");
    addAlert(alerts, rows.work.historical_open > 0, "info", "Өгөгдлийн тулгалт", `${rows.work.historical_open} өмнөх ажлын төлөвийг тусад нь баталгаажуулна`, "work-orders");
  }
  if (sections.camera) addAlert(alerts, rows.camera.broken > 0, "warning", "Камер", `${rows.camera.broken} камер ажиллагаагүй гэж бүртгэгдсэн`, "camera");
  if (sections.lighting) addAlert(alerts, rows.lighting.open_now > 0, "warning", "Гэрэлтүүлэг", `${rows.lighting.open_now} гэмтэл нээлттэй, ${rows.lighting.affected_now} нэгжид нөлөөлсөн`, "lighting");
  if (sections.safety) addAlert(alerts, rows.safety.critical_now > 0, "critical", "ХАБЭА", `${rows.safety.critical_now} өндөр эрсдэл нээлттэй байна`, "safety");
  if (sections.inventory) addAlert(alerts, rows.inventory.low_stock > 0, "warning", "Нярав", `${rows.inventory.low_stock} материал тохируулсан доод үлдэгдлээс багассан`, "inventory");
  const priority = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => priority[a.level] - priority[b.level]);

  res.json({
    generatedAt: new Date().toISOString(),
    period: { days, currentFrom: new Date(Date.now() - days * 86400000).toISOString(), previousDays: days },
    scope: { operations: operationsAccess, people: peopleAccess, finance: financeAccess },
    sections, workTrend: sections.work ? workTrend.rows : [], alerts
  });
}));

module.exports = router;
