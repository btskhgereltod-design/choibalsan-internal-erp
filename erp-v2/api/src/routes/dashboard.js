"use strict";

const express = require("express");
const { getPool, withTenantTransaction } = require("../db");
const { authenticate } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate);

function organizationScale(employeeCount) {
  const count = Number(employeeCount || 0);
  if (count <= 9) return { code: "micro", mode: "essential" };
  if (count <= 49) return { code: "small", mode: "focused" };
  if (count <= 249) return { code: "medium", mode: "departmental" };
  return { code: "large", mode: "enterprise" };
}

function addAlert(alerts, condition, level, module, message, view, detail = {}) {
  if (condition) alerts.push({ level, module, message, view, ...detail });
}

const recordsReadPermissions = ["records.read", "records.register", "records.assign", "records.process", "records.response.approve", "records.response.send", "records.manage"];
const hrReadPermissions = ["hr.manage", "hr.appointment.manage", "hr.appointment.finalize", "hr.leave.manage", "hr.leave.approve", "hr.exit.manage", "hr.exit.finalize", "hr.transfer.read", "hr.transfer.manage", "hr.transfer.review", "hr.transfer.decide", "hr.transfer.implement"];

function activityText(kind, action, row) {
  const labels = {
    work: { created: "Шинэ ажил бүртгэв", assigned: "Ажлын хариуцагч өөрчлөв", status_changed: "Ажлын төлөв өөрчлөв", note: "Ажлын мэдээлэл шинэчлэв" },
    records: { created: "Албан бичиг бүртгэв", assigned: "Албан бичиг хуваарилав", start: "Албан бичгийг шийдвэрлэж эхлэв", submit_response: "Хариу хяналтад шилжүүлэв", approve_response: "Хариуг батлав", return: "Албан бичгийг буцаав", reject_response: "Хариуг буцаав", send_response: "Албан бичгийн хариуг илгээв", close: "Албан бичгийг хаав", archive: "Албан бичгийг архивлав", cancel: "Албан бичгийг цуцлав" },
    hr: { hired: "Ажилтан томилов", contract_renewed: "Гэрээ шинэчлэв", position_changed: "Албан тушаал өөрчлөв", department_changed: "Харьяалах нэгж өөрчлөв", leave_started: "Чөлөө эхлэв", leave_ended: "Чөлөө дуусав", suspended: "Ажил эрхлэлт түдгэлзэв", terminated: "Ажил эрхлэлт дуусав", note: "Хүний нөөцийн мэдээлэл шинэчлэв" },
    inventory: { receipt: "Бараа материал орлогодов", issue: "Бараа материал олгов", transfer: "Бараа материал шилжүүлэв", adjustment_in: "Тооллогын нэмэгдэл бүртгэв", adjustment_out: "Тооллогын хорогдол бүртгэв" },
    finance: { created: "Өглөг, авлага бүртгэв", settlement_recorded: "Төлбөрийн хаалт бүртгэв", cancelled: "Өглөг, авлагыг цуцлав", reviewed: "Материалын олголтыг тулгав", reclassified: "Материалын ангиллыг шинэчлэв", income: "Орлогын гүйлгээ импортлов", expense: "Зарлагын гүйлгээ импортлов", receivable: "Авлагын гүйлгээ импортлов", payable: "Өглөгийн гүйлгээ импортлов", transfer: "Шилжүүлгийн гүйлгээ импортлов", adjustment: "Залруулгын гүйлгээ импортлов" }
  };
  const workStates = { new: "Шинэ", assigned: "Хуваарилсан", in_progress: "Хийгдэж байна", pending_review: "Хяналт хүлээж байна", completed: "Дууссан", cancelled: "Цуцалсан" };
  if (kind === "work" && action === "status_changed" && row.from_state && row.to_state) return `${labels.work.status_changed}: ${workStates[row.from_state] || row.from_state} → ${workStates[row.to_state] || row.to_state}`;
  return labels[kind]?.[action] || `${row.module_name} мэдээлэл шинэчлэгдэв`;
}

