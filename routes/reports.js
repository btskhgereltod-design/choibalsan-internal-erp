const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requirePermission } = require("../middleware/roles");

const router = express.Router();

// GET all schedules
router.get("/report-schedules", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT rs.*, u.full_name created_name
       FROM report_schedules rs
       LEFT JOIN users u ON u.id = rs.created_by
       ORDER BY rs.next_due ASC`
    ));
  } catch(e) { res.json([]); }
});

// GET upcoming (due within warn_days of today)
router.get("/report-schedules/upcoming", auth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT * FROM report_schedules
       WHERE is_active = 1
         AND date(next_due) <= date('now', '+' || warn_days || ' days')
       ORDER BY next_due ASC`
    );
    res.json(rows);
  } catch(e) { res.json([]); }
});

router.get("/work-report-snapshots", auth, async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = req.query.month ? Number(req.query.month) : null;
  let sql = `SELECT s.id, s.year, s.month, s.category_key, s.title, s.filter_json,
                    s.created_at, s.updated_at, u.full_name created_name
             FROM work_report_snapshots s
             LEFT JOIN users u ON u.id=s.created_by
             WHERE s.year=?`;
  const params = [year];
  if (month) { sql += " AND s.month=?"; params.push(month); }
  sql += " ORDER BY s.month DESC, s.updated_at DESC";
  try { res.json(await all(sql, params)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/work-report-snapshots/:id", auth, async (req, res) => {
  const row = await get(
    `SELECT s.*, u.full_name created_name
       FROM work_report_snapshots s
       LEFT JOIN users u ON u.id=s.created_by
      WHERE s.id=?`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: "Хадгалсан тайлан олдсонгүй" });
  try {
    res.json({
      id: row.id,
      year: row.year,
      month: row.month,
      category_key: row.category_key,
      title: row.title,
      filter: JSON.parse(row.filter_json || "[]"),
      data: JSON.parse(row.data_json || "{}"),
      created_name: row.created_name || "",
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch {
    res.status(500).json({ error: "Хадгалсан тайлангийн өгөгдөл гэмтсэн байна" });
  }
});

router.post("/work-report-snapshots", auth, requirePermission("reports_write"), async (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const filter = Array.isArray(req.body.filter) ? req.body.filter.map(x => String(x || "").trim()).filter(Boolean) : [];
  const categoryKey = filter.length ? filter.join("|").slice(0, 500) : "all";
  const data = req.body.data || {};
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "Он, сар буруу байна" });
  }
  const title = String(req.body.title || `Ажлын явцын тайлан ${year}-${String(month).padStart(2, "0")}`).trim().slice(0, 240);
  const dataJson = JSON.stringify(data);
  if (dataJson.length > 15 * 1024 * 1024) {
    return res.status(400).json({ error: "Тайлангийн өгөгдөл хэт том байна" });
  }
  try {
    const r = await run(
      `INSERT INTO work_report_snapshots(year,month,category_key,title,filter_json,data_json,created_by)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(year,month,category_key) DO UPDATE SET
         title=excluded.title,
         filter_json=excluded.filter_json,
         data_json=excluded.data_json,
         created_by=excluded.created_by,
         updated_at=CURRENT_TIMESTAMP`,
      [year, month, categoryKey, title, JSON.stringify(filter), dataJson, req.user.id]
    );
    await audit(req.user.id, "SAVE_WORK_REPORT", "work_report_snapshots", r.id || 0, title);
    res.json({ ok: true, title, category_key: categoryKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST create
router.post("/report-schedules", auth, requirePermission("reports_write"), async (req, res) => {
  const b = req.body;
  if (!b.name || !b.frequency || !b.next_due)
    return res.status(400).json({ error: "Шаардлагатай талбар дутуу" });
  try {
    const r = await run(
      `INSERT INTO report_schedules(name,frequency,next_due,responsible,recipient,warn_days,note,created_by)
       VALUES(?,?,?,?,?,?,?,?)`,
      [b.name, b.frequency, b.next_due, b.responsible||"", b.recipient||"",
       Number(b.warn_days||7), b.note||"", req.user.id]
    );
    await audit(req.user.id, "CREATE", "report_schedules", r.id, b.name);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT update
router.put("/report-schedules/:id", auth, requirePermission("reports_write"), async (req, res) => {
  const b = req.body;
  try {
    await run(
      `UPDATE report_schedules SET name=?,frequency=?,next_due=?,responsible=?,
       recipient=?,warn_days=?,note=?,is_active=? WHERE id=?`,
      [b.name, b.frequency, b.next_due, b.responsible||"", b.recipient||"",
       Number(b.warn_days||7), b.note||"", b.is_active!==undefined?b.is_active:1, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "report_schedules", req.params.id, b.name);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST mark as sent — advances next_due by frequency
router.post("/report-schedules/:id/mark-sent", auth, async (req, res) => {
  const rec = await get("SELECT * FROM report_schedules WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });

  const today = new Date().toISOString().split("T")[0];
  const due = new Date(rec.next_due);
  let isActive = 1;

  switch (rec.frequency) {
    case "Өдөр тутам":   due.setDate(due.getDate() + 1);          break;
    case "7 хоног":      due.setDate(due.getDate() + 7);          break;
    case "Сар тутам":    due.setMonth(due.getMonth() + 1);        break;
    case "Улирал тутам": due.setMonth(due.getMonth() + 3);        break;
    case "Хагас жил":    due.setMonth(due.getMonth() + 6);        break;
    case "Жил тутам":    due.setFullYear(due.getFullYear() + 1);  break;
    case "Нэг удаа":     isActive = 0;                            break;
  }

  const nextDue = due.toISOString().split("T")[0];
  try {
    await run(
      `UPDATE report_schedules SET last_sent=?, next_due=?, is_active=? WHERE id=?`,
      [today, nextDue, isActive, req.params.id]
    );
    await audit(req.user.id, "SENT", "report_schedules", req.params.id, rec.name);
    res.json({ ok: true, next_due: nextDue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE
router.delete("/report-schedules/:id", auth, requirePermission("reports_write"), async (req, res) => {
  const rec = await get("SELECT name FROM report_schedules WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM report_schedules WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "report_schedules", req.params.id, rec.name);
  res.json({ ok: true });
});

module.exports = router;
