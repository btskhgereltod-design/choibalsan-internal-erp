const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requirePermission } = require("../middleware/roles");
const router = express.Router();

router.get("/light-schedules", auth, async (req, res) => {
  try {
    const { category, year } = req.query;
    let sql = `SELECT l.*, u.full_name adjusted_by_name
               FROM light_schedule_logs l
               LEFT JOIN users u ON u.id = l.adjusted_by
               WHERE 1=1`;
    const params = [];
    if (category) { sql += " AND l.category=?"; params.push(category); }
    if (year) {
      sql += " AND (substr(l.valid_from,1,4)=? OR substr(l.adjusted_date,1,4)=?)";
      params.push(year, year);
    }
    sql += " ORDER BY l.valid_from DESC, l.id DESC";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/light-schedules", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body;
    if (!b.category || !b.valid_from) return res.status(400).json({ error: "Дутуу мэдээлэл" });
    const r = await run(
      `INSERT INTO light_schedule_logs(category,adjusted_date,valid_from,on_time,off_time,is_always_off,adjusted_by,notes)
       VALUES(?,?,?,?,?,?,?,?)`,
      [b.category, b.adjusted_date || b.valid_from, b.valid_from,
       b.on_time || null, b.off_time || null,
       b.is_always_off ? 1 : 0, req.user.id, b.notes || ""]
    );
    await audit(req.user.id, "CREATE", "light_schedule_logs", r.id,
      `${b.category}: ${b.valid_from} ${b.is_always_off ? "унтраасан" : `${b.on_time}–${b.off_time}`}`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/light-schedules/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body;
    await run(
      `UPDATE light_schedule_logs SET category=?,adjusted_date=?,valid_from=?,on_time=?,off_time=?,
       is_always_off=?,notes=? WHERE id=?`,
      [b.category, b.adjusted_date || b.valid_from, b.valid_from,
       b.on_time || null, b.off_time || null,
       b.is_always_off ? 1 : 0, b.notes || "", req.params.id]
    );
    await audit(req.user.id, "UPDATE", "light_schedule_logs", req.params.id, b.category);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/light-schedules/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const row = await get("SELECT category,valid_from,on_time,off_time,is_always_off FROM light_schedule_logs WHERE id=?", [req.params.id]);
    await run("DELETE FROM light_schedule_logs WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "light_schedule_logs", req.params.id,
      row ? `${row.category}: ${row.valid_from} ${row.is_always_off ? "унтраасан" : `${row.on_time}–${row.off_time}`}` : "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
