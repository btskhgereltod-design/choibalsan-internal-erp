const express = require("express");
const fs = require("fs");
const path = require("path");
const { run, all, get, auth, audit, upload, UPLOAD_DIR } = require("../db");
const { requirePermission } = require("../middleware/roles");
const { WORK_ORDER_STATUS, WORK_ORDER_FLOW } = require("../services/work_order_constants");
const { buildMonthlyReport } = require("../services/report_builder");

const router = express.Router();

function canSeeAll(role) {
  return ["director", "chief_engineer", "safety", "electric"].includes(role);
}

function isWorkLead(role) {
  return ["director", "chief_engineer"].includes(role);
}

function isWorkOwner(row, userId) {
  const uid = Number(userId || 0);
  return uid && (Number(row.created_by || 0) === uid || Number(row.assigned_to || 0) === uid);
}

function isCategoryResponsible(row, role) {
  const category = String(row.category || "");
  if (role === "camera_engineer" && category === "Камер засвар") return true;
  if (["engineer", "electric"].includes(role) && category === "Гэрэлтүүлэг засвар") return true;
  return false;
}

async function isWorkParticipant(row, user) {
  if (isCategoryResponsible(row, user.role)) return true;
  if (isWorkOwner(row, user.id)) return true;
  const u = await get("SELECT full_name FROM users WHERE id=?", [user.id]);
  const fullName = String(u?.full_name || "").trim();
  if (!fullName) return false;
  const workerText = String(row.material_note || "");
  if (workerText.includes(fullName)) return true;
  const exec = await get(
    `SELECT id FROM work_executions
     WHERE work_log_id=? AND workers LIKE ?
     LIMIT 1`,
    [row.id, `%${fullName}%`]
  );
  return !!exec;
}

