const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requireRole } = require("../middleware/roles");

const router = express.Router();
const canEditWebsite = requireRole("director", "hr", "chief_engineer");

router.get("/website/contents", auth, canEditWebsite, async (req, res) => {
  const rows = await all(
    `SELECT * FROM public_contents
     ORDER BY section, sort_order, id DESC`
  );
  res.json(rows);
});

router.post("/website/contents", auth, canEditWebsite, async (req, res) => {
  const row = normalizeContent(req.body);
  if (!row.title) return res.status(400).json({ error: "Гарчиг оруулна уу" });
  const result = await run(
    `INSERT INTO public_contents
      (section, content_key, title, body, image_url, link_url, sort_order, published, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [row.section, row.content_key, row.title, row.body, row.image_url, row.link_url,
     row.sort_order, row.published, req.user.id, req.user.id]
  );
  await audit(req.user.id, "CREATE", "public_contents", result.id, row.title);
  res.json({ id: result.id });
});

router.put("/website/contents/:id", auth, canEditWebsite, async (req, res) => {
  const existing = await get("SELECT id FROM public_contents WHERE id=?", [req.params.id]);
  if (!existing) return res.status(404).json({ error: "Мэдээлэл олдсонгүй" });
  const row = normalizeContent(req.body);
  if (!row.title) return res.status(400).json({ error: "Гарчиг оруулна уу" });
  await run(
    `UPDATE public_contents
     SET section=?, content_key=?, title=?, body=?, image_url=?, link_url=?,
         sort_order=?, published=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [row.section, row.content_key, row.title, row.body, row.image_url, row.link_url,
     row.sort_order, row.published, req.user.id, req.params.id]
  );
  await audit(req.user.id, "UPDATE", "public_contents", req.params.id, row.title);
  res.json({ ok: true });
});

router.delete("/website/contents/:id", auth, canEditWebsite, async (req, res) => {
  await run("DELETE FROM public_contents WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "public_contents", req.params.id, "");
  res.json({ ok: true });
});

router.get("/website/hazard-reports", auth, canEditWebsite, async (_req, res) => {
  const rows = await all(
    `SELECT * FROM public_hazard_reports
     ORDER BY created_at DESC, id DESC
     LIMIT 200`
  );
  res.json(rows);
});

router.patch("/website/hazard-reports/:id/status", auth, canEditWebsite, async (req, res) => {
  const status = String(req.body?.status || "Шинэ").trim().slice(0, 40);
  await run("UPDATE public_hazard_reports SET status=? WHERE id=?", [status, req.params.id]);
  await audit(req.user.id, "UPDATE_STATUS", "public_hazard_reports", req.params.id, status);
  res.json({ ok: true });
});

function normalizeContent(body = {}) {
  return {
    section: String(body.section || "news").trim().slice(0, 40),
    content_key: String(body.content_key || "").trim().slice(0, 80),
    title: String(body.title || "").trim().slice(0, 240),
    body: String(body.body || "").trim(),
    image_url: String(body.image_url || "").trim().slice(0, 500),
    link_url: String(body.link_url || "").trim().slice(0, 500),
    sort_order: Number(body.sort_order) || 99,
    published: body.published === false || Number(body.published) === 0 ? 0 : 1
  };
}

module.exports = router;
