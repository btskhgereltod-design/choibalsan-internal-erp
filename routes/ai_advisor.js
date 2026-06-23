"use strict";

/**
 * AI Strategic Advisor — Read-Only API
 *
 * Зориулалт: ChatGPT болон AI системд ERP-ийн context өгөх,
 * стратегийн зөвлөгөө авах зорилгоор ашиглана.
 *
 * Хандалтын хязгаарлалт:
 *  - Зөвхөн GET (read-only), POST /ai/ask нь зөвхөн лог хадгална
 *  - AI_READONLY болон director role-той хэрэглэгч л ашиглана
 *  - Нууц талбарууд (регистр, утас, цалин, хаяг) mask хийнэ
 *  - Бүх хандалт audit_logs-д immutable байдлаар хадгална
 *  - Rate limit: минутанд 60 хүсэлт/хэрэглэгч
 *
 * @openapi
 * tags:
 *   - name: AI Advisor
 *     description: AI стратегийн зөвлөхийн read-only API
 */

const express = require("express");
const { all, get, run, auth } = require("../db");

const router = express.Router();

// ── AI_READONLY role guard ────────────────────────────────────────────────────

function requireAiRole(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
  if (req.user.role === "ai_readonly" || req.user.role === "director") return next();
  return res.status(403).json({ error: "AI эрх хүрэхгүй. Шаардлагатай role: ai_readonly" });
}

// ── In-memory rate limiter: 60 req/min per user ───────────────────────────────

const _rateLimitStore = new Map();

function aiRateLimit(req, res, next) {
  const key = String(req.user?.id || req.ip);
  const now = Date.now();
  const WINDOW = 60_000;
  const LIMIT  = 60;
  let record = _rateLimitStore.get(key);
  if (!record || now > record.reset) {
    record = { count: 1, reset: now + WINDOW };
  } else {
    record.count += 1;
  }
  _rateLimitStore.set(key, record);
  res.setHeader("X-RateLimit-Limit",     LIMIT);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, LIMIT - record.count));
  res.setHeader("X-RateLimit-Reset",     Math.ceil(record.reset / 1000));
  if (record.count > LIMIT) {
    return res.status(429).json({ error: "Хэт олон хүсэлт. 1 минут дараа дахин оролдоно уу." });
  }
  next();
}

// ── Immutable AI audit logger ─────────────────────────────────────────────────

async function aiAudit(userId, endpoint, detail, ip) {
  await run(
    `INSERT INTO audit_logs(user_id, action, entity, entity_id, detail) VALUES(?,?,?,?,?)`,
    [
      userId,
      "AI_READ",
      endpoint,
      null,
      JSON.stringify({ detail, ip: ip || null, ts: new Date().toISOString() }),
    ]
  );
}

// ── Middleware stack for all AI endpoints ─────────────────────────────────────

const AI_GUARD = [auth, requireAiRole, aiRateLimit];

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/ai/context/overview
//    ERP-ийн ерөнхий зураглал — байгууллага, нэгтгэл тоо, эрсдэл
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/context/overview:
 *   get:
 *     summary: ERP-ийн ерөнхий зураглал
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Байгууллагын нэгтгэл статистик
 */