async function loadActivityFeed({ organizationId, userId, enabled, permissions, management }) {
  return withTenantTransaction(organizationId, async client => {
    const tasks = [];
    if (enabled.has("work-orders") && (permissions.has("work-orders.read") || permissions.has("work-orders.read-all"))) tasks.push(
      () => client.query(`SELECT ('work:'||e.id)::text id,'work' kind,'Ажлын самбар' module_name,w.title subject,e.event_type action,
          e.from_status from_state,e.to_status to_state,COALESCE(u.full_name,'Систем') actor_name,e.created_at occurred_at,'work-orders' view
        FROM work_order_events e JOIN work_orders w ON w.organization_id=e.organization_id AND w.id=e.work_order_id
        LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
        WHERE e.organization_id=$1 AND ($3::boolean OR w.created_by=$2 OR w.assigned_to=$2 OR e.actor_user_id=$2)
        ORDER BY e.created_at DESC,e.id DESC LIMIT 8`, [organizationId, userId, management || permissions.has("work-orders.read-all")])
    );
    if (enabled.has("records") && recordsReadPermissions.some(code => permissions.has(code))) tasks.push(
      () => client.query(`SELECT ('records:'||e.id)::text id,'records' kind,'Бичиг хэрэг' module_name,
          concat(CASE c.direction WHEN 'incoming' THEN 'Ирсэн' WHEN 'outgoing' THEN 'Явсан' ELSE 'Дотоод' END,' · ',
            CASE WHEN c.confidentiality IN('confidential','restricted') THEN 'Нууцлалтай албан бичгийн хөдөлгөөн' ELSE c.subject END) subject,
          e.event_type action,e.from_state,e.to_state,u.full_name actor_name,e.created_at occurred_at,'records' view
        FROM correspondence_events e JOIN correspondence_records c ON c.organization_id=e.organization_id AND c.id=e.correspondence_id
        JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
        WHERE e.organization_id=$1 AND (c.confidentiality<>'restricted' OR $2::boolean)
        ORDER BY e.created_at DESC,e.id DESC LIMIT 8`, [organizationId, permissions.has("documents.restricted.read")])
    );
    if (enabled.has("hr") && hrReadPermissions.some(code => permissions.has(code))) tasks.push(
      () => client.query(`SELECT ('hr:'||ev.id)::text id,'hr' kind,'Хүний нөөц' module_name,ev.title subject,ev.event_type action,
          NULL::text from_state,NULL::text to_state,u.full_name actor_name,ev.created_at occurred_at,'hr' view
        FROM employee_events ev JOIN users u ON u.organization_id=ev.organization_id AND u.id=ev.created_by
        WHERE ev.organization_id=$1 ORDER BY ev.created_at DESC,ev.id DESC LIMIT 8`, [organizationId])
    );
    if (enabled.has("inventory") && permissions.has("inventory.read")) tasks.push(
      () => client.query(`SELECT ('inventory:'||m.id)::text id,'inventory' kind,'Нярав' module_name,
          concat(i.name,' · ',trim(to_char(m.quantity,'FM999999999999990.######')),' ',i.unit) subject,m.movement_type action,
          NULL::text from_state,NULL::text to_state,COALESCE(u.full_name,'Систем') actor_name,m.created_at occurred_at,'inventory' view
        FROM stock_movements m JOIN inventory_items i ON i.organization_id=m.organization_id AND i.id=m.item_id
        LEFT JOIN users u ON u.organization_id=m.organization_id AND u.id=m.created_by
        WHERE m.organization_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 8`, [organizationId])
    );
    if (enabled.has("finance") && permissions.has("finance.read")) tasks.push(
      () => client.query(`SELECT * FROM (
          SELECT ('finance-obligation:'||e.id)::text id,'finance' kind,'Санхүү, бүртгэл' module_name,
            concat(CASE WHEN o.direction='payable' THEN 'Өглөг' ELSE 'Авлага' END,' · ',o.document_no) subject,e.action,
            NULL::text from_state,NULL::text to_state,u.full_name actor_name,e.created_at occurred_at,'finance' view
          FROM finance_obligation_events e JOIN finance_obligations o ON o.organization_id=e.organization_id AND o.id=e.obligation_id
          JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id WHERE e.organization_id=$1
          UNION ALL
          SELECT ('finance-material:'||e.id)::text,'finance','Санхүү, бүртгэл',concat('Материалын тулгалт · ',r.document_reference),e.action,
            NULL::text,NULL::text,u.full_name,e.created_at,'finance'
          FROM accounting_material_review_events e JOIN accounting_material_reviews r ON r.organization_id=e.organization_id AND r.id=e.review_id
          JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id WHERE e.organization_id=$1
          UNION ALL
          SELECT ('finance-transaction:'||t.id)::text,'finance','Санхүү, бүртгэл',
            concat(COALESCE(NULLIF(t.reference,''),'Гүйлгээ'),' · ',trim(to_char(t.amount,'FM999999999999990.00')),' ',t.currency),t.transaction_type,
            NULL::text,NULL::text,u.full_name,t.imported_at,'finance'
          FROM finance_transactions t JOIN finance_import_jobs j ON j.organization_id=t.organization_id AND j.id=t.import_job_id
          JOIN users u ON u.organization_id=j.organization_id AND u.id=j.created_by WHERE t.organization_id=$1
        ) q ORDER BY occurred_at DESC,id DESC LIMIT 8`, [organizationId])
    );
    if (!tasks.length) return [];
    const results = [];
    for (const task of tasks) results.push(await task());
    const rows = results.flatMap(result => result.rows);
    return rows.sort((a, b) => new Date(b.occurred_at)-new Date(a.occurred_at)).slice(0, 12).map(row => ({
      id: row.id, kind: row.kind, module: row.module_name, title: activityText(row.kind, row.action, row),
      subject: row.subject, actor: row.actor_name, occurredAt: row.occurred_at, view: row.view
    }));
  });
}

