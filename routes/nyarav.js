"use strict";
const express = require("express");
const { run, all, get, auth, audit, upload } = require("../db");
const { requireRole, requirePermission } = require("../middleware/roles");
const router  = express.Router();

// ── helpers ──────────────────────────────────────────────────────
async function nextDocNo(prefix) {
  const year = new Date().getFullYear();
  const row  = await get(
    `SELECT COUNT(*) as cnt FROM wh_transactions WHERE txn_no LIKE ?`,
    [`${prefix}-${year}-%`]);
  const seq  = (row?.cnt || 0) + 1;
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

async function computeBalance(material_id) {
  const m = await get("SELECT opening_qty FROM wh_materials WHERE id=?", [material_id]);
  if (!m) return 0;
  const t = await get(
    `SELECT
      COALESCE(SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN')  THEN qty ELSE 0 END),0) as total_in,
      COALESCE(SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END),0) as total_out
     FROM wh_transactions WHERE material_id=?`, [material_id]);
  return (m.opening_qty || 0) + (t?.total_in || 0) - (t?.total_out || 0);
}

const BALANCE_SQL = `
  (m.opening_qty
    + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN')  THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
    - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
  ) as current_qty`;

// ── Dashboard summary ────────────────────────────────────────────
router.get("/nyarav/summary", auth, async (req, res) => {
  try {
    const requestedMonth = String(req.query.month || "");
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? requestedMonth
      : new Date().toISOString().slice(0, 7);
    const [totalItems, totalValue, lowStock, recentMoves, monthIncome, monthExpense] = await Promise.all([
      get(`SELECT COUNT(*) as total FROM wh_materials`),
      get(`SELECT COALESCE(SUM(
             (m.opening_qty
               + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN')  THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
               - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
             ) * m.unit_price
           ),0) as total FROM wh_materials m`),
      all(`SELECT m.id, m.name, m.unit, m.unit_price, m.min_qty, ${BALANCE_SQL}
           FROM wh_materials m WHERE current_qty <= m.min_qty AND m.min_qty > 0
           ORDER BY current_qty ASC LIMIT 10`),
      all(`SELECT t.*, m.name material_name, COALESCE(NULLIF(t.unit,''), m.unit) unit, u.full_name created_name
           FROM wh_transactions t
           LEFT JOIN wh_materials m ON m.id=t.material_id
           LEFT JOIN users u ON u.id=t.created_by
           ORDER BY t.created_at DESC LIMIT 15`),
      get(`SELECT COALESCE(SUM(amount),0) as total FROM wh_transactions
           WHERE txn_type IN ('INCOME','INTERNAL_IN') AND txn_date LIKE ?`, [month + "%"]),
      get(`SELECT COALESCE(SUM(amount),0) as total FROM wh_transactions
           WHERE txn_type IN ('EXPENSE','INTERNAL_OUT') AND txn_date LIKE ?`, [month + "%"])
    ]);
    res.json({ month, totalItems, totalValue, lowStock, recentMoves, monthIncome, monthExpense });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Materials catalog ────────────────────────────────────────────
router.get("/nyarav/materials", auth, async (req, res) => {
  try {
    const { q, category } = req.query;
    let sql = `SELECT m.*, ${BALANCE_SQL} FROM wh_materials m WHERE 1=1`;
    const params = [];
    if (q)        { sql += " AND m.name LIKE ?";          params.push(`%${q}%`); }
    if (category) { sql += " AND m.category_code = ?";    params.push(category); }
    sql += " ORDER BY m.category_code, m.name";
    res.json(await all(sql, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/nyarav/materials/:id", auth, async (req, res) => {
  try {
    const m = await get(`SELECT m.*, ${BALANCE_SQL} FROM wh_materials m WHERE m.id=?`, [req.params.id]);
    if (!m) return res.status(404).json({ error: "Олдсонгүй" });
    res.json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/nyarav/materials", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: "Нэр заавал шаардлагатай" });
  try {
    const r = await run(
      `INSERT INTO wh_materials(barcode,name,category_code,category_name,unit,unit_price,
         opening_qty,opening_amount,min_qty,custodian,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.barcode || null, b.name.trim(), b.category_code || "", b.category_name || "",
       b.unit || "", Number(b.unit_price || 0), Number(b.opening_qty || 0),
       Number(b.opening_amount || 0), Number(b.min_qty || 0),
       b.custodian || "", b.notes || "", req.user.id]);
    await audit(req.user.id, "CREATE", "wh_materials", r.id, b.name);
    res.json({ id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/nyarav/materials/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE wh_materials SET barcode=?,name=?,category_code=?,category_name=?,unit=?,
       unit_price=?,min_qty=?,custodian=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.barcode || null, b.name, b.category_code || "", b.category_name || "",
     b.unit || "", Number(b.unit_price || 0), Number(b.min_qty || 0),
     b.custodian || "", b.notes || "", req.params.id]);
  await audit(req.user.id, "UPDATE", "wh_materials", req.params.id, b.name);
  res.json({ ok: true });
});

router.delete("/nyarav/materials/all", auth, requireRole("director"), async (req, res) => {
  await run("DELETE FROM wh_transactions");
  await run("DELETE FROM wh_materials");
  await audit(req.user.id, "DELETE_ALL", "wh_materials", 0, "Бүх материал болон гүйлгээ устгагдлаа");
  res.json({ ok: true });
});

router.delete("/nyarav/materials/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const rec = await get("SELECT name FROM wh_materials WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  const txns = await get("SELECT COUNT(*) as cnt FROM wh_transactions WHERE material_id=?", [req.params.id]);
  if (txns.cnt > 0) return res.status(400).json({ error: `"${rec.name}" материалд ${txns.cnt} гүйлгээ байна. Устгах боломжгүй.` });
  await run("DELETE FROM wh_materials WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "wh_materials", req.params.id, rec.name);
  res.json({ ok: true });
});

// ── Income (Орлого) ──────────────────────────────────────────────
router.get("/nyarav/income", auth, async (req, res) => {
  const { from, to, material_id } = req.query;
  let sql = `SELECT t.*, m.name material_name, COALESCE(NULLIF(t.unit,''), m.unit) unit, u.full_name created_name,
      '' work_title, '' work_category, '' work_location
    FROM wh_transactions t
    LEFT JOIN wh_materials m ON m.id=t.material_id
    LEFT JOIN users u ON u.id=t.created_by
    WHERE t.txn_type IN ('INCOME','INTERNAL_IN')`;
  const params = [];
  if (from)        { sql += " AND t.txn_date >= ?"; params.push(from); }
  if (to)          { sql += " AND t.txn_date <= ?"; params.push(to); }
  if (material_id) { sql += " AND t.material_id=?"; params.push(material_id); }
  sql += " ORDER BY t.txn_date DESC, t.id DESC";
  try { res.json(await all(sql, params)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/nyarav/income", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  if (!b.material_id || !b.qty || !b.txn_date)
    return res.status(400).json({ error: "material_id, qty, txn_date шаардлагатай" });
  try {
    const txn_type = b.txn_type === "INTERNAL_IN" ? "INTERNAL_IN" : "INCOME";
    const docNo    = await nextDocNo("ОР");
    const qty      = Number(b.qty);
    const price    = Number(b.unit_price || 0);
    const r = await run(
      `INSERT INTO wh_transactions(txn_no,txn_date,txn_type,material_id,qty,unit,unit_price,amount,doc_no,supplier,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [docNo, b.txn_date, txn_type, b.material_id, qty, b.unit || "",
       price, qty * price, b.doc_no || docNo, b.supplier || "", b.notes || "", req.user.id]);
    await audit(req.user.id, "CREATE", "wh_transactions", r.id, `${txn_type}: mat=${b.material_id} qty=${qty}`);
    res.json({ id: r.id, txn_no: docNo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Income grouped by doc_no ─────────────────────────────────────
router.get("/nyarav/income-docs", auth, async (req, res) => {
  try {
    const docs = await all(`
      SELECT doc_no, txn_date, txn_type, supplier, notes, created_by,
             COUNT(*) as line_count,
             SUM(amount) as total_amount,
             GROUP_CONCAT(id) as ids
      FROM wh_transactions
      WHERE txn_type IN ('INCOME','INTERNAL_IN')
      GROUP BY doc_no
      ORDER BY txn_date DESC, MIN(id) DESC
    `);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Expense grouped by doc_no ─────────────────────────────────────
router.get("/nyarav/expense-docs", auth, async (req, res) => {
  try {
    const docs = await all(`
      SELECT t.doc_no, t.txn_date, t.txn_type, t.received_by, t.work_ref, t.asset_ref, t.work_log_id,
             w.title work_title, w.category work_category, w.location work_location,
             t.notes, t.created_by,
             COUNT(*) as line_count,
             SUM(t.amount) as total_amount,
             GROUP_CONCAT(t.id) as ids
      FROM wh_transactions t
      LEFT JOIN asset_events w ON w.id=t.work_log_id
      WHERE t.txn_type IN ('EXPENSE','INTERNAL_OUT')
      GROUP BY t.doc_no
      ORDER BY t.txn_date DESC, MIN(t.id) DESC
    `);
    res.json(docs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Transaction edit / delete (орлого болон зарлага хоёуланд) ───
router.put("/nyarav/transactions/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  const rec = await get("SELECT * FROM wh_transactions WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  try {
    const qty   = Number(b.qty   ?? rec.qty);
    const price = Number(b.unit_price ?? rec.unit_price);
    await run(
      `UPDATE wh_transactions SET txn_date=?, qty=?, unit=?, unit_price=?, amount=?, doc_no=?, supplier=?, notes=? WHERE id=?`,
      [b.txn_date || rec.txn_date, qty, b.unit ?? rec.unit ?? "", price, qty * price,
       b.doc_no || rec.doc_no, b.supplier ?? rec.supplier, b.notes ?? rec.notes, req.params.id]);
    await audit(req.user.id, "UPDATE", "wh_transactions", req.params.id, `qty=${qty}`);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/nyarav/transactions/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const rec = await get("SELECT * FROM wh_transactions WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM wh_transactions WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "wh_transactions", req.params.id, `${rec.txn_type}: mat=${rec.material_id} qty=${rec.qty}`);
  res.json({ ok: true });
});

// ── Expense (Зарлага) ────────────────────────────────────────────
router.get("/nyarav/expense", auth, async (req, res) => {
  const { from, to, material_id, received_by } = req.query;
  let sql = `SELECT t.*, m.name material_name, COALESCE(NULLIF(t.unit,''), m.unit) unit, u.full_name created_name
    FROM wh_transactions t
    LEFT JOIN wh_materials m ON m.id=t.material_id
    LEFT JOIN users u ON u.id=t.created_by
    LEFT JOIN asset_events w ON w.id=t.work_log_id
    WHERE t.txn_type IN ('EXPENSE','INTERNAL_OUT')`;
  const params = [];
  if (from)        { sql += " AND t.txn_date >= ?"; params.push(from); }
  if (to)          { sql += " AND t.txn_date <= ?"; params.push(to); }
  if (material_id) { sql += " AND t.material_id=?"; params.push(material_id); }
  if (received_by) { sql += " AND t.received_by LIKE ?"; params.push(`%${received_by}%`); }
  sql += " ORDER BY t.txn_date DESC, t.id DESC";
  try { res.json(await all(sql, params)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/nyarav/expense", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  if (!b.material_id || !b.qty || !b.txn_date)
    return res.status(400).json({ error: "material_id, qty, txn_date шаардлагатай" });
  try {
    const balance = await computeBalance(b.material_id);
    if (Number(b.qty) > balance)
      return res.status(400).json({ error: `Үлдэгдэл хүрэлцэхгүй (үлдэгдэл: ${balance.toFixed(2)})` });

    const txn_type = b.txn_type === "INTERNAL_OUT" ? "INTERNAL_OUT" : "EXPENSE";
    const docNo    = await nextDocNo("ШХ");
    const qty      = Number(b.qty);
    const mat      = await get("SELECT unit_price FROM wh_materials WHERE id=?", [b.material_id]);
    const price    = Number(b.unit_price) || Number(mat?.unit_price || 0);
    const r = await run(
      `INSERT INTO wh_transactions(txn_no,txn_date,txn_type,material_id,qty,unit,unit_price,amount,
         doc_no,received_by,work_ref,asset_ref,work_log_id,notes,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [docNo, b.txn_date, txn_type, b.material_id, qty, b.unit || "", price, qty * price,
       b.doc_no || docNo, b.received_by || "", b.work_ref || "", b.asset_ref || "",
       b.work_log_id || null, b.notes || "", req.user.id]);
    await audit(req.user.id, "CREATE", "wh_transactions", r.id, `${txn_type}: mat=${b.material_id} qty=${qty}`);
    res.json({ id: r.id, txn_no: docNo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Balance ledger ───────────────────────────────────────────────
router.get("/nyarav/balance", auth, async (req, res) => {
  try {
    const rows = await all(`
      SELECT m.*,
        COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN')  THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0) as total_income_qty,
        COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN')  THEN amount ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0) as total_income_amount,
        COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0) as total_expense_qty,
        COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN amount ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0) as total_expense_amount,
        ${BALANCE_SQL}
      FROM wh_materials m ORDER BY m.category_code, m.name`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Monthly journal report (БМ журналын бүтэц) ──────────────────
router.get("/nyarav/report/monthly", auth, async (req, res) => {
  const year  = req.query.year  || new Date().getFullYear();
  const month = req.query.month || (new Date().getMonth() + 1);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  try {
    const rows = await all(`
      SELECT m.category_code, m.category_name, m.name, m.unit, m.unit_price,
        m.opening_qty, m.opening_qty * m.unit_price as opening_amount,
        COALESCE(SUM(CASE WHEN t.txn_type='INCOME'       AND t.txn_date LIKE ? THEN t.qty ELSE 0 END),0) as income_qty,
        COALESCE(SUM(CASE WHEN t.txn_type='INCOME'       AND t.txn_date LIKE ? THEN t.amount ELSE 0 END),0) as income_amount,
        COALESCE(SUM(CASE WHEN t.txn_type='INTERNAL_IN'  AND t.txn_date LIKE ? THEN t.qty ELSE 0 END),0) as int_in_qty,
        COALESCE(SUM(CASE WHEN t.txn_type='INTERNAL_IN'  AND t.txn_date LIKE ? THEN t.amount ELSE 0 END),0) as int_in_amount,
        COALESCE(SUM(CASE WHEN t.txn_type='EXPENSE'      AND t.txn_date LIKE ? THEN t.qty ELSE 0 END),0) as expense_qty,
        COALESCE(SUM(CASE WHEN t.txn_type='EXPENSE'      AND t.txn_date LIKE ? THEN t.amount ELSE 0 END),0) as expense_amount,
        COALESCE(SUM(CASE WHEN t.txn_type='INTERNAL_OUT' AND t.txn_date LIKE ? THEN t.qty ELSE 0 END),0) as int_out_qty,
        COALESCE(SUM(CASE WHEN t.txn_type='INTERNAL_OUT' AND t.txn_date LIKE ? THEN t.amount ELSE 0 END),0) as int_out_amount
      FROM wh_materials m
      LEFT JOIN wh_transactions t ON t.material_id=m.id
      GROUP BY m.id ORDER BY m.category_code, m.name`,
      Array(8).fill(prefix + "%"));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/nyarav/report/by-worker", auth, async (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT t.received_by, m.name material_name, m.unit,
      SUM(t.qty) as total_qty, SUM(t.amount) as total_amount
    FROM wh_transactions t LEFT JOIN wh_materials m ON m.id=t.material_id
    WHERE t.txn_type IN ('EXPENSE','INTERNAL_OUT') AND t.received_by != ''`;
  const params = [];
  if (from) { sql += " AND t.txn_date >= ?"; params.push(from); }
  if (to)   { sql += " AND t.txn_date <= ?"; params.push(to); }
  sql += " GROUP BY t.received_by, t.material_id ORDER BY t.received_by, m.name";
  try { res.json(await all(sql, params)); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/nyarav/report/by-work", auth, async (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT COALESCE(NULLIF(w.title,''), NULLIF(t.work_ref,''), 'Холбоосгүй') work_ref,
      t.work_log_id, m.name material_name, m.unit,
      SUM(t.qty) as total_qty, SUM(t.amount) as total_amount
    FROM wh_transactions t
    LEFT JOIN wh_materials m ON m.id=t.material_id
    LEFT JOIN asset_events w ON w.id=t.work_log_id
    WHERE t.txn_type IN ('EXPENSE','INTERNAL_OUT') AND (t.work_ref != '' OR t.work_log_id IS NOT NULL)`;
  const params = [];
  if (from) { sql += " AND t.txn_date >= ?"; params.push(from); }
  if (to)   { sql += " AND t.txn_date <= ?"; params.push(to); }
  sql += " GROUP BY t.work_log_id, t.work_ref, t.material_id ORDER BY work_ref, m.name";
  try { res.json(await all(sql, params)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Excel bootstrap (БМ журнал.xlsx import) ──────────────────────
router.post("/nyarav/bootstrap", auth, requirePermission("warehouse_write"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл оруулаагүй" });
  try {
    const xlsx = require("xlsx");
    const wb   = xlsx.readFile(req.file.path);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
    let imported = 0, skipped = 0;
    for (const row of rows.slice(5)) {
      const [cat, name, unit, barcode, unit_price, opening_qty, opening_amount] = row;
      if (!name || !String(name).trim()) continue;
      const catStr  = String(cat || "");
      if (catStr.startsWith("Хөтөлсөн") || catStr.startsWith("Шалгасан")) continue;
      const catCode = catStr.match(/^(\d+)/)?.[1] || "";
      const catName = catStr.replace(/^\d+-/, "").trim();
      try {
        await run(
          `INSERT OR IGNORE INTO wh_materials(barcode,name,category_code,category_name,unit,unit_price,opening_qty,opening_amount,created_by)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [String(barcode || ""), String(name).trim(), catCode, catName, String(unit || ""),
           Number(unit_price || 0), Number(opening_qty || 0), Number(opening_amount || 0), req.user.id]);
        imported++;
      } catch (_) { skipped++; }
    }
    await audit(req.user.id, "IMPORT", "wh_materials", 0, `БМ журнал bootstrap: ${imported} материал`);
    res.json({ imported, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Orders (Захиалга) — uses legacy nyarav_orders table ──────────
router.get("/nyarav/orders", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT no.*, u.full_name created_name, a.full_name approved_name
       FROM nyarav_orders no
       LEFT JOIN users u ON u.id=no.created_by
       LEFT JOIN users a ON a.id=no.approved_by
       ORDER BY no.created_at DESC`));
  } catch (_) { res.json([]); }
});

router.post("/nyarav/orders", auth, async (req, res) => {
  const b = req.body;
  if (!b.item_name || !b.qty || !b.order_date)
    return res.status(400).json({ error: "Шаардлагатай талбарууд дутуу байна" });
  try {
    const r = await run(
      `INSERT INTO nyarav_orders(order_date,item_name,qty,unit,estimated_price,purpose,requested_by,status,note,created_by)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [b.order_date, b.item_name, Number(b.qty), b.unit || "",
       Number(b.estimated_price || 0), b.purpose || "",
       b.requested_by || "", "Хүлээгдэж буй", b.note || "", req.user.id]);
    await audit(req.user.id, "CREATE", "nyarav_orders", r.id, `${b.item_name} x${b.qty}`);
    res.json({ id: r.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/nyarav/orders/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE nyarav_orders SET status=?,approved_by=?,approval_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.status, req.user.id, b.approval_note || "", req.params.id]);
  await audit(req.user.id, "UPDATE", "nyarav_orders", req.params.id, b.status);
  res.json({ ok: true });
});

// ── Categories list ──────────────────────────────────────────────
router.get("/nyarav/categories", auth, async (req, res) => {
  try {
    res.json(await all(
      `SELECT DISTINCT category_code, category_name FROM wh_materials
       WHERE category_code != '' ORDER BY category_code`));
  } catch (e) { res.json([]); }
});

// ── Work plan / to-do (first rollout for Nyarav, reusable data model) ──
const TODO_ASSIGN_ROLES = new Set(["director", "chief_engineer", "hr", "safety"]);
const TODO_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const TODO_STATUSES = new Set(["todo", "doing", "done", "postponed"]);
const TODO_TYPES = new Set(["work", "personal", "reminder", "meeting", "birthday", "other"]);
const TODO_PRIVACY = new Set(["private", "assigned", "shared"]);

function todoTime(value) {
  const s = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(s) ? s : "";
}

function canAssignTodo(user) {
  return TODO_ASSIGN_ROLES.has(user?.role);
}

function monthPrefix(v) {
  return String(v || new Date().toISOString().slice(0, 7)).slice(0, 7);
}

function todoModule(value) {
  return ["personal", "nyarav"].includes(value) ? value : "personal";
}

async function getTodoForAccess(id, user) {
  const row = await get("SELECT * FROM work_todos WHERE id=? AND module IN ('personal','nyarav')", [id]);
  if (!row) return null;
  const owns = [row.assigned_to, row.assigned_by, row.created_by].some(v => Number(v) === Number(user.id));
  if (owns) return row;
  if (row.privacy === "private") return false;
  if (row.privacy === "assigned") return false;
  if (row.privacy === "shared") {
    if (canAssignTodo(user)) return row;
  }
  return false;
}

router.get("/nyarav/todos", auth, async (req, res) => {
  try {
    // year=YYYY → fetch full year; month=YYYY-MM → fetch one month
    const datePrefix = /^\d{4}$/.test(req.query.year || '')
      ? req.query.year
      : monthPrefix(req.query.month);
    const mod = todoModule(req.query.module);
    const params = [mod, `${datePrefix}%`];
    let where = "WHERE wt.module=? AND wt.work_date LIKE ?";
    const requestedAssignee = req.query.assigned_to;

    if (requestedAssignee === "all") {
      // Бүх ажилтан горим: work/meeting/reminder → бүгдэд харагдана
      // personal/other + private → зөвхөн өөртөө
      where += ` AND (
        wt.todo_type NOT IN ('personal','other')
        OR wt.privacy = 'shared'
        OR wt.assigned_to=? OR wt.assigned_by=? OR wt.created_by=?
      )`;
      params.push(req.user.id, req.user.id, req.user.id);
    } else if (requestedAssignee && Number(requestedAssignee) !== Number(req.user.id)) {
      // Тодорхой хэрэглэгч — зөвхөн canAssignTodo (director г.м.)
      if (canAssignTodo(req.user)) {
        where += " AND wt.assigned_to=?";
        params.push(Number(requestedAssignee));
        where += ` AND (
          wt.todo_type NOT IN ('personal','other')
          OR wt.privacy = 'shared'
          OR wt.assigned_to=? OR wt.assigned_by=? OR wt.created_by=?
        )`;
        params.push(req.user.id, req.user.id, req.user.id);
      } else {
        where += " AND wt.assigned_to=?";
        params.push(req.user.id);
      }
    } else {
      // Өөрийн тэмдэглэл — бүгдийг харна
      where += " AND wt.assigned_to=?";
      params.push(req.user.id);
    }

    const rows = await all(`
      SELECT wt.*, au.full_name assigned_name, au.position assigned_position,
             bu.full_name assigned_by_name, cu.full_name created_name,
             (SELECT COUNT(*) FROM work_todo_notes n WHERE n.todo_id=wt.id) note_count,
             (SELECT n.note FROM work_todo_notes n WHERE n.todo_id=wt.id ORDER BY n.id DESC LIMIT 1) latest_note
      FROM work_todos wt
      LEFT JOIN users au ON au.id=wt.assigned_to
      LEFT JOIN users bu ON bu.id=wt.assigned_by
      LEFT JOIN users cu ON cu.id=wt.created_by
      ${where}
      ORDER BY wt.work_date ASC,
        CASE wt.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        wt.id DESC
    `, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/nyarav/todos", auth, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "Ажлын гарчиг оруулна уу" });
  const assigner = canAssignTodo(req.user);
  const assignedTo = assigner ? Number(b.assigned_to || req.user.id) : req.user.id;
  const workDate = String(b.work_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const priority = TODO_PRIORITIES.has(b.priority) ? b.priority : "normal";
  const status = TODO_STATUSES.has(b.status) ? b.status : "todo";
  const todoType = TODO_TYPES.has(b.todo_type) ? b.todo_type : "work";
  const privacy = TODO_PRIVACY.has(b.privacy) ? b.privacy : "private";
  const workTime    = todoTime(b.work_time);
  const workEndTime = todoTime(b.work_end_time);
  const mod = todoModule(b.module);
  try {
    const user = await get("SELECT id FROM users WHERE id=? AND active=1", [assignedTo]);
    if (!user) return res.status(400).json({ error: "Ажилтан олдсонгүй" });
    const r = await run(`
      INSERT INTO work_todos(module,title,note,assigned_to,assigned_by,work_date,work_time,work_end_time,due_date,todo_type,privacy,priority,status,created_by,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      mod, title, String(b.note || "").trim(), assignedTo, assigner ? req.user.id : null,
      workDate, workTime, workEndTime, b.due_date || workDate, todoType, privacy, priority, status, req.user.id,
      status === "done" ? new Date().toISOString() : null
    ]);
    await audit(req.user.id, "CREATE", "work_todos", r.id, title);
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put("/nyarav/todos/:id", auth, async (req, res) => {
  const existing = await getTodoForAccess(req.params.id, req.user);
  if (existing === null) return res.status(404).json({ error: "Ажил олдсонгүй" });
  if (existing === false) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const b = req.body || {};
  const assigner = canAssignTodo(req.user);
  const assignedTo = assigner && b.assigned_to ? Number(b.assigned_to) : existing.assigned_to;
  const status = TODO_STATUSES.has(b.status) ? b.status : existing.status;
  const priority = TODO_PRIORITIES.has(b.priority) ? b.priority : existing.priority;
  const todoType = TODO_TYPES.has(b.todo_type) ? b.todo_type : (existing.todo_type || "work");
  const privacy = TODO_PRIVACY.has(b.privacy) ? b.privacy : (existing.privacy || "private");
  const workTime    = Object.prototype.hasOwnProperty.call(b, "work_time")     ? todoTime(b.work_time)     : (existing.work_time     || "");
  const workEndTime = Object.prototype.hasOwnProperty.call(b, "work_end_time") ? todoTime(b.work_end_time) : (existing.work_end_time || "");
  const completedAt = status === "done"
    ? (existing.completed_at || new Date().toISOString())
    : null;
  try {
    await run(`
      UPDATE work_todos SET
        title=?, note=?, assigned_to=?, work_date=?, work_time=?, work_end_time=?, due_date=?, todo_type=?, privacy=?, priority=?, status=?,
        completed_at=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, [
      String(b.title ?? existing.title).trim() || existing.title,
      String(b.note ?? existing.note ?? "").trim(),
      assignedTo,
      String(b.work_date || existing.work_date).slice(0, 10),
      workTime, workEndTime,
      b.due_date || existing.due_date || String(b.work_date || existing.work_date).slice(0, 10),
      todoType,
      privacy,
      priority,
      status,
      completedAt,
      req.params.id
    ]);
    await audit(req.user.id, "UPDATE", "work_todos", req.params.id, status);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete("/nyarav/todos/:id", auth, requirePermission("warehouse_write"), async (req, res) => {
  const existing = await getTodoForAccess(req.params.id, req.user);
  if (existing === null) return res.status(404).json({ error: "Ажил олдсонгүй" });
  if (existing === false) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  try {
    await run("DELETE FROM work_todo_notes WHERE todo_id=?", [req.params.id]);
    await run("DELETE FROM work_todos WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "work_todos", req.params.id, existing.title);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get("/nyarav/todos/:id/notes", auth, async (req, res) => {
  const existing = await getTodoForAccess(req.params.id, req.user);
  if (existing === null) return res.status(404).json({ error: "Ажил олдсонгүй" });
  if (existing === false) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  try {
    res.json(await all(`
      SELECT n.*, u.full_name user_name
      FROM work_todo_notes n
      LEFT JOIN users u ON u.id=n.user_id
      WHERE n.todo_id=?
      ORDER BY n.id DESC
    `, [req.params.id]));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post("/nyarav/todos/:id/notes", auth, async (req, res) => {
  const existing = await getTodoForAccess(req.params.id, req.user);
  if (existing === null) return res.status(404).json({ error: "Ажил олдсонгүй" });
  if (existing === false) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "Тэмдэглэл бичнэ үү" });
  try {
    const r = await run("INSERT INTO work_todo_notes(todo_id,user_id,note) VALUES(?,?,?)", [req.params.id, req.user.id, note]);
    await run("UPDATE work_todos SET updated_at=CURRENT_TIMESTAMP WHERE id=?", [req.params.id]);
    await audit(req.user.id, "NOTE", "work_todos", req.params.id, note.slice(0, 120));
    res.json({ id: r.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