function isDeleteLockedStatus(status) {
  return [
    WORK_ORDER_STATUS.SUBMITTED_DONE,
    WORK_ORDER_STATUS.HSE_CHECKED,
    WORK_ORDER_STATUS.ENGINEER_APPROVED_LEGACY,
    WORK_ORDER_STATUS.CLOSED,
  ].includes(status);
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function erpSignatureCode(prefix, ...parts) {
  const text = [prefix, ...parts].map(v => String(v ?? "")).join("|");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

async function computeMaterialBalance(materialId) {
  const m = await get("SELECT opening_qty FROM wh_materials WHERE id=?", [materialId]);
  if (!m) return null;
  const t = await get(
    `SELECT
      COALESCE(SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END),0) total_in,
      COALESCE(SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END),0) total_out
     FROM wh_transactions WHERE material_id=?`,
    [materialId]
  );
  return Number(m.opening_qty || 0) + Number(t?.total_in || 0) - Number(t?.total_out || 0);
}

function normalizeProgress(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

async function syncWorkProgress(workLogId) {
  const summary = await get(
    `SELECT COUNT(*) execution_count,
            COALESCE(ROUND(AVG(CASE
              WHEN progress < 0 THEN 0
              WHEN progress > 100 THEN 100
              ELSE progress
            END)), 0) progress
     FROM work_executions
     WHERE work_log_id=?`,
    [workLogId]
  );
  const executionCount = Number(summary?.execution_count || 0);
  const countProgress = normalizeProgress(Math.ceil((executionCount / 3) * 100));
  const progress = executionCount > 0 ? countProgress : 0;
  const row = await get("SELECT status FROM asset_events WHERE id=?", [workLogId]);
  const lockedStatuses = [
    WORK_ORDER_STATUS.SUBMITTED_DONE,
    WORK_ORDER_STATUS.HSE_CHECKED,
    WORK_ORDER_STATUS.ENGINEER_APPROVED_LEGACY,
    WORK_ORDER_STATUS.CLOSED,
  ];
  let nextStatus = row?.status;
  if (!lockedStatuses.includes(row?.status)) {
    nextStatus = progress >= 100
      ? WORK_ORDER_STATUS.DONE
      : row?.status === WORK_ORDER_STATUS.DONE
        ? WORK_ORDER_STATUS.IN_PROGRESS
        : row?.status;
  }
  await run(
    "UPDATE asset_events SET progress=?, status=COALESCE(?, status), updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [progress, nextStatus, workLogId]
  );
  return progress;
}

async function nextWorkMaterialDocNo() {
  const year = new Date().getFullYear();
  const row = await get(
    `SELECT COUNT(*) cnt FROM wh_transactions WHERE txn_no LIKE ?`,
    [`WO-${year}-%`]
  );
  return `WO-${year}-${String(Number(row?.cnt || 0) + 1).padStart(4, "0")}`;
}

async function validateWorkReference(b) {
  const category = String(b.category || "");
  if (category === "Камер засвар") {
    const assetIds = parseWorkAssetIds(b);
    if (!assetIds.length) return "Камер засварын ажилд камер asset заавал сонгоно";
    const placeholders = assetIds.map(() => "?").join(",");
    const row = await get(
      `SELECT COUNT(*) count FROM assets WHERE category='Камер' AND id IN (${placeholders})`,
      assetIds
    );
    if (Number(row?.count || 0) !== assetIds.length) return "Камер засвар зөвхөн Камер asset-тэй холбогдоно";
  }
  if (category === "Гэрэлтүүлэг засвар" && (b.sl_sub_category || "") !== "other") {
    if (!b.sl_point_id && !b.ger_inventory_id) {
      return "Гэрэлтүүлэг засварын ажилд бүртгэлтэй гэрэлтүүлгийн байршил сонгоно";
    }
  }
  return "";
}

function parseWorkAssetIds(b) {
  const raw = Array.isArray(b.asset_ids)
    ? b.asset_ids
    : typeof b.asset_ids === "string"
      ? (() => { try { return JSON.parse(b.asset_ids); } catch (_) { return String(b.asset_ids).split(","); } })()
      : [];
  const ids = raw
    .map(v => Number(v || 0))
    .filter(v => Number.isInteger(v) && v > 0);
  if (b.asset_id) ids.unshift(Number(b.asset_id));
  return [...new Set(ids)];
}

// Resolve asset_id from domain reference if not explicitly set (Phase 2 bridge)
async function resolveAssetId(b) {
  const assetIds = parseWorkAssetIds(b);
  if (assetIds.length) return assetIds[0];
  if (b.sl_point_id) {
    const pt = await get("SELECT asset_id FROM sl_points WHERE id=?", [b.sl_point_id]).catch(() => null);
    if (pt?.asset_id) return pt.asset_id;
  }
  if (b.ger_inventory_id) {
    const gi = await get("SELECT asset_id FROM sl_ger_inventory WHERE id=?", [b.ger_inventory_id]).catch(() => null);
    if (gi?.asset_id) return gi.asset_id;
  }
  return null;
}

// ── Asset Events (work-logs) ─────────────────────────────────

router.get("/work-logs", auth, async (req, res) => {
  let where, params;
  if (canSeeAll(req.user.role)) {
    where = "";
    params = [];
  } else {
    const u = await get("SELECT full_name FROM users WHERE id=?", [req.user.id]);
    const nameLike = `%${u?.full_name || ''}%`;
    where = `WHERE (w.created_by=? OR w.assigned_to=?
      OR w.id IN (SELECT e.work_log_id FROM work_executions e WHERE e.workers LIKE ? AND e.work_log_id IS NOT NULL))`;
    params = [req.user.id, req.user.id, nameLike];
  }
  res.json(await all(`SELECT w.*, u.full_name created_name, a.full_name assigned_name,
    c.full_name confirmed_name, hp.full_name habea_pre_name, hpo.full_name habea_post_name,
    sb.full_name submitted_name,
    (SELECT COUNT(*) FROM work_photos p WHERE p.work_log_id=w.id) photo_count,
    (SELECT COUNT(*) FROM work_planned_materials pm WHERE pm.work_log_id=w.id) planned_material_count,
    (SELECT COUNT(*) FROM wh_transactions t WHERE t.work_log_id=w.id AND t.txn_type IN ('EXPENSE','INTERNAL_OUT')) material_count
    FROM asset_events w
    LEFT JOIN users u   ON u.id=w.created_by
    LEFT JOIN users a   ON a.id=w.assigned_to
    LEFT JOIN users c   ON c.id=w.confirmed_by
    LEFT JOIN users hp  ON hp.id=w.habea_pre_by
    LEFT JOIN users hpo ON hpo.id=w.habea_post_by
    LEFT JOIN users sb  ON sb.id=w.submitted_by
    ${where}
    ORDER BY w.work_date DESC, w.id DESC`, params));
});

router.post("/work-logs", auth, async (req, res) => {
  const b = req.body;
  if (!b.title?.trim()) return res.status(400).json({ error: "Ажлын нэр шаардлагатай" });
  if (!b.work_date)     return res.status(400).json({ error: "Огноо шаардлагатай" });
  const refError = await validateWorkReference(b);
  if (refError) return res.status(400).json({ error: refError });
  const assetIds = parseWorkAssetIds(b);
  const resolvedAssetId = await resolveAssetId(b);
  const r = await run(
    `INSERT INTO asset_events(title,category,department,location,description,status,progress,
      assigned_to,created_by,work_date,start_date,end_date,start_time,end_time,
      cost_amount,material_note,asset_id,asset_ids,ger_inventory_id,sl_point_id,sl_sub_category)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.title.trim(), b.category, b.department || "", b.location || "", b.description || "",
     b.status || WORK_ORDER_STATUS.IN_PROGRESS, 0, b.assigned_to || null, req.user.id,
     b.work_date, b.start_date || b.work_date || null, b.end_date || b.work_date || null,
     b.start_time || null, b.end_time || null, b.cost_amount || 0, b.material_note || "",
     resolvedAssetId, JSON.stringify(assetIds), b.ger_inventory_id || null,
     b.sl_point_id || null, b.sl_sub_category || null]);
  await audit(req.user.id, "CREATE", "asset_events", r.id, b.title.trim());
  res.json({ id: r.id });
});

router.put("/work-logs/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const b = req.body;
  const refError = await validateWorkReference(b);
  if (refError) return res.status(400).json({ error: refError });
  const assetIds = parseWorkAssetIds(b);
  const resolvedAssetId = await resolveAssetId(b);
  const manualProgress = normalizeProgress(Number(b.progress ?? 0));
  await run(`UPDATE asset_events SET title=?,category=?,department=?,location=?,description=?,
    status=?,progress=?,assigned_to=?,work_date=?,start_date=?,end_date=?,cost_amount=?,
    material_note=?,asset_id=?,asset_ids=?,ger_inventory_id=?,sl_point_id=?,sl_sub_category=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.title, b.category, b.department || "", b.location || "", b.description || "",
     b.status || WORK_ORDER_STATUS.IN_PROGRESS, manualProgress, b.assigned_to || null,
     b.work_date, b.start_date || null, b.end_date || null,
     b.cost_amount || 0, b.material_note || "", resolvedAssetId, JSON.stringify(assetIds),
     b.ger_inventory_id || null, b.sl_point_id || null, b.sl_sub_category || null,
     req.params.id]);
  await audit(req.user.id, "UPDATE", "asset_events", req.params.id, b.title);
  res.json({ ok: true });
});

router.patch("/work-logs/:id/assign", auth, requirePermission("operations_write"), async (req, res) => {
  const assignedTo = Number(req.body?.assigned_to || 0);
  if (!assignedTo) return res.status(400).json({ error: "Хариуцсан хүн сонгоно уу" });
  const row = await get("SELECT id,title,assigned_to FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Ажил олдсонгүй" });
  const user = await get("SELECT id,full_name FROM users WHERE id=? AND active=1", [assignedTo]);
  if (!user) return res.status(400).json({ error: "Сонгосон ажилтан олдсонгүй" });
  await run(
    "UPDATE asset_events SET assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [assignedTo, req.params.id]
  );
  await audit(req.user.id, "ASSIGN", "asset_events", req.params.id, `${row.title || ""} → ${user.full_name}`);
  res.json({ ok: true, assigned_to: assignedTo, assigned_name: user.full_name });
});

// Талбайн ажилтнаас хурдан төлөв шинэчлэх (field mobile)
router.patch("/work-logs/:id/status", auth, requirePermission("operations_write"), async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status шаардлагатай" });
  if (status === WORK_ORDER_STATUS.SUBMITTED_DONE) {
    return res.status(400).json({ error: "Дуусгаж илгээхдээ тусгай илгээх товч ашиглана уу" });
  }
  const updates = ["status=?","updated_at=CURRENT_TIMESTAMP"];
  const params  = [status];
  params.push(req.params.id);
  await run(`UPDATE asset_events SET ${updates.join(",")} WHERE id=?`, params);
  await audit(req.user.id, "UPDATE_STATUS", "asset_events", req.params.id, status);
  res.json({ ok: true });
});

