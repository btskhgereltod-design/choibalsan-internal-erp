const express = require("express");
const { run, all, get, auth, audit } = require("../db");
const { requireRole } = require("../middleware/roles");

const router = express.Router();

function ymStart(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function nextMonthStart(year, month) {
  const d = new Date(Date.UTC(Number(year), Number(month), 1));
  return d.toISOString().slice(0, 10);
}

function prevYearMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

function safeJson(raw, fallback = null) {
  try { return JSON.parse(raw || ""); } catch { return fallback; }
}

function hasRole(req, roles = []) {
  return roles.includes(req.user?.role);
}

function isAssignedTo(row, req) {
  return Number(row?.assigned_to || 0) === Number(req.user?.id || 0);
}

function deny(res, message = "Энэ үйлдэл хийх эрхгүй") {
  return res.status(403).json({ error: message });
}

function signatureCode(prefix, ...parts) {
  const raw = parts.map(v => String(v || "")).join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return `${prefix}-${Math.abs(hash).toString(36).toUpperCase().padStart(6, "0")}`;
}

async function ensureTrainingTargets(trainingId) {
  const users = await all("SELECT id FROM users WHERE active=1 ORDER BY full_name").catch(() => []);
  for (const u of users) {
    await run("INSERT OR IGNORE INTO safety_training_ack(training_id,user_id) VALUES(?,?)", [trainingId, u.id]).catch(() => {});
  }
  return users.length;
}

async function ensureInstructionTargets(instructionId) {
  const row = await get("SELECT target_scope FROM safety_instructions WHERE id=?", [instructionId]).catch(() => null);
  if (!row || row.target_scope !== "all") return 0;
  const users = await all("SELECT id FROM users WHERE active=1 ORDER BY full_name").catch(() => []);
  for (const u of users) {
    await run("INSERT OR IGNORE INTO safety_instruction_ack(instruction_id,user_id) VALUES(?,?)", [instructionId, u.id]).catch(() => {});
  }
  return users.length;
}

async function buildHseMonthlySnapshot(year, month) {
  const y = Number(year);
  const m = Number(month);
  const start = ymStart(y, m);
  const end = nextMonthStart(y, m);
  const prev = prevYearMonth(y, m);
  const prevSnap = await get(
    "SELECT data_json FROM hse_report_snapshots WHERE period_type='monthly' AND year=? AND month=?",
    [prev.year, prev.month]
  ).catch(() => null);
  const prevData = safeJson(prevSnap?.data_json, {});
  const openingItems = Array.isArray(prevData?.closing_open_items) ? prevData.closing_open_items : [];

  const [riskRows, ptwRows, worksPre, worksPost, dailyRows, monthlyRows, repairRows, vehicles, routeRows, accidentRows, diseaseRows] = await Promise.all([
    all(`SELECT * FROM safety_reports WHERE report_date>=? AND report_date<? ORDER BY report_date DESC, id DESC`, [start, end]).catch(() => []),
    all(`SELECT * FROM safety_reports WHERE work_log_id IS NOT NULL AND report_date>=? AND report_date<? ORDER BY report_date DESC, id DESC`, [start, end]).catch(() => []),
    all(`SELECT id,title,category,location,habea_pre_at,habea_pre_status FROM asset_events WHERE habea_pre_at>=? AND habea_pre_at<? ORDER BY habea_pre_at DESC`, [start, end]).catch(() => []),
    all(`SELECT id,title,category,location,habea_post_at,habea_post_status,status FROM asset_events WHERE habea_post_at>=? AND habea_post_at<? ORDER BY habea_post_at DESC`, [start, end]).catch(() => []),
    all(`SELECT * FROM vehicle_daily_inspections WHERE insp_date>=? AND insp_date<? ORDER BY insp_date DESC`, [start, end]).catch(() => []),
    all(`SELECT * FROM vehicle_monthly_inspections WHERE insp_year=? AND insp_month=? ORDER BY id DESC`, [y, m]).catch(() => []),
    all(`SELECT * FROM vehicle_repairs WHERE repair_date>=? AND repair_date<? ORDER BY repair_date DESC`, [start, end]).catch(() => []),
    all(`SELECT id,plate_no,vehicle_type,status FROM vehicles ORDER BY plate_no`).catch(() => []),
    all(`SELECT * FROM safety_route_plans WHERE route_date>=? AND route_date<? ORDER BY route_date DESC, id DESC`, [start, end]).catch(() => []),
    all(`SELECT * FROM safety_accidents WHERE accident_date>=? AND accident_date<? ORDER BY accident_date DESC, id DESC`, [start, end]).catch(() => []),
    all(`SELECT * FROM safety_occupational_diseases WHERE detected_date>=? AND detected_date<? ORDER BY detected_date DESC, id DESC`, [start, end]).catch(() => []),
  ]);

  const closingOpen = await all(
    `SELECT id, report_date, location, risk_type, risk_level, workflow_status, assigned_to, deadline, work_log_id
     FROM safety_reports
     WHERE report_date < ? AND COALESCE(workflow_status,'Шинэ') != 'Хаасан'
     ORDER BY report_date DESC, id DESC`,
    [end]
  ).catch(() => []);

  const count = (rows, fn) => rows.filter(fn).length;
  const byLevel = {};
  ["Бага", "Дунд", "Өндөр", "Маш өндөр"].forEach(level => { byLevel[level] = count(riskRows, r => r.risk_level === level); });
  const byWorkflow = {};
  ["Шинэ", "Танилцсан", "Арга хэмжээ өгсөн", "Хэрэгжиж байна", "Хаасан"].forEach(wf => {
    byWorkflow[wf] = count(riskRows, r => (r.workflow_status || "Шинэ") === wf);
  });

  return {
    period_type: "monthly",
    year: y,
    month: m,
    period: `${y}-${String(m).padStart(2, "0")}`,
    opening_open_count: openingItems.length,
    opening_open_items: openingItems,
    risk_total: riskRows.length,
    risk_closed: count(riskRows, r => (r.workflow_status || "Шинэ") === "Хаасан"),
    risk_high: count(riskRows, r => ["Өндөр", "Маш өндөр"].includes(r.risk_level)),
    risk_by_level: byLevel,
    risk_by_workflow: byWorkflow,
    ppe_filled: count(riskRows, r => (safeJson(r.ppe_checklist, []) || []).length > 0),
    action_filled: count(riskRows, r => r.action_plan || r.action_note),
    ptw_total: ptwRows.length,
    ptw_approved: count(ptwRows, r => r.status === "Батлагдсан"),
    ptw_closed: count(ptwRows, r => r.status === "Хаагдсан"),
    pre_approved: worksPre.length,
    post_checked: worksPost.length,
    post_rejected: count(worksPost, w => w.habea_post_status === "rejected"),
    vehicle_total: vehicles.length,
    daily_inspections: dailyRows.length,
    daily_failed: count(dailyRows, d => Number(d.overall_ok) !== 1),
    monthly_inspections: monthlyRows.length,
    repairs_total: repairRows.length,
    repairs_done: count(repairRows, r => r.repair_status === "Дууссан"),
    repairs_active: count(repairRows, r => r.repair_status !== "Дууссан"),
    route_total: routeRows.length,
    route_active: count(routeRows, r => (r.status || "Батлагдсан") !== "Цуцлагдсан"),
    accident_total: accidentRows.length,
    accident_open: count(accidentRows, r => (r.status || "Нээлттэй") !== "Хаасан"),
    accident_serious: count(accidentRows, r => ["Хүнд", "Ноцтой", "Нас баралт"].includes(r.severity)),
    occupational_disease_total: diseaseRows.length,
    occupational_disease_active: count(diseaseRows, r => (r.status || "Хяналтад") !== "Хаасан"),
    route_items: routeRows.slice(0, 30),
    accident_items: accidentRows.slice(0, 30),
    occupational_disease_items: diseaseRows.slice(0, 30),
    closing_open_count: closingOpen.length,
    closing_open_items: closingOpen,
    generated_at: new Date().toISOString(),
  };
}

async function buildHseAnnualSnapshot(year) {
  const y = Number(year);
  const monthlyRows = await all(
    "SELECT * FROM hse_report_snapshots WHERE period_type='monthly' AND year=? ORDER BY month ASC",
    [y]
  ).catch(() => []);
  const months = monthlyRows.map(r => safeJson(r.data_json, {})).filter(Boolean);
  const sum = key => months.reduce((s, m) => s + Number(m[key] || 0), 0);
  const last = months[months.length - 1] || {};
  return {
    period_type: "annual",
    year: y,
    months_saved: months.length,
    months,
    risk_total: sum("risk_total"),
    risk_closed: sum("risk_closed"),
    risk_high: sum("risk_high"),
    ptw_total: sum("ptw_total"),
    pre_approved: sum("pre_approved"),
    post_checked: sum("post_checked"),
    post_rejected: sum("post_rejected"),
    daily_inspections: sum("daily_inspections"),
    monthly_inspections: sum("monthly_inspections"),
    repairs_total: sum("repairs_total"),
    repairs_done: sum("repairs_done"),
    route_total: sum("route_total"),
    accident_total: sum("accident_total"),
    accident_serious: sum("accident_serious"),
    occupational_disease_total: sum("occupational_disease_total"),
    closing_open_count: Number(last.closing_open_count || 0),
    closing_open_items: Array.isArray(last.closing_open_items) ? last.closing_open_items : [],
    generated_at: new Date().toISOString(),
  };
}

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

  const row = await get("SELECT * FROM safety_reports WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });

  const lead = hasRole(req, ["director", "chief_engineer"]);
  const assigned = isAssignedTo(row, req);
  const hse = hasRole(req, ["safety"]);
  const order = ["Шинэ", "Танилцсан", "Арга хэмжээ өгсөн", "Хэрэгжиж байна", "Хаасан"];
  const curIdx = order.indexOf(row.workflow_status || "Шинэ");
  const nextIdx = order.indexOf(workflow_status);

  if (nextIdx === -1) return res.status(400).json({ error: "Workflow статус буруу байна" });
  if (!lead && nextIdx < curIdx) return deny(res, "Өмнөх төлөв рүү буцаах эрхгүй");
  if (!lead && nextIdx > curIdx + 1) return deny(res, "Workflow дараалал алгасах боломжгүй");
  if (workflow_status === "Танилцсан" && !(lead || hse || assigned)) {
    return deny(res, "Эрсдэлтэй танилцах эрхгүй");
  }
  if (["Арга хэмжээ өгсөн", "Хэрэгжиж байна"].includes(workflow_status) && !(lead || assigned)) {
    return deny(res, "Энэ алхамыг зөвхөн хариуцсан хүн эсвэл удирдлага хийнэ");
  }
  if (workflow_status === "Хаасан" && !lead) {
    return deny(res, "Хаах шийдвэрийг зөвхөн захирал эсвэл ерөнхий инженер батална");
  }

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
  await audit(req.user.id, "WORKFLOW", "safety_reports", req.params.id,
    `${row?.location} → ${workflow_status}`);
  res.json({ ok: true });
});

