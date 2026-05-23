const express = require("express");
const fs = require("fs");
const path = require("path");
const { run, all, get, auth, audit, upload, UPLOAD_DIR } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");

const router = express.Router();

function genAssetCode(category) {
  const prefix = {
    "Гэрэлтүүлэг": "LIGHT", "Камер": "CAM", "Шилэн кабель": "FIBER",
    "Шит/Самбар": "PANEL", "Гэрлэн дохио": "TRAF", "Техник": "VEH",
    "Барилга": "BLDG", "Бусад": "ASSET"
  }[category] || "ASSET";
  return `${prefix}-${Date.now().toString().slice(-6)}`;
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

router.get("/assets", auth, async (req, res) => {
  const cat = req.query.category;
  let sql = `SELECT a.*, u.full_name assigned_name,
    (SELECT COUNT(*) FROM asset_files f WHERE f.asset_id=a.id) file_count,
    (SELECT COUNT(*) FROM asset_events w WHERE w.asset_id=a.id) work_count
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
  const history = await all(`SELECT w.*, u.full_name created_name
    FROM asset_events w LEFT JOIN users u ON u.id=w.created_by
    WHERE w.asset_id=? ORDER BY w.work_date DESC LIMIT 50`, [req.params.id]);
  res.json({ ...asset, files, history });
});

router.post("/assets", auth, requirePermission("assets_write"), async (req, res) => {
  const b = req.body;
  const code = b.asset_code || genAssetCode(b.category);
  const r = await run(`INSERT INTO assets(asset_code,name,category,sub_category,location,
    gps_lat,gps_lng,status,condition,assigned_to,installed_date,warranty_until,
    purchase_price,current_value,useful_life_years,description,specs,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, b.name, b.category, b.sub_category || "", b.location || "",
     b.gps_lat || null, b.gps_lng || null,
     b.status || "Идэвхтэй", b.condition || "Хэвийн",
     b.assigned_to || null, b.installed_date || null, b.warranty_until || null,
     b.purchase_price || 0, b.current_value || 0, b.useful_life_years || 10,
     b.description || "", b.specs || "", b.notes || "", req.user.id]);
  await audit(req.user.id, "CREATE", "assets", r.id, `${b.category}: ${b.name}`);
  res.json({ id: r.id, asset_code: code });
});

router.patch("/assets/:id/status", auth, requirePermission("assets_write"), async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status шаардлагатай" });
  await run("UPDATE assets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", [status, req.params.id]);
  await audit(req.user.id, "UPDATE", "assets", req.params.id, `Төлөв: ${status}`);
  res.json({ ok: true });
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
  res.json({ ok: true });
});

router.delete("/traffic-signal-logs/:id", auth, requirePermission("assets_write"), async (req, res) => {
  await run("DELETE FROM traffic_signal_status_logs WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "traffic_signal_status_logs", req.params.id, "");
  res.json({ ok: true });
});

router.put("/assets/:id", auth, requirePermission("assets_write"), async (req, res) => {
  const b = req.body;
  await run(`UPDATE assets SET name=?,category=?,sub_category=?,location=?,
    gps_lat=?,gps_lng=?,status=?,condition=?,assigned_to=?,installed_date=?,
    warranty_until=?,purchase_price=?,current_value=?,useful_life_years=?,
    description=?,specs=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.name, b.category, b.sub_category || "", b.location || "",
     b.gps_lat || null, b.gps_lng || null,
     b.status || "Идэвхтэй", b.condition || "Хэвийн",
     b.assigned_to || null, b.installed_date || null, b.warranty_until || null,
     b.purchase_price || 0, b.current_value || 0, b.useful_life_years || 10,
     b.description || "", b.specs || "", b.notes || "", req.params.id]);
  await audit(req.user.id, "UPDATE", "assets", req.params.id, b.name);
  res.json({ ok: true });
});

router.delete("/assets/:id", auth, requirePermission("assets_delete"), async (req, res) => {
  await run("DELETE FROM assets WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "assets", req.params.id, "Хөрөнгө устгагдсан");
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

router.delete("/asset-files/:id", auth, async (req, res) => {
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

router.delete("/asset-flags/:id", auth, async (req, res) => {
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
