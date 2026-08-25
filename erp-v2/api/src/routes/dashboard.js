"use strict";

const express = require("express");
const { getPool } = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate);

function organizationScale(employeeCount) {
  const count = Number(employeeCount || 0);
  if (count <= 9) return { code: "micro", label: "Цомхон баг", mode: "essential" };
  if (count <= 49) return { code: "small", label: "Өсөж буй байгууллага", mode: "focused" };
  if (count <= 249) return { code: "medium", label: "Дунд байгууллага", mode: "departmental" };
  return { code: "large", label: "Том байгууллага", mode: "enterprise" };
}

function addAlert(alerts, condition, level, module, message, view) {
  if (condition) alerts.push({ level, module, message, view });
}

router.get("/overview", asyncHandler(async (req, res) => {
  const pool = getPool();
  const org = req.user.organization_id;
  const enabled = new Set(req.user.enabled_modules || []);
  const systemRoles = new Set(req.user.system_roles || []);
  const permissions = new Set(req.user.permissions || []);
  const management = systemRoles.has("owner") || systemRoles.has("administrator") || ["director", "chief_engineer", "accountant"].includes(req.user.role);
  const hrAccess = management || req.user.role === "hr" || permissions.has("hr.manage");

  const [people, attendance, hrSignals, work, assets, inventory, maintenance, procurement, finance, setup] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE e.active)::int AS active,
      count(*) FILTER(WHERE NOT e.active)::int AS inactive,
      count(*) FILTER(WHERE e.active AND (ep.employee_id IS NULL OR NULLIF(ep.phone,'') IS NULL OR ep.hire_date IS NULL))::int AS incomplete_profiles,
      count(DISTINCT e.department_id) FILTER(WHERE e.active AND e.department_id IS NOT NULL)::int AS staffed_departments
      FROM employees e LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
      WHERE e.organization_id=$1`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE status='worked')::int AS worked,
      count(*) FILTER(WHERE status='late')::int AS late,
      count(*) FILTER(WHERE status='absent')::int AS absent,
      count(*) FILTER(WHERE status IN('leave','sick','vacation'))::int AS away,
      count(*)::int AS recorded
      FROM attendance_records WHERE organization_id=$1 AND attendance_date=CURRENT_DATE`, [org]),
    pool.query(`SELECT
      (SELECT count(*) FROM hr_leave_requests WHERE organization_id=$1 AND status='pending')::int AS pending_leave,
      (SELECT count(*) FROM attendance_correction_requests WHERE organization_id=$1 AND status='pending')::int AS pending_corrections,
      (SELECT count(*) FROM employment_contracts c WHERE c.organization_id=$1 AND c.status='active' AND c.ends_on BETWEEN CURRENT_DATE AND CURRENT_DATE+30
        AND NOT EXISTS(SELECT 1 FROM employment_contracts newer WHERE newer.organization_id=c.organization_id AND newer.contract_key=c.contract_key AND newer.version_no>c.version_no))::int AS contracts_expiring,
      (SELECT count(*) FROM employee_skills WHERE organization_id=$1 AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE+30)::int AS certificates_expiring,
      (SELECT count(*) FROM employee_transition_checklists WHERE organization_id=$1 AND status='open')::int AS open_transitions`, [org]),
    pool.query(`SELECT
      count(*) FILTER(WHERE status IN('new','assigned','in_progress','pending_review'))::int AS open,
      count(*) FILTER(WHERE assigned_to=$2 AND status IN('new','assigned','in_progress','pending_review'))::int AS mine,
      count(*) FILTER(WHERE priority='emergency' AND status NOT IN('completed','cancelled'))::int AS emergency,
      count(*) FILTER(WHERE due_at<now() AND status NOT IN('completed','cancelled'))::int AS overdue,
      count(*) FILTER(WHERE assigned_to IS NULL AND status IN('new','assigned','in_progress','pending_review'))::int AS unassigned
      FROM work_orders WHERE organization_id=$1`, [org, req.user.id]),
    pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='repair')::int AS repair FROM assets WHERE organization_id=$1 AND COALESCE(metadata->>'excludedFromAssetMaster','false')<>'true'`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE total_quantity<=minimum_stock)::int AS low_stock,count(*)::int AS item_count
      FROM (SELECT i.id,i.minimum_stock,COALESCE(sum(b.quantity),0) total_quantity FROM inventory_items i
      LEFT JOIN inventory_balances b ON b.organization_id=i.organization_id AND b.item_id=i.id WHERE i.organization_id=$1 GROUP BY i.id) q`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE active AND next_due_date<CURRENT_DATE)::int AS overdue FROM maintenance_plans WHERE organization_id=$1`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE status='submitted')::int AS awaiting FROM purchase_requests WHERE organization_id=$1`, [org]),
    pool.query(`SELECT COALESCE(sum(amount) FILTER(WHERE transaction_type='income'),0)::numeric AS income,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='expense'),0)::numeric AS expense,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='receivable'),0)::numeric AS receivable
      FROM finance_transactions WHERE organization_id=$1 AND transaction_date>=date_trunc('month',CURRENT_DATE)`, [org]),
    pool.query(`SELECT
      (SELECT count(*) FROM departments WHERE organization_id=$1)::int AS departments,
      (SELECT count(*) FROM positions WHERE organization_id=$1)::int AS positions,
      (SELECT count(*) FROM employees WHERE organization_id=$1 AND active)::int AS employees,
      (SELECT count(*) FROM users WHERE organization_id=$1 AND active AND can_login)::int AS login_accounts`, [org])
  ]);

  const data = {
    people: people.rows[0], attendance: attendance.rows[0], hr: hrSignals.rows[0],
    work: work.rows[0], assets: assets.rows[0], inventory: inventory.rows[0],
    maintenance: maintenance.rows[0], procurement: procurement.rows[0], finance: finance.rows[0]
  };
  const scale = organizationScale(data.people.active);
  const setupData = setup.rows[0];
  const setupSteps = [
    { code: "organization", label: "Байгууллагын мэдээлэл", complete: true, tab: "organization" },
    { code: "structure", label: "Бүтэц ба албан тушаал", complete: setupData.departments > 0 && setupData.positions > 0, tab: "structure" },
    { code: "employees", label: "Ажилтны үндсэн бүртгэл", complete: setupData.employees > 0, view: hrAccess && enabled.has("hr") ? "hr" : "employees" },
    { code: "access", label: "Нэвтрэх эрх", complete: setupData.login_accounts > 0, tab: "access" }
  ];

  const metrics = [];
  if (management || hrAccess) metrics.push({ code: "people", label: "Идэвхтэй ажилтан", value: data.people.active, note: `${data.people.staffed_departments} нэгжид ажиллаж байна`, tone: "blue", view: hrAccess && enabled.has("hr") ? "hr" : "employees" });
  if (enabled.has("attendance") && hrAccess) metrics.push({ code: "attendance", label: "Өнөөдрийн ирц", value: data.attendance.recorded, note: `${data.attendance.late} хоцорсон · ${data.attendance.absent} тасалсан · ${data.attendance.away} чөлөөтэй`, tone: Number(data.attendance.absent) || Number(data.attendance.late) ? "amber" : "green", view: "attendance" });
  if (enabled.has("work-orders")) metrics.push({ code: "work", label: management ? "Нээлттэй ажил" : "Миний нээлттэй ажил", value: management ? data.work.open : data.work.mine, note: `${data.work.emergency} яаралтай · ${data.work.overdue} хэтэрсэн`, tone: Number(data.work.emergency) || Number(data.work.overdue) ? "red" : "green", view: "work-orders" });
  if (enabled.has("assets") && (management || ["chief_engineer","engineer","electric","camera_engineer","storekeeper"].includes(req.user.role))) metrics.push({ code: "assets", label: "Хөрөнгө", value: data.assets.total, note: `${data.assets.repair} засварт`, tone: Number(data.assets.repair) ? "amber" : "blue", view: "assets" });
  if (enabled.has("inventory") && management) metrics.push({ code: "inventory", label: "Агуулахын эрсдэл", value: data.inventory.low_stock, note: `${data.inventory.item_count} нэр төрлөөс`, tone: Number(data.inventory.low_stock) ? "red" : "green", view: "inventory" });
  if (enabled.has("finance") && management) metrics.push({ code: "finance", label: "Сарын цэвэр урсгал", value: Number(data.finance.income)-Number(data.finance.expense), format: "money", note: `Авлага MNT ${Number(data.finance.receivable).toLocaleString()}`, tone: Number(data.finance.income)-Number(data.finance.expense) < 0 ? "red" : "green", view: "finance" });

  const alerts = [];
  addAlert(alerts, enabled.has("work-orders") && Number(data.work.emergency)>0, "critical", "Ажил", `${data.work.emergency} яаралтай ажил нээлттэй байна`, "work-orders");
  addAlert(alerts, enabled.has("work-orders") && Number(data.work.overdue)>0, "warning", "Ажил", `${data.work.overdue} ажил хугацаа хэтэрсэн`, "work-orders");
  addAlert(alerts, management && enabled.has("work-orders") && Number(data.work.unassigned)>0, "warning", "Ажил", `${data.work.unassigned} нээлттэй ажил хариуцагчгүй байна`, "work-orders");
  addAlert(alerts, hrAccess && Number(data.hr.pending_leave)>0, "info", "Хүний нөөц", `${data.hr.pending_leave} чөлөөний хүсэлт шийдвэр хүлээж байна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.pending_corrections)>0, "warning", "Хүний нөөц", `${data.hr.pending_corrections} ирцийн залруулга шийдвэр хүлээж байна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.contracts_expiring)>0, "warning", "Хүний нөөц", `${data.hr.contracts_expiring} гэрээ 30 хоногт дуусна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.certificates_expiring)>0, "warning", "Хүний нөөц", `${data.hr.certificates_expiring} ур чадварын гэрчилгээ 30 хоногт дуусна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.open_transitions)>0, "info", "Хүний нөөц", `${data.hr.open_transitions} ажилд авах/гарах checklist нээлттэй байна`, "hr");
  addAlert(alerts, hrAccess && Number(data.people.incomplete_profiles)>0, "info", "Хүний нөөц", `${data.people.incomplete_profiles} ажилтны профайл дутуу байна`, "hr");
  addAlert(alerts, management && enabled.has("inventory") && Number(data.inventory.low_stock)>0, "warning", "Агуулах", `${data.inventory.low_stock} бараа доод үлдэгдэлд хүрсэн`, "inventory");
  addAlert(alerts, management && enabled.has("maintenance") && Number(data.maintenance.overdue)>0, "warning", "Засвар", `${data.maintenance.overdue} засварын төлөвлөгөө хэтэрсэн`, "maintenance");
  addAlert(alerts, management && enabled.has("procurement") && Number(data.procurement.awaiting)>0, "info", "Худалдан авалт", `${data.procurement.awaiting} хүсэлт шийдвэр хүлээж байна`, "procurement");

  const penalty = alerts.reduce((sum, item) => sum + ({ critical: 12, warning: 5, info: 1 }[item.level] || 0), 0);
  res.json({
    generatedAt: new Date().toISOString(), scope: management ? "organization" : "personal",
    scale, metrics, alerts, health: { score: Math.max(0, 100-penalty), basis: "Бодит, шийдээгүй анхааруулгын түвшнээр тооцсон" },
    setup: { complete: setupSteps.every(item => item.complete), completed: setupSteps.filter(item => item.complete).length, total: setupSteps.length, steps: setupSteps },
    enabledModules: [...enabled], hr: hrAccess ? data.hr : undefined
  });
}));

module.exports = router;
module.exports.organizationScale = organizationScale;