// Зөвхөн огноо шинэчлэх (Gantt drag)
router.patch("/work-logs/:id/dates", auth, requirePermission("operations_write"), async (req, res) => {
  const { start_date, end_date } = req.body;
  await run("UPDATE asset_events SET start_date=?,end_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [start_date, end_date, req.params.id]);
  res.json({ ok: true });
});

router.patch("/executions/:id/dates", auth, requirePermission("operations_write"), async (req, res) => {
  const { start_date, end_date } = req.body;
  await run("UPDATE work_executions SET start_date=?,end_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [start_date, end_date, req.params.id]);
  res.json({ ok: true });
});

router.delete("/work-logs/:id", auth, async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Ажил олдсонгүй" });

  const lead = isWorkLead(req.user.role);
  if (!lead) {
    if (!["engineer", "camera_engineer", "electric"].includes(req.user.role) || !(await isWorkParticipant(row, req.user))) {
      return res.status(403).json({ error: "Энэ ажлыг устгах эрхгүй байна" });
    }
    if (isDeleteLockedStatus(row.status)) {
      return res.status(400).json({ error: "Илгээсэн, шалгагдсан эсвэл хаагдсан ажлыг устгахгүй. Ерөнхий инженерээр буцаалгуулж засна уу" });
    }
  }

  const usedMaterials = await get(
    `SELECT COUNT(*) count FROM wh_transactions
     WHERE work_log_id=? AND txn_type IN ('EXPENSE','INTERNAL_OUT')`,
    [req.params.id]
  );
  if (Number(usedMaterials?.count || 0) > 0) {
    return res.status(400).json({ error: "Материал зарцуулалттай ажил тул устгахгүй. Эхлээд материалын зарцуулалтыг засна уу" });
  }

  await run("DELETE FROM safety_comments WHERE report_id IN (SELECT id FROM safety_reports WHERE work_log_id=?)", [req.params.id]).catch(() => {});
  await run("DELETE FROM safety_reports WHERE work_log_id=?", [req.params.id]).catch(() => {});
  await run("DELETE FROM execution_photos WHERE execution_id IN (SELECT id FROM work_executions WHERE work_log_id=?)", [req.params.id]).catch(() => {});
  await run("DELETE FROM work_photos WHERE work_log_id=?", [req.params.id]).catch(() => {});
  await run("DELETE FROM work_executions WHERE work_log_id=?", [req.params.id]);
  await run("DELETE FROM work_planned_materials WHERE work_log_id=?", [req.params.id]);
  await run("DELETE FROM asset_events WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "asset_events", req.params.id, `Ажил устгагдсан: ${row.title || ""}`);
  res.json({ ok: true });
});

// ── Submit done (engineer → "Дууссан гэж илгээсэн") ──────────

router.post("/work-logs/:id/submit-done", auth, async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  if (!isWorkLead(req.user.role) && !(await isWorkParticipant(row, req.user))) {
    return res.status(403).json({ error: "Зөвхөн хариуцсан эсвэл үүсгэсэн хүн ажлыг дуусгаж илгээнэ" });
  }
  const blocked = WORK_ORDER_FLOW.SUBMIT_DONE_BLOCKED;
  if (blocked.includes(row.status))
    return res.status(400).json({ error: `Ажил аль хэдийн "${row.status}" төлөвтэй байна` });
  if (row.habea_pre_status !== "approved") {
    return res.status(400).json({ error: "Дуусгаж илгээхээс өмнө ХАБЭА эхлэлийн зөвшөөрөл авсан байх шаардлагатай" });
  }
  if (Number(row.progress || 0) < 100) {
    return res.status(400).json({ error: "Дуусгаж илгээхээс өмнө ажлын явцыг 100% болгоно уу" });
  }
  const note = req.body.note || "";
  const evidence = await get(
    `SELECT
       (SELECT COUNT(*) FROM work_executions WHERE work_log_id=?) exec_count,
       (SELECT COUNT(*) FROM work_photos WHERE work_log_id=?) work_photo_count,
       (SELECT COUNT(*) FROM execution_photos p
          JOIN work_executions e ON e.id=p.execution_id
         WHERE e.work_log_id=?) exec_photo_count`,
    [req.params.id, req.params.id, req.params.id]
  );
  if (!Number(evidence?.exec_count || 0)) {
    return res.status(400).json({ error: "Дуусгаж илгээхээс өмнө гүйцэтгэлийн бүртгэл заавал оруулна уу" });
  }
  if ((Number(evidence?.work_photo_count || 0) + Number(evidence?.exec_photo_count || 0)) <= 0) {
    return res.status(400).json({ error: "Дуусгаж илгээхээс өмнө нотлох зураг заавал хавсаргана уу" });
  }
  await run(
    `UPDATE asset_events SET status=?, progress=100,
     submitted_by=?, submitted_at=CURRENT_TIMESTAMP, submit_note=?,
     assigned_to=COALESCE(assigned_to, ?),
     confirm_status='', reject_note='',
     habea_post_status='', habea_post_by=NULL, habea_post_at=NULL,
     habea_post_note='', habea_post_signature_code='',
     updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [WORK_ORDER_STATUS.SUBMITTED_DONE, req.user.id, note, req.user.id, req.params.id]
  );
  await audit(req.user.id, "SUBMIT_DONE", "asset_events", req.params.id, `${row.title}${note?" — "+note:""}`);
  res.json({ ok: true });
});

// ── Chief engineer final confirmation ─────────────────────────

router.post("/work-logs/:id/confirm", auth, requirePermission("operations_confirm"), upload.single("confirm_image"), async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  const allowed = WORK_ORDER_FLOW.FINAL_CONFIRM_ALLOWED;
  if (!allowed.includes(row.status))
    return res.status(400).json({ error: "Зөвхөн ХАБЭА шалгасан ажлыг эцэслэн батлах боломжтой" });
  const note      = (req.body.confirm_note || "").trim();
  if (!note) return res.status(400).json({ error: "Баталгааны тэмдэглэл заавал бичих шаардлагатай" });
  const image_url = req.file ? `/uploads/${req.file.filename}` : "";
  const signedAt = nowSql();
  const signature = erpSignatureCode("ENG", row.id, req.user.id, row.title, note, signedAt);
  await run(
    `UPDATE asset_events SET status=?, confirm_status='eng_final_confirmed',
     confirmed_by=?, confirmed_at=?, confirm_signature_code=?,
     confirm_note=?, confirm_image_url=?, reject_note='', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [WORK_ORDER_STATUS.CLOSED, req.user.id, signedAt, signature, note, image_url, req.params.id]
  );
  await audit(req.user.id, "CONFIRM", "asset_events", req.params.id, `${row.title}${note?" — "+note:""}`);
  await run(
    `UPDATE safety_reports SET status=?, workflow_status='Хаасан'
     WHERE work_log_id=? AND status != ?`,
    [WORK_ORDER_STATUS.CLOSED, req.params.id, WORK_ORDER_STATUS.CLOSED]
  ).catch(() => {});
  const updated = await get(
    `SELECT w.*, u.full_name confirmed_name FROM asset_events w
     LEFT JOIN users u ON u.id=w.confirmed_by WHERE w.id=?`,
    [req.params.id]
  );
  res.json(updated);
});

router.post("/work-logs/:id/reject", auth, requirePermission("operations_confirm"), async (req, res) => {
  const { note } = req.body;
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  await run(
    `UPDATE asset_events SET confirm_status='rejected', confirmed_by=?, confirmed_at=CURRENT_TIMESTAMP,
     reject_note=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [req.user.id, note || "Нэмэлт засвар шаардлагатай", WORK_ORDER_STATUS.REJECTED, req.params.id]
  );
  await audit(req.user.id, "REJECT", "asset_events", req.params.id, `${row.title} — ${note || ""}`);
  res.json({ ok: true });
});

// ── ХАБЭА pre-work sign-off ───────────────────────────────────

router.post("/work-logs/:id/habea-pre", auth, requirePermission("safety_confirm"), async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  const { note, risks, measures } = req.body;
  await run(
    `UPDATE asset_events SET habea_pre_status='approved', habea_pre_by=?,
     habea_pre_at=CURRENT_TIMESTAMP, habea_pre_note=?, habea_pre_risks=?,
     habea_pre_measures=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [req.user.id, note || "", risks || "", measures || "", req.params.id]
  );
  // Create linked PTW record in safety_reports (once per work order)
  const existingPtw = await get("SELECT id FROM safety_reports WHERE work_log_id=?", [req.params.id]);
  if (!existingPtw) {
    const riskDesc = [risks, note].filter(Boolean).join(" / ");
    await run(
      `INSERT INTO safety_reports
         (report_date, title, risk_type, risk_level, location,
          risk_description, pre_work_note,
          probability, consequence_score, risk_score,
          workflow_status, status, work_log_id, created_by)
       VALUES(date('now'),?,?,?,?,?,?,3,3,9,?,?,?,?)`,
      [`PTW — ${row.title}`, "Цахилгааны эрсдэл", "Дунд", row.location || row.title,
       riskDesc || "", measures || "",
       "Хэрэгжиж байна", "Батлагдсан", Number(req.params.id), req.user.id]
    );
  }
  await audit(req.user.id, "HABEA_PRE", "asset_events", req.params.id, row.title);
  res.json({ ok: true });
});

// ── ХАБЭА post-work inspection → chief engineer final approval ─

router.post("/work-logs/:id/habea-post", auth, requirePermission("safety_confirm"), async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  const allowed = WORK_ORDER_FLOW.HSE_POST_ALLOWED;
  if (!allowed.includes(row.status))
    return res.status(400).json({ error: "Зөвхөн дуусгаж илгээсэн ажлыг ХАБЭА шалгах боломжтой" });
  const note = ((req.body.note || "")).trim();
  if (!note) return res.status(400).json({ error: "Шалгалтын дүгнэлт заавал бичих шаардлагатай" });
  const signedAt = nowSql();
  const signature = erpSignatureCode("HSE", row.id, req.user.id, row.title, note, signedAt);
  await run(
    `UPDATE asset_events SET status=?, habea_post_status='approved',
     habea_post_by=?, habea_post_at=?, habea_post_signature_code=?,
     habea_post_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [WORK_ORDER_STATUS.HSE_CHECKED, req.user.id, signedAt, signature, note || "", req.params.id]
  );
  await audit(req.user.id, "HABEA_POST", "asset_events", req.params.id, `${row.title}${note?" — "+note:""}`);
  res.json({ ok: true });
});

router.post("/work-logs/:id/habea-post-reject", auth, requirePermission("safety_confirm"), async (req, res) => {
  const row = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  const allowed = WORK_ORDER_FLOW.HSE_POST_ALLOWED;
  if (!allowed.includes(row.status))
    return res.status(400).json({ error: "Зөвхөн дуусгаж илгээсэн ажлыг буцаах боломжтой" });
  const { note } = req.body;
  await run(
    `UPDATE asset_events SET status=?, habea_post_status='rejected',
     habea_post_by=?, habea_post_at=CURRENT_TIMESTAMP,
     reject_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [WORK_ORDER_STATUS.REJECTED, req.user.id, note || "ХАБЭА буцаасан", req.params.id]
  );
  await audit(req.user.id, "HABEA_REJECT", "asset_events", req.params.id, `${row.title} — ${note || ""}`);
  res.json({ ok: true });
});