router.patch("/safety-reports/:id/status", auth, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Статус шаардлагатай" });

  const row = await get("SELECT * FROM safety_reports WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Олдсонгүй" });

  const lead = hasRole(req, ["director", "chief_engineer"]);
  const canApproveOrCancel = hasRole(req, ["director", "safety"]);
  if (status === "Батлагдсан" && !canApproveOrCancel) {
    return deny(res, "PTW батлах эрх зөвхөн ХАБЭА эсвэл захиралд байна");
  }
  if (status === "Цуцлагдсан" && !canApproveOrCancel) {
    return deny(res, "PTW цуцлах эрх зөвхөн ХАБЭА эсвэл захиралд байна");
  }
  if (status === "Хаагдсан" && !lead) {
    return deny(res, "PTW хаах эрх зөвхөн захирал эсвэл ерөнхий инженерд байна");
  }

  if (status === "Хаагдсан" || status === "Цуцлагдсан") {
    await run("UPDATE safety_reports SET status=?, workflow_status='Хаасан' WHERE id=?", [status, req.params.id]);
  } else if (status === "Батлагдсан") {
    await run("UPDATE safety_reports SET status=?, workflow_status='Хэрэгжиж байна' WHERE id=?", [status, req.params.id]);
  } else {
    await run("UPDATE safety_reports SET status=? WHERE id=?", [status, req.params.id]);
  }
  await audit(req.user.id, "STATUS", "safety_reports", req.params.id, `${row?.location} → ${status}`);
  res.json({ ok: true });
});

