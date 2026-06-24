const express = require("express");
const path    = require("path");
const fs      = require("fs");
const { run, all, get, auth, audit, upload, UPLOAD_DIR } = require("../db");
const { requireRole } = require("../middleware/roles");

const router = express.Router();

// ── List all ─────────────────────────────────────────────────
router.get("/documents", auth, async (_req, res) => {
  const docs = await all(
    `SELECT d.*, u.full_name creator_name
     FROM documents d
     LEFT JOIN users u ON u.id = d.created_by
     ORDER BY d.created_at DESC`
  );
  res.json(docs);
});

// ── Expiring soon ────────────────────────────────────────────
// Must be declared before /:id routes so Express doesn't treat
// the literal "expiring" as an id.
router.get("/documents/expiring", auth, async (req, res) => {
  const days = parseInt(req.query.days || "30", 10);
  const docs = await all(
    `SELECT *,
       CAST(julianday(valid_until) - julianday('now','localtime') AS INTEGER) AS days_left
     FROM documents
     WHERE status = 'Хүчинтэй'
       AND valid_until IS NOT NULL
       AND valid_until != ''
       AND date(valid_until) <= date('now','localtime','+${days} days')
     ORDER BY valid_until ASC`
  );
  res.json(docs);
});

// ── Create ───────────────────────────────────────────────────
router.post("/documents", auth, async (req, res) => {
  const b = req.body;
  if (!b.doc_type)         return res.status(400).json({ error: "Баримтын төрөл шаардлагатай" });
  if (!b.title?.trim())    return res.status(400).json({ error: "Баримтын нэр шаардлагатай" });

  if (b.valid_from && b.valid_until && b.valid_until < b.valid_from)
    return res.status(400).json({ error: "Хүчинтэй дуусах огноо эхлэх огнооноос өмнө байж болохгүй" });

  if (b.issued_date && isNaN(Date.parse(b.issued_date)))
    return res.status(400).json({ error: "Олгосон огноо буруу форматтай байна" });

  const notifyDays = Number(b.notify_days_before ?? 30);
  if (isNaN(notifyDays) || notifyDays < 0)
    return res.status(400).json({ error: "Сануулах хоног 0-ээс их байх ёстой" });

  const r = await run(
    `INSERT INTO documents
       (doc_type,title,description,issued_by,issued_date,valid_from,valid_until,
        notify_days_before,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.doc_type, b.title.trim(), b.description || null, b.issued_by || null,
     b.issued_date || null, b.valid_from || null, b.valid_until || null,
     notifyDays, b.status || "Хүчинтэй", req.user.id]
  );
  await audit(req.user.id, "CREATE", "documents", r.id, b.title.trim());
  res.json({ id: r.id });
});

// ── Update ───────────────────────────────────────────────────
router.put("/documents/:id", auth, async (req, res) => {
  const b = req.body;
  if (!b.doc_type)      return res.status(400).json({ error: "Баримтын төрөл шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Баримтын нэр шаардлагатай" });

  if (b.valid_from && b.valid_until && b.valid_until < b.valid_from)
    return res.status(400).json({ error: "Хүчинтэй дуусах огноо эхлэх огнооноос өмнө байж болохгүй" });

  const existing = await get("SELECT id FROM documents WHERE id=?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Баримт олдсонгүй" });

  const notifyDays = Number(b.notify_days_before ?? 30);
  await run(
    `UPDATE documents SET
       doc_type=?,title=?,description=?,issued_by=?,issued_date=?,valid_from=?,
       valid_until=?,notify_days_before=?,status=?
     WHERE id=?`,
    [b.doc_type, b.title.trim(), b.description || null, b.issued_by || null,
     b.issued_date || null, b.valid_from || null, b.valid_until || null,
     isNaN(notifyDays) ? 30 : notifyDays, b.status || "Хүчинтэй", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "documents", req.params.id, b.title.trim());
  res.json({ ok: true });
});

// ── Delete ───────────────────────────────────────────────────
router.delete("/documents/:id", auth, requireRole("director", "hr"), async (req, res) => {
  const doc = await get("SELECT * FROM documents WHERE id=?", [req.params.id]);
  if (!doc) return res.status(404).json({ error: "Олдсонгүй" });

  if (doc.file_path) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(doc.file_path)), () => {});
  }
  await run("DELETE FROM documents WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "documents", req.params.id, doc.title);
  res.json({ ok: true });
});

// ── File upload ──────────────────────────────────────────────
router.post("/documents/:id/file", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл байхгүй" });

  const doc = await get("SELECT * FROM documents WHERE id=?", [req.params.id]);
  if (!doc) return res.status(404).json({ error: "Бичиг баримт олдсонгүй" });

  // Remove old file if exists
  if (doc.file_path) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(doc.file_path)), () => {});
  }

  const filePath = "/uploads/" + req.file.filename;
  await run("UPDATE documents SET file_path=? WHERE id=?", [filePath, req.params.id]);
  await audit(req.user.id, "UPLOAD", "documents", req.params.id, req.file.originalname);
  res.json({ file_path: filePath });
});

module.exports = router;