// ── Approval sheet data ───────────────────────────────────────

router.get("/work-logs/:id/approval-sheet", auth, async (req, res) => {
  const row = await get(
    `SELECT w.*,
            u.full_name   created_name,
            a.full_name   assigned_name,
            c.full_name   confirmed_name,
            hp.full_name  habea_pre_name,
            hpo.full_name habea_post_name,
            sb.full_name  submitted_name,
            (SELECT COUNT(*) FROM work_photos p WHERE p.work_log_id=w.id) photo_count
     FROM asset_events w
     LEFT JOIN users u   ON u.id = w.created_by
     LEFT JOIN users a   ON a.id = w.assigned_to
     LEFT JOIN users c   ON c.id = w.confirmed_by
     LEFT JOIN users hp  ON hp.id = w.habea_pre_by
     LEFT JOIN users hpo ON hpo.id = w.habea_post_by
     LEFT JOIN users sb  ON sb.id = w.submitted_by
     WHERE w.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  res.json(row);
});

// ── Linked PTW records for a work order ──────────────────────

router.get("/work-logs/:id/safety-reports", auth, async (req, res) => {
  res.json(await all(
    `SELECT s.*, u.full_name creator_name
     FROM safety_reports s
     LEFT JOIN users u ON u.id=s.created_by
     WHERE s.work_log_id=?
     ORDER BY s.created_at DESC`, [req.params.id]));
});

// ── Materials issued to a work order ─────────────────────────

router.get("/work-logs/:id/materials", auth, async (req, res) => {
  res.json(await all(
    `SELECT t.*, m.name material_name, COALESCE(NULLIF(t.unit,''), m.unit) unit,
            u.full_name created_name
     FROM wh_transactions t
     LEFT JOIN wh_materials m ON m.id=t.material_id
     LEFT JOIN users u ON u.id=t.created_by
     WHERE t.work_log_id=? AND t.txn_type IN ('EXPENSE','INTERNAL_OUT')
     ORDER BY t.txn_date DESC, t.id DESC`, [req.params.id]));
});

router.post("/work-logs/:id/materials", auth, requirePermission("operations_write"), async (req, res) => {
  const b = req.body || {};
  const work = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!work) return res.status(404).json({ error: "Ажил олдсонгүй" });

  const materialId = Number(b.material_id || 0);
  const qty = Number(b.qty || 0);
  if (!materialId || qty <= 0) return res.status(400).json({ error: "Материал болон тоо хэмжээг зөв оруулна уу" });

  const mat = await get("SELECT * FROM wh_materials WHERE id=?", [materialId]);
  if (!mat) return res.status(404).json({ error: "Материал олдсонгүй" });

  const balance = await computeMaterialBalance(materialId);
  if (balance === null) return res.status(404).json({ error: "Материал олдсонгүй" });
  if (qty > balance) {
    return res.status(400).json({ error: `Үлдэгдэл хүрэлцэхгүй (үлдэгдэл: ${balance.toLocaleString("mn-MN")} ${mat.unit || ""})` });
  }

  const user = await get("SELECT full_name FROM users WHERE id=?", [req.user.id]);
  const docNo = await nextWorkMaterialDocNo();
  const price = Number(b.unit_price || mat.unit_price || 0);
  const note = String(b.notes || "").trim();
  const r = await run(
    `INSERT INTO wh_transactions(txn_no,txn_date,txn_type,material_id,qty,unit,unit_price,amount,
       doc_no,received_by,work_ref,asset_ref,work_log_id,notes,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [docNo, b.txn_date || new Date().toISOString().slice(0, 10), "EXPENSE", materialId, qty,
     b.unit || mat.unit || "", price, qty * price, b.doc_no || docNo,
     user?.full_name || "", work.title || "", work.location || "", work.id,
     note ? `Инженерийн бодит зарцуулалт: ${note}` : "Инженерийн бодит зарцуулалт",
     req.user.id]
  );
  await audit(req.user.id, "WORK_MATERIAL_EXPENSE", "wh_transactions", r.id, `${work.title}: ${mat.name} x ${qty}`);
  res.json({ id: r.id, txn_no: docNo });
});

router.delete("/work-logs/:id/materials/:txnId", auth, requirePermission("operations_write"), async (req, res) => {
  const rec = await get(
    "SELECT * FROM wh_transactions WHERE id=? AND work_log_id=? AND txn_type IN ('EXPENSE','INTERNAL_OUT')",
    [req.params.txnId, req.params.id]
  );
  if (!rec) return res.status(404).json({ error: "Материалын зарлага олдсонгүй" });
  const canDelete = ["director", "chief_engineer"].includes(req.user.role) || Number(rec.created_by) === Number(req.user.id);
  if (!canDelete) return res.status(403).json({ error: "Зөвхөн өөрийн оруулсан материалыг устгах боломжтой" });
  await run("DELETE FROM wh_transactions WHERE id=?", [req.params.txnId]);
  await audit(req.user.id, "DELETE_WORK_MATERIAL", "wh_transactions", req.params.txnId, `work=${req.params.id} mat=${rec.material_id} qty=${rec.qty}`);
  res.json({ ok: true });
});

router.get("/work-logs/:id/planned-materials", auth, async (req, res) => {
  res.json(await all(
    `SELECT p.*, m.name material_name, m.category_name,
            COALESCE(NULLIF(p.unit,''), m.unit) unit,
            (m.opening_qty
              + COALESCE((SELECT SUM(CASE WHEN txn_type IN ('INCOME','INTERNAL_IN') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
              - COALESCE((SELECT SUM(CASE WHEN txn_type IN ('EXPENSE','INTERNAL_OUT') THEN qty ELSE 0 END) FROM wh_transactions t WHERE t.material_id=m.id),0)
            ) current_qty,
            u.full_name created_name
     FROM work_planned_materials p
     LEFT JOIN wh_materials m ON m.id=p.material_id
     LEFT JOIN users u ON u.id=p.created_by
     WHERE p.work_log_id=?
     ORDER BY p.id ASC`, [req.params.id]));
});

router.put("/work-logs/:id/planned-materials", auth, requirePermission("operations_write"), async (req, res) => {
  const rows = Array.isArray(req.body.materials) ? req.body.materials : [];
  await run("DELETE FROM work_planned_materials WHERE work_log_id=?", [req.params.id]);
  for (const item of rows) {
    const materialId = Number(item.material_id || 0);
    const qty = Number(item.qty || 0);
    if (!materialId || qty <= 0) continue;
    const mat = await get("SELECT unit, unit_price FROM wh_materials WHERE id=?", [materialId]);
    if (!mat) continue;
    const price = Number(item.unit_price || mat.unit_price || 0);
    await run(
      `INSERT INTO work_planned_materials(work_log_id,material_id,qty,unit,unit_price,note,status,created_by)
       VALUES(?,?,?,?,?,?,?,?)`,
      [req.params.id, materialId, qty, item.unit || mat.unit || "", price, item.note || "", "Төлөвлөсөн", req.user.id]
    );
  }
  await audit(req.user.id, "UPSERT", "work_planned_materials", req.params.id, `${rows.length} төлөвлөсөн материал`);
  res.json({ ok: true });
});

// ── Work Executions ──────────────────────────────────────────

router.get("/work-logs/:id/executions", auth, async (req, res) => {
  res.json(await all(`
    SELECT e.*, u.full_name created_name,
      (SELECT COUNT(*) FROM execution_photos p WHERE p.execution_id=e.id) photo_count
    FROM work_executions e
    LEFT JOIN users u ON u.id=e.created_by
    WHERE e.work_log_id=?
    ORDER BY e.start_date ASC, e.id ASC`, [req.params.id]));
});

router.post("/work-logs/:id/executions", auth, requirePermission("operations_write"), async (req, res) => {
  const b = req.body;
  const progress = normalizeProgress(b.progress);
  const r = await run(
    `INSERT INTO work_executions
      (work_log_id,title,start_date,end_date,status,progress,note,workers,safety_note,gps_lat,gps_lng,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.params.id, b.title, b.start_date, b.end_date,
     b.status || WORK_ORDER_STATUS.IN_PROGRESS, progress, b.note || "",
     b.workers || "", b.safety_note || "", b.gps_lat || null, b.gps_lng || null, req.user.id]);
  const parentProgress = await syncWorkProgress(req.params.id);
  await audit(req.user.id, "CREATE", "work_executions", r.id, b.title);
  res.json({ id: r.id, parent_progress: parentProgress });
});

router.get("/my-tasks", auth, async (req, res) => {
  const u = await get("SELECT full_name FROM users WHERE id=?", [req.user.id]);
  if (!u?.full_name) return res.json([]);
  const rows = await all(`
    SELECT e.id, e.title, e.status, e.progress, e.start_date, e.end_date, e.workers,
           w.id work_log_id, w.title work_title, w.category, w.location
    FROM work_executions e
    LEFT JOIN asset_events w ON w.id=e.work_log_id
    WHERE e.workers LIKE ? AND e.status != 'Дууссан'
    ORDER BY e.start_date ASC, e.id ASC`, [`%${u.full_name}%`]);
  res.json(rows);
});

router.get("/executions", auth, async (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const cat  = req.query.category || null;
  let sql = `SELECT e.*, w.title work_title, w.category, w.location,
    (SELECT COUNT(*) FROM execution_photos p WHERE p.execution_id=e.id) photo_count
    FROM work_executions e
    LEFT JOIN asset_events w ON w.id=e.work_log_id
    WHERE (e.start_date LIKE ? OR e.end_date LIKE ?)`;
  const params = [`${year}%`, `${year}%`];
  if (cat) { sql += " AND w.category=?"; params.push(cat); }
  sql += " ORDER BY e.start_date ASC, e.id ASC";
  res.json(await all(sql, params));
});

router.put("/executions/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const b = req.body;
  const execution = await get("SELECT work_log_id FROM work_executions WHERE id=?", [req.params.id]);
  if (!execution) return res.status(404).json({ error: "Гүйцэтгэл олдсонгүй" });
  const progress = normalizeProgress(b.progress);
  await run(`UPDATE work_executions SET
    title=?,start_date=?,end_date=?,status=?,progress=?,
    note=?,workers=?,safety_note=?,gps_lat=?,gps_lng=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.title, b.start_date, b.end_date, b.status || WORK_ORDER_STATUS.IN_PROGRESS,
     progress, b.note || "", b.workers || "", b.safety_note || "",
     b.gps_lat || null, b.gps_lng || null, req.params.id]);
  const parentProgress = await syncWorkProgress(execution.work_log_id);
  await audit(req.user.id, "UPDATE", "work_executions", req.params.id, b.title);
  res.json({ ok: true, parent_progress: parentProgress });
});

