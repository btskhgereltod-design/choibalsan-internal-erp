const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const { run, all, get, auth, audit, upload } = require("../db");
const { requirePermission } = require("../middleware/roles");

const router = express.Router();

// IP тус бүр 10 минутанд 5 submit — public survey submit
const _publicSurveyLimiter = new Map();
function publicRateLimit(req, res, next) {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  const now = Date.now();
  const WINDOW = 10 * 60 * 1000;
  const LIMIT  = 5;
  let rec = _publicSurveyLimiter.get(ip);
  if (!rec || now > rec.reset) rec = { count: 1, reset: now + WINDOW };
  else rec.count += 1;
  _publicSurveyLimiter.set(ip, rec);
  if (rec.count > LIMIT)
    return res.status(429).json({ error: "Хэт олон хүсэлт. 10 минутын дараа дахин оролдоно уу." });
  next();
}

// ── Job Postings ──────────────────────────────────────────────
router.get("/job-postings", auth, async (req, res) => {
  res.json(await all("SELECT * FROM job_postings ORDER BY created_at DESC"));
});

router.post("/job-postings", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO job_postings(title,department,position,requirements,salary_range,deadline,status,description,created_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.title, b.department||"", b.position||"", b.requirements||"",
     b.salary_range||"", b.deadline||"", b.status||"Нээлттэй", b.description||"", req.user.id]
  );
  await audit(req.user.id, "CREATE", "job_postings", r.id, b.title);
  res.json({ id: r.id });
});

router.put("/job-postings/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE job_postings SET title=?,department=?,position=?,requirements=?,salary_range=?,deadline=?,status=?,description=? WHERE id=?`,
    [b.title, b.department||"", b.position||"", b.requirements||"",
     b.salary_range||"", b.deadline||"", b.status||"Нээлттэй", b.description||"", req.params.id]
  );
  res.json({ ok: true });
});

router.delete("/job-postings/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM job_applications WHERE posting_id=?", [req.params.id]);
  await run("DELETE FROM job_postings WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// ── Job Applications ──────────────────────────────────────────
router.get("/job-applications", auth, async (req, res) => {
  const { posting_id } = req.query;
  let sql = `SELECT a.*, p.title posting_title FROM job_applications a
    LEFT JOIN job_postings p ON p.id=a.posting_id WHERE 1=1`;
  const params = [];
  if (posting_id) { sql += " AND a.posting_id=?"; params.push(posting_id); }
  sql += " ORDER BY a.created_at DESC";
  res.json(await all(sql, params));
});

router.post("/job-applications", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO job_applications(posting_id,full_name,register_no,birthdate,phone,email,address,education,major,experience,skills,stage,interview_date,interview_note,note)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.posting_id||null, b.full_name, b.register_no||"", b.birthdate||"",
     b.phone||"", b.email||"", b.address||"", b.education||"", b.major||"",
     b.experience||"", b.skills||"", b.stage||"Бүртгэгдсэн",
     b.interview_date||"", b.interview_note||"", b.note||""]
  );
  res.json({ id: r.id });
});