router.delete("/safety-reports/:id", auth, requireRole("director", "safety"), async (req, res) => {
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
  const comment = await get("SELECT * FROM safety_comments WHERE id=?", [req.params.id]);
  if (!comment) return res.status(404).json({ error: "Коммент олдсонгүй" });
  const isPrivileged = ["director", "safety"].includes(req.user.role);
  const isOwner = Number(comment.user_id) === Number(req.user.id);
  if (!isPrivileged && !isOwner)
    return res.status(403).json({ error: "Зөвхөн өөрийн коммент эсвэл director|safety устгах эрхтэй" });
  await run("DELETE FROM safety_comments WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// ── HSE monthly / annual report snapshots ─────────────────────

// HSE trainings
router.get("/safety-trainings", auth, async (req, res) => {
  const activeTrainings = await all("SELECT id FROM safety_trainings WHERE COALESCE(status,'Төлөвлөсөн') IN ('Төлөвлөсөн','Идэвхтэй','Хийгдсэн')").catch(() => []);
  for (const t of activeTrainings) await ensureTrainingTargets(t.id);
  const rows = await all(
    `SELECT t.*, u.full_name created_name,
            COUNT(a.id) target_count,
            SUM(CASE WHEN a.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) ack_count,
            MAX(CASE WHEN a.user_id=? THEN 1 ELSE 0 END) my_targeted,
            MAX(CASE WHEN a.user_id=? THEN a.acknowledged_at ELSE NULL END) my_ack_at,
            MAX(CASE WHEN a.user_id=? THEN a.signature_code ELSE NULL END) my_signature_code
     FROM safety_trainings t
     LEFT JOIN users u ON u.id=t.created_by
     LEFT JOIN safety_training_ack a ON a.training_id=t.id
     GROUP BY t.id
     ORDER BY t.training_date DESC, t.id DESC`,
    [req.user.id, req.user.id, req.user.id]
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-trainings", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.training_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Сургалтын нэр шаардлагатай" });
  const r = await run(
    `INSERT INTO safety_trainings
      (training_date,title,trainer,audience,participant_count,topic,result_note,file_url,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.training_date, b.title.trim(), b.trainer || "", b.audience || "", Number(b.participant_count) || 0,
     b.topic || "", b.result_note || "", b.file_url || "", b.status || "Төлөвлөсөн", req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_trainings", r.id, b.title);
  const targetCount = await ensureTrainingTargets(r.id);
  res.json({ id: r.id, target_count: targetCount });
});

router.put("/safety-trainings/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.training_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Сургалтын нэр шаардлагатай" });
  await run(
    `UPDATE safety_trainings SET
       training_date=?, title=?, trainer=?, audience=?, participant_count=?,
       topic=?, result_note=?, file_url=?, status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.training_date, b.title.trim(), b.trainer || "", b.audience || "", Number(b.participant_count) || 0,
     b.topic || "", b.result_note || "", b.file_url || "", b.status || "Төлөвлөсөн", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_trainings", req.params.id, b.title);
  await ensureTrainingTargets(req.params.id);
  res.json({ ok: true });
});

router.delete("/safety-trainings/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT title FROM safety_trainings WHERE id=?", [req.params.id]);
  await run("DELETE FROM safety_training_ack WHERE training_id=?", [req.params.id]).catch(() => {});
  await run("DELETE FROM safety_trainings WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_trainings", req.params.id, row?.title || "");
  res.json({ ok: true });
});

router.post("/safety-trainings/:id/ack", auth, async (req, res) => {
  const row = await get("SELECT id FROM safety_trainings WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Сургалт олдсонгүй" });
  const existing = await get(
    "SELECT * FROM safety_training_ack WHERE training_id=? AND user_id=?",
    [req.params.id, req.user.id]
  );
  if (existing?.acknowledged_at) return res.json({ ok: true, signature_code: existing.signature_code });
  const at = new Date().toISOString();
  const code = `TR-${req.params.id}-${req.user.id}-${Date.now().toString(36).toUpperCase()}`;
  if (existing) {
    await run(
      "UPDATE safety_training_ack SET acknowledged_at=?, signature_code=?, note=? WHERE training_id=? AND user_id=?",
      [at, code, req.body?.note || "", req.params.id, req.user.id]
    );
  } else {
    await run(
      "INSERT INTO safety_training_ack(training_id,user_id,acknowledged_at,signature_code,note) VALUES(?,?,?,?,?)",
      [req.params.id, req.user.id, at, code, req.body?.note || ""]
    );
  }
  await audit(req.user.id, "ACK", "safety_trainings", req.params.id, code);
  res.json({ ok: true, signature_code: code, acknowledged_at: at });
});