router.delete("/executions/:id", auth, requirePermission("operations_delete"), async (req, res) => {
  const execution = await get("SELECT work_log_id FROM work_executions WHERE id=?", [req.params.id]);
  if (!execution) return res.status(404).json({ error: "Гүйцэтгэл олдсонгүй" });
  await run("DELETE FROM execution_photos WHERE execution_id=?", [req.params.id]).catch(() => {});
  await run("DELETE FROM work_executions WHERE id=?", [req.params.id]);
  const parentProgress = await syncWorkProgress(execution.work_log_id);
  await audit(req.user.id, "DELETE", "work_executions", req.params.id, "Гүйцэтгэл устгагдсан");
  res.json({ ok: true, parent_progress: parentProgress });
});

// ── Execution photos ─────────────────────────────────────────

router.get("/executions/:id/photos", auth, async (req, res) => {
  res.json(await all(`SELECT p.*, u.full_name uploaded_name
    FROM execution_photos p LEFT JOIN users u ON u.id=p.uploaded_by
    WHERE execution_id=? ORDER BY id DESC`, [req.params.id]));
});

router.post("/executions/:id/photos", auth, upload.single("photo"), async (req, res) => {
  const ex = await get(
    `SELECT e.*, w.title work_title, w.location
     FROM work_executions e LEFT JOIN asset_events w ON w.id=e.work_log_id WHERE e.id=?`,
    [req.params.id]);
  if (!ex) return res.status(404).json({ error: "Гүйцэтгэл олдсонгүй" });
  const stamp = req.body.stamp_text || `${ex.title} | ${ex.work_title || ""} | ${new Date().toLocaleString("mn-MN")}`;
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO execution_photos(execution_id,file_path,stamp_text,uploaded_by) VALUES(?,?,?,?)`,
    [req.params.id, relative, stamp, req.user.id]);
  await audit(req.user.id, "UPLOAD_PHOTO", "execution_photos", r.id, stamp);
  res.json({ id: r.id, file_path: relative });
});

router.delete("/execution-photos/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const photo = await get("SELECT * FROM execution_photos WHERE id=?", [req.params.id]);
  if (photo) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(photo.file_path)), () => {});
    await run("DELETE FROM execution_photos WHERE id=?", [req.params.id]);
  }
  res.json({ ok: true });
});

// ── Work-log photos ──────────────────────────────────────────

router.post("/work-logs/:id/photos", auth, upload.single("photo"), async (req, res) => {
  const work = await get("SELECT * FROM asset_events WHERE id=?", [req.params.id]);
  if (!work) return res.status(404).json({ error: "Ажил олдсонгүй" });
  const stamp = req.body.stamp_text || `${work.title} | ${work.location || ""} | ${new Date().toLocaleString("mn-MN")}`;
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO work_photos(work_log_id,file_path,stamp_text,uploaded_by) VALUES(?,?,?,?)`,
    [work.id, relative, stamp, req.user.id]);
  await audit(req.user.id, "UPLOAD_PHOTO", "work_photos", r.id, stamp);
  res.json({ id: r.id, file_path: relative });
});

