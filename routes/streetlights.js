const express = require("express");
const { run, all, get, auth, audit, upload } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");
const XLSX    = require("xlsx");
const router  = express.Router();
const {
  LIGHTING_CATEGORIES,
  lightingCategoryTotals,
  saveLightingDailySnapshot,
  listLightingDailySnapshots,
} = require("../services/lighting_snapshots");

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
       lamp_count,wattage_per_lamp,head_count,total_heads,light_type,needs_poles,status,install_date,notes,asset_id,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.code, b.name, b.location||null, b.gps_lat||null, b.gps_lng||null,
       b.org_id||null, b.meter_no||null, b.lamp_count||1, b.wattage_per_lamp||0,
       b.head_count||1, b.total_heads||0, b.light_type||null, b.needs_poles||0,
       b.status||"active", b.install_date||null, b.notes||null, b.asset_id||null, req.user.id]
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
       meter_no=?,lamp_count=?,wattage_per_lamp=?,head_count=?,total_heads=?,light_type=?,needs_poles=?,status=?,install_date=?,remove_date=?,
       notes=?,asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.code, b.name, b.location||null, b.gps_lat||null, b.gps_lng||null, b.org_id||null,
       b.meter_no||null, b.lamp_count||1, b.wattage_per_lamp||0,
       b.head_count||1, b.total_heads||0, b.light_type||null, b.needs_poles||0, b.status,
       b.install_date||null, b.remove_date||null, b.notes||null, b.asset_id||null, req.params.id]
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
function validChoibalsanPoint(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) &&
    a >= 47 && a <= 49.5 &&
    b >= 113 && b <= 116.5;
}

function parseRouteGeometry(value) {
  const points = Array.isArray(value) ? value : [];
  return points
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter(p => validChoibalsanPoint(p.lat, p.lng));
}

