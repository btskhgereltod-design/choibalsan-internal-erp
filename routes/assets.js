const express = require("express");
const fs = require("fs");
const path = require("path");
const { run, all, get, auth, audit, upload, UPLOAD_DIR } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");
const { saveLightingDailySnapshot } = require("../services/lighting_snapshots");
const { saveCameraDailySnapshot } = require("../services/camera_snapshots");

const router = express.Router();
const CAMERA_CONDITIONS = new Set(["Засварлах", "Хэвийн", "Татан буулгах", "Нүүлгэх"]);

function genAssetCode(category) {
  const prefix = {
    "Гэрэлтүүлэг": "LIGHT", "Камер": "CAM", "Шилэн кабель": "FIBER",
    "Шит/Самбар": "PANEL", "Гэрлэн дохио": "TRAF", "Техник": "VEH",
    "Барилга": "BLDG", "Бусад": "ASSET"
  }[category] || "ASSET";
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

function pct(total, bad) {
  total = Number(total || 0);
  bad = Number(bad || 0);
  return total > 0 ? Math.max(0, (total - bad) / total * 100) : 100;
}

function normalizeBagNo(value, ...texts) {
  const direct = Number(value || 0);
  if (direct === 98) return 98;
  if (direct === 99) return 99;
  if (direct >= 1 && direct <= 11) return direct;
  const text = texts.join(" ").toLowerCase();
  const match = text.match(/(?:^|\D)(\d{1,2})\s*(?:-?\s*р|дугаар)?\s*баг\b/u);
  const inferred = match ? Number(match[1]) : 0;
  return inferred >= 1 && inferred <= 11 ? inferred : null;
}

// Must be before /assets/:id to avoid "summary" being treated as an id param
router.get("/assets/summary/by-category", auth, async (req, res) => {
  res.json(await all(`SELECT category,
    COUNT(*) total,
    SUM(CASE WHEN status='Идэвхтэй' OR status='Асаалтай' THEN 1 ELSE 0 END) active,
    SUM(CASE WHEN condition='Засвар хэрэгтэй' THEN 1 ELSE 0 END) needs_repair,
    SUM(purchase_price) total_value
    FROM assets GROUP BY category ORDER BY total DESC`));
});

router.get("/assets/check-code", auth, async (req, res) => {
  const code = String(req.query.code || "").trim();
  const excludeId = Number(req.query.exclude_id || 0);
  if (!code) return res.json({ exists: false });
  const row = excludeId
    ? await get("SELECT id,name,category FROM assets WHERE asset_code=? AND id<>?", [code, excludeId])
    : await get("SELECT id,name,category FROM assets WHERE asset_code=?", [code]);
  res.json({ exists: !!row, asset: row || null });
});

router.get("/camera-analytics", auth, async (req, res) => {
  try {
    await saveCameraDailySnapshot(null, "analytics_view").catch(() => {});
    const year = String(req.query.year || new Date().getFullYear()).replace(/[^\d]/g, "").slice(0, 4) || String(new Date().getFullYear());
    const start = `${year}-01-01`;
    const end = `${Number(year) + 1}-01-01`;
    const closed = ["Дууссан", "Хаагдсан"];

    const [totals, registeredMonthly, doneMonthly, registeredDaily, doneDaily, openRows, snapshots, locations] = await Promise.all([
      get(`SELECT COUNT(*) points, COALESCE(SUM(COALESCE(camera_count,1)),0) cameras
           , COALESCE(SUM(COALESCE(camera_broken_count,0)),0) broken_cameras
           FROM assets WHERE category='Камер'`),
      all(`SELECT substr(COALESCE(start_date,work_date),1,7) ym,
                  COUNT(*) work_count
           FROM asset_events
           WHERE category='Камер засвар'
             AND COALESCE(start_date,work_date)>=?
             AND COALESCE(start_date,work_date)<?
           GROUP BY substr(COALESCE(start_date,work_date),1,7)`, [start, end]),
      all(`SELECT substr(COALESCE(end_date,updated_at),1,7) ym,
                  COUNT(*) done_count
           FROM asset_events
           WHERE category='Камер засвар'
             AND status IN ('Дууссан','Хаагдсан')
             AND COALESCE(end_date,updated_at)>=?
             AND COALESCE(end_date,updated_at)<?
           GROUP BY substr(COALESCE(end_date,updated_at),1,7)`, [start, end]),
      all(`SELECT substr(COALESCE(start_date,work_date),1,10) day,
                  COUNT(*) work_count
           FROM asset_events
           WHERE category='Камер засвар'
             AND COALESCE(start_date,work_date)>=?
             AND COALESCE(start_date,work_date)<?
           GROUP BY substr(COALESCE(start_date,work_date),1,10)`, [start, end]),
      all(`SELECT substr(COALESCE(end_date,updated_at),1,10) day,
                  COUNT(*) done_count
           FROM asset_events
           WHERE category='Камер засвар'
             AND status IN ('Дууссан','Хаагдсан')
             AND COALESCE(end_date,updated_at)>=?
             AND COALESCE(end_date,updated_at)<?
           GROUP BY substr(COALESCE(end_date,updated_at),1,10)`, [start, end]),
      all(`SELECT w.*, u.full_name assigned_name
           FROM asset_events w
           LEFT JOIN users u ON u.id=w.assigned_to
           WHERE w.category='Камер засвар'
             AND w.status NOT IN ('Дууссан','Хаагдсан')
           ORDER BY COALESCE(w.start_date,w.work_date) DESC, w.id DESC`),
      all(`SELECT * FROM camera_daily_status
           WHERE snapshot_date>=? AND snapshot_date<?
             AND calc_basis='broken_cameras'
           ORDER BY snapshot_date`, [start, end]),
      all(`SELECT COALESCE(NULLIF(location,''),'Байршилгүй') location,
                  COUNT(*) work_count,
                  SUM(CASE WHEN status IN ('Дууссан','Хаагдсан') THEN 1 ELSE 0 END) done_count,
                  SUM(CASE WHEN status NOT IN ('Дууссан','Хаагдсан') THEN 1 ELSE 0 END) open_count,
                  AVG(CASE WHEN status IN ('Дууссан','Хаагдсан') AND start_date IS NOT NULL AND end_date IS NOT NULL
                    THEN julianday(end_date)-julianday(start_date)+1 ELSE NULL END) mttr_days
           FROM asset_events
           WHERE category='Камер засвар'
             AND COALESCE(start_date,work_date)>=?
             AND COALESCE(start_date,work_date)<?
           GROUP BY COALESCE(NULLIF(location,''),'Байршилгүй')
           ORDER BY open_count DESC, work_count DESC, location`, [start, end]),
    ]);

    const monthMap = {};
    registeredMonthly.forEach(r => { monthMap[r.ym] = { ...(monthMap[r.ym] || {}), work_count: Number(r.work_count || 0) }; });
    doneMonthly.forEach(r => { monthMap[r.ym] = { ...(monthMap[r.ym] || {}), done_count: Number(r.done_count || 0) }; });
    const dailyMap = {};
    registeredDaily.forEach(r => { dailyMap[r.day] = { ...(dailyMap[r.day] || {}), day: r.day, work_count: Number(r.work_count || 0) }; });
    doneDaily.forEach(r => { dailyMap[r.day] = { ...(dailyMap[r.day] || {}), day: r.day, done_count: Number(r.done_count || 0) }; });
    snapshots.forEach(s => {
      const day = String(s.snapshot_date || "").slice(0, 10);
      dailyMap[day] = {
        ...(dailyMap[day] || {}),
        day,
        total_cameras: Number(s.total_cameras || 0),
        broken_cameras: Number(s.broken_cameras || 0),
        open_work_count: Number(s.open_work_count || 0),
        availability_pct: Number(s.availability_pct),
        snapshot_date: s.snapshot_date
      };
    });
    const snapByMonth = {};
    snapshots.forEach(s => {
      const ym = String(s.snapshot_date || "").slice(0, 7);
      if (!snapByMonth[ym] || String(s.snapshot_date) > String(snapByMonth[ym].snapshot_date)) snapByMonth[ym] = s;
    });

    const totalCameras = Number(totals?.cameras || 0);
    const brokenCameras = Number(totals?.broken_cameras || 0);
    const months = Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const m = monthMap[ym] || {};
      const s = snapByMonth[ym] || null;
      const open = s ? Number(s.open_work_count || 0) : 0;
      return {
        ym,
        label: `${i + 1}-р сар`,
        capacity: s ? Number(s.total_cameras || 0) : totalCameras,
        work_count: Number(m.work_count || 0),
        done_count: Number(m.done_count || 0),
        open_count: open,
        availability_pct: s ? Number(s.availability_pct) : null,
        snapshot_date: s?.snapshot_date || null
      };
    });

    const yearWork = registeredMonthly.reduce((s, r) => s + Number(r.work_count || 0), 0);
    const yearDone = doneMonthly.reduce((s, r) => s + Number(r.done_count || 0), 0);
    const openCount = openRows.length;
    res.json({
      year: Number(year),
      summary: {
        points: Number(totals?.points || 0),
        capacity: totalCameras,
        broken_cameras: brokenCameras,
        work_count: yearWork,
        done_count: yearDone,
        open_count: openCount,
        availability_pct: pct(totalCameras, brokenCameras),
      },
      months,
      open_rows: openRows,
      daily: Object.values(dailyMap).sort((a, b) => String(a.day).localeCompare(String(b.day))),
      locations: locations.map(r => ({
        location: r.location,
        work_count: Number(r.work_count || 0),
        done_count: Number(r.done_count || 0),
        open_count: Number(r.open_count || 0),
        mttr_days: r.mttr_days == null ? null : Number(Number(r.mttr_days).toFixed(1)),
      })),
      snapshots
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/assets/panels/import-meters", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    const meters = await all(
      `SELECT * FROM meter_points
       WHERE status!='REMOVED' AND COALESCE(meter_no,'')!=''
       ORDER BY meter_no`
    );
    let created = 0, linked = 0, skipped = 0;
    const rows = [];
    for (const m of meters) {
      const code = String(m.meter_no || "").trim();
      if (!code) { skipped++; continue; }

      let panel = await get("SELECT id,name,asset_code FROM assets WHERE asset_code=?", [code]);
      if (!panel) {
        const name = m.name || m.location || `Шит/Самбар ${code}`;
        const r = await run(
          `INSERT INTO assets(asset_code,name,category,sub_category,location,status,condition,
           description,specs,notes,created_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [code, name, "Шит/Самбар", "Тоолууртай шит", m.location || "",
           "Идэвхтэй", "Хэвийн", "", "", m.notes || "", req.user.id]
        );
        panel = { id: r.id, name, asset_code: code };
        created++;
      } else {
        skipped++;
      }

      if (m.panel_asset_id !== panel.id) {
        await run("UPDATE meter_points SET panel_asset_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [panel.id, m.id]);
        linked++;
      }
      rows.push({ meter_id: m.id, meter_no: code, panel_id: panel.id, panel_name: panel.name });
    }
    await audit(req.user.id, "IMPORT", "assets", null, `meter panels: created=${created}, linked=${linked}`);
    res.json({ ok: true, total: meters.length, created, linked, skipped, rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/assets", auth, async (req, res) => {
  const cat = req.query.category;
  let sql = `SELECT a.*, u.full_name assigned_name,
    (SELECT COUNT(*) FROM asset_files f WHERE f.asset_id=a.id) file_count,
    (SELECT COUNT(*) FROM asset_events w
      WHERE w.asset_id=a.id
         OR instr(',' || replace(replace(replace(COALESCE(w.asset_ids,'[]'),'[',''),']',''),' ','') || ',', ',' || a.id || ',') > 0
    ) work_count
    FROM assets a LEFT JOIN users u ON u.id=a.assigned_to`;
  const params = [];
  if (cat) { sql += " WHERE a.category=?"; params.push(cat); }
  sql += " ORDER BY a.category, a.name";
  res.json(await all(sql, params));
});

router.get("/assets/:id", auth, async (req, res) => {
  const asset = await get(`SELECT a.*, u.full_name assigned_name
    FROM assets a LEFT JOIN users u ON u.id=a.assigned_to WHERE a.id=?`, [req.params.id]);
  if (!asset) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
  const files = await all("SELECT * FROM asset_files WHERE asset_id=? ORDER BY id DESC", [req.params.id]);
  const aid = req.params.id;
  const history = await all(`SELECT w.*, u.full_name created_name
    FROM asset_events w LEFT JOIN users u ON u.id=w.created_by
    WHERE w.asset_id=?
       OR instr(',' || replace(replace(replace(COALESCE(w.asset_ids,'[]'),'[',''),']',''),' ','') || ',', ',' || ? || ',') > 0
       OR w.sl_point_id IN (SELECT id FROM sl_points WHERE asset_id=?)
       OR w.ger_inventory_id IN (SELECT id FROM sl_ger_inventory WHERE asset_id=?)
    ORDER BY w.work_date DESC LIMIT 50`, [aid, aid, aid, aid]);
  res.json({ ...asset, files, history });
});

router.get("/fiber-routes", auth, async (req, res) => {
  await run(`CREATE TABLE IF NOT EXISTS fiber_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    route_type TEXT DEFAULT '',
    core_count INTEGER DEFAULT 0,
    color TEXT DEFAULT '',
    status TEXT DEFAULT 'Идэвхтэй',
    note TEXT DEFAULT '',
    geojson TEXT NOT NULL,
    length_m REAL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
  await run(`ALTER TABLE fiber_routes ADD COLUMN core_count INTEGER DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE fiber_routes ADD COLUMN color TEXT DEFAULT ''`).catch(() => {});
  const rows = await all(`SELECT r.*, u.full_name created_name
                          FROM fiber_routes r
                          LEFT JOIN users u ON u.id=r.created_by
                          ORDER BY r.updated_at DESC, r.id DESC`);
  res.json(rows.map(r => ({ ...r, geojson: JSON.parse(r.geojson || "{}") })));
});

router.get("/fiber-points", auth, async (req, res) => {
  await run(`CREATE TABLE IF NOT EXISTS fiber_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id INTEGER,
    route_b_id INTEGER,
    point_type TEXT DEFAULT 'Муфт',
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    splice_json TEXT DEFAULT '[]',
    note TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).catch(() => {});
  await run(`ALTER TABLE fiber_points ADD COLUMN route_b_id INTEGER`).catch(() => {});
  await run(`ALTER TABLE fiber_points ADD COLUMN splice_json TEXT DEFAULT '[]'`).catch(() => {});
  const rows = await all(`SELECT p.*, r.name route_name, rb.name route_b_name, u.full_name created_name
                          FROM fiber_points p
                          LEFT JOIN fiber_routes r ON r.id=p.route_id
                          LEFT JOIN fiber_routes rb ON rb.id=p.route_b_id
                          LEFT JOIN users u ON u.id=p.created_by
                          ORDER BY p.updated_at DESC, p.id DESC`);
  res.json(rows.map(r => ({ ...r, splice: JSON.parse(r.splice_json || "[]") })));
});

router.post("/fiber-points", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    await run(`CREATE TABLE IF NOT EXISTS fiber_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER,
      route_b_id INTEGER,
      point_type TEXT DEFAULT 'Муфт',
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      splice_json TEXT DEFAULT '[]',
      note TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).catch(() => {});
    await run(`ALTER TABLE fiber_points ADD COLUMN route_b_id INTEGER`).catch(() => {});
    await run(`ALTER TABLE fiber_points ADD COLUMN splice_json TEXT DEFAULT '[]'`).catch(() => {});
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (!name) return res.status(400).json({ error: "Цэгийн нэр шаардлагатай" });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "GPS координат буруу байна" });
    const routeId = b.route_id ? Number(b.route_id) : null;
    const routeBId = b.route_b_id ? Number(b.route_b_id) : null;
    const r = await run(
      `INSERT INTO fiber_points(route_id,route_b_id,point_type,name,lat,lng,note,splice_json,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [routeId || null, routeBId || null, b.point_type || "Муфт", name, lat, lng, b.note || "", JSON.stringify(b.splice || []), req.user.id]
    );
    await audit(req.user.id, "CREATE", "fiber_points", r.id, name);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch("/fiber-points/:id/splice", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    await run(`ALTER TABLE fiber_points ADD COLUMN route_b_id INTEGER`).catch(() => {});
    await run(`ALTER TABLE fiber_points ADD COLUMN splice_json TEXT DEFAULT '[]'`).catch(() => {});
    const b = req.body || {};
    const routeId = b.route_id ? Number(b.route_id) : null;
    const routeBId = b.route_b_id ? Number(b.route_b_id) : null;
    const splice = Array.isArray(b.splice) ? b.splice.map(row => ({
      a_core: Math.max(1, Number(row.a_core || 1)),
      a_color: String(row.a_color || ""),
      b_core: Math.max(1, Number(row.b_core || 1)),
      b_color: String(row.b_color || ""),
      note: String(row.note || "")
    })) : [];
    await run(
      `UPDATE fiber_points SET route_id=?, route_b_id=?, splice_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [routeId || null, routeBId || null, JSON.stringify(splice), req.params.id]
    );
    await audit(req.user.id, "UPDATE", "fiber_points", req.params.id, "fiber splice updated");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/fiber-points/:id", auth, requirePermission("assets_write"), async (req, res) => {
  await run("DELETE FROM fiber_points WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "fiber_points", req.params.id, "fiber point deleted");
  res.json({ ok: true });
});

router.post("/fiber-routes", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    await run(`ALTER TABLE fiber_routes ADD COLUMN core_count INTEGER DEFAULT 0`).catch(() => {});
    await run(`ALTER TABLE fiber_routes ADD COLUMN color TEXT DEFAULT ''`).catch(() => {});
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const coords = b?.geojson?.geometry?.coordinates || [];
    if (!name) return res.status(400).json({ error: "Трассын нэр шаардлагатай" });
    if (!Array.isArray(coords) || coords.length < 2) return res.status(400).json({ error: "Доод тал нь 2 цэгтэй трасс зурна уу" });
    const geojson = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords.map(p => [Number(p[0]), Number(p[1])]) }
    };
    const coreCount = Math.max(0, Math.min(288, Number(b.core_count || String(b.route_type || "").match(/(\d+)/)?.[1] || 0)));
    const color = /^#[0-9a-f]{6}$/i.test(String(b.color || "")) ? String(b.color) : "";
    const r = await run(
      `INSERT INTO fiber_routes(name,route_type,core_count,color,status,note,geojson,length_m,created_by)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [name, b.route_type || (coreCount ? `${coreCount} core` : ""), coreCount, color, b.status || "Идэвхтэй", b.note || "", JSON.stringify(geojson), Number(b.length_m || 0), req.user.id]
    );
    await audit(req.user.id, "CREATE", "fiber_routes", r.id, name);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/fiber-routes/:id", auth, requirePermission("assets_write"), async (req, res) => {
  await run("DELETE FROM fiber_routes WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "fiber_routes", req.params.id, "fiber route deleted");
  res.json({ ok: true });
});

router.post("/assets", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    const b = req.body;
    await run(`ALTER TABLE assets ADD COLUMN bag_no INTEGER`).catch(() => {});
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: "Нэр шаардлагатай" });
    if (!b.category || !String(b.category).trim()) return res.status(400).json({ error: "Ангилал шаардлагатай" });
    const manualCode = String(b.asset_code || "").trim();
    if (b.category === "Шит/Самбар" && !manualCode) {
      return res.status(400).json({ error: "Шит/Самбарын код оруулна уу" });
    }
    const code = manualCode || genAssetCode(b.category);
    const dup = await get("SELECT id FROM assets WHERE asset_code=?", [code]);
    if (dup) return res.status(400).json({ error: `Код давхардсан байна: ${code}` });
    const bagNo = normalizeBagNo(b.bag_no, b.name, b.location);
    const r = await run(`INSERT INTO assets(asset_code,name,category,sub_category,bag_no,location,
      gps_lat,gps_lng,status,condition,assigned_to,installed_date,warranty_until,
      purchase_price,current_value,useful_life_years,camera_count,description,specs,notes,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, b.name, b.category, b.sub_category || "", bagNo, b.location || "",
       b.gps_lat || null, b.gps_lng || null,
       b.status || "Идэвхтэй", b.condition || "Хэвийн",
       b.assigned_to || null, b.installed_date || null, b.warranty_until || null,
       b.purchase_price || 0, b.current_value || 0, b.useful_life_years || 10,
       b.camera_count || 1, b.description || "", b.specs || "", b.notes || "", req.user.id]);
    await audit(req.user.id, "CREATE", "assets", r.id, `${b.category}: ${b.name}`);
    if (b.category === "Гэрлэн дохио") await saveLightingDailySnapshot(null, "traffic_asset_create").catch(() => {});
    res.json({ id: r.id, asset_code: code });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch("/assets/:id/bag", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    await run(`ALTER TABLE assets ADD COLUMN bag_no INTEGER`).catch(() => {});
    const asset = await get("SELECT id,category,name FROM assets WHERE id=?", [req.params.id]);
    if (!asset) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
    const bagNo = normalizeBagNo(req.body.bag_no);
    await run("UPDATE assets SET bag_no=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [bagNo, req.params.id]);
    await audit(req.user.id, "UPDATE", "assets", req.params.id, `Баг: ${bagNo || "—"}`);
    res.json({ ok: true, bag_no: bagNo });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch("/assets/:id/status", auth, requirePermission("assets_write"), async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status шаардлагатай" });
  await run("UPDATE assets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, req.params.id]);
  await audit(req.user.id, "UPDATE", "assets", req.params.id, `Төлөв: ${status}`);
  res.json({ ok: true });
});

router.patch("/assets/:id/condition", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    const asset = await get("SELECT id,category,name FROM assets WHERE id=?", [req.params.id]);
    if (!asset) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
    const condition = CAMERA_CONDITIONS.has(req.body.condition) ? req.body.condition : "Хэвийн";
    await run("UPDATE assets SET condition=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [condition, req.params.id]);
    await audit(req.user.id, "UPDATE", "assets", req.params.id, `Нөхцөл: ${condition}`);
    res.json({ ok: true, condition });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch("/assets/:id/gps", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    const lat = Number(req.body.gps_lat);
    const lng = Number(req.body.gps_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "GPS координат буруу байна" });
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ error: "GPS координатын хүрээ буруу байна" });
    const asset = await get("SELECT id,name FROM assets WHERE id=?", [req.params.id]);
    if (!asset) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
    await run("UPDATE assets SET gps_lat=?,gps_lng=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [lat, lng, req.params.id]);
    await audit(req.user.id, "UPDATE", "assets", req.params.id, `GPS: ${lat}, ${lng}`);
    res.json({ ok: true, gps_lat: lat, gps_lng: lng });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.patch("/assets/:id/camera-counts", auth, requirePermission("assets_write"), async (req, res) => {
  try {
    await run(`ALTER TABLE assets ADD COLUMN camera_broken_count INTEGER DEFAULT 0`).catch(() => {});
    const asset = await get("SELECT id,category,condition FROM assets WHERE id=?", [req.params.id]);
    if (!asset) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
    if (asset.category !== "Камер") return res.status(400).json({ error: "Зөвхөн камерын бүртгэл дээр ашиглана" });
    const cameraCount = Math.max(1, Number(req.body.camera_count || 1));
    let status = req.body.status === "Идэвхгүй" ? "Идэвхгүй" : "Идэвхтэй";
    let brokenCount = Math.max(0, Math.min(cameraCount, Number(req.body.camera_broken_count || 0)));
    if (status === "Идэвхгүй") brokenCount = cameraCount;
    if (brokenCount >= cameraCount) status = "Идэвхгүй";
    const condition = brokenCount > 0 ? "Засварлах" : "Хэвийн";
    await run(
      `UPDATE assets SET camera_count=?,camera_broken_count=?,status=?,condition=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [cameraCount, brokenCount, status, condition, req.params.id]
    );
    await audit(req.user.id, "UPDATE", "assets", req.params.id, `Камер=${cameraCount}, гэмтэл=${brokenCount}, төлөв=${status}`);
    res.json({ ok: true, camera_count: cameraCount, camera_broken_count: brokenCount, status, condition });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Traffic signal evidence-grade status journal ──────────────
router.get("/traffic-signal-logs", auth, async (req, res) => {
  const assetId = Number(req.query.asset_id || 0);
  const from = req.query.from || "";
  const to = req.query.to || "";
  let sql = `SELECT l.*, a.name asset_name, a.location asset_location, u.full_name recorded_name
             FROM traffic_signal_status_logs l
             LEFT JOIN assets a ON a.id=l.asset_id
             LEFT JOIN users u ON u.id=l.recorded_by
             WHERE 1=1`;
  const p = [];
  if (assetId) { sql += " AND l.asset_id=?"; p.push(assetId); }
  if (from) { sql += " AND COALESCE(l.ended_at,l.started_at)>=?"; p.push(from); }
  if (to) { sql += " AND l.started_at<=?"; p.push(to); }
  sql += " ORDER BY l.started_at DESC, l.id DESC LIMIT 500";
  res.json(await all(sql, p));
});

router.get("/traffic-signal-status-at", auth, async (req, res) => {
  const assetId = Number(req.query.asset_id || 0);
  const at = req.query.at || "";
  if (!assetId || !at) return res.status(400).json({ error: "asset_id болон at шаардлагатай" });
  const asset = await get("SELECT id,name,location,status FROM assets WHERE id=? AND category='Гэрлэн дохио'", [assetId]);
  if (!asset) return res.status(404).json({ error: "Гэрлэн дохио олдсонгүй" });
  const log = await get(
    `SELECT l.*, u.full_name recorded_name
     FROM traffic_signal_status_logs l
     LEFT JOIN users u ON u.id=l.recorded_by
     WHERE l.asset_id=? AND l.started_at<=? AND (l.ended_at IS NULL OR l.ended_at='' OR l.ended_at>=?)
     ORDER BY l.started_at DESC, l.id DESC LIMIT 1`,
    [assetId, at, at]
  );
  res.json({
    asset,
    checked_at: at,
    matched: !!log,
    status: log?.status || "Тухайн цагийн журнал олдсонгүй",
    log: log || null
  });
});

router.post("/traffic-signal-logs", auth, requirePermission("assets_write"), async (req, res) => {
  const b = req.body || {};
  const assetId = Number(b.asset_id || 0);
  if (!assetId || !b.status || !b.started_at) {
    return res.status(400).json({ error: "Дохио, төлөв, эхэлсэн цаг шаардлагатай" });
  }
  const asset = await get("SELECT id,name,category FROM assets WHERE id=?", [assetId]);
  if (!asset || asset.category !== "Гэрлэн дохио") {
    return res.status(400).json({ error: "Зөвхөн гэрлэн дохионы объект дээр журнал үүсгэнэ" });
  }
  if (b.ended_at && b.ended_at < b.started_at) {
    return res.status(400).json({ error: "Дууссан цаг эхэлсэн цагаас өмнө байж болохгүй" });
  }
  await run(
    `UPDATE traffic_signal_status_logs
     SET ended_at=?,updated_at=CURRENT_TIMESTAMP
     WHERE asset_id=? AND (ended_at IS NULL OR ended_at='') AND started_at<=?`,
    [b.started_at, assetId, b.started_at]
  );
  const r = await run(
    `INSERT INTO traffic_signal_status_logs(asset_id,status,started_at,ended_at,source,evidence_no,notes,recorded_by)
     VALUES(?,?,?,?,?,?,?,?)`,
    [assetId, b.status, b.started_at, b.ended_at || null, b.source || "", b.evidence_no || "", b.notes || "", req.user.id]
  );
  if (!b.ended_at) {
    await run("UPDATE assets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [b.status, assetId]);
  }
  await audit(req.user.id, "CREATE", "traffic_signal_status_logs", r.id, `${asset.name}: ${b.status} ${b.started_at}`);
  await saveLightingDailySnapshot(b.started_at || null, "traffic_log_create").catch(() => {});
  res.json({ id: r.id });
});

router.put("/traffic-signal-logs/:id", auth, requirePermission("assets_write"), async (req, res) => {
  const b = req.body || {};
  if (!b.status || !b.started_at) return res.status(400).json({ error: "Төлөв, эхэлсэн цаг шаардлагатай" });
  if (b.ended_at && b.ended_at < b.started_at) return res.status(400).json({ error: "Дууссан цаг эхэлсэн цагаас өмнө байж болохгүй" });
  await run(
    `UPDATE traffic_signal_status_logs
     SET status=?,started_at=?,ended_at=?,source=?,evidence_no=?,notes=?,updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.status, b.started_at, b.ended_at || null, b.source || "", b.evidence_no || "", b.notes || "", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "traffic_signal_status_logs", req.params.id, b.status);
  await saveLightingDailySnapshot(b.started_at || null, "traffic_log_update").catch(() => {});
  res.json({ ok: true });
});

router.delete("/traffic-signal-logs/:id", auth, requirePermission("assets_write"), async (req, res) => {
  await run("DELETE FROM traffic_signal_status_logs WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "traffic_signal_status_logs", req.params.id, "");
  await saveLightingDailySnapshot(null, "traffic_log_delete").catch(() => {});
  res.json({ ok: true });
});

router.put("/assets/:id", auth, requirePermission("assets_write"), async (req, res) => {
  const b = req.body;
  await run(`ALTER TABLE assets ADD COLUMN bag_no INTEGER`).catch(() => {});
  const current = await get("SELECT asset_code FROM assets WHERE id=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Хөрөнгө олдсонгүй" });
  const manualCode = String(b.asset_code || "").trim();
  if (b.category === "Шит/Самбар" && !manualCode) {
    return res.status(400).json({ error: "Шит/Самбарын код оруулна уу" });
  }
  const code = manualCode || current.asset_code || genAssetCode(b.category);
  const dup = await get("SELECT id FROM assets WHERE asset_code=? AND id<>?", [code, req.params.id]);
  if (dup) return res.status(400).json({ error: `Код давхардсан байна: ${code}` });
  const bagNo = normalizeBagNo(b.bag_no, b.name, b.location);
  await run(`UPDATE assets SET asset_code=?,name=?,category=?,sub_category=?,bag_no=?,location=?,
    gps_lat=?,gps_lng=?,status=?,condition=?,assigned_to=?,installed_date=?,
    warranty_until=?,purchase_price=?,current_value=?,useful_life_years=?,camera_count=?,
    description=?,specs=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [code, b.name, b.category, b.sub_category || "", bagNo, b.location || "",
     b.gps_lat || null, b.gps_lng || null,
     b.status || "Идэвхтэй", b.condition || "Хэвийн",
     b.assigned_to || null, b.installed_date || null, b.warranty_until || null,
     b.purchase_price || 0, b.current_value || 0, b.useful_life_years || 10, b.camera_count || 1,
     b.description || "", b.specs || "", b.notes || "", req.params.id]);
  await audit(req.user.id, "UPDATE", "assets", req.params.id, b.name);
  if (b.category === "Гэрлэн дохио") await saveLightingDailySnapshot(null, "traffic_asset_update").catch(() => {});
  res.json({ ok: true });
});

router.delete("/assets/:id", auth, async (req, res) => {
  const asset = await get("SELECT category FROM assets WHERE id=?", [req.params.id]);
  const lightingCats = new Set(["Авто замын гэрэл", "Гэр хорооллын гэрэл", "Цамхагийн гэрэл", "Шит/Самбар", "Гэрлэн дохио"]);
  const canDelete = ["director", "chief_engineer"].includes(req.user.role)
    || (["engineer", "electric"].includes(req.user.role) && lightingCats.has(asset?.category));
  if (!canDelete) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  await run("DELETE FROM assets WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "assets", req.params.id, "Хөрөнгө устгагдсан");
  if (asset?.category === "Гэрлэн дохио") await saveLightingDailySnapshot(null, "traffic_asset_delete").catch(() => {});
  res.json({ ok: true });
});

router.post("/assets/:id/files", auth, requirePermission("assets_write"), upload.single("file"), async (req, res) => {
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO asset_files(asset_id,file_type,file_path,file_name,description,uploaded_by) VALUES(?,?,?,?,?,?)`,
    [req.params.id, req.body.file_type || "photo",
     relative, req.file.originalname, req.body.description || "", req.user.id]);
  await audit(req.user.id, "UPLOAD", "asset_files", r.id, req.file.originalname);
  res.json({ id: r.id, file_path: relative });
});

router.delete("/asset-files/:id", auth, requirePermission("assets_write"), async (req, res) => {
  const f = await get("SELECT * FROM asset_files WHERE id=?", [req.params.id]);
  if (f) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(f.file_path)), () => {});
    await run("DELETE FROM asset_files WHERE id=?", [req.params.id]);
  }
  res.json({ ok: true });
});

// ── Asset flags (буруу бүртгэл) ──────────────────────────────
router.get("/asset-flags", auth, async (req, res) => {
  const rows = await all(`
    SELECT f.*, u.full_name flagged_by_name, r.full_name resolved_by_name
    FROM asset_flags f
    LEFT JOIN users u ON u.id = f.flagged_by
    LEFT JOIN users r ON r.id = f.resolved_by
    ORDER BY f.flagged_at DESC`);
  res.json(rows);
});

router.post("/asset-flags", auth, async (req, res) => {
  const { table_name, record_id, flag_note } = req.body;
  if (!table_name || !record_id) return res.status(400).json({ error: "Дутуу мэдээлэл" });
  const valid = ["sl_ger_inventory", "sl_points", "assets"];
  if (!valid.includes(table_name)) return res.status(400).json({ error: "Хүснэгт буруу" });
  await run(`INSERT INTO asset_flags(table_name,record_id,flag_note,flagged_by,is_resolved)
    VALUES(?,?,?,?,0)
    ON CONFLICT(table_name,record_id) DO UPDATE SET
      flag_note=excluded.flag_note, flagged_by=excluded.flagged_by,
      flagged_at=CURRENT_TIMESTAMP, is_resolved=0, resolved_by=NULL, resolved_at=NULL`,
    [table_name, record_id, flag_note || "", req.user.id]);
  res.json({ ok: true });
});

router.put("/asset-flags/:id/resolve", auth, async (req, res) => {
  await run(`UPDATE asset_flags SET is_resolved=1, resolved_by=?, resolved_at=CURRENT_TIMESTAMP WHERE id=?`,
    [req.user.id, req.params.id]);
  res.json({ ok: true });
});

router.delete("/asset-flags/:id", auth, requirePermission("assets_write"), async (req, res) => {
  await run("DELETE FROM asset_flags WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// ── Улсын үзлэг, тооллого (Үндсэн хөрөнгийн дансны бүртгэлтэй холбогдсон) ──

router.get("/inventory-sessions", auth, async (req, res) => {
  const rows = await all(`
    SELECT s.*, u.full_name created_name,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id) total_items,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id AND i.inv_status='Тоологдсон') counted,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id AND i.inv_status='Зөрүүтэй') discrepancy,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id AND i.inv_status='Олдоогүй') missing,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id AND i.inv_status='Актлах саналтай') write_off,
      (SELECT COUNT(*) FROM asset_inventory_items i WHERE i.session_id=s.id AND i.inv_status='Шилжүүлэх') transfer
    FROM asset_inventory_sessions s
    LEFT JOIN users u ON u.id=s.created_by
    ORDER BY s.created_at DESC`);
  res.json(rows);
});

router.post("/inventory-sessions", auth, requirePermission("assets_write"), async (req, res) => {
  const { title, year, start_date, end_date, notes } = req.body;
  if (!title || !year) return res.status(400).json({ error: "Гарчиг, жил шаардлагатай" });
  const r = await run(
    `INSERT INTO asset_inventory_sessions(title,year,start_date,end_date,notes,created_by) VALUES(?,?,?,?,?,?)`,
    [title, year, start_date || null, end_date || null, notes || "", req.user.id]
  );
  await audit(req.user.id, "CREATE", "asset_inventory_sessions", r.id, title);
  res.json({ id: r.id });
});

router.patch("/inventory-sessions/:id/close", auth, requirePermission("assets_write"), async (req, res) => {
  await run(`UPDATE asset_inventory_sessions SET status='Дууссан',end_date=COALESCE(end_date,date('now')) WHERE id=?`, [req.params.id]);
  await audit(req.user.id, "UPDATE", "asset_inventory_sessions", req.params.id, "Дууссан");
  res.json({ ok: true });
});

// Сессийн хөрөнгийн жагсаалт — fixed_assets_ledger-тай холбогдсон
router.get("/inventory-sessions/:id/items", auth, async (req, res) => {
  const sid = req.params.id;
  const session = await get("SELECT * FROM asset_inventory_sessions WHERE id=?", [sid]);
  if (!session) return res.status(404).json({ error: "Сесс олдсонгүй" });

  const items = await all(`
    SELECT
      f.id,
      f.account_code,
      COALESCE(f.asset_code_manual,'') asset_code,
      COALESCE(f.asset_name_manual,'') name,
      COALESCE(f.asset_model,'') model,
      f.unit, f.unit_value, f.initial_qty,
      f.acquisition_date,
      f.initial_value, f.book_value,
      ROUND(f.useful_life_months / 12.0, 1) useful_life_years,
      COALESCE(i.id, 0) item_id,
      COALESCE(i.inv_status,'Хүлээгдэж буй') inv_status,
      COALESCE(i.actual_qty, f.initial_qty) actual_qty,
      COALESCE(i.note,'') note,
      i.checked_by, cu.full_name checked_name, i.checked_at
    FROM fixed_assets_ledger f
    LEFT JOIN asset_inventory_items i ON i.ledger_id=f.id AND i.session_id=?
    LEFT JOIN users cu ON cu.id = i.checked_by
    ORDER BY f.account_code, f.asset_name_manual`, [sid]);

  res.json({ session, items });
});

// Хөрөнгийн тооллогын статус шинэчлэх
router.put("/inventory-sessions/:sid/items/:ledgerId", auth, async (req, res) => {
  const { sid, ledgerId } = req.params;
  const { inv_status, actual_qty, note } = req.body;
  const validStatuses = ["Хүлээгдэж буй","Тоологдсон","Зөрүүтэй","Олдоогүй","Актлах саналтай","Шилжүүлэх"];
  if (!validStatuses.includes(inv_status)) return res.status(400).json({ error: "Статус буруу" });

  await run(`
    INSERT INTO asset_inventory_items(session_id,ledger_id,inv_status,actual_qty,note,checked_by,checked_at)
    VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(session_id,ledger_id) DO UPDATE SET
      inv_status=excluded.inv_status,
      actual_qty=excluded.actual_qty,
      note=excluded.note,
      checked_by=excluded.checked_by,
      checked_at=CURRENT_TIMESTAMP`,
    [sid, ledgerId, inv_status, actual_qty ?? null, note || "", req.user.id]);

  res.json({ ok: true });
});

// Тооллогын тайлан — данс, хөрөнгийн нэрээр бүлэглэсэн
router.get("/inventory-sessions/:id/report", auth, async (req, res) => {
  const sid = req.params.id;
  const session = await get("SELECT * FROM asset_inventory_sessions WHERE id=?", [sid]);
  if (!session) return res.status(404).json({ error: "Сесс олдсонгүй" });

  const summary = await all(`
    SELECT
      COALESCE(i.inv_status,'Хүлээгдэж буй') inv_status,
      COUNT(*) cnt,
      SUM(f.initial_value) total_initial,
      SUM(f.book_value) total_book
    FROM fixed_assets_ledger f
    LEFT JOIN asset_inventory_items i ON i.ledger_id=f.id AND i.session_id=?
    GROUP BY COALESCE(i.inv_status,'Хүлээгдэж буй')`, [sid]);

  const byAccount = await all(`
    SELECT
      f.account_code,
      COUNT(*) total,
      SUM(CASE WHEN i.inv_status='Тоологдсон'      THEN 1 ELSE 0 END) counted,
      SUM(CASE WHEN i.inv_status='Зөрүүтэй'        THEN 1 ELSE 0 END) discrepancy,
      SUM(CASE WHEN i.inv_status='Олдоогүй'        THEN 1 ELSE 0 END) missing,
      SUM(CASE WHEN i.inv_status='Актлах саналтай' THEN 1 ELSE 0 END) write_off,
      SUM(CASE WHEN i.inv_status IS NULL OR i.inv_status='Хүлээгдэж буй' THEN 1 ELSE 0 END) pending,
      SUM(f.initial_value) total_initial,
      SUM(f.book_value) total_book
    FROM fixed_assets_ledger f
    LEFT JOIN asset_inventory_items i ON i.ledger_id=f.id AND i.session_id=?
    GROUP BY f.account_code ORDER BY f.account_code`, [sid]);

  res.json({ session, summary, byAccount });
});

module.exports = router;