// HSE procedures / regulations
router.get("/safety-procedures", auth, async (req, res) => {
  const rows = await all(
    `SELECT p.*, u.full_name created_name
     FROM safety_procedures p
     LEFT JOIN users u ON u.id=p.created_by
     ORDER BY p.approved_date DESC, p.id DESC`
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-procedures", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: "Журмын нэр шаардлагатай" });
  const r = await run(
    `INSERT INTO safety_procedures
      (doc_no,title,category,approved_date,owner,version,status,file_url,note,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [b.doc_no || "", b.title.trim(), b.category || "", b.approved_date || "", b.owner || "",
     b.version || "1.0", b.status || "Идэвхтэй", b.file_url || "", b.note || "", req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_procedures", r.id, b.title);
  res.json({ id: r.id });
});

router.put("/safety-procedures/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.title?.trim()) return res.status(400).json({ error: "Журмын нэр шаардлагатай" });
  await run(
    `UPDATE safety_procedures SET
       doc_no=?, title=?, category=?, approved_date=?, owner=?, version=?,
       status=?, file_url=?, note=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.doc_no || "", b.title.trim(), b.category || "", b.approved_date || "", b.owner || "",
     b.version || "1.0", b.status || "Идэвхтэй", b.file_url || "", b.note || "", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_procedures", req.params.id, b.title);
  res.json({ ok: true });
});

router.delete("/safety-procedures/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT title FROM safety_procedures WHERE id=?", [req.params.id]);
  await run("DELETE FROM safety_procedures WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_procedures", req.params.id, row?.title || "");
  res.json({ ok: true });
});

