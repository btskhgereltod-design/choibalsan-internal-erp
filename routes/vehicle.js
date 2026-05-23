const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");

const router = express.Router();

// ── Vehicle Registry ──────────────────────────────────────────

router.get("/vehicles", auth, async (_req, res) => {
  const rows = await all(`
    SELECT v.*, u.full_name driver_name,
      (SELECT COUNT(*) FROM vehicle_daily_inspections d WHERE d.vehicle_id=v.id) daily_count,
      (SELECT COUNT(*) FROM vehicle_monthly_inspections m WHERE m.vehicle_id=v.id) monthly_count,
      (SELECT COUNT(*) FROM vehicle_repairs r WHERE r.vehicle_id=v.id AND r.repair_status!='Дууссан') active_repairs,
      COALESCE((SELECT MAX(d.insp_date) FROM vehicle_daily_inspections d WHERE d.vehicle_id=v.id), v.last_daily_insp) latest_daily_insp,
      COALESCE((SELECT MAX(printf('%04d-%02d', m.insp_year, m.insp_month)) FROM vehicle_monthly_inspections m WHERE m.vehicle_id=v.id), v.last_monthly_insp) latest_monthly_insp
    FROM vehicles v
    LEFT JOIN users u ON u.id = v.driver_id
    ORDER BY v.created_at DESC`);
  res.json(rows);
});

router.post("/vehicles", auth, requirePermission("vehicle_write"), async (req, res) => {
  const b = req.body;
  if (!b.plate_no || !b.vehicle_type) return res.status(400).json({ error: "Дугаар болон төрлийг оруулна уу" });
  const r = await run(
    `INSERT INTO vehicles(plate_no,vehicle_type,brand,model,manufacture_year,status,driver_id,note,created_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.plate_no, b.vehicle_type, b.brand||"", b.model||"",
     Number(b.manufacture_year||0), b.status||"Ажилд",
     b.driver_id||null, b.note||"", req.user.id]);
  await audit(req.user.id, "CREATE", "vehicles", r.id, b.plate_no);
  res.json({ id: r.id });
});

router.put("/vehicles/:id", auth, requirePermission("vehicle_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE vehicles SET plate_no=?,vehicle_type=?,brand=?,model=?,manufacture_year=?,
     status=?,driver_id=?,note=? WHERE id=?`,
    [b.plate_no, b.vehicle_type, b.brand||"", b.model||"",
     Number(b.manufacture_year||0), b.status||"Ажилд",
     b.driver_id||null, b.note||"", req.params.id]);
  await audit(req.user.id, "UPDATE", "vehicles", req.params.id, b.plate_no);
  res.json({ ok: true });
});