router.get("/sl-network/routes", auth, async (req, res) => {
  try {
    const rows = await all("SELECT * FROM sl_network_routes ORDER BY updated_at DESC, id DESC");
    res.json(rows.map(r => ({
      ...r,
      geometry: JSON.parse(r.geometry_json || "[]"),
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/routes", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    const geometry = parseRouteGeometry(b.geometry);
    if (geometry.length < 2) return res.status(400).json({ error: "Route needs at least 2 valid points" });
    const r = await run(
      `INSERT INTO sl_network_routes(name,meter_no,route_type,status,color,geometry_json,lamp_count,
       parent_route_id,feed_pole_id,pole_start,pole_end,wire_install_type,wire_phase,wire_profile,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String(b.name || "Lighting route").trim(),
        b.meter_no || null,
        b.route_type || "feed",
        b.status || "draft",
        b.color || "#f59e0b",
        JSON.stringify(geometry),
        b.lamp_count != null ? Number(b.lamp_count) : null,
        b.parent_route_id || null,
        b.feed_pole_id || null,
        b.pole_start != null ? Number(b.pole_start) : null,
        b.pole_end != null ? Number(b.pole_end) : null,
        b.wire_install_type || null,
        b.wire_phase || null,
        b.wire_profile || null,
        b.notes || null,
        req.user.id,
      ]
    );
    await audit(req.user.id, "CREATE", "sl_network_routes", r.id, b.name || "");
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-network/routes/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    await run(
      `UPDATE sl_network_routes SET
        name=COALESCE(?,name), meter_no=COALESCE(?,meter_no),
        status=COALESCE(?,status), color=COALESCE(?,color),
        lamp_count=COALESCE(?,lamp_count),
        parent_route_id=COALESCE(?,parent_route_id), feed_pole_id=COALESCE(?,feed_pole_id),
        pole_start=COALESCE(?,pole_start), pole_end=COALESCE(?,pole_end),
        wire_install_type=COALESCE(?,wire_install_type), wire_phase=COALESCE(?,wire_phase),
        wire_profile=COALESCE(?,wire_profile), notes=COALESCE(?,notes),
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.name??null, b.meter_no??null, b.status??null, b.color??null,
       b.lamp_count!=null ? Number(b.lamp_count) : null,
       b.parent_route_id??null, b.feed_pole_id??null,
       b.pole_start!=null ? Number(b.pole_start) : null,
       b.pole_end!=null ? Number(b.pole_end) : null,
       b.wire_install_type??null, b.wire_phase??null, b.wire_profile??null,
       b.notes??null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_network_routes", req.params.id, b.name || "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/routes/:id/renumber", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const route = await get("SELECT * FROM sl_network_routes WHERE id=?", [req.params.id]);
    if (!route) return res.status(404).json({ error: "Route not found" });
    const poles = await all("SELECT * FROM sl_network_poles WHERE route_id=? AND pole_type!='feed' ORDER BY id", [req.params.id]);
    if (poles.length === 0) return res.json({ ok: true, renumbered: 0 });
    let geo = [];
    try { geo = JSON.parse(route.geometry_json || "[]"); } catch(_) {}
    function distAlongRoute(lat, lng) {
      if (geo.length < 2) return 0;
      let best = 0, bestDist = Infinity, cum = 0;
      for (let i = 0; i < geo.length - 1; i++) {
        const ax = geo[i].lng, ay = geo[i].lat, bx = geo[i+1].lng, by = geo[i+1].lat;
        const dx = bx-ax, dy = by-ay, lenSq = dx*dx+dy*dy;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((lng-ax)*dx+(lat-ay)*dy)/lenSq)) : 0;
        const px = ax+t*dx, py = ay+t*dy;
        const d = Math.hypot(lng-px, lat-py);
        const segLen = Math.hypot(dx, dy);
        if (d < bestDist) { bestDist = d; best = cum + t * segLen; }
        cum += segLen;
      }
      return best;
    }
    const sorted = poles
      .map(p => ({ ...p, _dist: distAlongRoute(p.gps_lat, p.gps_lng) }))
      .sort((a, b) => a._dist - b._dist);
    const routeName = route.name || "Шон";
    const codeBase = (await get("SELECT code FROM sl_network_poles WHERE route_id=? AND pole_type!='feed' LIMIT 1", [req.params.id]))?.code || "";
    const codePrefix = codeBase.replace(/-\d+$/, "") || routeName.substring(0, 6).toUpperCase();
    for (let i = 0; i < sorted.length; i++) {
      const num = i + 1;
      const padded = String(num).padStart(3, "0");
      await run(
        "UPDATE sl_network_poles SET name=?, code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [`${routeName} shon ${num}`, `${codePrefix}-${padded}`, sorted[i].id]
      );
    }
    await audit(req.user.id, "UPDATE", "sl_network_routes", req.params.id, `Renumbered ${sorted.length} poles`);
    res.json({ ok: true, renumbered: sorted.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/routes/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_network_poles WHERE route_id=?", [req.params.id]);
    await run("DELETE FROM sl_network_routes WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_network_routes", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/sl-network/poles", auth, async (req, res) => {
  try {
    res.json(await all("SELECT * FROM sl_network_poles ORDER BY updated_at DESC, id DESC"));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/poles", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!validChoibalsanPoint(b.gps_lat, b.gps_lng)) return res.status(400).json({ error: "Invalid pole GPS point" });
    const r = await run(
      `INSERT INTO sl_network_poles(code,name,meter_no,route_id,gps_lat,gps_lng,pole_type,status,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        b.code || null,
        b.name || null,
        b.meter_no || null,
        b.route_id || null,
        Number(b.gps_lat),
        Number(b.gps_lng),
        b.pole_type || "pole",
        b.status || "active",
        b.notes || null,
        req.user.id,
      ]
    );
    await audit(req.user.id, "CREATE", "sl_network_poles", r.id, b.code || b.name || "");
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-network/poles/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    if (b.gps_lat !== undefined && !validChoibalsanPoint(b.gps_lat, b.gps_lng))
      return res.status(400).json({ error: "Invalid GPS point" });
    await run(
      `UPDATE sl_network_poles SET
        code=COALESCE(?,code), name=COALESCE(?,name), meter_no=COALESCE(?,meter_no),
        route_id=COALESCE(?,route_id), gps_lat=COALESCE(?,gps_lat), gps_lng=COALESCE(?,gps_lng),
        pole_type=COALESCE(?,pole_type), status=COALESCE(?,status), notes=COALESCE(?,notes),
        updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.code??null, b.name??null, b.meter_no??null, b.route_id??null,
       b.gps_lat!=null?Number(b.gps_lat):null, b.gps_lng!=null?Number(b.gps_lng):null,
       b.pole_type??null, b.status??null, b.notes??null, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_network_poles", req.params.id, b.code || b.name || "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/poles/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_network_poles WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_network_poles", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

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

router.delete("/sl-point-photos/:photoId", auth, requirePermission("lighting_edit"), async (req, res) => {
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

router.delete("/sl-point-docs/:docId", auth, requirePermission("lighting_edit"), async (req, res) => {
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
    await saveLightingDailySnapshot(null, "stats_view").catch(() => {});
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
    await saveLightingDailySnapshot(null, "analytics_view").catch(() => {});
    const year = String(req.query.year || new Date().getFullYear()).replace(/[^\d]/g, "").slice(0, 4) || String(new Date().getFullYear());
    const start = `${year}-01-01`;
    const end = `${Number(year) + 1}-01-01`;
    const cats = LIGHTING_CATEGORIES;

    const [totals, reported, repaired, reportedToDate, repairedToDate, openNow, snapshots] = await Promise.all([
      lightingCategoryTotals(),
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
            GROUP BY category`),
      listLightingDailySnapshots({ year })
    ]);

    const byKey = rows => {
      const map = {};
      rows.forEach(r => { map[`${r.category}|${r.ym}`] = r; });
      return map;
    };
    const repMap = byKey(reported);
    const fixMap = byKey(repaired);
    const openMap = {};
    openNow.forEach(r => { openMap[r.category] = r; });
    const snapshotByMonth = {};
    // Also track the latest snapshot per category (for asset-tracked categories like Гэрлэн дохио)
    const latestSnapByCategory = {};
    snapshots.forEach(s => {
      const ym = String(s.snapshot_date || "").slice(0, 7);
      if (!snapshotByMonth[ym]) snapshotByMonth[ym] = {};
      const prev = snapshotByMonth[ym][s.category];
      if (!prev || String(s.snapshot_date) > String(prev.snapshot_date)) snapshotByMonth[ym][s.category] = s;
      if (!latestSnapByCategory[s.category] || String(s.snapshot_date) > String(latestSnapByCategory[s.category].snapshot_date)) {
        latestSnapByCategory[s.category] = s;
      }
    });

    // Categories tracked via assets.status rather than sl_faults — carry forward their latest snapshot
    const ASSET_TRACKED = new Set(["Гэрлэн дохио"]);

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
        // For asset-tracked categories, fall back to the latest known snapshot when no monthly snapshot exists
        const snap = snapshotByMonth[ym]?.[category] || (ASSET_TRACKED.has(category) ? (latestSnapByCategory[category] || null) : null);
        const catOpen = snap ? Number(snap.broken_count || 0) : Math.max(0, cumulativeReported - cumulativeRepaired);
        const catCapacity = snap ? Number(snap.total_count || 0) : (totals[category] || 0);
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
          availability_pct: snap ? Number(snap.availability_pct) : catAvailability,
          snapshot_date: snap?.snapshot_date || null
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
        snapshot_count: categories.filter(c => c.snapshot_date).length,
        categories
      };
    });

    const by_category = cats.map(category => {
      const catReported = reported.filter(r => r.category === category);
      const catRepaired = repaired.filter(r => r.category === category);
      const catSnapshots = snapshots.filter(s => s.category === category);
      const lastSnap = catSnapshots[catSnapshots.length - 1] || null;
      const reportedHeadsRaw = catReported.reduce((s, r) => s + Number(r.reported_heads || 0), 0);
      const repairedHeads = catRepaired.reduce((s, r) => s + Number(r.repaired_heads || 0), 0);
      const openHeads = lastSnap ? Number(lastSnap.broken_count || 0) : Number(openMap[category]?.open_heads || 0);
      const capacity = lastSnap ? Number(lastSnap.total_count || 0) : (totals[category] || 0);
      // Гэрлэн дохио is tracked via assets.status, not sl_faults — use openHeads as reported
      const reportedHeads = (category === "Гэрлэн дохио" && reportedHeadsRaw === 0) ? openHeads : reportedHeadsRaw;
      return {
        category,
        capacity,
        fault_count: catReported.reduce((s, r) => s + Number(r.fault_count || 0), 0) || (category === "Гэрлэн дохио" ? openHeads : 0),
        reported_heads: reportedHeads,
        repair_count: catRepaired.reduce((s, r) => s + Number(r.repair_count || 0), 0),
        repaired_heads: repairedHeads,
        open_heads: openHeads,
        open_faults: Number(openMap[category]?.open_faults || 0),
        availability_pct: lastSnap ? Number(lastSnap.availability_pct) : (capacity > 0 ? Math.max(0, (capacity - openHeads) / capacity * 100) : null),
        snapshot_date: lastSnap?.snapshot_date || null
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
      months,
      snapshots
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/sl-daily-snapshots", auth, async (req, res) => {
  try {
    await saveLightingDailySnapshot(null, "snapshot_view").catch(() => {});
    res.json(await listLightingDailySnapshots({
      year: req.query.year || new Date().getFullYear(),
      category: req.query.category || "",
    }));
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
      `INSERT INTO sl_ger_inventory(bag_no,location_name,category,total_count,head_count,needs_poles,light_type,sl_point_id,notes,asset_id,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [b.bag_no||null, b.location_name.trim(), b.category,
       Number(b.total_count||0), Number(b.head_count||0), Number(b.needs_poles||0),
       b.light_type||"", b.sl_point_id||null, b.notes||"", b.asset_id||null, req.user.id]
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
       needs_poles=?,light_type=?,sl_point_id=?,notes=?,asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.bag_no||null, b.location_name.trim(), b.category,
       Number(b.total_count||0), Number(b.head_count||0), Number(b.needs_poles||0),
       b.light_type||"", b.sl_point_id||null, b.notes||"", b.asset_id||null, req.params.id]
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

router.delete("/sl-ger-photos/:photoId", auth, requirePermission("sl_ger_write"), async (req, res) => {
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

router.delete("/sl-ger-docs/:docId", auth, requirePermission("sl_ger_write"), async (req, res) => {
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeOptionalDate(value) {
  const text = String(value || "").trim();
  if (!text) return todayIsoDate();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return text.slice(0, 10);
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

function validateFaultPayload(body, { allowZeroBroken = false } = {}) {
  const b = body || {};
  const category = String(b.category || "").trim();
  const locationName = String(b.location_name || "").trim();
  const reportDate = normalizeOptionalDate(b.report_date);
  const totalHeads = positiveInt(b.total_heads);
  const brokenCount = positiveInt(b.broken_count);

  if (!category) return { error: "Ангилал шаардлагатай" };
  if (!LIGHTING_CATEGORIES.includes(category)) return { error: "Ангилал буруу байна" };
  if (!locationName) return { error: "Байршил шаардлагатай" };
  if (!reportDate) return { error: "Огноо буруу байна" };
  if (!Number.isInteger(totalHeads) || totalHeads < 1) return { error: "Нийт толгой 1-ээс бага байж болохгүй" };
  if (!Number.isInteger(brokenCount) || brokenCount < (allowZeroBroken ? 0 : 1)) {
    return { error: allowZeroBroken ? "Гэмтсэн тоо 0-ээс бага байж болохгүй" : "Гэмтсэн тоо 1-ээс бага байж болохгүй" };
  }
  if (brokenCount > totalHeads) return { error: "Гэмтсэн тоо нийт толгойноос их байж болохгүй" };

  return { category, locationName, reportDate, totalHeads, brokenCount };
}

router.post("/sl-faults", auth, async (req, res) => {
  try {
    const b = req.body;
    const valid = validateFaultPayload(b);
    if (valid.error) return res.status(400).json({ error: valid.error });
    const r = await run(
      `INSERT INTO sl_faults(category,location_id,location_name,location_type,total_heads,broken_count,report_date,notes,reported_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [valid.category, b.location_id||null, valid.locationName, b.location_type||null,
       valid.totalHeads, valid.brokenCount, valid.reportDate, b.notes||null, req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_faults", r.id, `${valid.category}: ${valid.locationName}`);
    await saveLightingDailySnapshot(valid.reportDate, "fault_create").catch(() => {});
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-faults/:id", auth, async (req, res) => {
  try {
    const b = req.body;
    const fault = await get("SELECT * FROM sl_faults WHERE id=?", [req.params.id]);
    if (!fault) return res.status(404).json({ error: "Гэмтэл олдсонгүй" });
    const valid = validateFaultPayload(b, { allowZeroBroken: true });
    if (valid.error) return res.status(400).json({ error: valid.error });
    if (Number(fault.fixed_count || 0) > 0 && valid.brokenCount !== Number(fault.broken_count || 0)) {
      return res.status(400).json({ error: "Засвар бүртгэгдсэн тул гэмтсэн тоог шууд өөрчлөх боломжгүй" });
    }
    await run(
      `UPDATE sl_faults SET category=?,location_id=?,location_name=?,total_heads=?,
       broken_count=?,notes=?,report_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [valid.category, b.location_id||null, valid.locationName, valid.totalHeads,
       valid.brokenCount, b.notes||null, valid.reportDate, req.params.id]
    );
    await saveLightingDailySnapshot(valid.reportDate, "fault_update").catch(() => {});
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-faults/:id", auth, requirePermission("sl_technical"), async (req, res) => {
  try {
    await run("DELETE FROM sl_fault_repairs WHERE fault_id=?", [req.params.id]);
    await run("DELETE FROM sl_faults WHERE id=?", [req.params.id]);
    await saveLightingDailySnapshot(null, "fault_delete").catch(() => {});
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
    const headsFix = positiveInt(b.heads_fixed);
    if (!Number.isInteger(headsFix) || headsFix < 1) {
      return res.status(400).json({ error: "Зассан толгой 1-ээс бага байж болохгүй" });
    }

    const fault = await get("SELECT * FROM sl_faults WHERE id=?", [faultId]);
    if (!fault) return res.status(404).json({ error: "Гэмтэл олдсонгүй" });

    const currentBroken = Number(fault.broken_count || 0);
    const currentFixed = Number(fault.fixed_count || 0);
    const originalBroken = currentBroken + currentFixed;
    if (headsFix > currentBroken) {
      return res.status(400).json({ error: "Зассан толгой үлдсэн гэмтсэн тооноос их байж болохгүй" });
    }

    // Insert repair record
    const r = await run(
      `INSERT INTO sl_fault_repairs(fault_id,heads_fixed,repair_date,notes,repaired_by)
       VALUES(?,?,?,?,?)`,
      [faultId, headsFix, b.repair_date||null, b.notes||null, req.user.id]
    );

    // Update fault: decrease broken, increase fixed
    const newBroken  = Math.max(0, currentBroken - headsFix);
    const newFixed   = currentFixed + headsFix;
    if (newFixed > originalBroken) {
      return res.status(400).json({ error: "Зассан нийт тоо анхны гэмтсэн тооноос давж болохгүй" });
    }
    const newStatus  = newBroken === 0 ? "Дууссан"
                     : newFixed  > 0   ? "Засварт"
                     :                   "Нээлттэй";

    await run(
      `UPDATE sl_faults SET broken_count=?,fixed_count=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [newBroken, newFixed, newStatus, faultId]
    );

    await audit(req.user.id, "CREATE", "sl_fault_repairs", r.id,
      `${fault.location_name}: ${headsFix} толгой засав`);
    await saveLightingDailySnapshot(b.repair_date || null, "repair_create").catch(() => {});
    res.json({ id: r.id, newBroken, newFixed, newStatus });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics: top fault locations + MTTR ──────────────────
router.get("/sl-analytics/locations", auth, async (req, res) => {
  try {
    const year  = String(req.query.year || new Date().getFullYear()).replace(/[^\d]/g,"").slice(0,4);
    const start = `${year}-01-01`;
    const end   = `${Number(year)+1}-01-01`;
    const [locations, mttrRow] = await Promise.all([
      all(`
        SELECT f.category, f.location_name,
               COUNT(*) fault_count,
               SUM(f.broken_count + f.fixed_count) reported_heads,
               SUM(f.fixed_count) repaired_heads,
               SUM(CASE WHEN f.status!='Дууссан' THEN f.broken_count ELSE 0 END) open_heads,
               ROUND(AVG(CASE WHEN r.first_repair IS NOT NULL
                 THEN julianday(r.first_repair) - julianday(f.report_date) END), 1) avg_days_to_repair
        FROM sl_faults f
        LEFT JOIN (SELECT fault_id, MIN(repair_date) first_repair
                   FROM sl_fault_repairs GROUP BY fault_id) r ON r.fault_id = f.id
        WHERE f.report_date >= ? AND f.report_date < ?
        GROUP BY f.category, f.location_name
        ORDER BY reported_heads DESC
        LIMIT 20`, [start, end]),
      get(`
        SELECT ROUND(AVG(julianday(r.first_repair) - julianday(f.report_date)), 1) overall_mttr,
               COUNT(DISTINCT f.id) total_faults,
               COUNT(DISTINCT CASE WHEN f.status='Дууссан' THEN f.id END) resolved_faults
        FROM sl_faults f
        LEFT JOIN (SELECT fault_id, MIN(repair_date) first_repair
                   FROM sl_fault_repairs GROUP BY fault_id) r ON r.fault_id = f.id
        WHERE f.report_date >= ? AND f.report_date < ?`, [start, end])
    ]);
    res.json({ year: Number(year), locations, mttr: mttrRow });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics: Excel export ─────────────────────────────────
router.get("/sl-analytics/export", auth, async (req, res) => {
  try {
    const year  = String(req.query.year || new Date().getFullYear()).replace(/[^\d]/g,"").slice(0,4);
    const start = `${year}-01-01`;
    const end   = `${Number(year)+1}-01-01`;
    const cats  = LIGHTING_CATEGORIES;

    const [totals, reported, repaired, reportedToDate, repairedToDate, openNow, locations, snapshots] = await Promise.all([
      lightingCategoryTotals(),
      all(`SELECT category, substr(report_date,1,7) ym,
                  SUM(broken_count + fixed_count) reported_heads, COUNT(*) fault_count
           FROM sl_faults WHERE report_date>=? AND report_date<?
           GROUP BY category, substr(report_date,1,7)`, [start, end]),
      all(`SELECT f.category, substr(r.repair_date,1,7) ym, SUM(r.heads_fixed) repaired_heads
           FROM sl_fault_repairs r JOIN sl_faults f ON f.id=r.fault_id
           WHERE r.repair_date>=? AND r.repair_date<?
           GROUP BY f.category, substr(r.repair_date,1,7)`, [start, end]),
      all(`SELECT category, substr(report_date,1,7) ym,
                  SUM(broken_count + fixed_count) reported_heads
           FROM sl_faults
           WHERE report_date<?
           GROUP BY category, substr(report_date,1,7)`, [end]),
      all(`SELECT f.category, substr(r.repair_date,1,7) ym,
                  SUM(r.heads_fixed) repaired_heads
           FROM sl_fault_repairs r JOIN sl_faults f ON f.id=r.fault_id
           WHERE r.repair_date<?
           GROUP BY f.category, substr(r.repair_date,1,7)`, [end]),
      all(`SELECT category, SUM(broken_count) open_heads
           FROM sl_faults WHERE status!='Дууссан' GROUP BY category`),
      all(`SELECT f.category, f.location_name,
                  COUNT(*) fault_count,
                  SUM(f.broken_count + f.fixed_count) reported_heads,
                  SUM(f.fixed_count) repaired_heads,
                  SUM(CASE WHEN f.status!='Дууссан' THEN f.broken_count ELSE 0 END) open_heads,
                  ROUND(AVG(CASE WHEN r.first_repair IS NOT NULL
                    THEN julianday(r.first_repair) - julianday(f.report_date) END), 1) avg_days_to_repair
           FROM sl_faults f
           LEFT JOIN (SELECT fault_id, MIN(repair_date) first_repair
                      FROM sl_fault_repairs GROUP BY fault_id) r ON r.fault_id = f.id
           WHERE f.report_date >= ? AND f.report_date < ?
           GROUP BY f.category, f.location_name
           ORDER BY reported_heads DESC LIMIT 30`, [start, end]),
      listLightingDailySnapshots({ year })
    ]);

    const repMap = {};
    reported.forEach(r => { repMap[`${r.category}|${r.ym}`] = r; });
    const fixMap = {};
    repaired.forEach(r => { fixMap[`${r.category}|${r.ym}`] = r; });
    const openMap = {};
    openNow.forEach(r => { openMap[r.category] = r; });
    const ASSET_TRACKED = new Set(["Гэрлэн дохио"]);
    const snapshotByMonth = {};
    const latestSnapByCategory = {};
    snapshots.forEach(s => {
      const ym = String(s.snapshot_date || "").slice(0, 7);
      if (!snapshotByMonth[ym]) snapshotByMonth[ym] = {};
      const prev = snapshotByMonth[ym][s.category];
      if (!prev || String(s.snapshot_date) > String(prev.snapshot_date)) snapshotByMonth[ym][s.category] = s;
      if (!latestSnapByCategory[s.category] || String(s.snapshot_date) > String(latestSnapByCategory[s.category].snapshot_date)) {
        latestSnapByCategory[s.category] = s;
      }
    });

    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i+1).padStart(2,"0")}`;
      let rep=0, fix=0, fc=0, open=0, cap=0;
      cats.forEach(cat => {
        const r = repMap[`${cat}|${ym}`] || {};
        const f = fixMap[`${cat}|${ym}`] || {};
        const snap = snapshotByMonth[ym]?.[cat] || (ASSET_TRACKED.has(cat) ? (latestSnapByCategory[cat] || null) : null);
        const cumulativeReported = reportedToDate
          .filter(x => x.category === cat && x.ym <= ym)
          .reduce((s, x) => s + Number(x.reported_heads || 0), 0);
        const cumulativeRepaired = repairedToDate
          .filter(x => x.category === cat && x.ym <= ym)
          .reduce((s, x) => s + Number(x.repaired_heads || 0), 0);
        const catOpen = snap ? Number(snap.broken_count||0) : Math.max(0, cumulativeReported - cumulativeRepaired);
        const catCap  = snap ? Number(snap.total_count||0)  : (totals[cat]||0);
        rep  += Number(r.reported_heads||0);
        fix  += Number(f.repaired_heads||0);
        fc   += Number(r.fault_count||0);
        open += catOpen;
        cap  += catCap;
      });
      return {
        label: `${i+1}-р сар`, fault_count: fc, reported_heads: rep,
        repaired_heads: fix, open_heads: open,
        availability_pct: cap > 0 ? Number(Math.max(0,(cap-open)/cap*100).toFixed(1)) : ""
      };
    });

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([
        ["Сар", "Бүртгэл тоо", "Гэмтсэн толгой", "Зассан толгой", "Үлдсэн толгой", "Асалт %"],
        ...months.map(m => [m.label, m.fault_count, m.reported_heads, m.repaired_heads, m.open_heads, m.availability_pct])
      ]), "Сарын явц");

    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([
        ["Төрөл", "Нийт толгой", "Гэмтсэн", "Зассан", "Одоо асахгүй", "Асалт %"],
        ...cats.map(cat => {
          const r = reported.filter(x=>x.category===cat).reduce((s,x)=>s+Number(x.reported_heads||0),0);
          const f = repaired.filter(x=>x.category===cat).reduce((s,x)=>s+Number(x.repaired_heads||0),0);
          const open = Number(openMap[cat]?.open_heads||0);
          const cap = totals[cat]||0;
          return [cat, cap, r, f, open, cap>0?Number(Math.max(0,(cap-open)/cap*100).toFixed(1)):""];
        })
      ]), "Төрлөөр");

    XLSX.utils.book_append_sheet(wb,
      XLSX.utils.aoa_to_sheet([
        ["№", "Төрөл", "Байршил", "Гэмтэл тоо", "Гэмтсэн толгой", "Зассан", "Үлдсэн", "MTTR (хоног)"],
        ...locations.map((r,i) => [i+1, r.category, r.location_name, r.fault_count, r.reported_heads, r.repaired_heads, r.open_heads, r.avg_days_to_repair ?? ""])
      ]), "Байршлаар");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Disposition", `attachment; filename=gereltuuleg-sudalgaa-${year}.xlsx`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buf);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// ШИНЭ DATA MODEL: corridor / alignment / feed_point / feeder_cable
// ══════════════════════════════════════════════════════════════

function computeBearing(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const first = geometry[0], last = geometry[geometry.length - 1];
  return ((Math.atan2(last.lng - first.lng, last.lat - first.lat) * 180 / Math.PI) + 360) % 360;
}

// ── Corridors (замын геометрийн шугам) ────────────────────────
router.get("/sl-network/corridors", auth, async (req, res) => {
  try {
    const rows = await all("SELECT * FROM sl_corridor ORDER BY updated_at DESC, id DESC");
    res.json(rows.map(r => ({ ...r, geometry: JSON.parse(r.geometry_json || "[]") })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/corridors", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    const geometry = parseRouteGeometry(b.geometry);
    if (geometry.length < 2) return res.status(400).json({ error: "Corridor needs ≥2 valid points" });
    const bearing = computeBearing(geometry);
    const r = await run(
      `INSERT INTO sl_corridor(name,geometry_json,bearing,notes,created_by) VALUES(?,?,?,?,?)`,
      [String(b.name || "Коридор").trim(), JSON.stringify(geometry), bearing, b.notes || null, req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_corridor", r.id, b.name || "");
    res.json({ id: r.id, bearing });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-network/corridors/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    const fields = [], params = [];
    if (b.name !== undefined)     { fields.push("name=?");     params.push(b.name); }
    if (b.geometry !== undefined) {
      const geo = parseRouteGeometry(b.geometry);
      fields.push("geometry_json=?"); params.push(JSON.stringify(geo));
      fields.push("bearing=?");       params.push(computeBearing(geo));
    }
    if (b.notes !== undefined) { fields.push("notes=?"); params.push(b.notes); }
    fields.push("updated_at=CURRENT_TIMESTAMP");
    params.push(req.params.id);
    if (fields.length > 1) await run(`UPDATE sl_corridor SET ${fields.join(",")} WHERE id=?`, params);
    await audit(req.user.id, "UPDATE", "sl_corridor", req.params.id, b.name || "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/corridors/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_alignment WHERE corridor_id=?", [req.params.id]);
    await run("DELETE FROM sl_corridor WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_corridor", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Alignments (нэг замын A/B тал) ────────────────────────────
router.get("/sl-network/alignments", auth, async (req, res) => {
  try {
    const { corridor_id } = req.query;
    let sql = `SELECT a.*, c.name as corridor_name, c.bearing as corridor_bearing
               FROM sl_alignment a
               LEFT JOIN sl_corridor c ON c.id = a.corridor_id
               WHERE 1=1`;
    const params = [];
    if (corridor_id) { sql += " AND a.corridor_id=?"; params.push(corridor_id); }
    sql += " ORDER BY a.corridor_id, a.side_key";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/alignments", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.corridor_id) return res.status(400).json({ error: "corridor_id шаардлагатай" });
    const r = await run(
      `INSERT INTO sl_alignment(corridor_id,side_key,side_label,numbering_direction,notes) VALUES(?,?,?,?,?)`,
      [b.corridor_id, b.side_key || "A", b.side_label || null,
       b.numbering_direction || "start_to_end", b.notes || null]
    );
    await audit(req.user.id, "CREATE", "sl_alignment", r.id, `Corridor ${b.corridor_id} side ${b.side_key || "A"}`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-network/alignments/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    await run(
      `UPDATE sl_alignment SET side_key=COALESCE(?,side_key), side_label=COALESCE(?,side_label),
       numbering_direction=COALESCE(?,numbering_direction), notes=COALESCE(?,notes),
       updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.side_key ?? null, b.side_label ?? null, b.numbering_direction ?? null,
       b.notes ?? null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/alignments/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_alignment WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Feed Points (щит/тоолуур/ТП байршил) ─────────────────────
router.get("/sl-network/feed-points", auth, async (req, res) => {
  try {
    res.json(await all("SELECT * FROM sl_feed_point ORDER BY updated_at DESC, id DESC"));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/feed-points", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!validChoibalsanPoint(b.gps_lat, b.gps_lng)) return res.status(400).json({ error: "Invalid GPS" });
    const r = await run(
      `INSERT INTO sl_feed_point(name,gps_lat,gps_lng,type,notes,created_by) VALUES(?,?,?,?,?,?)`,
      [String(b.name || "ТП").trim(), Number(b.gps_lat), Number(b.gps_lng),
       b.type || "panel", b.notes || null, req.user.id]
    );
    await audit(req.user.id, "CREATE", "sl_feed_point", r.id, b.name || "");
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/sl-network/feed-points/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    await run(
      `UPDATE sl_feed_point SET name=COALESCE(?,name), gps_lat=COALESCE(?,gps_lat), gps_lng=COALESCE(?,gps_lng),
       type=COALESCE(?,type), notes=COALESCE(?,notes), updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [b.name ?? null,
       b.gps_lat != null ? Number(b.gps_lat) : null,
       b.gps_lng != null ? Number(b.gps_lng) : null,
       b.type ?? null, b.notes ?? null, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/feed-points/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_feeder_cable WHERE feed_point_id=?", [req.params.id]);
    await run("DELETE FROM sl_feed_point_device WHERE feed_point_id=?", [req.params.id]);
    await run("DELETE FROM sl_feed_point WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "sl_feed_point", req.params.id, "");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Feed Point IoT node links ────────────────────────────────
router.get("/sl-network/feed-point-devices", auth, async (req, res) => {
  try {
    const { feed_point_id } = req.query;
    let sql = "SELECT * FROM sl_feed_point_device WHERE 1=1";
    const params = [];
    if (feed_point_id) { sql += " AND feed_point_id=?"; params.push(feed_point_id); }
    sql += " ORDER BY feed_point_id, id";
    res.json(await all(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/feed-point-devices", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    const feedPointId = Number(b.feed_point_id);
    const devEui = String(b.dev_eui || "").trim().toUpperCase();
    if (!feedPointId || !devEui) return res.status(400).json({ error: "feed_point_id болон dev_eui шаардлагатай" });
    const feedPoint = await get("SELECT id,gps_lat,gps_lng FROM sl_feed_point WHERE id=?", [feedPointId]);
    if (!feedPoint) return res.status(404).json({ error: "Feed point not found" });
    const role = b.role || "controller";
    if (role === "controller") {
      await run("DELETE FROM sl_feed_point_device WHERE feed_point_id=? AND role='controller'", [feedPointId]);
    }
    const r = await run(
      `INSERT INTO sl_feed_point_device(feed_point_id,dev_eui,role,notes) VALUES(?,?,?,?)`,
      [feedPointId, devEui, role, b.notes || null]
    );
    const lat = Number(feedPoint.gps_lat);
    const lng = Number(feedPoint.gps_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      await run(
        `INSERT INTO iot_device_settings(dev_eui,updated_by,updated_at,manual_lat,manual_lng,manual_location_by,manual_location_at)
         VALUES(?,?,CURRENT_TIMESTAMP,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(dev_eui) DO UPDATE SET
           updated_by=excluded.updated_by,
           updated_at=CURRENT_TIMESTAMP,
           manual_lat=excluded.manual_lat,
           manual_lng=excluded.manual_lng,
           manual_location_by=excluded.manual_location_by,
           manual_location_at=CURRENT_TIMESTAMP`,
        [devEui, req.user?.id || null, lat, lng, req.user?.id || null]
      );
    }
    await audit(req.user.id, "CREATE", "sl_feed_point_device", r.id || feedPointId, `FP${feedPointId} -> ${devEui}`);
    res.json({ ok: true, id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/feed-point-devices/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_feed_point_device WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Feeder Cables (тэжээл → сегмент холболт) ──────────────────
router.get("/sl-network/feeder-cables", auth, async (req, res) => {
  try {
    const { feed_point_id, cable_segment_id } = req.query;
    let sql = `SELECT fc.*, fp.name as feed_point_name, fp.gps_lat as fp_lat, fp.gps_lng as fp_lng,
               r.name as segment_name, r.pole_start, r.pole_end, r.parent_route_id
               FROM sl_feeder_cable fc
               LEFT JOIN sl_feed_point fp ON fp.id = fc.feed_point_id
               LEFT JOIN sl_network_routes r ON r.id = fc.cable_segment_id
               WHERE 1=1`;
    const params = [];
    if (feed_point_id)    { sql += " AND fc.feed_point_id=?";    params.push(feed_point_id); }
    if (cable_segment_id) { sql += " AND fc.cable_segment_id=?"; params.push(cable_segment_id); }
    const rows = await all(sql, params);
    res.json(rows.map(r => ({ ...r, geometry: JSON.parse(r.geometry_json || "[]") })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/sl-network/feeder-cables", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.feed_point_id || !b.cable_segment_id)
      return res.status(400).json({ error: "feed_point_id болон cable_segment_id шаардлагатай" });
    const geometry = Array.isArray(b.geometry) ? b.geometry : [];
    const r = await run(
      `INSERT INTO sl_feeder_cable(feed_point_id,cable_segment_id,connection_pole_no,geometry_json,notes) VALUES(?,?,?,?,?)`,
      [b.feed_point_id, b.cable_segment_id, b.connection_pole_no || null,
       JSON.stringify(geometry), b.notes || null]
    );
    await audit(req.user.id, "CREATE", "sl_feeder_cable", r.id, `FP${b.feed_point_id}→SEG${b.cable_segment_id}`);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/sl-network/feeder-cables/:id", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    await run("DELETE FROM sl_feeder_cable WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Cable Segment Status (on/off/fault/partial) ────────────────
router.put("/sl-network/cable-segments/:id/status", auth, requirePermission("lighting_edit"), async (req, res) => {
  try {
    const { status } = req.body;
    if (!["on", "off", "fault", "partial"].includes(status))
      return res.status(400).json({ error: "Зөвшөөрөгдсөн утга: on / off / fault / partial" });
    await run(
      "UPDATE sl_network_routes SET segment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND route_type='cable'",
      [status, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "sl_network_routes", req.params.id, `segment_status → ${status}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Corridor Summary (road_corridor дээрх нийт статистик) ─────
router.get("/sl-network/corridor-summary", auth, async (req, res) => {
  try {
    const routes = await all(
      "SELECT id, name, parent_route_id, route_type, segment_status, pole_start, pole_end FROM sl_network_routes"
    );
    const poles = await all(
      "SELECT id, route_id, status FROM sl_network_poles WHERE pole_type != 'feed'"
    );
    const roadRoutes = routes.filter(r => r.route_type !== "cable" && r.route_type !== "feed_wire");
    const summary = roadRoutes.map(road => {
      const cableSegs = routes.filter(r => r.route_type === "cable" && Number(r.parent_route_id) === Number(road.id));
      const roadPoles = poles.filter(p => Number(p.route_id) === Number(road.id));
      const on = cableSegs.filter(s => (s.segment_status || "on") === "on")
        .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
      const off = cableSegs.filter(s => s.segment_status === "off")
        .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
      const fault = cableSegs.filter(s => s.segment_status === "fault")
        .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
      const partial = cableSegs.filter(s => s.segment_status === "partial")
        .reduce((sum, s) => sum + Math.max(0, Number(s.pole_end || 0) - Number(s.pole_start || 0) + 1), 0);
      const total = roadPoles.length;
      return {
        id: road.id, name: road.name,
        total_poles: total, cable_segments: cableSegs.length,
        on_poles: on, off_poles: off, fault_poles: fault, partial_poles: partial,
        corridor_status: fault > 0 ? "fault" : off > 0 ? (on > 0 ? "partial" : "off") : "on",
      };
    });
    res.json(summary);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