// HSE shift / repeated instructions with employee acknowledgement
router.get("/safety-instructions", auth, async (req, res) => {
  const activeInstructions = await all("SELECT id FROM safety_instructions WHERE COALESCE(status,'Идэвхтэй')='Идэвхтэй' AND COALESCE(target_scope,'all')='all'").catch(() => []);
  for (const i of activeInstructions) await ensureInstructionTargets(i.id);
  const rows = await all(
    `SELECT i.*, u.full_name created_name,
            COUNT(a.id) target_count,
            SUM(CASE WHEN a.acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) ack_count,
            MAX(CASE WHEN a.user_id=? THEN 1 ELSE 0 END) my_targeted,
            MAX(CASE WHEN a.user_id=? THEN a.acknowledged_at ELSE NULL END) my_ack_at,
            MAX(CASE WHEN a.user_id=? THEN a.signature_code ELSE NULL END) my_signature_code
     FROM safety_instructions i
     LEFT JOIN users u ON u.id=i.created_by
     LEFT JOIN safety_instruction_ack a ON a.instruction_id=i.id
     GROUP BY i.id
     ORDER BY i.instruction_date DESC, i.id DESC`,
    [req.user.id, req.user.id, req.user.id]
  ).catch(() => []);
  res.json(rows);
});

router.get("/safety-instructions/:id/acks", auth, async (req, res) => {
  const row = await get("SELECT id FROM safety_instructions WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Зааварчилгаа олдсонгүй" });
  const rows = await all(
    `SELECT a.*, u.full_name, u.position, u.department
     FROM safety_instruction_ack a
     LEFT JOIN users u ON u.id=a.user_id
     WHERE a.instruction_id=?
     ORDER BY CASE WHEN a.acknowledged_at IS NULL THEN 0 ELSE 1 END, u.department, u.full_name`,
    [req.params.id]
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-instructions", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.instruction_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Зааварчилгааны гарчиг шаардлагатай" });

  const r = await run(
    `INSERT INTO safety_instructions
      (instruction_date,type,title,body,file_url,target_scope,status,created_by)
     VALUES(?,?,?,?,?,?,?,?)`,
    [b.instruction_date, b.type || "Ээлжит", b.title.trim(), b.body || "", b.file_url || "",
     b.target_scope || "all", b.status || "Идэвхтэй", req.user.id]
  );

  const selected = Array.isArray(b.target_user_ids) ? b.target_user_ids.map(Number).filter(Boolean) : [];
  const users = selected.length
    ? await all(`SELECT id FROM users WHERE active=1 AND id IN (${selected.map(() => "?").join(",")})`, selected)
    : await all("SELECT id FROM users WHERE active=1 ORDER BY full_name");
  for (const u of users) {
    await run("INSERT OR IGNORE INTO safety_instruction_ack(instruction_id,user_id) VALUES(?,?)", [r.id, u.id]);
  }

  await audit(req.user.id, "CREATE", "safety_instructions", r.id, b.title);
  res.json({ id: r.id, target_count: users.length });
});

