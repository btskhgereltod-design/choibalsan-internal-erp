const express = require("express");
const { run, all, get, auth, audit, upload } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");
const XLSX    = require("xlsx");
const router  = express.Router();

// ── Organizations ─────────────────────────────────────────────
router.get("/sl-orgs", auth, async (req, res) => {
  try { res.json(await all("SELECT * FROM sl_organizations ORDER BY is_own DESC, name")); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-orgs", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    const r = await run(
      "INSERT INTO sl_organizations(name,short_name,contact_person,phone,notes,is_own) VALUES(?,?,?,?,?,?)",
      [b.name, b.short_name||null, b.contact_person||null, b.phone||null, b.notes||null, b.is_own||0]
    );
    await audit(req.user.id, "CREATE", "sl_organizations", r.id, b.name);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-orgs/:id", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    await run(
      "UPDATE sl_organizations SET name=?,short_name=?,contact_person=?,phone=?,notes=? WHERE id=?",
      [b.name, b.short_name||null, b.contact_person||null, b.phone||null, b.notes||null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_organizations", req.params.id, b.name);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Points ────────────────────────────────────────────────────
router.get("/sl-points", auth, async (req, res) => {
  try {
    const { status, org_id } = req.query;
    let sql = `SELECT p.*, o.name as org_name, o.short_name as org_short, o.is_own
               FROM sl_points p
               LEFT JOIN sl_organizations o ON o.id = p.org_id
               WHERE 1=1`;
    const params = [];
    if (status) { sql += " AND p.status=?"; params.push(status); }
    if (org_id) { sql += " AND p.org_id=?"; params.push(org_id); }
    sql += " ORDER BY p.code";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-points", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    const r = await run(
      `INSERT INTO sl_points(code,name,location,gps_lat,gps_lng,org_id,meter_no,
       lamp_count,wattage_per_lamp,status,install_date,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.code, b.name, b.location||null, b.gps_lat||null, b.gps_lng||null,
       b.org_id||null, b.meter_no||null, b.lamp_count||1, b.wattage_per_lamp||0,
       b.status||"active", b.install_date||null, b.notes||null, req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_points", r.id, `${b.code}: ${b.name}`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-points/:id", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    await run(
      `UPDATE sl_points SET code=?,name=?,location=?,gps_lat=?,gps_lng=?,org_id=?,
       meter_no=?,lamp_count=?,wattage_per_lamp=?,status=?,install_date=?,remove_date=?,
       notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.code, b.name, b.location||null, b.gps_lat||null, b.gps_lng||null, b.org_id||null,
       b.meter_no||null, b.lamp_count||1, b.wattage_per_lamp||0, b.status,
       b.install_date||null, b.remove_date||null, b.notes||null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_points", req.params.id, `${b.code}: ${b.name}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-points/:id", auth, requireRole("director"), async (req, res) => {
  try {
    await run("DELETE FROM sl_points WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_points", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Update GPS coordinates ────────────────────────────────────
router.put("/sl-points/:id/gps", auth, async (req, res) => {
  try {
    const { gps_lat, gps_lng } = req.body;
    await run(
      "UPDATE sl_points SET gps_lat=?, gps_lng=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [gps_lat || null, gps_lng || null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Link meter point to sl_point ─────────────────────────────
router.put("/sl-points/:id/link-meter", auth, async (req, res) => {
  try {
    const { meter_point_id, meter_no } = req.body;
    await run(
      "UPDATE sl_points SET meter_point_id=?, meter_no=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [meter_point_id || null, meter_no || null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Single sl_point with photos ───────────────────────────────
router.get("/sl-points/:id", auth, async (req, res) => {
  try {
    const pt = await get(
      `SELECT p.*, o.name as org_name,
              mp.meter_no as mp_meter_no, mp.name as mp_name, mp.location as mp_location
       FROM sl_points p
       LEFT JOIN sl_organizations o ON o.id = p.org_id
       LEFT JOIN meter_points mp ON mp.id = p.meter_point_id
       WHERE p.id=?`, [req.params.id]
    );
    if (!pt) return res.status(404).json({ error: "Олдсонгүй" });
    pt.photos = await all(
      `SELECT ph.*, u.full_name uploader_name FROM sl_point_photos ph
       LEFT JOIN users u ON u.id = ph.uploaded_by
       WHERE ph.sl_point_id=? ORDER BY ph.uploaded_at DESC`, [req.params.id]
    );
    pt.docs = await all(
      `SELECT d.*, u.full_name uploader_name FROM sl_point_docs d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.sl_point_id=? ORDER BY d.uploaded_at DESC`, [req.params.id]
    );
    pt.history = await all(
      `SELECT w.*, u.full_name created_name, c.full_name confirmed_name
       FROM asset_events w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN users c ON c.id = w.confirmed_by
       WHERE w.sl_point_id=?
       ORDER BY COALESCE(w.work_date,w.start_date,w.created_at) DESC, w.id DESC
       LIMIT 50`, [req.params.id]
    );
    res.json(pt);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-points/:id/photos", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Зураг оруулаагүй" });
  try {
    const r = await run(
      `INSERT INTO sl_point_photos(sl_point_id, file_path, description, uploaded_by)
       VALUES(?,?,?,?)`,
      [req.params.id, req.file.path.replace(/\\/g, "/"), req.body.description||"", req.user.id]
    );
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-point-photos/:photoId", auth, async (req, res) => {
  try {
    await run("DELETE FROM sl_point_photos WHERE id=?", [req.params.photoId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Passport docs (PDF / scans) ───────────────────────────────
router.post("/sl-points/:id/docs", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй" });
  try {
    const r = await run(
      `INSERT INTO sl_point_docs(sl_point_id, file_path, file_name, description, uploaded_by)
       VALUES(?,?,?,?,?)`,
      [req.params.id,
       req.file.path.replace(/\\/g, "/"),
       req.file.originalname || req.file.filename,
       req.body.description || "",
       req.user.id]
    );
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-point-docs/:docId", auth, async (req, res) => {
  try {
    await run("DELETE FROM sl_point_docs WHERE id=?", [req.params.docId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Points for reading entry (with existing readings) ─────────
router.get("/sl-points-for-reading", auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const rows = await all(
      `SELECT p.*, o.name as org_name, o.is_own,
       r.id as reading_id, r.prev_reading, r.curr_reading, r.kwh_used,
       r.rate, r.amount, r.in_our_bill, r.anomaly_flag, r.anomaly_note, r.notes as reading_notes
       FROM sl_points p
       LEFT JOIN sl_organizations o ON o.id = p.org_id
       LEFT JOIN sl_monthly_readings r ON r.point_id=p.id AND r.year=? AND r.month=?
       WHERE p.status='active'
       ORDER BY p.code`,
      [year||0, month||0]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Monthly Readings ──────────────────────────────────────────
router.get("/sl-readings", auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    let sql = `SELECT r.*, p.code, p.name as point_name, p.location, p.meter_no,
               p.lamp_count, p.wattage_per_lamp, o.name as org_name, o.is_own
               FROM sl_monthly_readings r
               JOIN sl_points p ON p.id = r.point_id
               LEFT JOIN sl_organizations o ON o.id = p.org_id
               WHERE 1=1`;
    const params = [];
    if (year)  { sql += " AND r.year=?";  params.push(year); }
    if (month) { sql += " AND r.month=?"; params.push(month); }
    sql += " ORDER BY p.code";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-readings/bulk", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const { year, month, readings } = req.body;
    let savedCount = 0;
    for (const r of readings) {
      const kwh = Math.max(0, (parseFloat(r.curr_reading)||0) - (parseFloat(r.prev_reading)||0));
      const amount = kwh * (parseFloat(r.rate)||0);

      // Anomaly: kwh > 50% above average of last 3 months
      const prev = await get(
        `SELECT AVG(kwh_used) as avg FROM (
           SELECT kwh_used FROM sl_monthly_readings
           WHERE point_id=? AND kwh_used > 0 AND NOT (year=? AND month=?)
           ORDER BY year DESC, month DESC LIMIT 3
         )`,
        [r.point_id, year, month]
      );
      const avg = parseFloat(prev?.avg) || 0;
      const anomaly = (avg > 0 && kwh > avg * 1.5) ? 1 : 0;
      const anomalyNote = anomaly
        ? `Дундаж ${avg.toFixed(0)} кВт·ц-аас ${Math.round((kwh/avg-1)*100)}% их`
        : null;

      const existing = await get(
        "SELECT id FROM sl_monthly_readings WHERE point_id=? AND year=? AND month=?",
        [r.point_id, year, month]
      );
      if (existing) {
        await run(
          `UPDATE sl_monthly_readings SET prev_reading=?,curr_reading=?,kwh_used=?,rate=?,
           amount=?,in_our_bill=?,anomaly_flag=?,anomaly_note=?,notes=?,
           entered_by=?,entered_at=CURRENT_TIMESTAMP WHERE id=?`,
          [r.prev_reading||0, r.curr_reading||0, kwh, r.rate||0, amount,
           r.in_our_bill??1, anomaly, anomalyNote, r.notes||null, req.user.id, existing.id]
        );
      } else {
        await run(
          `INSERT INTO sl_monthly_readings(point_id,year,month,prev_reading,curr_reading,
           kwh_used,rate,amount,in_our_bill,anomaly_flag,anomaly_note,notes,entered_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.point_id, year, month, r.prev_reading||0, r.curr_reading||0, kwh,
           r.rate||0, amount, r.in_our_bill??1, anomaly, anomalyNote, r.notes||null, req.user.id]
        );
      }
      savedCount++;
    }
    await audit(req.user.id, "BULK_SAVE", "sl_monthly_readings", 0, `${year}/${month}: ${savedCount} уншилт`);
    res.json({ ok: true, count: savedCount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-readings/:id/clear-anomaly", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    await run("UPDATE sl_monthly_readings SET anomaly_flag=0,anomaly_note=NULL WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Bills ─────────────────────────────────────────────────────
router.get("/sl-bills", auth, async (req, res) => {
  try {
    const { year } = req.query;
    let sql = "SELECT * FROM sl_bills WHERE 1=1";
    const params = [];
    if (year) { sql += " AND year=?"; params.push(year); }
    sql += " ORDER BY year DESC, month DESC";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-bills", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    // Our expected from readings (only our org's points, marked in_our_bill=1)
    const ours = await get(
      `SELECT COALESCE(SUM(r.kwh_used),0) as kwh, COALESCE(SUM(r.amount),0) as amt
       FROM sl_monthly_readings r
       JOIN sl_points p ON p.id=r.point_id
       JOIN sl_organizations o ON o.id=p.org_id
       WHERE r.year=? AND r.month=? AND r.in_our_bill=1 AND o.is_own=1`,
      [b.year, b.month]
    );
    // Points that are NOT ours but included in our bill (flags discrepancy)
    const foreign = await get(
      `SELECT COALESCE(SUM(r.kwh_used),0) as kwh, COALESCE(SUM(r.amount),0) as amt
       FROM sl_monthly_readings r
       JOIN sl_points p ON p.id=r.point_id
       JOIN sl_organizations o ON o.id=p.org_id
       WHERE r.year=? AND r.month=? AND r.in_our_bill=1 AND o.is_own=0`,
      [b.year, b.month]
    );
    const ourKwh  = parseFloat(ours?.kwh) || 0;
    const ourAmt  = parseFloat(ours?.amt) || 0;
    const forKwh  = parseFloat(foreign?.kwh) || 0;
    const forAmt  = parseFloat(foreign?.amt) || 0;
    const diffKwh = (parseFloat(b.total_kwh)||0) - ourKwh;
    const diffAmt = (parseFloat(b.total_amount)||0) - ourAmt;

    const existing = await get("SELECT id FROM sl_bills WHERE year=? AND month=?", [b.year, b.month]);
    let id;
    if (existing) {
      await run(
        `UPDATE sl_bills SET bill_no=?,bill_date=?,supplier_name=?,total_kwh=?,total_amount=?,
         our_kwh=?,our_amount=?,diff_kwh=?,diff_amount=?,foreign_kwh=?,foreign_amount=?,
         status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [b.bill_no||null, b.bill_date||null, b.supplier_name||null,
         b.total_kwh||0, b.total_amount||0, ourKwh, ourAmt, diffKwh, diffAmt,
         forKwh, forAmt, b.status||"pending", b.notes||null, existing.id]
      );
      id = existing.id;
      await audit(req.user.id, "UPDATE", "sl_bills", id, `${b.year}/${b.month}`);
    } else {
      const r = await run(
        `INSERT INTO sl_bills(bill_no,bill_date,year,month,supplier_name,total_kwh,total_amount,
         our_kwh,our_amount,diff_kwh,diff_amount,foreign_kwh,foreign_amount,status,notes,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.bill_no||null, b.bill_date||null, b.year, b.month, b.supplier_name||null,
         b.total_kwh||0, b.total_amount||0, ourKwh, ourAmt, diffKwh, diffAmt,
         forKwh, forAmt, b.status||"pending", b.notes||null, req.user.id]
      );
      id = r.id;
      await audit(req.user.id, "CREATE", "sl_bills", id, `${b.year}/${b.month}`);
    }
    res.json({ id, our_kwh: ourKwh, our_amount: ourAmt,
               diff_kwh: diffKwh, diff_amount: diffAmt,
               foreign_kwh: forKwh, foreign_amount: forAmt });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-bills/:id/status", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    await run("UPDATE sl_bills SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [req.body.status, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Transfers ─────────────────────────────────────────────────
router.get("/sl-transfers", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT t.*, p.code, p.name as point_name, p.location,
       fo.name as from_org_name, torg.name as to_org_name
       FROM sl_transfers t
       JOIN sl_points p ON p.id = t.point_id
       LEFT JOIN sl_organizations fo   ON fo.id   = t.from_org_id
       LEFT JOIN sl_organizations torg ON torg.id = t.to_org_id
       ORDER BY t.transfer_date DESC`
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-transfers", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    const b = req.body;
    const r = await run(
      `INSERT INTO sl_transfers(point_id,from_org_id,to_org_id,transfer_date,doc_no,reason,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?)`,
      [b.point_id, b.from_org_id||null, b.to_org_id||null,
       b.transfer_date, b.doc_no||null, b.reason||null, b.notes||null, req.user.id]
    );
    await run("UPDATE sl_points SET org_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [b.to_org_id, b.point_id]);
    await audit(req.user.id, "CREATE", "sl_transfers", r.id, `Цэг #${b.point_id} шилжилт`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Summary for dashboard ─────────────────────────────────────
router.get("/sl-summary", auth, async (req, res) => {
  try {
    const { year, month } = req.query;
    const [totalPoints, ownPoints] = await Promise.all([
      get("SELECT COUNT(*) as cnt FROM sl_points WHERE status='active'"),
      get(`SELECT COUNT(*) as cnt FROM sl_points p
           JOIN sl_organizations o ON o.id=p.org_id
           WHERE p.status='active' AND o.is_own=1`)
    ]);

    let bill = null, anomalies = [], foreignInBill = [], recentBills = [];
    if (year && month) {
      [bill, anomalies, foreignInBill] = await Promise.all([
        get("SELECT * FROM sl_bills WHERE year=? AND month=?", [year, month]),
        all(`SELECT r.*, p.code, p.name as point_name
             FROM sl_monthly_readings r
             JOIN sl_points p ON p.id=r.point_id
             WHERE r.anomaly_flag=1
             ORDER BY r.year DESC, r.month DESC LIMIT 20`),
        all(`SELECT r.*, p.code, p.name as point_name, o.name as org_name
             FROM sl_monthly_readings r
             JOIN sl_points p ON p.id=r.point_id
             LEFT JOIN sl_organizations o ON o.id=p.org_id
             WHERE r.year=? AND r.month=? AND r.in_our_bill=1 AND o.is_own=0
             ORDER BY p.code`, [year, month])
      ]);
    } else {
      anomalies = await all(
        `SELECT r.*, p.code, p.name as point_name
         FROM sl_monthly_readings r
         JOIN sl_points p ON p.id=r.point_id
         WHERE r.anomaly_flag=1
         ORDER BY r.year DESC, r.month DESC LIMIT 20`
      );
    }

    recentBills = await all("SELECT * FROM sl_bills ORDER BY year DESC, month DESC LIMIT 12");

    res.json({
      totalPoints: totalPoints?.cnt || 0,
      ownPoints: ownPoints?.cnt || 0,
      bill, anomalies, foreignInBill, recentBills
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Smart Import ──────────────────────────────────────────────

// Analyze uploaded Excel: return preview + auto-detected columns
router.post("/sl-import/analyze", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй байна" });
  try {
    const wb = XLSX.readFile(req.file.path);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Remove empty rows
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ""));

    // Try to auto-detect header row (first row with 3+ non-empty cells)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
      if (nonEmpty[i].filter(c => c !== "").length >= 3) { headerIdx = i; break; }
    }
    const headers = nonEmpty[headerIdx].map(h => String(h).trim());
    const dataRows = nonEmpty.slice(headerIdx + 1).slice(0, 200);

    // Auto-detect column mapping by header name keywords
    const guess = (keywords) => {
      const idx = headers.findIndex(h =>
        keywords.some(k => h.toLowerCase().includes(k.toLowerCase()))
      );
      return idx >= 0 ? idx : null;
    };

    const colMap = {
      code:     guess(["код","code","цэг","байршил","location","нэр"]),
      prev:     guess(["өмнөх","урьд","before","previous","prev","эхний"]),
      curr:     guess(["одоогийн","curr","поток","current","дараах","хоёр"]),
      kwh:      guess(["квт","kwh","зарцуулалт","хэмжилт","consumption"]),
      rate:     guess(["тариф","rate","үнэ","price","ₓ"]),
      amount:   guess(["дүн","amount","нийт","total","₮"]),
      meter_no: guess(["тоолуур","meter","no","дугаар"]),
    };

    // Get existing points for matching
    const points = await all("SELECT id,code,name,location,meter_no FROM sl_points WHERE status='active'");

    res.json({
      sheets: wb.SheetNames,
      usedSheet: sheetName,
      headers,
      colMap,
      preview: dataRows.slice(0, 8),
      totalRows: dataRows.length,
      points: points.map(p => ({ id: p.id, code: p.code, name: p.name, meter_no: p.meter_no }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Import readings from analyzed Excel
router.post("/sl-import/readings", auth, requirePermission("sl_billing"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй байна" });
  try {
    const { year, month, colCode, colPrev, colCurr, colRate, colInBill } = req.body;
    if (!year || !month) return res.status(400).json({ error: "Он, сар заавал шаардлагатай" });

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ""));

    // Find header row
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
      if (nonEmpty[i].filter(c => c !== "").length >= 3) { headerIdx = i; break; }
    }
    const dataRows = nonEmpty.slice(headerIdx + 1);

    const points = await all("SELECT id,code,name,location,meter_no FROM sl_points WHERE status='active'");

    // Match point by code or name similarity
    function matchPoint(cellVal) {
      const v = String(cellVal).trim().toUpperCase();
      if (!v) return null;
      let found = points.find(p => p.code.toUpperCase() === v);
      if (!found) found = points.find(p => p.meter_no && p.meter_no.trim() === v);
      if (!found) found = points.find(p => p.name.toUpperCase().includes(v) || v.includes(p.name.toUpperCase().slice(0,4)));
      return found;
    }

    let imported = 0, skipped = 0, errors = [];
    for (const row of dataRows) {
      const codeCell = colCode >= 0 ? row[parseInt(colCode)] : "";
      const prev = parseFloat(row[parseInt(colPrev)]) || 0;
      const curr = parseFloat(row[parseInt(colCurr)]) || 0;
      const rate = parseFloat(row[parseInt(colRate)]) || 0;
      const inBill = colInBill >= 0 ? (row[parseInt(colInBill)] ? 1 : 1) : 1;

      if (!codeCell && prev === 0 && curr === 0) continue;

      const pt = matchPoint(codeCell);
      if (!pt) { skipped++; if (codeCell) errors.push(`Цэг олдсонгүй: "${codeCell}"`); continue; }

      const kwh = Math.max(0, curr - prev);
      const amount = kwh * rate;

      const prevAvg = await get(
        `SELECT AVG(kwh_used) as avg FROM (
           SELECT kwh_used FROM sl_monthly_readings
           WHERE point_id=? AND kwh_used>0 AND NOT (year=? AND month=?)
           ORDER BY year DESC, month DESC LIMIT 3)`,
        [pt.id, year, month]
      );
      const avg = parseFloat(prevAvg?.avg) || 0;
      const anomaly = avg > 0 && kwh > avg * 1.5 ? 1 : 0;
      const anomalyNote = anomaly ? `Дундаж ${avg.toFixed(0)} кВт·ц-аас ${Math.round((kwh/avg-1)*100)}% их` : null;

      const ex = await get("SELECT id FROM sl_monthly_readings WHERE point_id=? AND year=? AND month=?",
        [pt.id, year, month]);
      if (ex) {
        await run(`UPDATE sl_monthly_readings SET prev_reading=?,curr_reading=?,kwh_used=?,rate=?,
           amount=?,in_our_bill=?,anomaly_flag=?,anomaly_note=?,entered_by=?,entered_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          [prev, curr, kwh, rate, amount, inBill, anomaly, anomalyNote, req.user.id, ex.id]);
      } else {
        await run(`INSERT INTO sl_monthly_readings(point_id,year,month,prev_reading,curr_reading,
           kwh_used,rate,amount,in_our_bill,anomaly_flag,anomaly_note,entered_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          [pt.id, year, month, prev, curr, kwh, rate, amount, inBill, anomaly, anomalyNote, req.user.id]);
      }
      imported++;
    }

    await audit(req.user.id, "IMPORT", "sl_monthly_readings", 0,
      `${year}/${month}: импорт ${imported} цэг`);
    res.json({ ok: true, imported, skipped, errors: errors.slice(0, 20) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Import bill from uploaded Excel (electricity company invoice)
router.post("/sl-import/bill", auth, requirePermission("sl_billing"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй байна" });
  try {
    const { year, month, colKwh, colAmount, colBillNo, colDate, supplier } = req.body;
    if (!year || !month) return res.status(400).json({ error: "Он, сар заавал шаардлагатай" });

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const nonEmpty = rows.filter(r => r.some(c => String(c).trim() !== ""));

    // For bill: find the total row or aggregate all numeric kwh values
    let totalKwh = 0, totalAmount = 0, billNo = "", billDate = "";

    if (colKwh !== undefined && colAmount !== undefined) {
      // User specified which columns contain kwh and amount
      let headerIdx = 0;
      for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
        if (nonEmpty[i].filter(c => c !== "").length >= 3) { headerIdx = i; break; }
      }
      const dataRows = nonEmpty.slice(headerIdx + 1);
      for (const row of dataRows) {
        const kwh = parseFloat(row[parseInt(colKwh)]) || 0;
        const amt = parseFloat(row[parseInt(colAmount)]) || 0;
        totalKwh    += kwh;
        totalAmount += amt;
        if (colBillNo >= 0 && row[parseInt(colBillNo)]) billNo = String(row[parseInt(colBillNo)]);
        if (colDate >= 0 && row[parseInt(colDate)])    billDate = String(row[parseInt(colDate)]).slice(0,10);
      }
    } else {
      // Auto-detect: look for the largest numeric values as totals
      for (const row of nonEmpty) {
        const nums = row.map(c => parseFloat(c)).filter(n => !isNaN(n) && n > 0);
        if (nums.length >= 2) {
          const sorted = [...nums].sort((a,b) => b-a);
          if (sorted[0] > totalAmount) { totalAmount = sorted[0]; }
        }
      }
    }

    // Calculate our expected from existing readings
    const ours = await get(
      `SELECT COALESCE(SUM(r.kwh_used),0) as kwh, COALESCE(SUM(r.amount),0) as amt
       FROM sl_monthly_readings r
       JOIN sl_points p ON p.id=r.point_id
       JOIN sl_organizations o ON o.id=p.org_id
       WHERE r.year=? AND r.month=? AND r.in_our_bill=1 AND o.is_own=1`,
      [year, month]
    );
    const ourKwh = parseFloat(ours?.kwh) || 0;
    const ourAmt = parseFloat(ours?.amt) || 0;
    const diffKwh = totalKwh - ourKwh;
    const diffAmt = totalAmount - ourAmt;

    const existing = await get("SELECT id FROM sl_bills WHERE year=? AND month=?", [year, month]);
    let id;
    if (existing) {
      await run(`UPDATE sl_bills SET bill_no=?,bill_date=?,supplier_name=?,total_kwh=?,total_amount=?,
         our_kwh=?,our_amount=?,diff_kwh=?,diff_amount=?,status='pending',
         updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [billNo||null, billDate||null, supplier||null, totalKwh, totalAmount,
         ourKwh, ourAmt, diffKwh, diffAmt, existing.id]);
      id = existing.id;
    } else {
      const r2 = await run(`INSERT INTO sl_bills(bill_no,bill_date,year,month,supplier_name,
         total_kwh,total_amount,our_kwh,our_amount,diff_kwh,diff_amount,status,created_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [billNo||null, billDate||null, year, month, supplier||null, totalKwh, totalAmount,
         ourKwh, ourAmt, diffKwh, diffAmt, "pending", req.user.id]);
      id = r2.id;
    }
    await audit(req.user.id, "IMPORT", "sl_bills", id, `${year}/${month} нэхэмжлэл импорт`);
    res.json({ ok: true, id, total_kwh: totalKwh, total_amount: totalAmount,
               our_kwh: ourKwh, diff_kwh: diffKwh, diff_amount: diffAmt });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Generate readings template Excel
router.get("/sl-import/template/readings", auth, async (req, res) => {
  try {
    const points = await all(
      `SELECT p.code, p.name, p.meter_no, p.lamp_count, p.wattage_per_lamp
       FROM sl_points p WHERE p.status='active' ORDER BY p.code`
    );
    const wb = XLSX.utils.book_new();
    const data = [
      ["Код", "Байршил / Нэр", "Тоолуурын №", "Өмнөх уншилт", "Одоогийн уншилт", "Тариф (₮/кВт·ц)", "Тайлбар"],
      ...points.map(p => [p.code, p.name, p.meter_no||"", "", "", "", ""])
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [14,30,14,14,14,16,20].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Сарын уншилт");
    const buf = XLSX.write(wb, { type:"buffer", bookType:"xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename="sl-readings-template.xlsx"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// ГЭР ХОРООЛЛЫН ГЭРЭЛТҮҮЛГИЙН БҮРТГЭЛ (sl_ger_inventory)
// ══════════════════════════════════════════════════════════════

// ── Summary stats for dashboard ──────────────────────────────
router.get("/sl-ger-stats", auth, async (_req, res) => {
  try {
    const rows = await all("SELECT category, SUM(total_count) as total FROM sl_ger_inventory GROUP BY category");
    const byBag = await all(
      `SELECT bag_no, category, SUM(total_count) as total
       FROM sl_ger_inventory WHERE bag_no IS NOT NULL
       GROUP BY bag_no, category ORDER BY bag_no`
    );
    // Open fault broken counts (new system)
    const faultBroken = await all(
      `SELECT category, SUM(broken_count) as total FROM sl_faults WHERE status!='Дууссан' GROUP BY category`
    );
    const faultBycat = {};
    faultBroken.forEach(r => { faultBycat[r.category] = r.total||0; });
    const totalBroken = Object.values(faultBycat).reduce((s,v)=>s+v,0);

    // Per-category location counts for ger inventory
    const gerLoc    = await get(`SELECT COUNT(*) as c FROM sl_ger_inventory WHERE category='Гэр хороолол'`);
    const camhagLoc = await get(`SELECT COUNT(*) as c FROM sl_ger_inventory WHERE category='Цамхаг'`);

    // Гэрлэн дохио stats from assets table
    const trafficRows = await all(
      `SELECT status FROM assets WHERE category='Гэрлэн дохио'`
    );
    const trafficTotal    = trafficRows.length;
    const trafficAsaaltai = trafficRows.filter(r => r.status === "Асаалтай").length;

    // ГТ- sl_points stats
    const slPts = await all(
      `SELECT lamp_count, total_heads, needs_poles, status FROM sl_points WHERE code LIKE 'ГТ-%'`
    );
    const slPoles      = slPts.reduce((s,p) => s + (p.lamp_count||0), 0);
    const slHeads      = slPts.reduce((s,p) => s + (p.total_heads > 0 ? p.total_heads : (p.lamp_count||0)), 0);
    const slNeedsPoles = slPts.reduce((s,p) => s + (p.needs_poles||0), 0);
    const slStreets    = slPts.length;
    const slActive     = slPts.filter(p => p.status==="active"||p.status==="Идэвхтэй").length;
    const slFaultBroken = { total: faultBycat["Авто замын гэрэл"] || 0 };

    const catMap = {};
    rows.forEach(r => { catMap[r.category] = r.total; });

    res.json({
      by_category: catMap,
      total_ger:    catMap["Гэр хороолол"] || 0,
      total_camhag: catMap["Цамхаг"] || 0,
      total_broken: totalBroken,
      sl_streets:    slStreets,
      sl_poles:      slPoles,
      sl_heads:      slHeads,
      sl_needs_poles: slNeedsPoles,
      sl_active:     slActive,
      sl_broken:     slFaultBroken?.total || 0,
      ger_locations:    gerLoc?.c || 0,
      ger_broken:       faultBycat["Гэр хорооллын гэрэл"] || 0,
      camhag_locations: camhagLoc?.c || 0,
      camhag_broken:    faultBycat["Цамхагийн гэрэл"] || 0,
      traffic_total:    trafficTotal,
      traffic_asaaltai: trafficAsaaltai,
      by_bag: byBag,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Lighting fault / availability analytics ───────────────────
router.get("/sl-analytics", auth, async (req, res) => {
  try {
    const year = String(req.query.year || new Date().getFullYear()).replace(/[^\d]/g, "").slice(0, 4) || String(new Date().getFullYear());
    const start = `${year}-01-01`;
    const end = `${Number(year) + 1}-01-01`;
    const cats = ["Авто замын гэрэл", "Гэр хорооллын гэрэл", "Цамхагийн гэрэл", "Гэрлэн дохио"];

    const [road, ger, tower, signal, reported, repaired, reportedToDate, repairedToDate, openNow] = await Promise.all([
      get(`SELECT COALESCE(SUM(CASE WHEN total_heads > 0 THEN total_heads ELSE lamp_count END),0) total
           FROM sl_points WHERE code LIKE 'ГТ-%'`),
      get(`SELECT COALESCE(SUM(CASE WHEN head_count > 0 THEN head_count ELSE total_count END),0) total
           FROM sl_ger_inventory WHERE category='Гэр хороолол'`),
      get(`SELECT COALESCE(SUM(CASE WHEN head_count > 0 THEN head_count ELSE total_count END),0) total
           FROM sl_ger_inventory WHERE category='Цамхаг'`),
      get(`SELECT COUNT(*) total FROM assets WHERE category='Гэрлэн дохио'`),
      all(`SELECT category, substr(report_date,1,7) ym,
                  SUM(broken_count + fixed_count) reported_heads,
                  COUNT(*) fault_count
           FROM sl_faults
           WHERE report_date>=? AND report_date<?
           GROUP BY category, substr(report_date,1,7)`, [start, end]),
      all(`SELECT f.category, substr(r.repair_date,1,7) ym,
                  SUM(r.heads_fixed) repaired_heads,
                  COUNT(*) repair_count
           FROM sl_fault_repairs r
           JOIN sl_faults f ON f.id=r.fault_id
           WHERE r.repair_date>=? AND r.repair_date<?
           GROUP BY f.category, substr(r.repair_date,1,7)`, [start, end]),
      all(`SELECT category, substr(report_date,1,7) ym,
                  SUM(broken_count + fixed_count) reported_heads
           FROM sl_faults
           WHERE report_date<?
           GROUP BY category, substr(report_date,1,7)`, [end]),
      all(`SELECT f.category, substr(r.repair_date,1,7) ym,
                  SUM(r.heads_fixed) repaired_heads
           FROM sl_fault_repairs r
           JOIN sl_faults f ON f.id=r.fault_id
           WHERE r.repair_date<?
           GROUP BY f.category, substr(r.repair_date,1,7)`, [end]),
      all(`SELECT category, SUM(broken_count) open_heads, COUNT(*) open_faults
           FROM sl_faults
           WHERE status!='Дууссан'
           GROUP BY category`)
    ]);

    const totals = {
      "Авто замын гэрэл": Number(road?.total || 0),
      "Гэр хорооллын гэрэл": Number(ger?.total || 0),
      "Цамхагийн гэрэл": Number(tower?.total || 0),
      "Гэрлэн дохио": Number(signal?.total || 0),
    };
    const byKey = rows => {
      const map = {};
      rows.forEach(r => { map[`${r.category}|${r.ym}`] = r; });
      return map;
    };
    const repMap = byKey(reported);
    const fixMap = byKey(repaired);
    const openMap = {};
    openNow.forEach(r => { openMap[r.category] = r; });

    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      let reportedHeads = 0, repairedHeads = 0, faultCount = 0, repairCount = 0, openHeads = 0, capacity = 0;
      const categories = cats.map(category => {
        const r = repMap[`${category}|${ym}`] || {};
        const f = fixMap[`${category}|${ym}`] || {};
        const cumulativeReported = reportedToDate
          .filter(x => x.category === category && x.ym <= ym)
          .reduce((s, x) => s + Number(x.reported_heads || 0), 0);
        const cumulativeRepaired = repairedToDate
          .filter(x => x.category === category && x.ym <= ym)
          .reduce((s, x) => s + Number(x.repaired_heads || 0), 0);
        const catOpen = Math.max(0, cumulativeReported - cumulativeRepaired);
        const catCapacity = totals[category] || 0;
        const catAvailability = catCapacity > 0 ? Math.max(0, (catCapacity - catOpen) / catCapacity * 100) : null;

        reportedHeads += Number(r.reported_heads || 0);
        repairedHeads += Number(f.repaired_heads || 0);
        faultCount += Number(r.fault_count || 0);
        repairCount += Number(f.repair_count || 0);
        openHeads += catOpen;
        capacity += catCapacity;

        return {
          category,
          capacity: catCapacity,
          fault_count: Number(r.fault_count || 0),
          reported_heads: Number(r.reported_heads || 0),
          repair_count: Number(f.repair_count || 0),
          repaired_heads: Number(f.repaired_heads || 0),
          open_heads: catOpen,
          availability_pct: catAvailability
        };
      });
      return {
        ym,
        label: `${i + 1}-р сар`,
        capacity,
        fault_count: faultCount,
        reported_heads: reportedHeads,
        repair_count: repairCount,
        repaired_heads: repairedHeads,
        open_heads: openHeads,
        availability_pct: capacity > 0 ? Math.max(0, (capacity - openHeads) / capacity * 100) : null,
        categories
      };
    });

    const by_category = cats.map(category => {
      const catReported = reported.filter(r => r.category === category);
      const catRepaired = repaired.filter(r => r.category === category);
      const reportedHeads = catReported.reduce((s, r) => s + Number(r.reported_heads || 0), 0);
      const repairedHeads = catRepaired.reduce((s, r) => s + Number(r.repaired_heads || 0), 0);
      const openHeads = Number(openMap[category]?.open_heads || 0);
      const capacity = totals[category] || 0;
      return {
        category,
        capacity,
        fault_count: catReported.reduce((s, r) => s + Number(r.fault_count || 0), 0),
        reported_heads: reportedHeads,
        repair_count: catRepaired.reduce((s, r) => s + Number(r.repair_count || 0), 0),
        repaired_heads: repairedHeads,
        open_heads: openHeads,
        open_faults: Number(openMap[category]?.open_faults || 0),
        availability_pct: capacity > 0 ? Math.max(0, (capacity - openHeads) / capacity * 100) : null
      };
    });

    const totalCapacity = Object.values(totals).reduce((s, n) => s + n, 0);
    const totalOpen = by_category.reduce((s, r) => s + r.open_heads, 0);
    res.json({
      year: Number(year),
      totals,
      summary: {
        capacity: totalCapacity,
        reported_heads: by_category.reduce((s, r) => s + r.reported_heads, 0),
        repaired_heads: by_category.reduce((s, r) => s + r.repaired_heads, 0),
        open_heads: totalOpen,
        availability_pct: totalCapacity > 0 ? Math.max(0, (totalCapacity - totalOpen) / totalCapacity * 100) : null
      },
      by_category,
      months
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── List inventory ────────────────────────────────────────────
router.get("/sl-ger-inventory", auth, async (req, res) => {
  try {
    const { category, bag_no, search } = req.query;
    let sql = `
      SELECT g.*,
        (SELECT broken_count FROM sl_inspections WHERE inventory_id=g.id ORDER BY id DESC LIMIT 1) as last_broken,
        (SELECT inspect_date FROM sl_inspections WHERE inventory_id=g.id ORDER BY id DESC LIMIT 1) as last_inspect,
        p.code as point_code, p.name as point_name
      FROM sl_ger_inventory g
      LEFT JOIN sl_points p ON p.id = g.sl_point_id
      WHERE 1=1`;
    const params = [];
    if (category) { sql += " AND g.category=?"; params.push(category); }
    if (bag_no)   { sql += " AND g.bag_no=?";   params.push(bag_no);   }
    if (search)   { sql += " AND g.location_name LIKE ?"; params.push(`%${search}%`); }
    sql += " ORDER BY g.bag_no, g.category, g.id";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Create ────────────────────────────────────────────────────
router.post("/sl-ger-inventory", auth, requirePermission("sl_ger_write"), async (req, res) => {
  const b = req.body;
  if (!b.location_name?.trim()) return res.status(400).json({ error: "Байршлын нэр шаардлагатай" });
  if (!b.category)              return res.status(400).json({ error: "Төрөл шаардлагатай" });
  try {
    const r = await run(
      `INSERT INTO sl_ger_inventory(bag_no,location_name,category,total_count,head_count,light_type,sl_point_id,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [b.bag_no||null, b.location_name.trim(), b.category,
       Number(b.total_count||0), Number(b.head_count||0),
       b.light_type||"", b.sl_point_id||null, b.notes||"", req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_ger_inventory", r.id, b.location_name.trim());
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Update ────────────────────────────────────────────────────
router.put("/sl-ger-inventory/:id", auth, requirePermission("sl_ger_write"), async (req, res) => {
  const b = req.body;
  if (!b.location_name?.trim()) return res.status(400).json({ error: "Байршлын нэр шаардлагатай" });
  try {
    await run(
      `UPDATE sl_ger_inventory SET bag_no=?,location_name=?,category=?,total_count=?,head_count=?,
       light_type=?,sl_point_id=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.bag_no||null, b.location_name.trim(), b.category,
       Number(b.total_count||0), Number(b.head_count||0),
       b.light_type||"", b.sl_point_id||null, b.notes||"", req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_ger_inventory", req.params.id, b.location_name.trim());
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Delete ────────────────────────────────────────────────────
router.delete("/sl-ger-inventory/:id", auth, requirePermission("sl_billing"), async (req, res) => {
  try {
    await run("DELETE FROM sl_inspections WHERE inventory_id=?", [req.params.id]);
    await run("DELETE FROM sl_ger_inventory WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_ger_inventory", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Single ger record with photos + docs ─────────────────────
router.get("/sl-ger-inventory/:id", auth, async (req, res) => {
  try {
    const rec = await get(
      `SELECT g.*, mp.meter_no as mp_meter_no, mp.name as mp_name, mp.location as mp_location
       FROM sl_ger_inventory g
       LEFT JOIN meter_points mp ON mp.id = g.meter_point_id
       WHERE g.id=?`, [req.params.id]
    );
    if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
    rec.photos = await all(
      `SELECT p.*, u.full_name uploader_name FROM sl_ger_photos p
       LEFT JOIN users u ON u.id=p.uploaded_by WHERE p.ger_id=? ORDER BY p.uploaded_at DESC`,
      [req.params.id]
    );
    rec.docs = await all(
      `SELECT d.*, u.full_name uploader_name FROM sl_ger_docs d
       LEFT JOIN users u ON u.id=d.uploaded_by WHERE d.ger_id=? ORDER BY d.uploaded_at DESC`,
      [req.params.id]
    );
    rec.history = await all(
      `SELECT w.*, u.full_name created_name, c.full_name confirmed_name
       FROM asset_events w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN users c ON c.id = w.confirmed_by
       WHERE w.ger_inventory_id=?
       ORDER BY COALESCE(w.work_date,w.start_date,w.created_at) DESC, w.id DESC
       LIMIT 50`, [req.params.id]
    );
    res.json(rec);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-ger-inventory/:id/gps", auth, async (req, res) => {
  try {
    const { gps_lat, gps_lng } = req.body;
    await run("UPDATE sl_ger_inventory SET gps_lat=?,gps_lng=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [gps_lat||null, gps_lng||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-ger-inventory/:id/link-meter", auth, async (req, res) => {
  try {
    const { meter_point_id, meter_no } = req.body;
    await run("UPDATE sl_ger_inventory SET meter_point_id=?,meter_no=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [meter_point_id||null, meter_no||null, req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-ger-inventory/:id/photos", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Зураг оруулаагүй" });
  try {
    const r = await run(
      `INSERT INTO sl_ger_photos(ger_id,file_path,description,uploaded_by) VALUES(?,?,?,?)`,
      [req.params.id, req.file.path.replace(/\\/g,"/"), req.body.description||"", req.user.id]
    );
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-ger-photos/:photoId", auth, async (req, res) => {
  try {
    await run("DELETE FROM sl_ger_photos WHERE id=?", [req.params.photoId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-ger-inventory/:id/docs", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй" });
  try {
    const r = await run(
      `INSERT INTO sl_ger_docs(ger_id,file_path,file_name,description,uploaded_by) VALUES(?,?,?,?,?)`,
      [req.params.id, req.file.path.replace(/\\/g,"/"),
       req.file.originalname||req.file.filename,
       req.body.description||"", req.user.id]
    );
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-ger-docs/:docId", auth, async (req, res) => {
  try {
    await run("DELETE FROM sl_ger_docs WHERE id=?", [req.params.docId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Inspections (тооллого) ───────────────────────────────────
router.get("/sl-inspections/:inventoryId", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT i.*, u.full_name inspector_name FROM sl_inspections i
       LEFT JOIN users u ON u.id=i.inspector_id
       WHERE i.inventory_id=? ORDER BY i.year DESC, i.quarter DESC`,
      [req.params.inventoryId]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-inspections", auth, async (req, res) => {
  const b = req.body;
  if (!b.inventory_id) return res.status(400).json({ error: "Байршил шаардлагатай" });
  if (!b.year || !b.quarter) return res.status(400).json({ error: "Он, улирал шаардлагатай" });
  if (!b.inspect_date) return res.status(400).json({ error: "Тооллогын огноо шаардлагатай" });
  const broken = Number(b.broken_count || 0);
  const total  = Number(b.total_count  || 0);
  if (broken < 0) return res.status(400).json({ error: "Эвдэрсэн тоо 0-ээс бага байж болохгүй" });
  if (total  > 0 && broken > total) return res.status(400).json({ error: "Эвдэрсэн тоо нийт тооноос их байж болохгүй" });
  try {
    // Update inventory total_count if provided
    if (total > 0) await run("UPDATE sl_ger_inventory SET total_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [total, b.inventory_id]);
    const r = await run(
      `INSERT INTO sl_inspections(inventory_id,year,quarter,inspect_date,total_count,broken_count,inspector_id,note)
       VALUES(?,?,?,?,?,?,?,?)`,
      [b.inventory_id, b.year, b.quarter, b.inspect_date, total, broken, req.user.id, b.note||""]
    );
    await audit(req.user.id, "CREATE", "sl_inspections", r.id, `${b.year}/${b.quarter}-р улирал`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-inspections/:id", auth, requirePermission("sl_ger_write"), async (req, res) => {
  try {
    await run("DELETE FROM sl_inspections WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Maintenance work records for a location ─────────────────
router.get("/sl-ger-works/:inventoryId", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT a.id, a.title, a.work_date, a.status, a.confirm_status,
              u.full_name assigned_name
       FROM asset_events a
       LEFT JOIN users u ON u.id=a.assigned_to
       WHERE a.ger_inventory_id=?
       ORDER BY a.work_date DESC, a.id DESC`,
      [req.params.inventoryId]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Fault / Гэмтэл бүртгэл ───────────────────────────────────
router.get("/sl-faults", auth, async (req, res) => {
  try {
    const { category, status, location_id } = req.query;
    let sql = `
      SELECT f.*, u.full_name reported_name
      FROM sl_faults f
      LEFT JOIN users u ON u.id = f.reported_by
      WHERE 1=1`;
    const p = [];
    if (category)    { sql += " AND f.category=?";    p.push(category); }
    if (status)      { sql += " AND f.status=?";      p.push(status); }
    if (location_id) { sql += " AND f.location_id=?"; p.push(Number(location_id)); }
    sql += " ORDER BY f.report_date DESC, f.id DESC";
    res.json(await all(sql, p));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-faults", auth, async (req, res) => {
  try {
    const b = req.body;
    const r = await run(
      `INSERT INTO sl_faults(category,location_id,location_name,location_type,total_heads,broken_count,report_date,notes,reported_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [b.category, b.location_id||null, b.location_name, b.location_type||null,
       b.total_heads||0, b.broken_count||0, b.report_date||null, b.notes||null, req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_faults", r.id, `${b.category}: ${b.location_name}`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-faults/:id", auth, async (req, res) => {
  try {
    const b = req.body;
    await run(
      `UPDATE sl_faults SET category=?,location_id=?,location_name=?,total_heads=?,
       broken_count=?,notes=?,report_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.category, b.location_id||null, b.location_name, b.total_heads||0,
       b.broken_count||0, b.notes||null, b.report_date||null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-faults/:id", auth, async (req, res) => {
  try {
    await run("DELETE FROM sl_fault_repairs WHERE fault_id=?", [req.params.id]);
    await run("DELETE FROM sl_faults WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get repairs for a fault
router.get("/sl-fault-repairs/:faultId", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT r.*, u.full_name repaired_name
       FROM sl_fault_repairs r
       LEFT JOIN users u ON u.id = r.repaired_by
       WHERE r.fault_id=? ORDER BY r.repair_date DESC, r.id DESC`,
      [req.params.faultId]
    ));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Log a repair → auto-update fault broken_count
router.post("/sl-fault-repairs", auth, async (req, res) => {
  try {
    const b = req.body;
    const faultId  = b.fault_id;
    const headsFix = parseInt(b.heads_fixed) || 0;

    const fault = await get("SELECT * FROM sl_faults WHERE id=?", [faultId]);
    if (!fault) return res.status(404).json({ error: "Гэмтэл олдсонгүй" });

    // Insert repair record
    const r = await run(
      `INSERT INTO sl_fault_repairs(fault_id,heads_fixed,repair_date,notes,repaired_by)
       VALUES(?,?,?,?,?)`,
      [faultId, headsFix, b.repair_date||null, b.notes||null, req.user.id]
    );

    // Update fault: decrease broken, increase fixed
    const newBroken  = Math.max(0, fault.broken_count - headsFix);
    const newFixed   = fault.fixed_count + headsFix;
    const newStatus  = newBroken === 0 ? "Дууссан"
                     : newFixed  > 0   ? "Засварт"
                     :                   "Нээлттэй";

    await run(
      `UPDATE sl_faults SET broken_count=?,fixed_count=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [newBroken, newFixed, newStatus, faultId]
    );

    await audit(req.user.id, "CREATE", "sl_fault_repairs", r.id,
      `${fault.location_name}: ${headsFix} толгой засав`);
    res.json({ id: r.id, newBroken, newFixed, newStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