router.get("/work-logs/:id/photos", auth, async (req, res) => {
  res.json(await all(
    `SELECT p.*, u.full_name uploaded_name FROM work_photos p
     LEFT JOIN users u ON u.id=p.uploaded_by WHERE work_log_id=? ORDER BY id DESC`,
    [req.params.id]));
});


// ── Plans ────────────────────────────────────────────────────

router.post("/plans", auth, async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO plans(plan_type,year,month,title,department,budget,status,note,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.plan_type, b.year, b.month || null, b.title, b.department || "",
     b.budget || 0, b.status || "Төлөвлөсөн", b.note || "", req.user.id]);
  await audit(req.user.id, "CREATE", "plans", r.id, b.title);
  res.json({ id: r.id });
});

router.get("/plans", auth, async (_, res) => {
  res.json(await all(
    `SELECT p.*, u.full_name created_name FROM plans p
     LEFT JOIN users u ON u.id=p.created_by ORDER BY year DESC, month DESC, id DESC`));
});

router.put("/plans/:id", auth, async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE plans SET title=?,year=?,department=?,budget=?,status=?,note=? WHERE id=?`,
    [b.title, Number(b.year || new Date().getFullYear()), b.department || "",
     Number(b.budget || 0), b.status || "Төлөвлөж буй", b.note || "", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "plans", req.params.id, b.title || "");
  res.json({ ok: true });
});

router.delete("/plans/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const rec = await get("SELECT * FROM plans WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM plan_items WHERE plan_id=?", [req.params.id]);
  await run("DELETE FROM plan_files WHERE plan_id=?", [req.params.id]);
  await run("DELETE FROM plans WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "plans", req.params.id, rec.title || "");
  res.json({ ok: true });
});

router.get("/plans/:id/items", auth, async (req, res) => {
  res.json(await all(
    `SELECT pi.*, u.full_name responsible_name
     FROM plan_items pi
     LEFT JOIN users u ON u.id=pi.responsible_user
     WHERE pi.plan_id=?
     ORDER BY pi.id ASC`,
    [req.params.id]
  ));
});

router.post("/plans/:id/items", auth, async (req, res) => {
  const b = req.body;
  if (!b.title?.trim()) return res.status(400).json({ error: "Зардлын мөрийн нэр шаардлагатай" });
  const r = await run(
    `INSERT INTO plan_items(plan_id,title,target_qty,unit,estimated_cost,due_date,status,note)
     VALUES(?,?,?,?,?,?,?,?)`,
    [req.params.id, b.title.trim(), Number(b.target_qty || 1), b.unit || "",
     Number(b.estimated_cost || 0), b.due_date || null, b.status || "Төлөвлөсөн", b.note || ""]
  );
  await audit(req.user.id, "CREATE", "plan_items", r.id, `${req.params.id}: ${b.title}`);
  res.json({ id: r.id });
});

router.delete("/plan-items/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const rec = await get("SELECT * FROM plan_items WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM plan_items WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "plan_items", req.params.id, rec.title || "");
  res.json({ ok: true });
});

router.get("/plans/:id/files", auth, async (req, res) => {
  res.json(await all(
    `SELECT pf.*, u.full_name uploaded_name
     FROM plan_files pf
     LEFT JOIN users u ON u.id=pf.uploaded_by
     WHERE pf.plan_id=?
     ORDER BY pf.uploaded_at DESC, pf.id DESC`,
    [req.params.id]
  ));
});

router.post("/plans/:id/files", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл сонгоогүй байна" });
  const b = req.body || {};
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO plan_files(plan_id,file_type,file_path,file_name,note,uploaded_by)
     VALUES(?,?,?,?,?,?)`,
    [req.params.id, b.file_type || "document", relative, req.file.originalname || req.file.filename, b.note || "", req.user.id]
  );
  await audit(req.user.id, "UPLOAD", "plan_files", r.id, `${req.params.id}: ${req.file.originalname || req.file.filename}`);
  res.json({ id: r.id, file_path: relative, file_name: req.file.originalname || req.file.filename });
});