router.delete("/vehicles/:id", auth, requireRole("director"), async (req, res) => {
  await run("DELETE FROM vehicles WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "vehicles", req.params.id, "");
  res.json({ ok: true });
});

// ── Vehicle Dashboard ─────────────────────────────────────────

router.get("/vehicle-dashboard", auth, async (_req, res) => {
  const [total, active, inRepair, bigRepair, needInsp] = await Promise.all([
    get("SELECT COUNT(*) cnt FROM vehicles"),
    get("SELECT COUNT(*) cnt FROM vehicles WHERE status='Ажилд'"),
    get("SELECT COUNT(*) cnt FROM vehicles WHERE status='Засварт'"),
    get("SELECT COUNT(*) cnt FROM vehicles WHERE status='Их засвартай'"),
    get("SELECT COUNT(*) cnt FROM vehicles WHERE status='Үзлэг хийгдэх шаардлагатай'"),
  ]);
  const todayInsp = await all(`SELECT vehicle_id FROM vehicle_daily_inspections WHERE insp_date=date('now')`);
  const todaySet = new Set(todayInsp.map(r => r.vehicle_id));
  const allActive = await all("SELECT id,plate_no,vehicle_type FROM vehicles WHERE status='Ажилд'");
  const uninspected = allActive.filter(v => !todaySet.has(v.id));
  res.json({
    total: total.cnt, active: active.cnt, in_repair: inRepair.cnt,
    big_repair: bigRepair.cnt, need_insp: needInsp.cnt, uninspected
  });
});

// ── Daily Inspections ─────────────────────────────────────────

// Deprecated: see docs/deprecated-endpoints.md
router.get("/vehicles/:id/daily-inspections", auth, async (req, res) => {
  const rows = await all(`
    SELECT d.*, u.full_name inspector_name, du.full_name driver_name, rv.full_name reviewer_name, v.plate_no
    FROM vehicle_daily_inspections d
    LEFT JOIN users u ON u.id = d.inspector_id
    LEFT JOIN users du ON du.id = d.driver_id
    LEFT JOIN users rv ON rv.id = d.reviewer_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.vehicle_id=? ORDER BY d.insp_date DESC LIMIT 30`, [req.params.id]);
  res.json(rows);
});

router.get("/vehicle-daily-inspections", auth, async (req, res) => {
  const { vehicle_id } = req.query;
  const rows = await all(`
    SELECT d.*, u.full_name inspector_name, du.full_name driver_name, rv.full_name reviewer_name, v.plate_no, v.vehicle_type
    FROM vehicle_daily_inspections d
    LEFT JOIN users u ON u.id = d.inspector_id
    LEFT JOIN users du ON du.id = d.driver_id
    LEFT JOIN users rv ON rv.id = d.reviewer_id
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    ${vehicle_id ? "WHERE d.vehicle_id=?" : ""}
    ORDER BY d.insp_date DESC LIMIT 60`,
    vehicle_id ? [vehicle_id] : []);
  res.json(rows);
});

router.post("/vehicle-daily-inspections", auth, requireRole("director", "chief_engineer", "engineer", "electric"), async (req, res) => {
  const b = req.body;
  if (!b.vehicle_id || !b.insp_date) return res.status(400).json({ error: "Техник болон огноо шаардлагатай" });
  const veh = await get("SELECT driver_id FROM vehicles WHERE id=?", [b.vehicle_id]);
  const driverId = b.driver_id || veh?.driver_id || null;
  const hasIssue = (b.items||[]).some(i => i.status === "Зөрчилтэй");
  const r = await run(
    `INSERT INTO vehicle_daily_inspections(vehicle_id,insp_date,inspector_id,driver_id,items_json,overall_ok,review_status,work_permit,note,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.vehicle_id, b.insp_date, b.inspector_id || req.user.id, driverId,
     JSON.stringify(b.items||[]), hasIssue ? 0 : 1, "ХАБЭА хүлээгдэж байна", 0, b.note||"", req.user.id]);
  await run("UPDATE vehicles SET last_daily_insp=? WHERE id=?", [b.insp_date, b.vehicle_id]);
  if (hasIssue)
    await run("UPDATE vehicles SET status='Үзлэг хийгдэх шаардлагатай' WHERE id=? AND status='Ажилд'", [b.vehicle_id]);
  else
    await run("UPDATE vehicles SET status='Ажилд' WHERE id=? AND status='Үзлэг хийгдэх шаардлагатай'", [b.vehicle_id]);
  await audit(req.user.id, "CREATE", "vehicle_daily_inspections", r.id, `${b.vehicle_id}·${b.insp_date}`);
  res.json({ id: r.id });
});

router.patch("/vehicle-daily-inspections/:id/review", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body;
  const status = b.approved ? "Ажилд гарах зөвшөөрөлтэй" : "Зөвшөөрөл татгалзсан";
  const row = await get("SELECT vehicle_id FROM vehicle_daily_inspections WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Үзлэг олдсонгүй" });
  await run(`UPDATE vehicle_daily_inspections
    SET review_status=?, reviewer_id=?, reviewed_at=CURRENT_TIMESTAMP, review_note=?, work_permit=?
    WHERE id=?`, [status, req.user.id, b.note || "", b.approved ? 1 : 0, req.params.id]);
  await run(`UPDATE vehicles SET status=? WHERE id=?`,
    [b.approved ? "Ажилд" : "Үзлэг хийгдэх шаардлагатай", row.vehicle_id]);
  await audit(req.user.id, "REVIEW", "vehicle_daily_inspections", req.params.id, status);
  res.json({ ok: true });
});

// ── Weekly Inspections ─────────────────────────────────────────

router.get("/vehicle-weekly-inspections", auth, async (req, res) => {
  const { vehicle_id } = req.query;
  const rows = await all(`
    SELECT w.*, u.full_name hse_name, v.plate_no, v.vehicle_type
    FROM vehicle_weekly_inspections w
    LEFT JOIN users u ON u.id = w.hse_id
    LEFT JOIN vehicles v ON v.id = w.vehicle_id
    ${vehicle_id ? "WHERE w.vehicle_id=?" : ""}
    ORDER BY w.week_start DESC LIMIT 60`,
    vehicle_id ? [vehicle_id] : []);
  res.json(rows);
});

router.post("/vehicle-weekly-inspections", auth, requireRole("director", "safety"), async (req, res) => {
  const b = req.body;
  if (!b.vehicle_id || !b.week_start) return res.status(400).json({ error: "Техник болон 7 хоногийн огноо шаардлагатай" });
  const hasIssue = (b.items||[]).some(i => i.status === "Зөрчилтэй");
  const r = await run(
    `INSERT INTO vehicle_weekly_inspections(vehicle_id,week_start,hse_id,items_json,overall_ok,note,created_by)
     VALUES(?,?,?,?,?,?,?)`,
    [b.vehicle_id, b.week_start, b.hse_id || req.user.id, JSON.stringify(b.items||[]), hasIssue ? 0 : 1, b.note||"", req.user.id]);
  if (hasIssue) await run("UPDATE vehicles SET status='Үзлэг хийгдэх шаардлагатай' WHERE id=? AND status='Ажилд'", [b.vehicle_id]);
  await audit(req.user.id, "CREATE", "vehicle_weekly_inspections", r.id, `${b.vehicle_id}·${b.week_start}`);
  res.json({ id: r.id });
});

// ── Monthly Inspections ───────────────────────────────────────

router.get("/vehicle-monthly-inspections", auth, async (req, res) => {
  const { vehicle_id } = req.query;
  const rows = await all(`
    SELECT m.*, u1.full_name mechanic_name, u2.full_name engineer_name, ap.full_name approver_name, v.plate_no, v.vehicle_type
    FROM vehicle_monthly_inspections m
    LEFT JOIN users u1 ON u1.id = m.mechanic_id
    LEFT JOIN users u2 ON u2.id = m.engineer_id
    LEFT JOIN users ap ON ap.id = m.approved_by
    LEFT JOIN vehicles v ON v.id = m.vehicle_id
    ${vehicle_id ? "WHERE m.vehicle_id=?" : ""}
    ORDER BY m.insp_year DESC, m.insp_month DESC LIMIT 60`,
    vehicle_id ? [vehicle_id] : []);
  res.json(rows);
});

router.post("/vehicle-monthly-inspections", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body;
  if (!b.vehicle_id || !b.insp_year || !b.insp_month) return res.status(400).json({ error: "Техник болон сар шаардлагатай" });
  const hasIssue = (b.items||[]).some(i => i.status === "Зөрчилтэй");
  const r = await run(
    `INSERT INTO vehicle_monthly_inspections(vehicle_id,insp_year,insp_month,mechanic_id,engineer_id,items_json,overall_ok,approval_status,note,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.vehicle_id, b.insp_year, b.insp_month, b.mechanic_id||null, b.engineer_id||null,
     JSON.stringify(b.items||[]), hasIssue ? 0 : 1, "Ерөнхий инженер хүлээгдэж байна", b.note||"", req.user.id]);
  const mo = `${b.insp_year}-${String(b.insp_month).padStart(2,"0")}-01`;
  await run("UPDATE vehicles SET last_monthly_insp=? WHERE id=?", [mo, b.vehicle_id]);
  await audit(req.user.id, "CREATE", "vehicle_monthly_inspections", r.id, `${b.vehicle_id}·${b.insp_year}/${b.insp_month}`);
  res.json({ id: r.id });
});

router.patch("/vehicle-monthly-inspections/:id/approve", auth, requireRole("director", "chief_engineer"), async (req, res) => {
  const b = req.body;
  const status = b.approved ? "Баталгаажсан" : "Буцаасан";
  await run(`UPDATE vehicle_monthly_inspections
    SET approval_status=?, approved_by=?, approved_at=CURRENT_TIMESTAMP, approval_note=?
    WHERE id=?`, [status, req.user.id, b.note || "", req.params.id]);
  await audit(req.user.id, "APPROVE", "vehicle_monthly_inspections", req.params.id, status);
  res.json({ ok: true });
});

// ── Repairs ───────────────────────────────────────────────────

router.get("/vehicle-repairs", auth, async (req, res) => {
  const { vehicle_id } = req.query;
  const rows = await all(`
    SELECT r.*, u1.full_name technician_name, u2.full_name engineer_name, v.plate_no, v.vehicle_type
    FROM vehicle_repairs r
    LEFT JOIN users u1 ON u1.id = r.technician_id
    LEFT JOIN users u2 ON u2.id = r.engineer_id
    LEFT JOIN vehicles v ON v.id = r.vehicle_id
    ${vehicle_id ? "WHERE r.vehicle_id=?" : ""}
    ORDER BY r.repair_date DESC LIMIT 100`,
    vehicle_id ? [vehicle_id] : []);
  res.json(rows);
});

router.post("/vehicle-repairs", auth, requirePermission("vehicle_write"), async (req, res) => {
  const b = req.body;
  if (!b.vehicle_id || !b.repair_date || !b.repair_type) return res.status(400).json({ error: "Шаардлагатай талбарууд дутуу" });
  const r = await run(
    `INSERT INTO vehicle_repairs(vehicle_id,repair_date,repair_type,act_no,technician_id,engineer_id,description,parts_json,cost,repair_status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [b.vehicle_id, b.repair_date, b.repair_type, b.act_no||"",
     b.technician_id||null, b.engineer_id||null,
     b.description||"", JSON.stringify(b.parts||[]),
     Number(b.cost||0), b.repair_status||"Хийгдэж байна", req.user.id]);
  if (b.repair_type === "Их засвар")
    await run("UPDATE vehicles SET status='Их засвартай' WHERE id=?", [b.vehicle_id]);
  else if ((b.repair_status||"") !== "Дууссан")
    await run("UPDATE vehicles SET status='Засварт' WHERE id=? AND status='Ажилд'", [b.vehicle_id]);
  await audit(req.user.id, "CREATE", "vehicle_repairs", r.id, `${b.repair_type}·${b.vehicle_id}`);
  res.json({ id: r.id });
});

router.patch("/vehicle-repairs/:id/status", auth, async (req, res) => {
  const { repair_status, vehicle_id } = req.body;
  await run("UPDATE vehicle_repairs SET repair_status=? WHERE id=?", [repair_status, req.params.id]);
  if (repair_status === "Дууссан" && vehicle_id) {
    const active = await get("SELECT COUNT(*) cnt FROM vehicle_repairs WHERE vehicle_id=? AND repair_status!='Дууссан' AND id!=?", [vehicle_id, req.params.id]);
    if (active.cnt === 0) await run("UPDATE vehicles SET status='Ажилд' WHERE id=?", [vehicle_id]);
  }
  res.json({ ok: true });
});

router.delete("/vehicle-repairs/:id", auth, requireRole("director"), async (req, res) => {
  await run("DELETE FROM vehicle_repairs WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