router.put("/safety-instructions/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.instruction_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Зааварчилгааны гарчиг шаардлагатай" });
  const row = await get("SELECT id FROM safety_instructions WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Зааварчилгаа олдсонгүй" });

  await run(
    `UPDATE safety_instructions SET
       instruction_date=?, type=?, title=?, body=?, file_url=?, target_scope=?,
       status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.instruction_date, b.type || "Ээлжит", b.title.trim(), b.body || "", b.file_url || "",
     b.target_scope || "all", b.status || "Идэвхтэй", req.params.id]
  );

  const selected = Array.isArray(b.target_user_ids) ? b.target_user_ids.map(Number).filter(Boolean) : [];
  if (selected.length) {
    for (const id of selected) {
      await run("INSERT OR IGNORE INTO safety_instruction_ack(instruction_id,user_id) VALUES(?,?)", [req.params.id, id]);
    }
  } else if ((b.target_scope || "all") === "all") {
    await ensureInstructionTargets(req.params.id);
  }

  await audit(req.user.id, "UPDATE", "safety_instructions", req.params.id, b.title);
  res.json({ ok: true });
});

router.post("/safety-instructions/:id/ack", auth, async (req, res) => {
  const row = await get("SELECT id,title FROM safety_instructions WHERE id=? AND status='Идэвхтэй'", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Идэвхтэй зааварчилгаа олдсонгүй" });
  const ack = await get(
    "SELECT * FROM safety_instruction_ack WHERE instruction_id=? AND user_id=?",
    [req.params.id, req.user.id]
  );
  if (!ack) return deny(res, "Энэ зааварчилгаа танд оноогдоогүй байна");
  if (ack.acknowledged_at) return res.json({ ok: true, signature_code: ack.signature_code });

  const at = new Date().toISOString();
  const code = signatureCode("HSEI", req.params.id, req.user.id, row.title, at);
  await run(
    "UPDATE safety_instruction_ack SET acknowledged_at=?, signature_code=?, note=? WHERE instruction_id=? AND user_id=?",
    [at, code, req.body?.note || "", req.params.id, req.user.id]
  );
  await audit(req.user.id, "ACK", "safety_instructions", req.params.id, row.title);
  res.json({ ok: true, signature_code: code, acknowledged_at: at });
});

router.delete("/safety-instructions/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT title FROM safety_instructions WHERE id=?", [req.params.id]);
  await run("DELETE FROM safety_instruction_ack WHERE instruction_id=?", [req.params.id]);
  await run("DELETE FROM safety_instructions WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_instructions", req.params.id, row?.title || "");
  res.json({ ok: true });
});

// HSE employee routes
router.get("/safety-route-plans", auth, async (_req, res) => {
  const rows = await all(
    `SELECT r.*, u.full_name created_name
     FROM safety_route_plans r
     LEFT JOIN users u ON u.id=r.created_by
     ORDER BY r.route_date DESC, r.id DESC`
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-route-plans", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.route_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Маршрутын нэр шаардлагатай" });
  const r = await run(
    `INSERT INTO safety_route_plans
      (route_date,title,route_type,start_point,end_point,vehicle,driver,workers,risk_points,control_note,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.route_date, b.title.trim(), b.route_type || "", b.start_point || "", b.end_point || "",
     b.vehicle || "", b.driver || "", b.workers || "", b.risk_points || "", b.control_note || "",
     b.status || "Батлагдсан", req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_route_plans", r.id, b.title);
  res.json({ id: r.id });
});