router.put("/job-applications/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE job_applications SET posting_id=?,full_name=?,register_no=?,birthdate=?,phone=?,email=?,
     address=?,education=?,major=?,experience=?,skills=?,stage=?,interview_date=?,interview_note=?,note=? WHERE id=?`,
    [b.posting_id||null, b.full_name, b.register_no||"", b.birthdate||"",
     b.phone||"", b.email||"", b.address||"", b.education||"", b.major||"",
     b.experience||"", b.skills||"", b.stage||"Бүртгэгдсэн",
     b.interview_date||"", b.interview_note||"", b.note||"", req.params.id]
  );
  res.json({ ok: true });
});

router.delete("/job-applications/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM job_applications WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.post("/job-applications/:id/cv", auth, requirePermission("hr_write"), upload.single("cv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл олдсонгүй" });
  const url = "/uploads/" + req.file.filename;
  await run("UPDATE job_applications SET cv_url=? WHERE id=?", [url, req.params.id]);
  res.json({ url });
});

// ── Trainings ─────────────────────────────────────────────────
router.get("/trainings", auth, async (req, res) => {
  res.json(await all("SELECT * FROM trainings ORDER BY start_date DESC, id DESC"));
});

router.post("/trainings", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO trainings(title,type,category,trainer,location,start_date,end_date,hours,budget,material_url,description,status,created_by)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [b.title, b.type||"Дотоод", b.category||"", b.trainer||"", b.location||"",
     b.start_date||"", b.end_date||"", Number(b.hours||0), Number(b.budget||0),
     b.material_url||"", b.description||"", b.status||"Төлөвлөгдсөн", req.user.id]
  );
  await audit(req.user.id, "CREATE", "trainings", r.id, b.title);
  res.json({ id: r.id });
});

router.put("/trainings/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE trainings SET title=?,type=?,category=?,trainer=?,location=?,start_date=?,end_date=?,hours=?,budget=?,description=?,status=? WHERE id=?`,
    [b.title, b.type||"Дотоод", b.category||"", b.trainer||"", b.location||"",
     b.start_date||"", b.end_date||"", Number(b.hours||0), Number(b.budget||0),
     b.description||"", b.status||"Төлөвлөгдсөн", req.params.id]
  );
  res.json({ ok: true });
});

router.post("/trainings/:id/material", auth, requirePermission("hr_write"), upload.single("material"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Материал файл олдсонгүй" });
  const allowed = new Set([
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]);
  if (!allowed.has(req.file.mimetype)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Зөвхөн PDF эсвэл PowerPoint материал upload хийнэ үү" });
  }
  const url = "/uploads/" + req.file.filename;
  await run("UPDATE trainings SET material_url=? WHERE id=?", [url, req.params.id]);
  await audit(req.user.id, "UPLOAD", "trainings", req.params.id, "training material");
  res.json({ url });
});

router.delete("/trainings/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM training_attendees WHERE training_id=?", [req.params.id]);
  await run("DELETE FROM trainings WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.get("/training-attendees/:trainingId", auth, async (req, res) => {
  const rows = await all(
    `SELECT ta.*, u.full_name, u.position, u.department FROM training_attendees ta
     JOIN users u ON u.id=ta.user_id WHERE ta.training_id=? ORDER BY u.full_name`,
    [req.params.trainingId]
  );
  res.json(rows);
});

router.post("/training-attendees", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const existing = await get("SELECT id FROM training_attendees WHERE training_id=? AND user_id=?",
    [b.training_id, b.user_id]);
  if (existing) {
    await run("UPDATE training_attendees SET attended=?,score=?,note=? WHERE id=?",
      [b.attended||0, b.score||null, b.note||"", existing.id]);
  } else {
    await run(`INSERT INTO training_attendees(training_id,user_id,attended,score,note) VALUES(?,?,?,?,?)`,
      [b.training_id, b.user_id, b.attended||0, b.score||null, b.note||""]);
  }
  res.json({ ok: true });
});

router.post("/training-attendees/:id/certificate", auth, upload.single("certificate"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл олдсонгүй" });
  const url = "/uploads/" + req.file.filename;
  await run("UPDATE training_attendees SET certificate_url=? WHERE id=?", [url, req.params.id]);
  res.json({ url });
});