router.get("/ai/context/overview", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/context/overview", "overview", req.ip);

  const [
    totalEmployees,
    activeEmployees,
    totalSlPoints,
    totalFeedPoints,
    totalLoraDevices,
    openFaults,
    faultsLast30,
    openWorkOrders,
    overdueWorkOrders,
    iotAlarmsCount,
  ] = await Promise.all([
    get("SELECT COUNT(*) AS cnt FROM users"),
    get("SELECT COUNT(*) AS cnt FROM users WHERE active=1"),
    get("SELECT COUNT(*) AS cnt FROM sl_points WHERE status='active'"),
    get("SELECT COUNT(*) AS cnt FROM sl_feed_point"),
    get("SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1"),
    get("SELECT COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй'"),
    get("SELECT COUNT(*) AS cnt FROM sl_faults WHERE created_at >= datetime('now','-30 days')"),
    get("SELECT COUNT(*) AS cnt FROM asset_events WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')"),
    get(`SELECT COUNT(*) AS cnt FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
           AND end_date IS NOT NULL AND end_date < date('now')`),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE last_status='fault' AND is_active=1`),
  ]);

  const risks = [];
  if ((openFaults?.cnt || 0) > 0)
    risks.push({ level: "medium", msg: `Нээлттэй гэрэлтүүлгийн гэмтэл: ${openFaults.cnt}` });
  if ((overdueWorkOrders?.cnt || 0) > 0)
    risks.push({ level: "high", msg: `Хугацаа хэтэрсэн ажлын даалгавар: ${overdueWorkOrders.cnt}` });
  if ((iotAlarmsCount?.cnt || 0) > 0)
    risks.push({ level: "high", msg: `IoT дохиотой төхөөрөмж: ${iotAlarmsCount.cnt}` });

  res.json({
    generated_at: new Date().toISOString(),
    organization: {
      name: "Чойбалсан хөгжил ОНӨААТҮГ",
      city: "Чойбалсан хот",
      aimag: "Хэнтий аймаг",
    },
    summary: {
      total_employees:        totalEmployees?.cnt    || 0,
      active_employees:       activeEmployees?.cnt   || 0,
      total_lighting_points:  totalSlPoints?.cnt     || 0,
      total_feed_points:      totalFeedPoints?.cnt   || 0,
      active_iot_devices:     totalLoraDevices?.cnt  || 0,
      open_lighting_faults:   openFaults?.cnt        || 0,
      faults_last_30_days:    faultsLast30?.cnt      || 0,
      open_work_orders:       openWorkOrders?.cnt    || 0,
      overdue_work_orders:    overdueWorkOrders?.cnt || 0,
    },
    risks,
    note: "Нууц мэдээлэл (регистр, утас, цалин, хаяг) mask хийгдсэн.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/ai/context/modules
//    ERP-д байгаа бүх module, entity, relationship-ийн тайлбар
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/context/modules:
 *   get:
 *     summary: ERP module болон entity тайлбар
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/context/modules", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/context/modules", "modules", req.ip);

  res.json({
    generated_at: new Date().toISOString(),
    modules: [
      {
        key: "employees",
        label: "Хүний нөөц",
        tables: ["users", "hr_records", "hr_history", "payroll_timesheet"],
        key_fields: {
          users: ["id", "username", "full_name", "role", "active", "can_login"],
          hr_records: ["user_id", "department", "position", "start_date", "employment_type"],
        },
        sensitive_fields: ["register_number", "phone", "address", "salary", "bank_account", "email"],
        relationships: ["users → hr_records (1:1)", "users → payroll_timesheet (1:N)"],
        api_endpoint: "/api/ai/employees/summary",
      },
      {
        key: "lighting",
        label: "Гудамжны гэрэлтүүлэг",
        tables: ["sl_points", "sl_feed_point", "sl_feeder_cable", "sl_corridor", "sl_alignment",
                 "sl_faults", "sl_fault_repairs", "sl_daily_status", "sl_monthly_readings",
                 "sl_organizations", "sl_network_routes", "sl_network_poles"],
        key_fields: {
          sl_points: ["id", "code", "name", "location", "gps_lat", "gps_lng", "org_id", "lamp_count", "wattage_per_lamp", "status"],
          sl_feed_point: ["id", "name", "gps_lat", "gps_lng", "type"],
          sl_faults: ["id", "category", "location_name", "broken_count", "status", "report_date"],
          sl_monthly_readings: ["point_id", "year", "month", "kwh_used", "amount"],
        },
        relationships: [
          "sl_points → sl_organizations (N:1)",
          "sl_feed_point → sl_feeder_cable (1:N)",
          "sl_faults → sl_fault_repairs (1:N)",
          "sl_points → sl_monthly_readings (1:N)",
        ],
        api_endpoint: "/api/ai/lighting/summary",
      },
      {
        key: "iot",
        label: "IoT / LoRa төхөөрөмж",
        tables: ["lora_devices", "lora_readings", "lora_daily", "iot_meter_readings",
                 "sl_feed_point_device", "iot_device_commands", "iot_audit_logs"],
        key_fields: {
          lora_devices: ["id", "device_eui", "device_name", "model", "sl_point_id", "phase",
                         "is_active", "last_seen", "last_voltage", "last_current", "last_power", "last_status"],
          iot_meter_readings: ["dev_eui", "voltage", "current", "power", "energy", "do_state", "rssi", "snr", "received_at"],
          sl_feed_point_device: ["feed_point_id", "dev_eui", "role"],
        },
        relationships: [
          "lora_devices → sl_points (N:1)",
          "sl_feed_point → sl_feed_point_device (1:1)",
          "sl_feed_point_device.dev_eui → iot_meter_readings.dev_eui (1:N)",
        ],
        api_endpoint: "/api/ai/iot/summary",
      },
      {
        key: "work_orders",
        label: "Ажлын даалгавар",
        tables: ["asset_events", "work_executions", "work_photos", "work_planned_materials", "work_todos"],
        key_fields: {
          asset_events: ["id", "title", "category", "department", "status", "progress",
                         "assigned_to", "work_date", "start_date", "end_date", "confirm_status"],
          work_executions: ["id", "work_log_id", "title", "start_date", "end_date", "status", "progress"],
        },
        status_values: {
          asset_events: ["Явцтай", "Дууссан", "Цуцлагдсан"],
          work_executions: ["Явцтай", "Дууссан"],
        },
        relationships: ["asset_events → work_executions (1:N)", "asset_events → work_photos (1:N)"],
        api_endpoint: "/api/ai/work-orders/summary",
      },
      {
        key: "assets",
        label: "Хөрөнгө",
        tables: ["asset_events"],
        note: "asset_events нь ажлын даалгавар болон хөрөнгийн бүртгэлийг хамтад нь агуулна",
        api_endpoint: "/api/ai/assets/summary",
      },
      {
        key: "finance",
        label: "Санхүү",
        tables: ["cash_journal", "accounts_payable", "accounts_receivable",
                 "fixed_assets_ledger", "expenses", "payroll_timesheet"],
        sensitive_fields: ["amount", "balance", "salary"],
        api_endpoint: null,
        note: "Санхүүгийн нарийн мэдээлэл AI-д ил гаргахгүй. Зөвхөн нэгтгэл.",
      },
      {
        key: "warehouse",
        label: "Агуулах / Нярав",
        tables: ["warehouse_items", "wh_materials", "wh_transactions", "material_moves"],
        key_fields: {
          warehouse_items: ["id", "item_name", "unit", "balance", "warning_level", "price"],
        },
      },
      {
        key: "safety",
        label: "ХАБЭА",
        tables: ["safety_reports", "safety_accidents", "safety_trainings",
                 "safety_procedures", "safety_instructions", "vehicle_daily_inspections"],
        api_endpoint: null,
      },
      {
        key: "vehicles",
        label: "Тээврийн хэрэгсэл",
        tables: ["vehicles", "vehicle_daily_inspections", "vehicle_weekly_inspections",
                 "vehicle_monthly_inspections", "vehicle_repairs"],
      },
      {
        key: "reports",
        label: "Тайлан",
        tables: ["engineer_monthly_reports", "hse_report_snapshots"],
        api_endpoint: "/api/ai/reports/monthly",
      },
      {
        key: "audit",
        label: "Аудит лог",
        tables: ["audit_logs", "mcp_tool_audit", "iot_audit_logs"],
        note: "Immutable — өөрчилж, устгаж болохгүй. Бүх AI хандалт энд хадгалагдана.",
        api_endpoint: "/api/ai/audit/recent",
      },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/ai/employees/summary
//    Ажилчдын нэгтгэл — нууц мэдээлэл mask хийгдсэн
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/employees/summary:
 *   get:
 *     summary: Ажилчдын нэгтгэл (mask хийгдсэн)
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/employees/summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/employees/summary", "employees", req.ip);

  const [byRole, activeCount, inactiveCount, recentActivity, topActive] = await Promise.all([
    all(`SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY count DESC`),
    get(`SELECT COUNT(*) AS cnt FROM users WHERE active=1`),
    get(`SELECT COUNT(*) AS cnt FROM users WHERE active=0`),
    all(`SELECT u.role, al.action, COUNT(*) AS cnt
         FROM audit_logs al JOIN users u ON u.id = al.user_id
         WHERE al.created_at >= datetime('now','-30 days')
         GROUP BY u.role, al.action ORDER BY cnt DESC LIMIT 20`),
    all(`SELECT u.role, COUNT(al.id) AS activity_count
         FROM audit_logs al JOIN users u ON u.id = al.user_id
         WHERE al.created_at >= datetime('now','-30 days')
         GROUP BY u.role ORDER BY activity_count DESC LIMIT 5`),
  ]);

  const risks = [];
  if ((activeCount?.cnt || 0) < 3) risks.push("Идэвхтэй ажилтны тоо хязгаарлагдмал");

  res.json({
    generated_at: new Date().toISOString(),
    total_employees: (activeCount?.cnt || 0) + (inactiveCount?.cnt || 0),
    active_count: activeCount?.cnt   || 0,
    inactive_count: inactiveCount?.cnt || 0,
    by_role: byRole,
    activity_last_30_days: recentActivity,
    most_active_roles: topActive,
    hr_risks: risks,
    note: "Нууц мэдээлэл (регистр, утас, цалин, гэрийн хаяг, банкны дансны дугаар) хасагдсан.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/ai/assets/summary
//    Ажлын үйл ажиллагаа болон хөрөнгийн нэгтгэл
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/assets/summary:
 *   get:
 *     summary: Хөрөнгийн ажлын нэгтгэл
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/assets/summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/assets/summary", "assets", req.ip);

  const [byCategory, byStatus, overdueWorks, last30, progressAvg] = await Promise.all([
    all(`SELECT category, COUNT(*) AS cnt FROM asset_events GROUP BY category ORDER BY cnt DESC`),
    all(`SELECT status, COUNT(*) AS cnt FROM asset_events GROUP BY status ORDER BY cnt DESC`),
    get(`SELECT COUNT(*) AS cnt FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
           AND end_date IS NOT NULL AND end_date < date('now')`),
    all(`SELECT id, title, category, status, progress, work_date
         FROM asset_events
         WHERE created_at >= datetime('now','-30 days')
         ORDER BY created_at DESC LIMIT 30`),
    get(`SELECT ROUND(AVG(progress),1) AS avg_pct FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')`),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    by_category: byCategory,
    by_status: byStatus,
    overdue_count: overdueWorks?.cnt || 0,
    avg_progress_open: progressAvg?.avg_pct || 0,
    recent_30_days: last30,
    risks: [
      (overdueWorks?.cnt || 0) > 0
        ? `${overdueWorks.cnt} ажил хугацаа хэтэрсэн байна`
        : null,
    ].filter(Boolean),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/ai/lighting/summary
//    Гудамжны гэрэлтүүлгийн бүрэн нэгтгэл
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/lighting/summary:
 *   get:
 *     summary: Гэрэлтүүлгийн бүрэн нэгтгэл
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/lighting/summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/lighting/summary", "lighting", req.ip);

  const [
    totalPoints,
    byOrg,
    totalFeedPoints,
    openFaults,
    faultLast30,
    faultByCategory,
    energyLast12,
    dailyStatus,
    wattSummary,
  ] = await Promise.all([
    get(`SELECT COUNT(*) AS cnt, SUM(lamp_count) AS total_lamps,
              SUM(lamp_count * wattage_per_lamp) AS total_watt
         FROM sl_points WHERE status='active'`),
    all(`SELECT so.name AS org_name, COUNT(sp.id) AS point_count,
              SUM(sp.lamp_count) AS lamp_count,
              SUM(sp.lamp_count * sp.wattage_per_lamp) AS total_watt
         FROM sl_points sp
         LEFT JOIN sl_organizations so ON so.id = sp.org_id
         WHERE sp.status='active'
         GROUP BY so.name ORDER BY point_count DESC`),
    get(`SELECT COUNT(*) AS cnt FROM sl_feed_point`),
    get(`SELECT COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй'`),
    get(`SELECT COUNT(*) AS cnt FROM sl_faults WHERE created_at >= datetime('now','-30 days')`),
    all(`SELECT category, COUNT(*) AS cnt, SUM(broken_count) AS total_broken
         FROM sl_faults WHERE status='Нээлттэй'
         GROUP BY category ORDER BY cnt DESC`),
    all(`SELECT year, month, SUM(kwh_used) AS total_kwh, SUM(amount) AS total_amount
         FROM sl_monthly_readings
         GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 12`),
    all(`SELECT snapshot_date, category, total_count, broken_count, availability_pct, fault_count
         FROM sl_daily_status ORDER BY snapshot_date DESC LIMIT 7`),
    get(`SELECT SUM(lamp_count * wattage_per_lamp)/1000.0 AS total_kw FROM sl_points WHERE status='active'`),
  ]);

  const totalKw = wattSummary?.total_kw || 0;
  const estimatedMonthlyKwh = totalKw * 10 * 30; // ~10 цаг/шөнө x 30 хоног
  const estimatedMonthlyAmount = estimatedMonthlyKwh * 120; // ойролцоо тариф ₮120/кВтц

  const risks = [];
  if ((openFaults?.cnt || 0) > 0)
    risks.push({ level: "medium", msg: `Нээлттэй гэмтэл: ${openFaults.cnt}` });
  if ((faultLast30?.cnt || 0) > 20)
    risks.push({ level: "high", msg: `Сүүлийн 30 хоногт ${faultLast30.cnt} гэмтэл бүртгэгдсэн` });

  res.json({
    generated_at: new Date().toISOString(),
    total_active_points:         totalPoints?.cnt        || 0,
    total_active_lamps:          totalPoints?.total_lamps || 0,
    total_watt:                  totalPoints?.total_watt  || 0,
    total_kw:                    +totalKw.toFixed(2),
    estimated_monthly_kwh:       +estimatedMonthlyKwh.toFixed(0),
    estimated_monthly_amount_mnT: +estimatedMonthlyAmount.toFixed(0),
    total_feed_points:           totalFeedPoints?.cnt     || 0,
    open_faults:                 openFaults?.cnt          || 0,
    faults_last_30_days:         faultLast30?.cnt         || 0,
    faults_by_category:          faultByCategory,
    by_organization:             byOrg,
    energy_monthly_last_12:      energyLast12,
    availability_last_7_days:    dailyStatus,
    risks,
    note: "Сарын зардлын тооцоо ойролцоо. Жинхэнэ тариф: sl_monthly_readings.amount-аас гаргана.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/ai/lighting/control-points
//    Feed point (удирдлагын цэг) бүрийн дэлгэрэнгүй байдал + IoT холболт
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/lighting/control-points:
 *   get:
 *     summary: Удирдлагын цэгүүдийн жагсаалт + IoT байдал
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/lighting/control-points", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/lighting/control-points", "control_points", req.ip);

  // Feed point бүрт холбогдсон IoT device болон хамгийн сүүлийн уншилтыг JOIN хийнэ
  const points = await all(`
    SELECT
      fp.id,
      fp.name,
      fp.gps_lat   AS latitude,
      fp.gps_lng   AS longitude,
      fp.type      AS panel_type,
      fp.notes,
      fpd.dev_eui,
      CASE WHEN fpd.id IS NOT NULL THEN 1 ELSE 0 END AS has_iot_device,
      mr.voltage,
      mr.current,
      mr.power,
      mr.energy,
      mr.do_state  AS relay_state,
      mr.rssi,
      mr.snr,
      mr.received_at AS last_seen
    FROM sl_feed_point fp
    LEFT JOIN sl_feed_point_device fpd ON fpd.feed_point_id = fp.id
    LEFT JOIN (
      SELECT dev_eui, voltage, current, power, energy, do_state, rssi, snr, received_at
      FROM iot_meter_readings imr1
      WHERE received_at = (
        SELECT MAX(received_at) FROM iot_meter_readings imr2 WHERE imr2.dev_eui = imr1.dev_eui
      )
    ) mr ON mr.dev_eui = fpd.dev_eui
    ORDER BY fp.id
  `);

  const online   = points.filter(p => p.has_iot_device && p.last_seen &&
                     new Date(p.last_seen) > new Date(Date.now() - 3600_000)).length;
  const offline  = points.filter(p => p.has_iot_device && (!p.last_seen ||
                     new Date(p.last_seen) <= new Date(Date.now() - 3600_000))).length;
  const noDevice = points.filter(p => !p.has_iot_device).length;

  res.json({
    generated_at: new Date().toISOString(),
    total: points.length,
    iot_online:    online,
    iot_offline:   offline,
    no_iot_device: noDevice,
    control_points: points,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/ai/iot/summary
//    LoRa / IoT төхөөрөмжүүдийн нэгтгэл
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/iot/summary:
 *   get:
 *     summary: IoT төхөөрөмжүүдийн нэгтгэл
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/iot/summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/iot/summary", "iot", req.ip);

  const [devices, faultCount, offlineCount, recentReadings] = await Promise.all([
    all(`
      SELECT
        ld.id,
        ld.device_name,
        ld.device_eui,
        ld.model,
        ld.phase,
        ld.is_active,
        ld.last_seen,
        ld.last_voltage,
        ld.last_current,
        ld.last_power,
        ld.last_status,
        sp.code  AS sl_point_code,
        sp.name  AS sl_point_name,
        CASE
          WHEN ld.last_seen IS NULL THEN 'never'
          WHEN ld.last_seen < datetime('now','-1 hour') THEN 'offline'
          ELSE 'online'
        END AS connectivity
      FROM lora_devices ld
      LEFT JOIN sl_points sp ON sp.id = ld.sl_point_id
      WHERE ld.is_active = 1
      ORDER BY ld.last_seen DESC
    `),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE last_status='fault' AND is_active=1`),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices
         WHERE is_active=1 AND (last_seen IS NULL OR last_seen < datetime('now','-1 hour'))`),
    all(`SELECT dev_eui, voltage, current, power, energy, do_state, rssi, snr, received_at
         FROM iot_meter_readings
         ORDER BY received_at DESC LIMIT 20`),
  ]);

  const risks = [];
  if ((faultCount?.cnt || 0) > 0)
    risks.push({ level: "high", msg: `${faultCount.cnt} IoT төхөөрөмжид гэмтлийн дохио байна` });
  if ((offlineCount?.cnt || 0) > 0)
    risks.push({ level: "medium", msg: `${offlineCount.cnt} IoT төхөөрөмж 1 цагаас дээш offline байна` });

  res.json({
    generated_at: new Date().toISOString(),
    total_active_devices: devices.length,
    fault_devices:   faultCount?.cnt  || 0,
    offline_devices: offlineCount?.cnt || 0,
    devices,
    recent_telemetry: recentReadings,
    risks,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. GET /api/ai/work-orders/summary
//    Ажлын даалгаврын нэгтгэл
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/work-orders/summary:
 *   get:
 *     summary: Ажлын даалгаврын нэгтгэл
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/work-orders/summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/work-orders/summary", "work_orders", req.ip);

  const [byStatus, overdue, byCategory, byDept, recent, repeatFaults] = await Promise.all([
    all(`SELECT status, COUNT(*) AS cnt FROM asset_events GROUP BY status ORDER BY cnt DESC`),
    get(`SELECT COUNT(*) AS cnt FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
           AND end_date IS NOT NULL AND end_date < date('now')`),
    all(`SELECT category, COUNT(*) AS cnt FROM asset_events
         GROUP BY category ORDER BY cnt DESC LIMIT 10`),
    all(`SELECT department, COUNT(*) AS cnt FROM asset_events
         WHERE department IS NOT NULL GROUP BY department ORDER BY cnt DESC`),
    all(`SELECT id, title, category, department, status, progress, work_date, end_date
         FROM asset_events ORDER BY created_at DESC LIMIT 25`),
    all(`SELECT title, COUNT(*) AS repeat_cnt
         FROM asset_events WHERE created_at >= datetime('now','-90 days')
         GROUP BY title HAVING repeat_cnt > 1 ORDER BY repeat_cnt DESC LIMIT 10`),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    by_status: byStatus,
    overdue_count: overdue?.cnt || 0,
    by_category: byCategory,
    by_department: byDept,
    recent: recent,
    repeat_faults_last_90_days: repeatFaults,
    sla_risks: [
      (overdue?.cnt || 0) > 0 ? `${overdue.cnt} ажлын даалгавар хугацаа хэтэрсэн` : null,
      repeatFaults.length > 0 ? `${repeatFaults.length} давтагдаж байгаа асуудал илэрлэв` : null,
    ].filter(Boolean),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. GET /api/ai/reports/monthly
//    Тайлангийн нэгтгэл — аль нь автомат, аль нь гараар
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/reports/monthly:
 *   get:
 *     summary: Тайлангийн каталог ба сүүлийн байдал
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/reports/monthly", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/reports/monthly", "reports", req.ip);

  const [engReports, hseReports] = await Promise.all([
    all(`SELECT id, year, month, created_at
         FROM engineer_monthly_reports ORDER BY year DESC, month DESC LIMIT 12`),
    all(`SELECT id, period_type, year, month, title, status, created_at
         FROM hse_report_snapshots ORDER BY year DESC, month DESC LIMIT 12`),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    catalog: [
      {
        key: "engineer_monthly",
        label: "Инженерийн сарын тайлан",
        source_table: "engineer_monthly_reports",
        is_auto_exportable: true,
        is_manual: false,
        recent: engReports,
      },
      {
        key: "hse_monthly",
        label: "ХАБЭА сарын тайлан",
        source_table: "hse_report_snapshots",
        is_auto_exportable: true,
        is_manual: false,
        recent: hseReports,
      },
      {
        key: "lighting_energy",
        label: "Гэрэлтүүлгийн эрчим хүчний тайлан",
        source_table: "sl_monthly_readings",
        is_auto_exportable: true,
        is_manual: false,
        note: "sl_monthly_readings-аас автоматаар нэгтгэж гаргах боломжтой",
      },
      {
        key: "work_order_summary",
        label: "Ажлын даалгаврын нэгтгэл",
        source_table: "asset_events",
        is_auto_exportable: true,
        is_manual: false,
      },
      {
        key: "fault_repair",
        label: "Гэмтэл засварын тайлан",
        source_table: "sl_faults + sl_fault_repairs",
        is_auto_exportable: true,
        is_manual: false,
      },
      {
        key: "iot_energy",
        label: "IoT хэмжилтийн эрчим хүчний тайлан",
        source_table: "lora_daily + iot_meter_readings",
        is_auto_exportable: true,
        is_manual: false,
      },
      {
        key: "payroll",
        label: "Цалингийн тайлан",
        source_table: "payroll_timesheet",
        is_auto_exportable: false,
        is_manual: true,
        note: "Санхүүгийн нууц мэдээлэл агуулах тул AI-д ил гаргахгүй",
      },
    ],
    note: "is_auto_exportable=true тайлангуудыг ERP-ийн API-аар шууд гаргах боломжтой.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. GET /api/ai/audit/recent
//     Сүүлийн audit log — AI-ийн ашиглалт мөн энд хадгалагдана
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/audit/recent:
 *   get:
 *     summary: Сүүлийн 100 audit log
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 */
router.get("/ai/audit/recent", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/audit/recent", "audit", req.ip);

  const logs = await all(`
    SELECT
      al.id,
      u.full_name  AS user_name,
      u.role       AS user_role,
      al.action,
      al.entity    AS module,
      al.entity_id,
      al.created_at AS timestamp,
      al.detail
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 100
  `);

  const aiAccessCount = logs.filter(l => l.action === "AI_READ" || l.action === "AI_QUESTION").length;

  res.json({
    generated_at: new Date().toISOString(),
    total_returned: logs.length,
    ai_access_in_set: aiAccessCount,
    logs: logs.map(l => {
      let detailSummary = null;
      try {
        const d = JSON.parse(l.detail || "{}");
        detailSummary = d.detail || d.scope || d.note || null;
      } catch (_) {}
      return {
        id:             l.id,
        user:           l.user_name,
        role:           l.user_role,
        action:         l.action,
        module:         l.module,
        entity_id:      l.entity_id,
        timestamp:      l.timestamp,
        detail_summary: detailSummary,
      };
    }),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. POST /api/ai/ask
//     ChatGPT-ийн асуулт хүлээн авч ERP context-той хамт лог хадгалах
//     Хариултыг ChatGPT өөрөө боловсруулна — энэ endpoint зөвхөн context өгнө
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /api/ai/ask:
 *   post:
 *     summary: AI асуулт + ERP context snippet
 *     tags: [AI Advisor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question]
 *             properties:
 *               question:
 *                 type: string
 *                 maxLength: 2000
 *               scope:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [lighting, iot, work_orders, assets, employees, reports, audit]
 *     responses:
 *       200:
 *         description: ERP context snippet + audit_id
 */
router.post("/ai/ask", ...AI_GUARD, async (req, res) => {
  const { question, scope = [] } = req.body || {};

  if (!question || typeof question !== "string" || question.trim().length < 3) {
    return res.status(400).json({ error: "question талбар хоосон эсвэл хэт богино байна (min 3 тэмдэгт)" });
  }

  const safeQuestion = question.trim().slice(0, 2000);
  const safeScope    = Array.isArray(scope) ? scope.filter(s => typeof s === "string").slice(0, 10) : [];
  const resolvedScope = safeScope.length > 0
    ? safeScope
    : ["lighting", "iot", "work_orders", "assets"];

  // Асуултыг immutable байдлаар хадгалах
  const logResult = await run(
    `INSERT INTO audit_logs(user_id, action, entity, entity_id, detail) VALUES(?,?,?,?,?)`,
    [
      req.user.id,
      "AI_QUESTION",
      "ai_ask",
      null,
      JSON.stringify({
        question: safeQuestion,
        scope: resolvedScope,
        ip: req.ip || null,
        ts: new Date().toISOString(),
      }),
    ]
  );

  // Хүссэн scope-д тохирох context snippet-уудыг цуглуулах
  const contextParts = {};

  if (resolvedScope.includes("lighting")) {
    const [pts, faults, energy] = await Promise.all([
      get(`SELECT COUNT(*) AS cnt, SUM(lamp_count) AS lamps FROM sl_points WHERE status='active'`),
      get(`SELECT COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй'`),
      get(`SELECT SUM(kwh_used) AS kwh, SUM(amount) AS amt FROM sl_monthly_readings
           WHERE year=strftime('%Y',date('now')) AND month=strftime('%m',date('now'))`),
    ]);
    contextParts.lighting = {
      active_points: pts?.cnt,
      total_lamps:   pts?.lamps,
      open_faults:   faults?.cnt,
      current_month_kwh:    energy?.kwh,
      current_month_amount: energy?.amt,
    };
  }

  if (resolvedScope.includes("iot")) {
    const [total, fault, offline] = await Promise.all([
      get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1`),
      get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE last_status='fault' AND is_active=1`),
      get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1
           AND (last_seen IS NULL OR last_seen < datetime('now','-1 hour'))`),
    ]);
    contextParts.iot = {
      total_devices:   total?.cnt,
      fault_devices:   fault?.cnt,
      offline_devices: offline?.cnt,
    };
  }

  if (resolvedScope.includes("work_orders")) {
    const statuses = await all(`SELECT status, COUNT(*) AS cnt FROM asset_events GROUP BY status`);
    const overdue  = await get(`SELECT COUNT(*) AS cnt FROM asset_events
       WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
         AND end_date IS NOT NULL AND end_date < date('now')`);
    contextParts.work_orders = { by_status: statuses, overdue: overdue?.cnt };
  }

  if (resolvedScope.includes("assets")) {
    const summary = await all(`SELECT category, COUNT(*) AS cnt FROM asset_events GROUP BY category ORDER BY cnt DESC LIMIT 8`);
    contextParts.assets = { by_category: summary };
  }

  if (resolvedScope.includes("employees")) {
    const byRole = await all(`SELECT role, COUNT(*) AS cnt FROM users WHERE active=1 GROUP BY role`);
    contextParts.employees = { by_role: byRole };
  }

  res.json({
    question: safeQuestion,
    scope: resolvedScope,
    answer_context: contextParts,
    sources: resolvedScope.map(s => `/api/ai/${s === "work_orders" ? "work-orders" : s}/summary`),
    audit_id: logResult.id,
    note: "Энэ endpoint нь асуулт болон ERP context-ийг хадгалдаг. Хариултыг ChatGPT өөрөө боловсруулна.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. GET /api/ai/executive/daily
//     Захиралын өдөр тутмын нэг хуудас дүгнэлт
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/executive/daily", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/executive/daily", "executive_daily", req.ip);

  const today     = new Date().toISOString().slice(0, 10);
  const thisYear  = new Date().getFullYear();
  const thisMonth = new Date().getMonth() + 1;

  const [
    lightingAvail,
    openFaults,
    oldestFaults,
    overdueWork,
    todayWork,
    iotOffline,
    iotAlarm,
    lowStockWh,
    lowStockMat,
    attendanceSummary,
    faultByCategory,
    recentAudit,
  ] = await Promise.all([
    // Гэрэлтүүлгийн хүртээмж (сүүлийн бүртгэл)
    get(`SELECT snapshot_date, category, total_count, broken_count, availability_pct
         FROM sl_daily_status ORDER BY snapshot_date DESC LIMIT 1`),

    // Нээлттэй гэмтэл
    get(`SELECT COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй'`),

    // Хамгийн хуучин нээлттэй гэмтэл
    all(`SELECT id, location_name, category, broken_count, report_date,
               CAST((julianday(date('now')) - julianday(report_date)) AS INTEGER) AS days_open
         FROM sl_faults WHERE status='Нээлттэй'
         ORDER BY report_date ASC LIMIT 5`),

    // Хугацаа хэтэрсэн ажил
    get(`SELECT COUNT(*) AS cnt FROM asset_events
         WHERE status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
           AND end_date IS NOT NULL AND end_date < date('now')`),

    // Өнөөдрийн ажлын даалгавар
    all(`SELECT status, COUNT(*) AS cnt FROM asset_events
         WHERE work_date = ? GROUP BY status`, [today]),

    // IoT offline
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1
         AND (last_seen IS NULL OR last_seen < datetime('now','-1 hour'))`),

    // IoT дохиотой
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1 AND last_status='fault'`),

    // Агуулахын дутагдалтай бараа (warehouse_items)
    all(`SELECT item_name, unit, balance, warning_level,
               ROUND((balance / NULLIF(warning_level,0)) * 100.0, 0) AS pct
         FROM warehouse_items
         WHERE balance < warning_level AND warning_level > 0
         ORDER BY pct ASC LIMIT 8`),

    // Нярав материалын дутагдал (wh_materials min_qty)
    all(`SELECT name, unit, min_qty, current_qty FROM (
           SELECT m.name, m.unit, m.min_qty,
                  COALESCE(
                    (SELECT m.opening_qty
                       + COALESCE(SUM(CASE WHEN t.txn_type='IN'  THEN t.qty ELSE 0 END),0)
                       - COALESCE(SUM(CASE WHEN t.txn_type='OUT' THEN t.qty ELSE 0 END),0)
                     FROM wh_transactions t WHERE t.material_id = m.id), m.opening_qty
                  ) AS current_qty
           FROM wh_materials m WHERE m.min_qty > 0
         ) sub WHERE current_qty < min_qty ORDER BY current_qty ASC LIMIT 8`),

    // Ирцийн нэгтгэл (энэ сарын)
    get(`SELECT COUNT(*) AS records_count,
               SUM(absent_days) AS total_absent,
               ROUND(AVG(work_days), 1) AS avg_work_days,
               SUM(late_times) AS total_late
         FROM payroll_timesheet
         WHERE year=? AND month=?`, [thisYear, thisMonth]),

    // Гэмтэл категориор
    all(`SELECT category, COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй'
         GROUP BY category ORDER BY cnt DESC`),

    // Сүүлийн audit (AI-ийн өөрийнх биш)
    all(`SELECT u.role, al.action, al.entity, al.created_at
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
         WHERE al.action NOT IN ('AI_READ','AI_QUESTION')
           AND al.created_at >= datetime('now','-24 hours')
         ORDER BY al.created_at DESC LIMIT 10`),
  ]);

  // ── Эрсдэлийн жагсаалт автоматаар үүсгэх ──────────────────
  const risks = [];

  if ((openFaults?.cnt || 0) > 0)
    risks.push({ level: "high", area: "Гэрэлтүүлэг", msg: `${openFaults.cnt} нээлттэй гэмтэл байна` });

  if ((overdueWork?.cnt || 0) > 0)
    risks.push({ level: "high", area: "Ажил", msg: `${overdueWork.cnt} ажил хугацаа хэтэрсэн байна` });

  if ((iotAlarm?.cnt || 0) > 0)
    risks.push({ level: "high", area: "IoT", msg: `${iotAlarm.cnt} IoT дохио өгч байна` });

  if ((iotOffline?.cnt || 0) > 0)
    risks.push({ level: "medium", area: "IoT", msg: `${iotOffline.cnt} IoT offline байна` });

  if (oldestFaults.length > 0 && oldestFaults[0].days_open > 7)
    risks.push({ level: "medium", area: "Гэрэлтүүлэг",
      msg: `Хамгийн хуучин гэмтэл ${oldestFaults[0].days_open} хоног нээлттэй (${oldestFaults[0].location_name})` });

  if ((lowStockWh.length + lowStockMat.length) > 0)
    risks.push({ level: "low", area: "Агуулах",
      msg: `${lowStockWh.length + lowStockMat.length} төрлийн бараа материалын нөөц дутагдаж байна` });

  if ((lightingAvail?.availability_pct || 100) < 95)
    risks.push({ level: "medium", area: "Гэрэлтүүлэг",
      msg: `Гэрэлтүүлгийн хүртээмж ${lightingAvail.availability_pct}% (хэвийн 95%+)` });

  risks.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.level] - { high: 0, medium: 1, low: 2 }[b.level]));

  // ── Захиралд зориулсан санал ────────────────────────────────
  const recommendations = [];

  if ((overdueWork?.cnt || 0) > 0)
    recommendations.push(`⚡ ${overdueWork.cnt} хоцорсон ажлыг инженерүүдтэй шалгах`);

  if (oldestFaults.slice(0, 3).some(f => f.days_open > 5))
    recommendations.push(`🔧 Удаан нээлттэй гэмтлийг (${oldestFaults[0]?.days_open || 0} хоног) шийдвэрлэх`);

  if ((iotAlarm?.cnt || 0) > 0)
    recommendations.push(`📡 IoT дохиотой ${iotAlarm.cnt} цэгийг инженерт шалгуулах`);

  if (lowStockWh.length > 0)
    recommendations.push(`📦 Нөөц барагдсан материал захиалах: ${lowStockWh.slice(0,3).map(r=>r.item_name).join(', ')}`);

  res.json({
    generated_at: new Date().toISOString(),
    date: today,
    lighting: {
      availability_pct:    lightingAvail?.availability_pct || null,
      availability_date:   lightingAvail?.snapshot_date    || null,
      open_faults:         openFaults?.cnt                 || 0,
      oldest_open_faults:  oldestFaults,
      faults_by_category:  faultByCategory,
    },
    work_orders: {
      overdue_count: overdueWork?.cnt || 0,
      today_by_status: todayWork,
    },
    iot: {
      offline_count: iotOffline?.cnt || 0,
      alarm_count:   iotAlarm?.cnt   || 0,
    },
    inventory: {
      low_stock_warehouse: lowStockWh,
      low_stock_materials: lowStockMat,
      total_low_stock_items: lowStockWh.length + lowStockMat.length,
    },
    attendance_this_month: {
      records_count:  attendanceSummary?.records_count || 0,
      total_absent:   attendanceSummary?.total_absent  || 0,
      avg_work_days:  attendanceSummary?.avg_work_days || 0,
      total_late:     attendanceSummary?.total_late    || 0,
      note: "Цалингийн нарийн тоо мэдээлэл (дүн, хасалт) агуулахгүй.",
    },
    top_risks: risks.slice(0, 5),
    recommended_actions: recommendations,
    recent_system_activity: recentAudit,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. GET /api/ai/lighting/schedule-today
//     Өнөөдрийн гэрэлтүүлгийн хуваарь — Priority: Override > Manual > Schedule
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/lighting/schedule-today", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/lighting/schedule-today", "lighting_schedule", req.ip);

  const today = new Date().toISOString().slice(0, 10);

  // Бүх категорийн өнөөдрийн хуваарийг тодорхойлох
  // 1) Өнөөдөр тусгайлан тохируулсан (adjusted_date = today) → manual override
  // 2) valid_from <= today хамгийн сүүлийнх → default schedule
  const [todayOverrides, allCategories, defaultSchedules, totalManualToday] = await Promise.all([
    all(`SELECT category, on_time, off_time, is_always_off, adjusted_date, valid_from, notes, adjusted_by
         FROM light_schedule_logs
         WHERE adjusted_date = ?
         ORDER BY id DESC`, [today]),

    all(`SELECT DISTINCT category FROM light_schedule_logs ORDER BY category`),

    all(`SELECT category, on_time, off_time, is_always_off, valid_from, notes
         FROM light_schedule_logs l1
         WHERE id = (
           SELECT l2.id FROM light_schedule_logs l2
           WHERE l2.category = l1.category AND l2.valid_from <= ?
           ORDER BY l2.valid_from DESC, l2.id DESC
           LIMIT 1
         )`, [today]),

    get(`SELECT COUNT(*) AS cnt FROM light_schedule_logs WHERE adjusted_date = ?`, [today]),
  ]);

  // Категори бүрт эцсийн хуваарийг Priority дарааллаар тодорхойлох
  const scheduleResult = allCategories.map(({ category }) => {
    // Priority 1: Өнөөдрийн тусгай override
    const override = todayOverrides.find(r => r.category === category);
    // Priority 2: Ерөнхий default schedule
    const def      = defaultSchedules.find(r => r.category === category);

    const source = override
      ? (override.is_always_off ? "emergency_override" : "manual_today")
      : (def ? "schedule" : "no_data");

    const active = override || def;

    return {
      category,
      final_on_time:         active?.on_time         || null,
      final_off_time:        active?.off_time        || null,
      is_always_off:         active?.is_always_off   ? true : false,
      decision_source:       source,
      decision_priority: {
        emergency_override: "is_always_off=1 болон өнөөдрийн тусгай тохиргоо",
        manual_today:       "Өнөөдрийн огноонд зориулан гараар тохируулсан",
        schedule:           "Тухайн категорийн сүүлийн үнэтэй хуваарь",
        no_data:            "Хуваарь тохируулаагүй байна",
      }[source],
      override_detail: override
        ? { adjusted_date: override.adjusted_date, notes: override.notes || null }
        : null,
      default_schedule: def
        ? { valid_from: def.valid_from, on_time: def.on_time, off_time: def.off_time }
        : null,
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    date: today,
    manual_override_count: totalManualToday?.cnt || 0,
    priority_order: ["emergency_override", "manual_today", "schedule", "no_data"],
    schedules: scheduleResult,
    note: [
      "Цаг агаарын тохируулга одоогоор ERP-д бүртгэгддэггүй.",
      "Эцсийн шийдвэр: emergency_override > manual_today > schedule.",
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. GET /api/ai/lighting/control-points-status
//     Control point бүрийн дэлгэрэнгүй байдал (fault + health нэмсэн)
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/lighting/control-points-status", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/lighting/control-points-status", "control_points_status", req.ip);

  const today = new Date().toISOString().slice(0, 10);
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

  // Control point бүрт IoT + schedule + fault мэдээлэл нэгтгэх
  const points = await all(`
    SELECT
      fp.id,
      fp.name,
      fp.gps_lat       AS latitude,
      fp.gps_lng       AS longitude,
      fp.type          AS phase_type,
      fp.notes,
      fpd.dev_eui,
      CASE WHEN fpd.id IS NOT NULL THEN 1 ELSE 0 END AS has_iot_device,
      mr.voltage,
      mr.current,
      mr.power,
      mr.energy,
      mr.do_state      AS relay_status,
      mr.rssi,
      mr.snr,
      mr.received_at   AS last_seen
    FROM sl_feed_point fp
    LEFT JOIN sl_feed_point_device fpd ON fpd.feed_point_id = fp.id
    LEFT JOIN (
      SELECT dev_eui, voltage, current, power, energy,
             do_state, rssi, snr, received_at
      FROM iot_meter_readings imr1
      WHERE received_at = (
        SELECT MAX(received_at) FROM iot_meter_readings imr2
        WHERE imr2.dev_eui = imr1.dev_eui
      )
    ) mr ON mr.dev_eui = fpd.dev_eui
    ORDER BY fp.id
  `);

  // Өнөөдрийн хуваарийг категориор авах
  const schedules = await all(`
    SELECT category, on_time, off_time, is_always_off
    FROM light_schedule_logs l1
    WHERE valid_from = (
      SELECT MAX(l2.valid_from) FROM light_schedule_logs l2
      WHERE l2.category = l1.category AND l2.valid_from <= ?
    )
  `, [today]);

  // Нээлттэй гэмтлийн тоо (байршлын нэрээр)
  const openFaultMap = {};
  const faultRows = await all(
    `SELECT location_name, COUNT(*) AS cnt FROM sl_faults WHERE status='Нээлттэй' GROUP BY location_name`
  );
  for (const f of faultRows) openFaultMap[f.location_name] = f.cnt;

  // Тодорхой асуудалтай цэгүүдийн тоо
  let healthCounts = { healthy: 0, warning: 0, offline: 0, fault: 0, no_iot: 0 };

  const enriched = points.map(pt => {
    const isOnline      = pt.has_iot_device && pt.last_seen && pt.last_seen >= oneHourAgo;
    const isOffline     = pt.has_iot_device && (!pt.last_seen || pt.last_seen < oneHourAgo);
    const hasFault      = (openFaultMap[pt.name] || 0) > 0;
    const alarmStatus   = pt.voltage !== null && (pt.voltage < 180 || pt.voltage > 260) ? "voltage_abnormal" : "normal";
    const relayStatus   = pt.relay_status ?? (pt.has_iot_device ? "unknown" : null);

    // Нийт хуваарь (эхний тохирох категори)
    const schedule      = schedules[0] || null;
    const scheduleStatus = schedule
      ? (schedule.is_always_off ? "always_off" : `${schedule.on_time}–${schedule.off_time}`)
      : "no_schedule";

    // Эрүүл мэнд
    let healthStatus;
    if (!pt.has_iot_device)                         { healthStatus = "no_iot";  healthCounts.no_iot++;  }
    else if (hasFault || alarmStatus !== "normal")  { healthStatus = "fault";   healthCounts.fault++;   }
    else if (isOffline)                             { healthStatus = "offline"; healthCounts.offline++; }
    else if (pt.voltage === null && isOnline)        { healthStatus = "warning"; healthCounts.warning++; }
    else                                             { healthStatus = "healthy"; healthCounts.healthy++; }

    return {
      id:               pt.id,
      name:             pt.name,
      latitude:         pt.latitude,
      longitude:        pt.longitude,
      phase_type:       pt.phase_type,
      has_iot_device:   !!pt.has_iot_device,
      iot_device_eui:   pt.dev_eui    || null,
      last_seen:        pt.last_seen  || null,
      voltage:          pt.voltage,
      current:          pt.current,
      power:            pt.power,
      energy:           pt.energy,
      relay_status:     relayStatus,
      rssi:             pt.rssi,
      schedule_status:  scheduleStatus,
      alarm_status:     alarmStatus,
      fault_count:      openFaultMap[pt.name] || 0,
      fault_status:     hasFault ? "has_open_faults" : "no_faults",
      health_status:    healthStatus,
      connectivity:     !pt.has_iot_device ? "no_iot"
                        : isOnline  ? "online"
                        : isOffline ? "offline"
                        : "never_seen",
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    total:   enriched.length,
    summary: healthCounts,
    health_legend: {
      healthy:  "IoT online, хэвийн хэмжилт, гэмтэлгүй",
      warning:  "Online боловч хэмжилтийн утга дутуу",
      fault:    "Нээлттэй гэмтэл эсвэл хүчдэлийн хазайлт",
      offline:  "IoT 1 цагаас дээш харилцаа тасарсан",
      no_iot:   "IoT device холбогдоогүй",
    },
    control_points: enriched,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. GET /api/ai/iot/detailed
//     IoT-ийн дэлгэрэнгүй нэгтгэл — signal качество, offline бүлэг
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/iot/detailed", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/iot/detailed", "iot_detailed", req.ip);

  const [
    devices,
    noData1h,
    noData6h,
    noData24h,
    faultNodes,
    weakSignal,
    totalFpDevices,
  ] = await Promise.all([
    all(`
      SELECT
        ld.id, ld.device_name, ld.device_eui, ld.model, ld.phase, ld.is_active,
        ld.last_seen, ld.last_voltage, ld.last_current, ld.last_power, ld.last_status,
        sp.code AS sl_point_code, sp.name AS sl_point_name,
        CASE
          WHEN ld.last_seen IS NULL                               THEN 'never'
          WHEN ld.last_seen < datetime('now','-24 hours')        THEN 'offline_24h'
          WHEN ld.last_seen < datetime('now','-6 hours')         THEN 'offline_6h'
          WHEN ld.last_seen < datetime('now','-1 hour')          THEN 'offline_1h'
          ELSE 'online'
        END AS connectivity,
        COALESCE(
          (SELECT rssi FROM lora_readings WHERE device_id=ld.id ORDER BY received_at DESC LIMIT 1),
          NULL
        ) AS last_rssi,
        COALESCE(
          (SELECT snr  FROM lora_readings WHERE device_id=ld.id ORDER BY received_at DESC LIMIT 1),
          NULL
        ) AS last_snr
      FROM lora_devices ld
      LEFT JOIN sl_points sp ON sp.id = ld.sl_point_id
      WHERE ld.is_active = 1
      ORDER BY ld.last_seen DESC
    `),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1
         AND (last_seen IS NULL OR last_seen < datetime('now','-1 hour'))`),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1
         AND (last_seen IS NULL OR last_seen < datetime('now','-6 hours'))`),
    get(`SELECT COUNT(*) AS cnt FROM lora_devices WHERE is_active=1
         AND (last_seen IS NULL OR last_seen < datetime('now','-24 hours'))`),
    all(`SELECT id, device_name, device_eui, last_seen, last_status, last_voltage
         FROM lora_devices WHERE is_active=1 AND last_status='fault'
         ORDER BY last_seen DESC`),
    all(`SELECT id, device_name, device_eui, last_seen
         FROM lora_devices ld WHERE is_active=1
           AND EXISTS (
             SELECT 1 FROM lora_readings lr WHERE lr.device_id=ld.id
               AND lr.rssi IS NOT NULL AND lr.rssi < -110
               AND lr.received_at >= datetime('now','-6 hours')
           )
         LIMIT 10`),
    get(`SELECT COUNT(*) AS cnt FROM sl_feed_point_device`),
  ]);

  const onlineCount = devices.filter(d => d.connectivity === "online").length;

  const topProblemNodes = [
    ...faultNodes.map(d => ({ ...d, problem: "fault" })),
    ...weakSignal.map(d => ({ ...d, problem: "weak_signal" })),
  ].slice(0, 10);

  res.json({
    generated_at: new Date().toISOString(),
    counts: {
      total_active_nodes:     devices.length,
      feed_point_controllers: totalFpDevices?.cnt || 0,
      online:                 onlineCount,
      offline_1h:             noData1h?.cnt  || 0,
      offline_6h:             noData6h?.cnt  || 0,
      offline_24h:            noData24h?.cnt || 0,
      fault_nodes:            faultNodes.length,
      weak_signal_nodes:      weakSignal.length,
    },
    fault_nodes:        faultNodes,
    weak_signal_nodes:  weakSignal,
    top_problem_nodes:  topProblemNodes,
    all_devices:        devices,
    note: "Gateway-ийн тусдаа бүртгэл одоогоор ERP-д байхгүй. lora_devices нь node-уудыг агуулна.",
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. GET /api/ai/work-orders/search
//     Ажлын даалгавар хайх — filter, risk, дараагийн үйлдэл нэмсэн
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/work-orders/search", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/work-orders/search", "work_orders_search", req.ip);

  const {
    overdue_only,
    due_today,
    due_this_week,
    assigned_unit,
    status,
    limit: limitParam,
  } = req.query;

  let sql = `
    SELECT
      ae.id, ae.title, ae.category, ae.department, ae.status, ae.progress,
      ae.work_date, ae.start_date, ae.end_date,
      u.full_name   AS assigned_to_name,
      u.role        AS assigned_to_role,
      ae.confirm_status,
      CAST((julianday(date('now')) - julianday(ae.end_date)) AS INTEGER) AS days_overdue_raw
    FROM asset_events ae
    LEFT JOIN users u ON u.id = ae.assigned_to
    WHERE 1=1
  `;
  const params = [];

  if (overdue_only === "true") {
    sql += ` AND ae.status NOT IN ('Дууссан','Цуцлагдсан','done','cancelled')
             AND ae.end_date IS NOT NULL AND ae.end_date < date('now')`;
  }
  if (due_today === "true") {
    sql += ` AND ae.work_date = date('now')`;
  }
  if (due_this_week === "true") {
    sql += ` AND ae.work_date BETWEEN date('now') AND date('now','+7 days')`;
  }
  if (assigned_unit) {
    sql += ` AND ae.department = ?`;
    params.push(assigned_unit);
  }
  if (status) {
    sql += ` AND ae.status = ?`;
    params.push(status);
  }

  const safeLimit = Math.min(parseInt(limitParam) || 50, 100);
  sql += ` ORDER BY
    CASE WHEN ae.end_date < date('now') AND ae.status NOT IN ('Дууссан','Цуцлагдсан') THEN 0 ELSE 1 END,
    ae.end_date ASC NULLS LAST,
    ae.work_date ASC
  LIMIT ?`;
  params.push(safeLimit);

  const rows = await all(sql, params);

  const enriched = rows.map(r => {
    const isOverdue = r.end_date && r.end_date < new Date().toISOString().slice(0, 10)
      && !["Дууссан", "Цуцлагдсан", "done", "cancelled"].includes(r.status);
    const daysOverdue = isOverdue && r.days_overdue_raw > 0 ? r.days_overdue_raw : 0;

    const riskLevel = !isOverdue        ? "low"
      : daysOverdue <= 3                ? "medium"
      : daysOverdue <= 7                ? "high"
      : "critical";

    const nextAction = r.status === "Дууссан"     ? "verified хийлгэх шаардлагатай"
      : r.progress === 100                         ? "дууссан гэж тэмдэглэх"
      : r.progress > 50                            ? "явцыг шинэчлэх"
      : r.progress === 0                           ? "ажил эхлүүлэх"
      : "явцыг үргэлжлүүлэх";

    return {
      id:              r.id,
      title:           r.title,
      category:        r.category,
      department:      r.department,
      status:          r.status,
      progress:        r.progress,
      work_date:       r.work_date,
      end_date:        r.end_date     || null,
      assigned_to:     r.assigned_to_name || null,
      is_overdue:      isOverdue,
      days_overdue:    daysOverdue,
      risk_level:      riskLevel,
      next_required_action: nextAction,
    };
  });

  const summary = {
    total:    enriched.length,
    overdue:  enriched.filter(r => r.is_overdue).length,
    critical: enriched.filter(r => r.risk_level === "critical").length,
    high:     enriched.filter(r => r.risk_level === "high").length,
  };

  res.json({
    generated_at: new Date().toISOString(),
    filters_applied: { overdue_only, due_today, due_this_week, assigned_unit, status },
    summary,
    work_orders: enriched,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. GET /api/ai/faults/workflow-status
//     Гэмтлийн workflow байдал — аль статусаас хойш хэр удаж байгааг харуул
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/faults/workflow-status", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/faults/workflow-status", "fault_workflow", req.ip);

  const [byStatus, stuckOpen, recentRepaired, oldestByCategory] = await Promise.all([
    all(`SELECT status, COUNT(*) AS cnt FROM sl_faults GROUP BY status ORDER BY cnt DESC`),

    // 7 хоногоос дээш нээлттэй гэмтэл
    all(`SELECT id, location_name, category, broken_count, status, report_date,
               CAST((julianday(date('now')) - julianday(report_date)) AS INTEGER) AS days_open
         FROM sl_faults
         WHERE status='Нээлттэй'
           AND report_date < date('now','-7 days')
         ORDER BY report_date ASC LIMIT 20`),

    // Сүүлд засагдсан (sl_fault_repairs)
    all(`SELECT fr.repair_date, fr.heads_fixed, fr.notes,
               sf.location_name, sf.category, sf.status AS fault_status
         FROM sl_fault_repairs fr
         JOIN sl_faults sf ON sf.id = fr.fault_id
         ORDER BY fr.repair_date DESC LIMIT 10`),

    // Категориор хамгийн хуучин нээлттэй гэмтэл
    all(`SELECT category,
               COUNT(*) AS open_cnt,
               MIN(report_date) AS oldest_date,
               CAST((julianday(date('now')) - julianday(MIN(report_date))) AS INTEGER) AS oldest_days
         FROM sl_faults WHERE status='Нээлттэй'
         GROUP BY category ORDER BY oldest_days DESC`),
  ]);

  // Workflow дүн: open цэгүүдийн 100% of work_executions дууссан ч verified гэж тэмдэглэгдэх ёстой
  const workCompletedButNotClosed = await all(`
    SELECT sf.id, sf.location_name, sf.status AS fault_status,
           COUNT(we.id) AS total_executions,
           SUM(CASE WHEN we.progress=100 THEN 1 ELSE 0 END) AS completed_executions
    FROM sl_faults sf
    JOIN asset_events ae ON ae.title LIKE '%' || sf.location_name || '%'
    JOIN work_executions we ON we.work_log_id = ae.id
    WHERE sf.status = 'Нээлттэй'
    GROUP BY sf.id
    HAVING completed_executions > 0 AND completed_executions >= total_executions
    LIMIT 10
  `).catch(() => []);

  res.json({
    generated_at: new Date().toISOString(),
    workflow_definition: {
      steps: ["Нээлттэй", "Засагдсан", "Баталгаажсан", "Хаагдсан"],
      note: "100% дууссан ажил байсан ч заавал 'Баталгаажсан' статус авч байж 'Хаагдсан' болно.",
    },
    by_status: byStatus,
    stuck_open_over_7days: stuckOpen,
    recently_repaired:    recentRepaired,
    oldest_by_category:   oldestByCategory,
    possibly_missed_close: workCompletedButNotClosed,
    risks: [
      stuckOpen.length > 0
        ? `${stuckOpen.length} гэмтэл 7+ хоног нээлттэй хэвээр байна`
        : null,
      workCompletedButNotClosed.length > 0
        ? `${workCompletedButNotClosed.length} гэмтэл ажил дууссан ч статус шинэчлэгдээгүй байж болзошгүй`
        : null,
    ].filter(Boolean),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. GET /api/ai/audit/ai-summary
//     AI-ийн өөрийн ашиглалтын аудит — юу уншсан, хэдэн удаа, denied эсэх
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/ai/audit/ai-summary", ...AI_GUARD, async (req, res) => {
  await aiAudit(req.user.id, "/ai/audit/ai-summary", "ai_audit_summary", req.ip);

  const days = Math.min(parseInt(req.query.days) || 7, 30);

  const [
    byEndpoint,
    byDay,
    questions,
    rateLimitHits,
    totalReads,
    totalQuestions,
  ] = await Promise.all([
    all(`SELECT entity AS endpoint, COUNT(*) AS call_count,
               MIN(created_at) AS first_call, MAX(created_at) AS last_call
         FROM audit_logs
         WHERE action = 'AI_READ'
           AND created_at >= datetime('now','-${days} days')
         GROUP BY entity ORDER BY call_count DESC`),

    all(`SELECT date(created_at) AS day, COUNT(*) AS calls
         FROM audit_logs
         WHERE action IN ('AI_READ','AI_QUESTION')
           AND created_at >= datetime('now','-${days} days')
         GROUP BY day ORDER BY day DESC`),

    all(`SELECT al.created_at,
               JSON_EXTRACT(al.detail, '$.question') AS question,
               JSON_EXTRACT(al.detail, '$.scope')    AS scope
         FROM audit_logs al
         WHERE al.action = 'AI_QUESTION'
           AND al.created_at >= datetime('now','-${days} days')
         ORDER BY al.created_at DESC LIMIT 20`),

    // Rate limit hit-ийг audit log-д тусгаагүй тул ойролцоо тооцоо
    get(`SELECT COUNT(*) AS cnt FROM audit_logs
         WHERE action = 'AI_READ'
           AND created_at >= datetime('now','-1 hour')`),

    get(`SELECT COUNT(*) AS cnt FROM audit_logs
         WHERE action = 'AI_READ'
           AND created_at >= datetime('now','-${days} days')`),

    get(`SELECT COUNT(*) AS cnt FROM audit_logs
         WHERE action = 'AI_QUESTION'
           AND created_at >= datetime('now','-${days} days')`),
  ]);

  const readsPerHour = totalReads?.cnt || 0;
  const rateLimitWarning = readsPerHour > 50;

  res.json({
    generated_at: new Date().toISOString(),
    period_days: days,
    totals: {
      total_ai_reads:     totalReads?.cnt     || 0,
      total_ai_questions: totalQuestions?.cnt || 0,
    },
    reads_last_hour: rateLimitHits?.cnt || 0,
    rate_limit_warning: rateLimitWarning,
    rate_limit_threshold: "60 хүсэлт/минут/хэрэглэгч",
    by_endpoint: byEndpoint,
    by_day:      byDay,
    recent_questions: questions.map(q => ({
      timestamp: q.created_at,
      question:  q.question,
      scope:     (() => { try { return JSON.parse(q.scope || "[]"); } catch { return []; } })(),
    })),
  });
});

module.exports = router;