router.delete("/plan-files/:id", auth, requirePermission("operations_write"), async (req, res) => {
  const rec = await get("SELECT * FROM plan_files WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM plan_files WHERE id=?", [req.params.id]);
  fs.unlink(path.join(UPLOAD_DIR, path.basename(rec.file_path || "")), () => {});
  await audit(req.user.id, "DELETE", "plan_files", req.params.id, rec.file_name || "");
  res.json({ ok: true });
});

// ── Correspondence (incoming/outgoing letters) ───────────────

router.post("/correspondence", auth, requirePermission("admin_hr"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO correspondence(doc_type,doc_no,doc_date,source_org,subject,assigned_to,due_date,status,decision,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.doc_type, b.doc_no || "", b.doc_date, b.source_org || "", b.subject,
     b.assigned_to || null, b.due_date || null, b.status || "Шинэ", b.decision || "", req.user.id]);
  await audit(req.user.id, "CREATE", "correspondence", r.id, b.subject);
  res.json({ id: r.id });
});

router.get("/correspondence", auth, async (req, res) => {
  const canSeeAll = ["director", "hr", "chief_engineer"].includes(req.user.role);
  const where = canSeeAll ? "" : "WHERE d.assigned_to=?";
  const params = canSeeAll ? [] : [req.user.id];
  res.json(await all(
    `SELECT d.*, a.full_name assigned_name, c.full_name created_name
     FROM correspondence d
     LEFT JOIN users a ON a.id=d.assigned_to
     LEFT JOIN users c ON c.id=d.created_by
     ${where}
     ORDER BY doc_date DESC, id DESC`, params));
});

// ── Reports ──────────────────────────────────────────────────