router.delete("/training-attendees/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM training_attendees WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// ── KPI Evaluations ───────────────────────────────────────────
router.get("/kpi-evaluations", auth, async (req, res) => {
  const { user_id, period_type } = req.query;
  let sql = `SELECT e.*, u.full_name, u.position, u.department,
    ev.full_name evaluator_name FROM kpi_evaluations e
    JOIN users u ON u.id=e.user_id
    LEFT JOIN users ev ON ev.id=e.evaluator_id WHERE 1=1`;
  const params = [];
  if (user_id) { sql += " AND e.user_id=?"; params.push(user_id); }
  if (period_type) { sql += " AND e.period_type=?"; params.push(period_type); }
  sql += " ORDER BY e.created_at DESC";
  res.json(await all(sql, params));
});

router.post("/kpi-evaluations", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO kpi_evaluations(user_id,evaluator_id,period,period_type,items,total_score,grade,comment,status)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.user_id, req.user.id, b.period||"", b.period_type||"Сар",
     JSON.stringify(b.items||[]), b.total_score||0, b.grade||"", b.comment||"", b.status||"Ноорог"]
  );
  await audit(req.user.id, "CREATE", "kpi_evaluations", r.id, `KPI: ${b.period}`);
  res.json({ id: r.id });
});

router.put("/kpi-evaluations/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE kpi_evaluations SET period=?,period_type=?,items=?,total_score=?,grade=?,comment=?,status=? WHERE id=?`,
    [b.period||"", b.period_type||"Сар", JSON.stringify(b.items||[]),
     b.total_score||0, b.grade||"", b.comment||"", b.status||"Ноорог", req.params.id]
  );
  res.json({ ok: true });
});

router.delete("/kpi-evaluations/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM kpi_evaluations WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

// Submit for chief engineer review (HR/director)
router.put("/kpi-evaluations/:id/submit", auth, requirePermission("hr_write"), async (req, res) => {
  await run("UPDATE kpi_evaluations SET status='Хянаж байна' WHERE id=?", [req.params.id]);
  await audit(req.user.id, "UPDATE", "kpi_evaluations", req.params.id, "submitted for review");
  res.json({ ok: true });
});

// Approve by chief engineer or director
router.put("/kpi-evaluations/:id/approve", auth, requirePermission("engineering"), async (req, res) => {
  const now = new Date().toISOString().slice(0,10);
  await run(
    "UPDATE kpi_evaluations SET status='Баталгаажсан', approved_by=?, approved_at=?, reject_note='' WHERE id=?",
    [req.user.id, now, req.params.id]
  );
  await audit(req.user.id, "APPROVE", "kpi_evaluations", req.params.id, "approved");
  res.json({ ok: true });
});

// Reject by chief engineer or director
router.put("/kpi-evaluations/:id/reject", auth, requirePermission("engineering"), async (req, res) => {
  const note = req.body.note || "";
  await run(
    "UPDATE kpi_evaluations SET status='Буцаагдсан', approved_by=?, reject_note=? WHERE id=?",
    [req.user.id, note, req.params.id]
  );
  await audit(req.user.id, "REJECT", "kpi_evaluations", req.params.id, note);
  res.json({ ok: true });
});

// Approval info endpoint
router.get("/kpi-evaluations/:id/approver", auth, async (req, res) => {
  const row = await get(
    `SELECT e.approved_by, e.approved_at, e.reject_note, u.full_name approver_name, u.position approver_position
     FROM kpi_evaluations e LEFT JOIN users u ON u.id=e.approved_by WHERE e.id=?`,
    [req.params.id]
  );
  res.json(row || {});
});

// ── Surveys ───────────────────────────────────────────────────
router.get("/public-surveys/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const s = await get(
    "SELECT id,title,description,type,questions,deadline,status,anonymous FROM surveys WHERE public_token=?",
    [token]
  );
  if (!s) return res.status(404).json({ error: "Судалгаа олдсонгүй" });
  if (s.status !== "Идэвхтэй") return res.status(400).json({ error: "Судалгаа хаагдсан байна" });
  if (s.deadline && s.deadline < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: "Судалгааны хугацаа дууссан байна" });
  }
  res.json(s);
});

router.post("/public-survey-responses", publicRateLimit, async (req, res) => {
  const b = req.body || {};
  const token = String(b.token || "").trim();
  const s = await get("SELECT id,status,deadline FROM surveys WHERE public_token=?", [token]);
  if (!s) return res.status(404).json({ error: "Судалгаа олдсонгүй" });
  if (s.status !== "Идэвхтэй") return res.status(400).json({ error: "Судалгаа хаагдсан байна" });
  if (s.deadline && s.deadline < new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: "Судалгааны хугацаа дууссан байна" });
  }
  await run(
    `INSERT INTO survey_responses(survey_id,user_id,answers) VALUES(?,?,?)`,
    [s.id, null, JSON.stringify(b.answers || {})]
  );
  res.json({ ok: true });
});