router.put("/safety-route-plans/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.route_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  if (!b.title?.trim()) return res.status(400).json({ error: "Маршрутын нэр шаардлагатай" });
  await run(
    `UPDATE safety_route_plans SET
       route_date=?, title=?, route_type=?, start_point=?, end_point=?, vehicle=?, driver=?,
       workers=?, risk_points=?, control_note=?, status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.route_date, b.title.trim(), b.route_type || "", b.start_point || "", b.end_point || "",
     b.vehicle || "", b.driver || "", b.workers || "", b.risk_points || "", b.control_note || "",
     b.status || "Батлагдсан", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_route_plans", req.params.id, b.title);
  res.json({ ok: true });
});

router.delete("/safety-route-plans/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT title FROM safety_route_plans WHERE id=?", [req.params.id]).catch(() => null);
  await run("DELETE FROM safety_route_plans WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_route_plans", req.params.id, row?.title || "");
  res.json({ ok: true });
});

// HSE workplace accidents
router.get("/safety-accidents", auth, async (_req, res) => {
  const rows = await all(
    `SELECT a.*, COALESCE(e.full_name, a.employee_name) employee_full_name, u.full_name created_name
     FROM safety_accidents a
     LEFT JOIN users e ON e.id=a.employee_id
     LEFT JOIN users u ON u.id=a.created_by
     ORDER BY a.accident_date DESC, a.id DESC`
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-accidents", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.accident_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  const r = await run(
    `INSERT INTO safety_accidents
      (accident_date,accident_time,location,employee_id,employee_name,accident_type,severity,injury,cause,witness,immediate_action,commission_note,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.accident_date, b.accident_time || "", b.location || "", b.employee_id || null, b.employee_name || "",
     b.accident_type || "", b.severity || "", b.injury || "", b.cause || "", b.witness || "",
     b.immediate_action || "", b.commission_note || "", b.status || "Нээлттэй", req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_accidents", r.id, b.location || b.employee_name || "");
  res.json({ id: r.id });
});

router.put("/safety-accidents/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.accident_date) return res.status(400).json({ error: "Огноо шаардлагатай" });
  await run(
    `UPDATE safety_accidents SET
       accident_date=?, accident_time=?, location=?, employee_id=?, employee_name=?, accident_type=?,
       severity=?, injury=?, cause=?, witness=?, immediate_action=?, commission_note=?, status=?,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.accident_date, b.accident_time || "", b.location || "", b.employee_id || null, b.employee_name || "",
     b.accident_type || "", b.severity || "", b.injury || "", b.cause || "", b.witness || "",
     b.immediate_action || "", b.commission_note || "", b.status || "Нээлттэй", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_accidents", req.params.id, b.location || b.employee_name || "");
  res.json({ ok: true });
});

router.delete("/safety-accidents/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT location, employee_name FROM safety_accidents WHERE id=?", [req.params.id]).catch(() => null);
  await run("DELETE FROM safety_accidents WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_accidents", req.params.id, row?.location || row?.employee_name || "");
  res.json({ ok: true });
});

// HSE occupational diseases
router.get("/safety-occupational-diseases", auth, async (_req, res) => {
  const rows = await all(
    `SELECT d.*, COALESCE(e.full_name, d.employee_name) employee_full_name, u.full_name created_name
     FROM safety_occupational_diseases d
     LEFT JOIN users e ON e.id=d.employee_id
     LEFT JOIN users u ON u.id=d.created_by
     ORDER BY d.detected_date DESC, d.id DESC`
  ).catch(() => []);
  res.json(rows);
});

router.post("/safety-occupational-diseases", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.detected_date) return res.status(400).json({ error: "Илэрсэн огноо шаардлагатай" });
  const r = await run(
    `INSERT INTO safety_occupational_diseases
      (detected_date,employee_id,employee_name,position,department,exposure_factor,diagnosis,medical_note,disability,work_limit,prevention_note,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.detected_date, b.employee_id || null, b.employee_name || "", b.position || "", b.department || "",
     b.exposure_factor || "", b.diagnosis || "", b.medical_note || "", b.disability || "",
     b.work_limit || "", b.prevention_note || "", b.status || "Хяналтад", req.user.id]
  );
  await audit(req.user.id, "CREATE", "safety_occupational_diseases", r.id, b.employee_name || b.diagnosis || "");
  res.json({ id: r.id });
});

