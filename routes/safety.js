const express = require("express");
const { run, all, get, auth, audit } = require("../db");

const router = express.Router();

// ── Safety Reports ───────────────────────────────────────────

router.get("/safety-reports", auth, async (req, res) => {
  const { ref_type, ref_id } = req.query;
  let sql = `SELECT s.*, u.full_name creator_name, a.full_name assigned_name,
            ack.full_name acknowledged_name, w.title work_title
     FROM safety_reports s
     LEFT JOIN users u ON u.id = s.created_by
     LEFT JOIN users a ON a.id = s.assigned_to
     LEFT JOIN users ack ON ack.id = s.acknowledged_by
     LEFT JOIN asset_events w ON w.id = s.work_log_id`;
  const params = [];
  if (ref_type && ref_id) {
    sql += " WHERE s.location_ref_type=? AND s.location_ref_id=?";
    params.push(ref_type, Number(ref_id));
  }
  sql += " ORDER BY s.report_date DESC, s.created_at DESC";
  res.json(await all(sql, params));
});

router.post("/safety-reports", auth, async (req, res) => {
  const b = req.body;
  if (!b.location)    return res.status(400).json({ error: "Байршил шаардлагатай" });
  if (!b.report_date) return res.status(400).json({ error: "Огноо шаардлагатай" });

  const prob  = Number(b.probability) || 1;
  const cons  = Number(b.consequence_score) || 1;
  const score = prob * cons;

  // Resolve assigned engineer: explicit > asset assigned_to > loc-supplied
  let assignedTo = b.assigned_to || null;
  const refType = b.location_ref_type || null;
  const refId   = Number(b.location_ref_id) || null;
  if (!assignedTo && refId) {
    if (refType === 'sl_ger_inventory') {
      const loc = await get("SELECT assigned_to FROM sl_ger_inventory WHERE id=?", [refId]).catch(()=>null);
      if (loc?.assigned_to) assignedTo = loc.assigned_to;
    } else if (refType === 'assets') {
      const asset = await get("SELECT assigned_to FROM assets WHERE id=?", [refId]).catch(()=>null);
      if (asset?.assigned_to) assignedTo = asset.assigned_to;
    }
  }
  if (!assignedTo && b._loc_assigned) assignedTo = b._loc_assigned;

  const r = await run(
    `INSERT INTO safety_reports
       (report_date, risk_time, title, risk_type, risk_level, location,
        risk_description, risk_condition, possible_consequence,
        pre_work_note, ppe_checklist, assigned_to,
        probability, consequence_score, risk_score,
        workflow_status, deadline, action_note, action_plan,
        priority, gps_lat, gps_lng, status,
        image_url, before_image_url, after_image_url,
        location_ref_type, location_ref_id, created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.report_date, b.risk_time || null,
     b.location, b.risk_type || null,
     b.risk_level || riskScoreLevel(score), b.location,
     b.risk_description || null, b.risk_condition || null,
     b.possible_consequence || null, b.pre_work_note || null,
     b.ppe_checklist || "[]", assignedTo,
     prob, cons, score,
     b.workflow_status || "Шинэ",
     b.deadline || null, b.action_note || null, b.action_plan || null,
     b.priority || "Дунд",
     b.gps_lat || null, b.gps_lng || null,
     b.status || "Нээлттэй",
     b.image_url || "", b.before_image_url || "", b.after_image_url || "",
     refType, refId, req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_reports", r.id, b.location);
  res.json({ id: r.id });
});

router.put("/safety-reports/:id", auth, async (req, res) => {
  const b = req.body;
  const prob = Number(b.probability) || 1;
  const cons = Number(b.consequence_score) || 1;
  const score = prob * cons;

  await run(
    `UPDATE safety_reports SET
       report_date=?, risk_time=?, title=?, risk_type=?, risk_level=?, location=?,
       risk_description=?, risk_condition=?, possible_consequence=?,
       pre_work_note=?, ppe_checklist=?, assigned_to=?,
       probability=?, consequence_score=?, risk_score=?,
       workflow_status=?, deadline=?, action_note=?, action_plan=?,
       priority=?, gps_lat=?, gps_lng=?, status=?,
       image_url=?, before_image_url=?, after_image_url=?
     WHERE id=?`,
    [b.report_date, b.risk_time || null,
     b.location || b.title, b.risk_type || null,
     b.risk_level || riskScoreLevel(score), b.location || null,
     b.risk_description || null, b.risk_condition || null,
     b.possible_consequence || null, b.pre_work_note || null,
     b.ppe_checklist || "[]", b.assigned_to || null,
     prob, cons, score,
     b.workflow_status || "Шинэ",
     b.deadline || null, b.action_note || null, b.action_plan || null,
     b.priority || "Дунд",
     b.gps_lat || null, b.gps_lng || null,
     b.status || "Нээлттэй",
     b.image_url || "", b.before_image_url || "", b.after_image_url || "", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_reports", req.params.id, b.location || b.title);
  res.json({ ok: true });
});

// Workflow transition
router.patch("/safety-reports/:id/workflow", auth, async (req, res) => {
  const { workflow_status, action_note, deadline, assigned_to } = req.body;
  if (!workflow_status) return res.status(400).json({ error: "Workflow статус шаардлагатай" });

  const updates = ["workflow_status=?"];
  const vals    = [workflow_status];

  if (action_note !== undefined) { updates.push("action_note=?"); vals.push(action_note); }
  if (deadline    !== undefined) { updates.push("deadline=?");    vals.push(deadline); }
  if (assigned_to !== undefined) { updates.push("assigned_to=?"); vals.push(assigned_to); }

  if (workflow_status === "Танилцсан") {
    updates.push("acknowledged_by=?", "acknowledged_at=CURRENT_TIMESTAMP");
    vals.push(req.user.id);
  }
  if (workflow_status === "Хаасан") {
    updates.push("status=?");
    vals.push("Хаагдсан");
  }

  vals.push(req.params.id);
  await run(`UPDATE safety_reports SET ${updates.join(",")} WHERE id=?`, vals);
  const row = await get("SELECT location FROM safety_reports WHERE id=?", [req.params.id]);
  await audit(req.user.id, "WORKFLOW", "safety_reports", req.params.id,
    `${row?.location} → ${workflow_status}`);
  res.json({ ok: true });
});

router.patch("/safety-reports/:id/status", auth, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Статус шаардлагатай" });
  await run("UPDATE safety_reports SET status=? WHERE id=?", [status, req.params.id]);
  const row = await get("SELECT location FROM safety_reports WHERE id=?", [req.params.id]);
  await audit(req.user.id, "STATUS", "safety_reports", req.params.id, `${row?.location} → ${status}`);
  res.json({ ok: true });
});

router.delete("/safety-reports/:id", auth, async (req, res) => {
  const row = await get("SELECT * FROM safety_reports WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM safety_comments WHERE report_id=?", [req.params.id]);
  await run("DELETE FROM safety_reports WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_reports", req.params.id, row.location || row.title);
  res.json({ ok: true });
});

// ── Comments ─────────────────────────────────────────────────

router.get("/safety-reports/:id/comments", auth, async (req, res) => {
  const rows = await all(
    `SELECT c.*, u.full_name user_name
     FROM safety_comments c LEFT JOIN users u ON u.id=c.user_id
     WHERE c.report_id=? ORDER BY c.created_at ASC`, [req.params.id]);
  res.json(rows);
});

router.post("/safety-reports/:id/comments", auth, async (req, res) => {
  const { comment } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: "Коммент хоосон байна" });
  const r = await run(
    "INSERT INTO safety_comments(report_id,user_id,comment) VALUES(?,?,?)",
    [req.params.id, req.user.id, comment.trim()]);
  res.json({ id: r.id });
});

router.delete("/safety-comments/:id", auth, async (req, res) => {
  await run("DELETE FROM safety_comments WHERE id=? AND user_id=?", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Helper ────────────────────────────────────────────────────

function riskScoreLevel(score) {
  if (score <= 4)  return "Бага";
  if (score <= 12) return "Дунд";
  if (score <= 19) return "Өндөр";
  return "Маш өндөр";
}

module.exports = router;