router.get("/surveys", auth, async (req, res) => {
  res.json(await all("SELECT * FROM surveys ORDER BY created_at DESC"));
});

router.post("/surveys", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO surveys(title,description,type,questions,deadline,status,anonymous,public_token,created_by)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.title, b.description||"", b.type||"Сэтгэл ханамж",
     JSON.stringify(b.questions||[]), b.deadline||"",
     b.status||"Идэвхтэй", b.anonymous?1:0, crypto.randomBytes(16).toString("hex"), req.user.id]
  );
  await audit(req.user.id, "CREATE", "surveys", r.id, b.title);
  res.json({ id: r.id });
});

router.put("/surveys/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE surveys SET title=?,description=?,type=?,questions=?,deadline=?,status=?,anonymous=? WHERE id=?`,
    [b.title, b.description||"", b.type||"Сэтгэл ханамж",
     JSON.stringify(b.questions||[]), b.deadline||"",
     b.status||"Идэвхтэй", b.anonymous?1:0, req.params.id]
  );
  res.json({ ok: true });
});

router.post("/surveys/:id/public-token", auth, requirePermission("hr_write"), async (req, res) => {
  const row = await get("SELECT id, public_token FROM surveys WHERE id=?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Судалгаа олдсонгүй" });
  const token = row.public_token || crypto.randomBytes(16).toString("hex");
  if (!row.public_token) {
    await run("UPDATE surveys SET public_token=? WHERE id=?", [token, req.params.id]);
  }
  res.json({ token });
});

router.delete("/surveys/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM survey_responses WHERE survey_id=?", [req.params.id]);
  await run("DELETE FROM surveys WHERE id=?", [req.params.id]);
  res.json({ ok: true });
});

router.get("/survey-responses/:surveyId", auth, async (req, res) => {
  const survey = await get("SELECT anonymous FROM surveys WHERE id=?", [req.params.surveyId]);
  const rows = await all(
    `SELECT sr.*, u.full_name FROM survey_responses sr
     LEFT JOIN users u ON u.id=sr.user_id WHERE sr.survey_id=? ORDER BY sr.submitted_at DESC`,
    [req.params.surveyId]
  );
  res.json((survey?.anonymous ? rows.map(r => ({ ...r, full_name: "" })) : rows));
});

router.get("/survey-responses/:surveyId/mine", auth, async (req, res) => {
  const row = await get(
    "SELECT * FROM survey_responses WHERE survey_id=? AND user_id=?",
    [req.params.surveyId, req.user.id]
  );
  res.json(row || null);
});

router.post("/survey-responses", auth, async (req, res) => {
  const b = req.body;
  const existing = await get(
    "SELECT id FROM survey_responses WHERE survey_id=? AND user_id=?",
    [b.survey_id, req.user.id]
  );
  if (existing) return res.status(400).json({ error: "Та аль хэдийн хариулсан байна" });
  await run(
    `INSERT INTO survey_responses(survey_id,user_id,answers) VALUES(?,?,?)`,
    [b.survey_id, req.user.id, JSON.stringify(b.answers||{})]
  );
  res.json({ ok: true });
});

// ── org_contracts enhanced fields ─────────────────────────────
router.put("/org-contracts/:id/details", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  await run(
    `UPDATE org_contracts SET register_no=?,phone=?,email=?,signed_date=?,
     responsible_person=?,details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [b.register_no||"", b.phone||"", b.email||"",
     b.signed_date||"", b.responsible_person||"",
     JSON.stringify(b.details||{}), req.params.id]
  );
  res.json({ ok: true });
});

module.exports = router;