router.get("/overview", asyncHandler(async (req, res) => {
  const pool = getPool();
  const org = req.user.organization_id;
  const enabled = new Set(req.user.enabled_modules || []);
  const systemRoles = new Set(req.user.system_roles || []);
  const permissions = new Set(req.user.permissions || []);
  const management = systemRoles.has("owner") || systemRoles.has("administrator") || ["director", "chief_engineer"].includes(req.user.role);
  const hrAccess = management || req.user.role === "hr" || permissions.has("hr.manage");
  const engineeringAccess = management || ["engineer", "electric", "camera_engineer", "safety", "worker"].includes(req.user.role);

  const [people, attendance, hrSignals, work, assets, inventory, maintenance, procurement, finance, obligations, camera, lighting, safety, setup, reportSchedules, lightingOverview, cameraOverview] = await Promise.all([
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
      count(*) FILTER(WHERE status='remote')::int AS remote,
      count(*) FILTER(WHERE status='leave')::int AS leave,
      count(*) FILTER(WHERE status='sick')::int AS sick,
      count(*) FILTER(WHERE status='vacation')::int AS vacation,
      count(*) FILTER(WHERE status IN('leave','sick','vacation'))::int AS away,
      COALESCE(sum(overtime_hours),0)::numeric AS overtime_hours,
      count(*)::int AS recorded
      FROM attendance_records attendance
      CROSS JOIN (SELECT timezone FROM organizations WHERE id=$1) organization
      WHERE attendance.organization_id=$1
        AND attendance.attendance_date=(now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))::date`, [org]),
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
      count(*) FILTER(WHERE assigned_to=$2 AND created_at>=now()-interval '30 days' AND status IN('new','assigned','in_progress','pending_review'))::int AS mine_recent,
      count(*) FILTER(WHERE assigned_to=$2 AND priority='emergency' AND created_at>=now()-interval '30 days' AND status NOT IN('completed','cancelled'))::int AS mine_emergency_recent,
      count(*) FILTER(WHERE assigned_to=$2 AND due_at<now() AND created_at>=now()-interval '30 days' AND status NOT IN('completed','cancelled'))::int AS mine_overdue_recent,
      count(*) FILTER(WHERE assigned_to=$2 AND due_at::date=(now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))::date AND status NOT IN('completed','cancelled'))::int AS mine_due_today,
      count(*) FILTER(WHERE assigned_to=$2 AND status='pending_review')::int AS mine_pending_review,
      count(*) FILTER(WHERE assigned_to=$2 AND status='completed' AND updated_at>=date_trunc('month',(now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))))::int AS mine_completed_month,
      count(*) FILTER(WHERE priority='emergency' AND created_at>=now()-interval '30 days' AND status NOT IN('completed','cancelled'))::int AS emergency_recent,
      count(*) FILTER(WHERE due_at<now() AND created_at>=now()-interval '30 days' AND status NOT IN('completed','cancelled'))::int AS overdue_recent,
      count(*) FILTER(WHERE assigned_to IS NULL AND created_at>=now()-interval '30 days' AND status IN('new','assigned','in_progress','pending_review'))::int AS unassigned_recent,
      count(*) FILTER(WHERE created_at>=now()-interval '30 days' AND status IN('new','assigned','in_progress','pending_review'))::int AS recent_open,
      count(*) FILTER(WHERE created_at<now()-interval '30 days' AND status IN('new','assigned','in_progress','pending_review'))::int AS historical_open,
      count(*) FILTER(WHERE created_at>=date_trunc('year',(now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))))::int AS total_year,
      count(*) FILTER(WHERE created_at>=date_trunc('year',(now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))) AND status='completed')::int AS completed_year
      FROM work_orders work_order
      CROSS JOIN (SELECT timezone FROM organizations WHERE id=$1) organization
      WHERE work_order.organization_id=$1`, [org, req.user.id]),
    pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='repair')::int AS repair
      FROM assets WHERE organization_id=$1 AND COALESCE(metadata->>'excludedFromAssetMaster','false')<>'true'`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE minimum_stock>0 AND total_quantity<minimum_stock)::int AS low_stock,
      count(*) FILTER(WHERE total_quantity>0)::int AS positive_stock,
      count(*) FILTER(WHERE total_quantity=0)::int AS zero_stock,
      count(*) FILTER(WHERE minimum_stock>0)::int AS minimum_configured,
      count(*)::int AS item_count,COALESCE(sum(total_quantity*unit_cost),0)::numeric AS inventory_value
      FROM (SELECT i.id,i.minimum_stock,i.unit_cost,COALESCE(sum(b.quantity),0) total_quantity FROM inventory_items i
      LEFT JOIN inventory_balances b ON b.organization_id=i.organization_id AND b.item_id=i.id
      WHERE i.organization_id=$1 GROUP BY i.id) q`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE active AND next_due_date<CURRENT_DATE)::int AS overdue FROM maintenance_plans WHERE organization_id=$1`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE status='submitted')::int AS awaiting FROM purchase_requests WHERE organization_id=$1`, [org]),
    pool.query(`SELECT COALESCE(sum(amount) FILTER(WHERE transaction_type='income'),0)::numeric AS income,
      COALESCE(sum(amount) FILTER(WHERE transaction_type='expense'),0)::numeric AS expense,
      count(*)::int AS transaction_count
      FROM finance_transactions WHERE organization_id=$1 AND transaction_date>=date_trunc('month',CURRENT_DATE)`, [org]),
    pool.query(`SELECT
      COALESCE(sum(total_amount-settled_amount) FILTER(WHERE direction='payable' AND status IN('open','partial')),0)::numeric AS payable_open,
      COALESCE(sum(total_amount-settled_amount) FILTER(WHERE direction='receivable' AND status IN('open','partial')),0)::numeric AS receivable_open
      FROM finance_obligations WHERE organization_id=$1`, [org]),
    pool.query(`SELECT count(*)::int AS locations,
      COALESCE(sum(CASE WHEN metadata->>'cameraCount' ~ '^[0-9]+$' THEN (metadata->>'cameraCount')::int ELSE 0 END),0)::int AS devices,
      COALESCE(sum(CASE WHEN metadata->>'brokenCount' ~ '^[0-9]+$' THEN (metadata->>'brokenCount')::int ELSE 0 END),0)::int AS broken
      FROM operational_objects WHERE organization_id=$1 AND domain='camera' AND status<>'retired'`, [org]),
    pool.query(`SELECT
      (SELECT count(*) FROM operational_objects WHERE organization_id=$1 AND domain='lighting' AND status<>'retired')::int AS objects,
      count(*) FILTER(WHERE status IN('open','in_progress'))::int AS open_incidents,
      COALESCE(sum(affected_quantity-resolved_quantity) FILTER(WHERE status IN('open','in_progress')),0)::int AS affected
      FROM operational_incidents WHERE organization_id=$1 AND domain='lighting'`, [org]),
    pool.query(`SELECT count(*) FILTER(WHERE status<>'closed')::int AS open_risks,
      count(*) FILTER(WHERE status<>'closed' AND risk_score>=17)::int AS critical_risks
      FROM safety_risks WHERE organization_id=$1`, [org]),
    pool.query(`SELECT
      (SELECT count(*) FROM departments WHERE organization_id=$1)::int AS departments,
      (SELECT count(*) FROM positions WHERE organization_id=$1)::int AS positions,
      (SELECT count(*) FROM employees WHERE organization_id=$1 AND active)::int AS employees,
      (SELECT count(*) FROM users WHERE organization_id=$1 AND active AND can_login)::int AS login_accounts`, [org]),
    permissions.has("report-schedules.read")
      ? pool.query(`SELECT
          count(*) FILTER(WHERE schedule.next_due<tenant_day.today)::int AS overdue,
          count(*) FILTER(WHERE schedule.next_due=tenant_day.today)::int AS due_today,
          count(*) FILTER(WHERE schedule.next_due>tenant_day.today
            AND schedule.next_due<=tenant_day.today+schedule.warn_days)::int AS upcoming
          FROM report_schedules schedule
          JOIN organizations organization ON organization.id=schedule.organization_id
          CROSS JOIN LATERAL (
            SELECT (now() AT TIME ZONE COALESCE(NULLIF(organization.timezone,''),'Asia/Ulaanbaatar'))::date AS today
          ) tenant_day
          WHERE schedule.organization_id=$1 AND schedule.active=true
            AND ($3::boolean OR schedule.responsible_user_id=$2)`, [org, req.user.id, management])
      : Promise.resolve({ rows: [{ overdue: 0, due_today: 0, upcoming: 0 }] }),
    enabled.has("lighting-operations") && engineeringAccess
      ? pool.query(`WITH classified AS (
          SELECT o.id,CASE
            WHEN o.source_table='sl_points' AND (
              COALESCE(NULLIF(o.metadata->>'legacyCode',''),NULLIF(source.source_snapshot->>'code','')) LIKE chr(1043)||chr(1058)||'-%'
              OR COALESCE(o.metadata->>'notes','')='Гудамжны гэрэлтүүлэг'
              OR EXISTS(SELECT 1 FROM operational_incidents marker WHERE marker.organization_id=o.organization_id
                AND marker.operational_object_id=o.id AND marker.incident_type='Авто замын гэрэл')) THEN 'road'
            WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN('Гэр хороолол','Гэр хорооллын гэрэл','??? ????????') THEN 'ger'
            WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN('Цамхаг','Цамхагийн гэрэл','??????') THEN 'tower'
          END code,
          COALESCE(spec.pole_count,
            CASE WHEN source.source_snapshot->>'lamp_count' ~ '^[0-9]+$' THEN (source.source_snapshot->>'lamp_count')::int END,
            CASE WHEN o.metadata->>'poleCount' ~ '^[0-9]+$' THEN (o.metadata->>'poleCount')::int END,0)::int poles,
          COALESCE(CASE WHEN spec.id IS NOT NULL THEN lamps.total_heads END,
            CASE WHEN source.source_snapshot->>'total_heads' ~ '^[0-9]+$' THEN (source.source_snapshot->>'total_heads')::int END,
            CASE WHEN source.source_snapshot->>'total_count' ~ '^[0-9]+$' THEN (source.source_snapshot->>'total_count')::int END,
            CASE WHEN o.metadata->>'totalHeadCount' ~ '^[0-9]+$' THEN (o.metadata->>'totalHeadCount')::int END,0)::int total,
          COALESCE(CASE WHEN source.source_snapshot->>'needs_poles' ~ '^[0-9]+$' THEN (source.source_snapshot->>'needs_poles')::int END,
            CASE WHEN o.metadata->>'replacementPoleCount' ~ '^[0-9]+$' THEN (o.metadata->>'replacementPoleCount')::int END,0)::int replacements
          FROM operational_objects o
          LEFT JOIN source_import_records source ON source.organization_id=o.organization_id AND source.source_system=o.source_system
            AND source.source_table=o.source_table AND source.source_id=o.source_id
          LEFT JOIN operational_object_specifications spec ON spec.organization_id=o.organization_id AND spec.id=o.current_specification_id
          LEFT JOIN LATERAL(SELECT COALESCE(sum(g.head_count),0)::int total_heads FROM operational_object_lamp_groups g
            WHERE g.organization_id=o.organization_id AND g.specification_id=spec.id) lamps ON true
          WHERE o.organization_id=$1 AND o.domain='lighting' AND o.status<>'retired'
            AND NOT (o.source_table='sl_points' AND (
              COALESCE(NULLIF(o.metadata->>'legacyCode',''),NULLIF(source.source_snapshot->>'code',''),'') LIKE chr(1043)||chr(1044)||'-%'
              OR COALESCE(o.metadata->>'notes','')='Гэрлэн дохио'))
        ), faults AS (
          SELECT CASE incident_type WHEN 'Авто замын гэрэл' THEN 'road' WHEN 'Гэр хорооллын гэрэл' THEN 'ger'
              WHEN 'Цамхагийн гэрэл' THEN 'tower' WHEN 'Гэрлэн дохио' THEN 'signal' END code,
            COALESCE(sum(GREATEST(affected_quantity-resolved_quantity,0)),0)::int faults
          FROM operational_incidents WHERE organization_id=$1 AND domain='lighting' AND status IN('open','in_progress')
          GROUP BY code
        ), grouped AS (
          SELECT code,count(*)::int locations,COALESCE(sum(poles),0)::int poles,COALESCE(sum(total),0)::int total,
            COALESCE(sum(replacements),0)::int replacements FROM classified WHERE code IS NOT NULL GROUP BY code
        ), signals AS (
          SELECT count(*)::int locations,count(*)::int total FROM assets WHERE organization_id=$1 AND category='Гэрлэн дохио'
            AND status<>'retired' AND COALESCE(metadata->>'excludedFromAssetMaster','false')<>'true'
        ) SELECT g.code,g.locations,g.poles,g.total,g.replacements,COALESCE(f.faults,0)::int faults
          FROM grouped g LEFT JOIN faults f ON f.code=g.code
          UNION ALL SELECT 'signal',s.locations,0,s.total,0,COALESCE(f.faults,0)::int FROM signals s LEFT JOIN faults f ON f.code='signal'
          UNION ALL SELECT 'unclassified',count(*)::int,0,0,0,0 FROM classified WHERE code IS NULL`, [org])
      : Promise.resolve({ rows: [] }),
    enabled.has("camera-operations") && engineeringAccess
      ? pool.query(`WITH object_totals AS (
          SELECT count(*)::int locations,COALESCE(sum(CASE WHEN spec.id IS NOT NULL THEN COALESCE(devices.camera_count,0)
              WHEN o.metadata->>'cameraCount' ~ '^[0-9]+$' THEN (o.metadata->>'cameraCount')::int ELSE 0 END),0)::int devices
          FROM operational_objects o
          LEFT JOIN operational_object_specifications spec ON spec.organization_id=o.organization_id
            AND spec.id=o.current_specification_id AND spec.profile_kind='camera'
          LEFT JOIN LATERAL(SELECT COALESCE(sum(d.quantity),0)::int camera_count FROM operational_object_camera_devices d
            WHERE d.organization_id=o.organization_id AND d.specification_id=spec.id) devices ON true
          WHERE o.organization_id=$1 AND o.domain='camera' AND o.status<>'retired'
        ), fault_totals AS (
          SELECT COALESCE(sum(GREATEST(affected_quantity-resolved_quantity,0)),0)::int broken
          FROM operational_incidents WHERE organization_id=$1 AND domain='camera' AND status IN('open','in_progress')
        ) SELECT o.locations,o.devices,GREATEST(o.devices-f.broken,0)::int active,f.broken,
          CASE WHEN o.devices>0 THEN round(GREATEST(o.devices-f.broken,0)::numeric/o.devices*100,1) ELSE 0 END availability
          FROM object_totals o CROSS JOIN fault_totals f`, [org])
      : Promise.resolve({ rows: [] })
  ]);

  const data = {
    people: people.rows[0], attendance: attendance.rows[0], hr: hrSignals.rows[0], work: work.rows[0],
    assets: assets.rows[0], inventory: inventory.rows[0], maintenance: maintenance.rows[0],
    procurement: procurement.rows[0], finance: finance.rows[0], obligations: obligations.rows[0],
    camera: camera.rows[0], lighting: lighting.rows[0], safety: safety.rows[0],
    reportSchedules: reportSchedules.rows[0], lightingOverview: lightingOverview.rows, cameraOverview: cameraOverview.rows[0]
  };
  let personal;
  if (req.user.employee_id) {
    const [identity, personalAttendance, personalRequests, departmentWork] = await Promise.all([
      pool.query(`SELECT e.id,e.full_name,e.department_id,d.name AS department_name,p.title AS position_title,
        ep.salary AS profile_salary,comp.base_salary AS approved_salary,comp.currency AS approved_currency
        FROM employees e
        LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
        LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
        LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
        LEFT JOIN LATERAL (
          SELECT base_salary,currency FROM employee_compensation_history c
          WHERE c.organization_id=e.organization_id AND c.employee_id=e.id AND c.approved_by IS NOT NULL
            AND c.effective_from<=CURRENT_DATE AND (c.effective_to IS NULL OR c.effective_to>=CURRENT_DATE)
          ORDER BY c.effective_from DESC,c.created_at DESC LIMIT 1
        ) comp ON true
        WHERE e.organization_id=$1 AND e.id=$2`, [org, req.user.employee_id]),
      pool.query(`SELECT
        max(status) FILTER(WHERE attendance_date=CURRENT_DATE) AS today_status,
        max(check_in) FILTER(WHERE attendance_date=CURRENT_DATE) AS check_in,
        max(check_out) FILTER(WHERE attendance_date=CURRENT_DATE) AS check_out,
        count(*) FILTER(WHERE attendance_date>=date_trunc('month',CURRENT_DATE))::int AS recorded_days,
        count(*) FILTER(WHERE attendance_date>=date_trunc('month',CURRENT_DATE) AND status IN('worked','late','remote'))::int AS worked_days,
        count(*) FILTER(WHERE attendance_date>=date_trunc('month',CURRENT_DATE) AND status='late')::int AS late_days,
        COALESCE(sum(work_hours) FILTER(WHERE attendance_date>=date_trunc('month',CURRENT_DATE)),0)::numeric AS work_hours,
        COALESCE(sum(overtime_hours) FILTER(WHERE attendance_date>=date_trunc('month',CURRENT_DATE)),0)::numeric AS overtime_hours
        FROM attendance_records WHERE organization_id=$1 AND employee_id=$2`, [org, req.user.employee_id]),
      pool.query(`SELECT
        (SELECT count(*) FROM hr_leave_requests WHERE organization_id=$1 AND employee_id=$2 AND status='pending')::int AS pending_leave,
        (SELECT count(*) FROM attendance_correction_requests WHERE organization_id=$1 AND employee_id=$2 AND status='pending')::int AS pending_corrections`, [org, req.user.employee_id]),
      pool.query(`SELECT
        count(*) FILTER(WHERE w.status IN('new','assigned','in_progress','pending_review'))::int AS open,
        count(*) FILTER(WHERE w.status='completed' AND w.updated_at>=date_trunc('month',CURRENT_DATE))::int AS completed_month,
        count(*) FILTER(WHERE w.due_at<now() AND w.created_at>=now()-interval '30 days' AND w.status NOT IN('completed','cancelled'))::int AS overdue_recent
        FROM work_orders w JOIN employees e ON e.organization_id=w.organization_id AND e.id=$2
        WHERE w.organization_id=$1 AND w.department_id=e.department_id`, [org, req.user.employee_id])
    ]);
    const employee = identity.rows[0] || {};
    const approvedSalary = employee.approved_salary;
    const referenceSalary = approvedSalary ?? employee.profile_salary;
    personal = {
      identity: { fullName: employee.full_name || req.user.full_name, department: employee.department_name, position: employee.position_title },
      attendance: personalAttendance.rows[0],
      work: {
        open: data.work.mine, recentOpen: data.work.mine_recent, dueToday: data.work.mine_due_today,
        overdueRecent: data.work.mine_overdue_recent, pendingReview: data.work.mine_pending_review,
        completedMonth: data.work.mine_completed_month
      },
      requests: personalRequests.rows[0],
      department: departmentWork.rows[0],
      compensation: {
        available: referenceSalary !== null && referenceSalary !== undefined,
        referenceSalary, currency: employee.approved_currency || "MNT",
        status: approvedSalary !== null && approvedSalary !== undefined ? "approved_base" : "profile_reference",
        netPay: null
      }
    };
  }
  const setupData = setup.rows[0];
  const setupSteps = [
    { code: "organization", label: "Байгууллагын мэдээлэл", complete: true, tab: "organization" },
    { code: "structure", label: "Бүтэц ба албан тушаал", complete: setupData.departments > 0 && setupData.positions > 0, tab: "structure" },
    { code: "employees", label: "Ажилтны үндсэн бүртгэл", complete: setupData.employees > 0, view: hrAccess && enabled.has("hr") ? "hr" : "employees" },
    { code: "access", label: "Нэвтрэх эрх", complete: setupData.login_accounts > 0, tab: "access" }
  ];

  const operations = [];
  if (enabled.has("hr") && hrAccess) operations.push({ code: "employees", label: "Нийт ажилтан", value: data.people.total, note: `${data.people.active} идэвхтэй ажилтан`, tone: "blue", view: "hr" });
  if (enabled.has("attendance") && hrAccess) {
    const present = Number(data.attendance.worked)+Number(data.attendance.late)+Number(data.attendance.remote);
    const attendanceRate = Number(data.people.active) ? Math.round(present/Number(data.people.active)*100) : 0;
    operations.push({ code: "attendance-present", label: "Өнөөдөр ирсэн", value: present, note: `${attendanceRate}% ирц`, tone: "green", view: "attendance" });
  }
  if (enabled.has("work-orders")) {
    const completionRate = Number(data.work.total_year) ? Math.round(Number(data.work.completed_year)/Number(data.work.total_year)*1000)/10 : 0;
    operations.push({ code: "work-total", label: "Нийт ажил", value: data.work.total_year, note: `${new Date().getFullYear()} оны бүртгэл`, tone: "amber", view: "work-orders" });
    operations.push({ code: "work-progress", label: "Ажлын дундаж явц", value: `${completionRate}%`, note: `Дууссан ажлын хувь · ${data.work.completed_year}/${data.work.total_year}`, tone: "purple", view: "work-orders" });
  }
  if (enabled.has("work-orders")) operations.push({ code: "work", label: management ? "Сүүлийн 30 хоногийн нээлттэй ажил" : "Миний сүүлийн 30 хоногийн ажил", value: management ? data.work.recent_open : data.work.mine_recent, note: management ? `${data.work.historical_open} өмнөх ажлын төлөвийг тусад нь шалгана` : `${data.work.mine} нийт нээлттэй`, tone: Number(management ? data.work.emergency_recent : data.work.mine_emergency_recent) || Number(management ? data.work.overdue_recent : data.work.mine_overdue_recent) ? "red" : "blue", view: "work-orders" });
  if (enabled.has("camera-operations") && engineeringAccess) operations.push({ code: "camera", label: "Камерын ажиллагаа", value: `${Math.max(0, Number(data.camera.devices)-Number(data.camera.broken))} / ${data.camera.devices}`, note: `${data.camera.broken} ажиллагаагүй · ${data.camera.locations} объект`, tone: Number(data.camera.broken) ? "red" : "green", view: "camera" });
  if (enabled.has("lighting-operations") && engineeringAccess) operations.push({ code: "lighting", label: "Гэрэлтүүлгийн орчин", value: data.lighting.objects, note: `${data.lighting.open_incidents} нээлттэй гэмтэл · ${data.lighting.affected} нөлөөлсөн`, tone: Number(data.lighting.open_incidents) ? "amber" : "green", view: "lighting" });
  if (enabled.has("safety") && (management || req.user.role === "safety")) operations.push({ code: "safety", label: "ХАБЭА-н нээлттэй эрсдэл", value: data.safety.open_risks, note: `${data.safety.critical_risks} өндөр эрсдэл`, tone: Number(data.safety.critical_risks) ? "red" : Number(data.safety.open_risks) ? "amber" : "green", view: "safety" });

  const resources = [];
  if (enabled.has("assets") && (management || engineeringAccess || req.user.role === "storekeeper")) resources.push({ code: "assets", label: "Үндсэн хөрөнгө", value: data.assets.total, note: `${data.assets.repair} засварт`, tone: Number(data.assets.repair) ? "amber" : "blue", view: "assets" });
  if (management && enabled.has("inventory")) resources.push({ code: "inventory-value", label: "Бараа материалын үлдэгдэл", value: data.inventory.inventory_value, format: "money", note: `${data.inventory.item_count} нэр төрөл · ${data.inventory.positive_stock} үлдэгдэлтэй`, tone: "blue", view: "inventory" });
  if (management && enabled.has("finance")) {
    resources.push({ code: "payable", label: "Нээлттэй өглөг", value: data.obligations.payable_open, format: "money", note: "Төлөгдөөгүй үлдэгдэл", tone: "amber", view: "finance" });
    resources.push({ code: "receivable", label: "Нээлттэй авлага", value: data.obligations.receivable_open, format: "money", note: "Хүлээн авах үлдэгдэл", tone: "green", view: "finance" });
    resources.push({ code: "cash-flow", label: "Энэ сарын мөнгөн урсгал", value: Number(data.finance.income)-Number(data.finance.expense), format: "money", note: Number(data.finance.transaction_count) ? `${data.finance.transaction_count} гүйлгээнд үндэслэв` : "Энэ сард гүйлгээ бүртгэгдээгүй", tone: Number(data.finance.transaction_count) ? (Number(data.finance.income)-Number(data.finance.expense)<0 ? "red" : "green") : "blue", view: "finance" });
  }

  const alerts = [];
  addAlert(alerts, enabled.has("work-orders") && Number(management ? data.work.emergency_recent : data.work.mine_emergency_recent)>0, "critical", "Ажлын самбар", management ? `${data.work.emergency_recent} яаралтай ажил сүүлийн 30 хоногт нээлттэй байна` : `${data.work.mine_emergency_recent} яаралтай ажил танд оноогдсон`, "work-orders");
  addAlert(alerts, enabled.has("work-orders") && Number(management ? data.work.overdue_recent : data.work.mine_overdue_recent)>0, "warning", "Ажлын самбар", management ? `${data.work.overdue_recent} шинэ ажил хугацаа хэтэрсэн` : `${data.work.mine_overdue_recent} ажил тань хугацаа хэтэрсэн`, "work-orders");
  addAlert(alerts, management && enabled.has("work-orders") && Number(data.work.unassigned_recent)>0, "warning", "Ажлын самбар", `${data.work.unassigned_recent} шинэ ажил хариуцагчгүй байна`, "work-orders");
  addAlert(alerts, management && enabled.has("work-orders") && Number(data.work.historical_open)>0, "info", "Өгөгдлийн тулгалт", `${data.work.historical_open} өмнөх ажлын төлөвийг нэг удаа хянаж баталгаажуулна`, "work-orders");
  addAlert(alerts, enabled.has("camera-operations") && (management || req.user.role === "camera_engineer") && Number(data.camera.broken)>0, "warning", "Камер", `${data.camera.broken} камер ажиллагаагүй гэж бүртгэгдсэн`, "camera");
  addAlert(alerts, enabled.has("lighting-operations") && (management || req.user.role === "electric") && Number(data.lighting.open_incidents)>0, "warning", "Гэрэлтүүлэг", `${data.lighting.open_incidents} гэрэлтүүлгийн гэмтэл шийдэгдээгүй байна`, "lighting");
  addAlert(alerts, enabled.has("safety") && (management || req.user.role === "safety") && Number(data.safety.critical_risks)>0, "critical", "ХАБЭА", `${data.safety.critical_risks} өндөр эрсдэлд арга хэмжээ шаардлагатай`, "safety");
  addAlert(alerts, hrAccess && Number(data.hr.pending_leave)>0, "info", "Хүний нөөц", `${data.hr.pending_leave} чөлөөний хүсэлт шийдвэр хүлээж байна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.pending_corrections)>0, "warning", "Хүний нөөц", `${data.hr.pending_corrections} ирцийн залруулга шийдвэр хүлээж байна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.contracts_expiring)>0, "warning", "Хүний нөөц", `${data.hr.contracts_expiring} гэрээ 30 хоногт дуусна`, "hr");
  addAlert(alerts, hrAccess && Number(data.hr.certificates_expiring)>0, "warning", "Хүний нөөц", `${data.hr.certificates_expiring} ур чадварын гэрчилгээ 30 хоногт дуусна`, "hr");
  addAlert(alerts, management && enabled.has("inventory") && Number(data.inventory.low_stock)>0, "warning", "Нярав", `${data.inventory.low_stock} материал тохируулсан доод үлдэгдлээс багассан`, "inventory");
  addAlert(alerts, management && enabled.has("maintenance") && Number(data.maintenance.overdue)>0, "warning", "Төлөвлөгөөт засвар", `${data.maintenance.overdue} засварын төлөвлөгөө хэтэрсэн`, "maintenance");
  addAlert(alerts, management && enabled.has("procurement") && Number(data.procurement.awaiting)>0, "info", "Худалдан авалт", `${data.procurement.awaiting} хүсэлт шийдвэр хүлээж байна`, "procurement");

  addAlert(alerts, permissions.has("report-schedules.read") && Number(data.reportSchedules.overdue)>0,
    "critical", "Тайлангийн хуваарь", `${data.reportSchedules.overdue} тайлангийн хугацаа хэтэрсэн`,
    "reports", { reportTab: "schedule" });
  addAlert(alerts, permissions.has("report-schedules.read") && Number(data.reportSchedules.due_today)>0,
    "critical", "Тайлангийн хуваарь", `${data.reportSchedules.due_today} тайлан өнөөдөр гарах хугацаатай`,
    "reports", { reportTab: "schedule" });
  addAlert(alerts, permissions.has("report-schedules.read") && Number(data.reportSchedules.upcoming)>0,
    "warning", "Тайлангийн хуваарь", `${data.reportSchedules.upcoming} тайлан анхааруулах хугацаандаа орсон`,
    "reports", { reportTab: "schedule" });

  const priority = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => priority[a.level]-priority[b.level]);
  const activity = await loadActivityFeed({ organizationId: org, userId: req.user.id, enabled, permissions, management });
  res.json({
    generatedAt: new Date().toISOString(), scope: management ? "organization" : "personal",
    scale: organizationScale(data.people.active), operations, metrics: operations, resources, alerts, personal,
    dataQuality: management ? { incompleteEmployeeProfiles: data.people.incomplete_profiles, inventoryMinimumConfigured: data.inventory.minimum_configured, inventoryZeroStock: data.inventory.zero_stock } : undefined,
    setup: { complete: setupSteps.every(item => item.complete), completed: setupSteps.filter(item => item.complete).length, total: setupSteps.length, steps: setupSteps },
    enabledModules: [...enabled], hr: hrAccess ? data.hr : undefined, activity,
    attendanceOverview: enabled.has("attendance") && hrAccess ? {
      date: new Date().toISOString().slice(0,10), absent: data.attendance.absent, leave: data.attendance.leave, sick: data.attendance.sick,
      vacation: data.attendance.vacation, overtimeHours: data.attendance.overtime_hours
    } : undefined,
    infrastructure: data.lightingOverview.length || data.cameraOverview
      ? { lighting: data.lightingOverview, camera: data.cameraOverview || null }
      : undefined
  });
}));

module.exports = router;
module.exports.organizationScale = organizationScale;