router.put("/safety-occupational-diseases/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const b = req.body || {};
  if (!b.detected_date) return res.status(400).json({ error: "Илэрсэн огноо шаардлагатай" });
  await run(
    `UPDATE safety_occupational_diseases SET
       detected_date=?, employee_id=?, employee_name=?, position=?, department=?, exposure_factor=?,
       diagnosis=?, medical_note=?, disability=?, work_limit=?, prevention_note=?, status=?,
       updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    [b.detected_date, b.employee_id || null, b.employee_name || "", b.position || "", b.department || "",
     b.exposure_factor || "", b.diagnosis || "", b.medical_note || "", b.disability || "",
     b.work_limit || "", b.prevention_note || "", b.status || "Хяналтад", req.params.id]
  );
  await audit(req.user.id, "UPDATE", "safety_occupational_diseases", req.params.id, b.employee_name || b.diagnosis || "");
  res.json({ ok: true });
});

router.delete("/safety-occupational-diseases/:id", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const row = await get("SELECT employee_name, diagnosis FROM safety_occupational_diseases WHERE id=?", [req.params.id]).catch(() => null);
  await run("DELETE FROM safety_occupational_diseases WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "safety_occupational_diseases", req.params.id, row?.employee_name || row?.diagnosis || "");
  res.json({ ok: true });
});

router.get("/hse-report-snapshots", auth, async (req, res) => {
  const periodType = req.query.period_type || "monthly";
  const year = Number(req.query.year || new Date().getFullYear());
  const month = req.query.month ? Number(req.query.month) : null;
  const params = [periodType, year];
  let sql = `SELECT s.*, u.full_name created_name
             FROM hse_report_snapshots s
             LEFT JOIN users u ON u.id=s.created_by
             WHERE s.period_type=? AND s.year=?`;
  if (periodType === "monthly" && month) {
    sql += " AND s.month=?";
    params.push(month);
  }
  sql += " ORDER BY COALESCE(s.month,0) ASC, s.updated_at DESC";
  const rows = await all(sql, params).catch(() => []);
  res.json(rows.map(r => ({ ...r, data: safeJson(r.data_json, {}) })));
});

router.post("/hse-report-snapshots/monthly", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const year = Number(req.body.year || new Date().getFullYear());
  const month = Number(req.body.month || (new Date().getMonth() + 1));
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Он, сар буруу байна" });
  const data = await buildHseMonthlySnapshot(year, month);
  const title = `ХАБЭА сарын тайлан ${year}-${String(month).padStart(2, "0")}`;
  await run(
    `INSERT INTO hse_report_snapshots(period_type,year,month,title,data_json,created_by)
     VALUES('monthly',?,?,?,?,?)
     ON CONFLICT(period_type,year,month) DO UPDATE SET
       title=excluded.title,
       data_json=excluded.data_json,
       updated_at=CURRENT_TIMESTAMP`,
    [year, month, title, JSON.stringify(data), req.user.id]
  );
  await audit(req.user.id, "SAVE_MONTHLY_HSE_REPORT", "hse_report_snapshots", 0, title);
  res.json({ ok: true, data });
});

router.post("/hse-report-snapshots/annual", auth, requireRole("director", "chief_engineer", "safety"), async (req, res) => {
  const year = Number(req.body.year || new Date().getFullYear());
  if (!year) return res.status(400).json({ error: "Он буруу байна" });
  const data = await buildHseAnnualSnapshot(year);
  const title = `ХАБЭА жилийн тайлан ${year}`;
  await run(
    `INSERT INTO hse_report_snapshots(period_type,year,month,title,data_json,created_by)
     VALUES('annual',?,0,?,?,?)
     ON CONFLICT(period_type,year,month) DO UPDATE SET
       title=excluded.title,
       data_json=excluded.data_json,
       updated_at=CURRENT_TIMESTAMP`,
    [year, title, JSON.stringify(data), req.user.id]
  );
  await audit(req.user.id, "SAVE_ANNUAL_HSE_REPORT", "hse_report_snapshots", 0, title);
  res.json({ ok: true, data });
});

// ── Helper ────────────────────────────────────────────────────

function riskScoreLevel(score) {
  if (score <= 4)  return "Бага";
  if (score <= 12) return "Дунд";
  if (score <= 19) return "Өндөр";
  return "Маш өндөр";
}

module.exports = router;