router.get("/reports/summary", auth, async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = req.query.month ? Number(req.query.month) : null;
  const start = month ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-01-01`;
  const endMonth = month ? month + 1 : 13;
  const endYear = endMonth === 13 ? year + 1 : year;
  const end = month
    ? `${endYear}-${String(endMonth).padStart(2, "0")}-01`
    : `${year + 1}-01-01`;

  const [work, expenses, materials, byCategory, hr, docs, safety] = await Promise.all([
    get(`SELECT COUNT(*) count, SUM(cost_amount) total_cost, AVG(progress) avg_progress
         FROM asset_events WHERE work_date>=? AND work_date<?`, [start, end]),
    get(`SELECT COUNT(*) count, SUM(amount) total FROM expenses WHERE expense_date>=? AND expense_date<?`,
        [start, end]),
    all(`SELECT m.name item_name,
           SUM(CASE WHEN t.txn_type IN ('INCOME','INTERNAL_IN')  THEN t.qty ELSE 0 END) income_qty,
           SUM(CASE WHEN t.txn_type IN ('EXPENSE','INTERNAL_OUT') THEN t.qty ELSE 0 END) expense_qty,
           SUM(CASE WHEN t.txn_type IN ('EXPENSE','INTERNAL_OUT') AND t.txn_date>=? AND t.txn_date<? THEN t.qty ELSE 0 END) period_qty,
           SUM(CASE WHEN t.txn_type IN ('EXPENSE','INTERNAL_OUT') AND t.txn_date>=? AND t.txn_date<? THEN t.amount ELSE 0 END) period_amount
         FROM wh_materials m
         LEFT JOIN wh_transactions t ON t.material_id=m.id
         GROUP BY m.id HAVING period_qty > 0 ORDER BY period_amount DESC LIMIT 20`,
        [start, end, start, end]),
    all(`SELECT category, COUNT(*) count, SUM(cost_amount) cost
         FROM asset_events WHERE work_date>=? AND work_date<? GROUP BY category ORDER BY count DESC`,
        [start, end]),
    all(`SELECT record_type, COUNT(*) count FROM hr_records
         WHERE start_date>=? AND start_date<? GROUP BY record_type`, [start, end]),
    all(`SELECT status, COUNT(*) count FROM correspondence
         WHERE doc_date>=? AND doc_date<? GROUP BY status`, [start, end]),
    all(`SELECT risk_level, COUNT(*) count FROM safety_reports
         WHERE report_date>=? AND report_date<? GROUP BY risk_level`, [start, end]),
  ]);

  res.json({ period: { year, month }, work, expenses, materials, byCategory, hr, docs, safety });
});

router.get("/reports/annual-plan-suggestion", auth, async (req, res) => {
  const baseYear = Number(req.query.baseYear || new Date().getFullYear());
  const rows = await all(
    `SELECT category, department, COUNT(*) work_count, SUM(cost_amount) total_cost, AVG(cost_amount) avg_cost
     FROM asset_events WHERE work_date>=? AND work_date<? GROUP BY category, department ORDER BY work_count DESC`,
    [`${baseYear}-01-01`, `${baseYear + 1}-01-01`]);
  const suggestions = rows.map(r => ({
    title: `${r.department || "Ерөнхий"} - ${r.category} чиглэлийн давтамжит ажил`,
    reason: `${baseYear} онд ${r.work_count} удаа бүртгэгдсэн.`,
    estimated_budget: Math.round((r.total_cost || 0) * 1.12),
    suggested_frequency: r.work_count > 20 ? "Сар бүр" : r.work_count > 6 ? "Улирал бүр" : "Шаардлагатай үед"
  }));
  res.json({ baseYear, targetYear: baseYear + 1, suggestions });
});

// ── Unified monthly report ────────────────────────────────────

router.get("/monthly-report-unified", auth, async (req, res) => {
  const year  = Number(req.query.year  || new Date().getFullYear());
  const month = Number(req.query.month || new Date().getMonth() + 1);
  try {
    res.json(await buildMonthlyReport(year, month));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/unified-report-snapshots", auth, async (req, res) => {
  const year  = Number(req.query.year  || new Date().getFullYear());
  const month = req.query.month ? Number(req.query.month) : null;
  let sql = `SELECT s.id, s.year, s.month, s.title, s.created_at, s.updated_at,
                    u.full_name created_name
             FROM unified_report_snapshots s
             LEFT JOIN users u ON u.id=s.created_by
             WHERE s.year=?`;
  const params = [year];
  if (month) { sql += " AND s.month=?"; params.push(month); }
  sql += " ORDER BY s.month DESC";
  res.json(await all(sql, params));
});

router.get("/unified-report-snapshots/:year/:month/data", auth, async (req, res) => {
  const row = await get(
    "SELECT data_json, title, created_at, updated_at FROM unified_report_snapshots WHERE year=? AND month=?",
    [Number(req.params.year), Number(req.params.month)]
  );
  if (!row) return res.status(404).json({ error: "Хадгалсан тайлан байхгүй" });
  try { res.json({ ...JSON.parse(row.data_json), _meta: { title: row.title, saved_at: row.updated_at } }); }
  catch { res.status(500).json({ error: "Тайлангийн өгөгдөл гэмтсэн байна" }); }
});

router.post("/unified-report-snapshots", auth, requirePermission("operations_confirm"), async (req, res) => {
  const year  = Number(req.body.year  || new Date().getFullYear());
  const month = Number(req.body.month || new Date().getMonth() + 1);
  let d;
  try { d = await buildMonthlyReport(year, month); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  const MN = ["","1","2","3","4","5","6","7","8","9","10","11","12"];
  const title = `Нэгтгэсэн тайлан ${year} оны ${MN[month]}-р сар`;
  await run(
    `INSERT INTO unified_report_snapshots(year,month,title,data_json,created_by)
     VALUES(?,?,?,?,?)
     ON CONFLICT(year,month) DO UPDATE SET
       title=excluded.title, data_json=excluded.data_json,
       created_by=excluded.created_by, updated_at=CURRENT_TIMESTAMP`,
    [year, month, title, JSON.stringify(d), req.user.id]
  );
  await audit(req.user.id, "SAVE_UNIFIED_REPORT", "unified_report_snapshots", 0, title);
  res.json({ ok: true, title });
});

// ── Chief engineer monthly notes ─────────────────────────────

router.get("/engineer-monthly-report/history", auth, async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = Number(req.query.month || new Date().getMonth() + 1);
  const limit = Math.max(1, Math.min(24, Number(req.query.limit || 12)));
  const periodKey = year * 100 + month;
  const rows = await all(
    `SELECT * FROM engineer_monthly_reports
     WHERE created_by=?
       AND (year * 100 + month) < ?
     ORDER BY year DESC, month DESC
     LIMIT ?`,
    [req.user.id, periodKey, limit]
  );
  res.json(rows);
});

router.get("/engineer-monthly-report", auth, async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const month = Number(req.query.month || new Date().getMonth() + 1);
  const userId = req.user.id;
  const row = await get(
    `SELECT * FROM engineer_monthly_reports WHERE year=? AND month=? AND created_by=?`,
    [year, month, userId]
  );
  res.json(row || {
    year,
    month,
    summary_note: "",
    issue_note: "",
    resource_note: "",
    next_plan_note: "",
    conclusion_note: ""
  });
});

router.put("/engineer-monthly-report", auth, requirePermission("operations_write"), async (req, res) => {
  const b = req.body || {};
  const year = Number(b.year || new Date().getFullYear());
  const month = Number(b.month || new Date().getMonth() + 1);
  const vals = [
    String(b.summary_note || "").trim(),
    String(b.issue_note || "").trim(),
    String(b.resource_note || "").trim(),
    String(b.next_plan_note || "").trim(),
    String(b.conclusion_note || "").trim(),
    req.user.id,
    req.user.id
  ];
  await run(
    `INSERT INTO engineer_monthly_reports
      (year,month,summary_note,issue_note,resource_note,next_plan_note,conclusion_note,created_by,updated_by)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(year, month, created_by) DO UPDATE SET
      summary_note=excluded.summary_note,
      issue_note=excluded.issue_note,
      resource_note=excluded.resource_note,
      next_plan_note=excluded.next_plan_note,
      conclusion_note=excluded.conclusion_note,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP`,
    [year, month, ...vals]
  );
  await audit(req.user.id, "UPSERT", "engineer_monthly_reports", `${year}-${month}`, "Ерөнхий инженерийн сарын тэмдэглэл");
  res.json({ ok: true });
});

module.exports = router;
