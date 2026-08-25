"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const optionalDate = z.union([z.iso.date(), z.literal(""), z.null()]).optional();
const leaveSchema = z.object({
  employeeId: uuid,
  leaveType: z.enum(["annual", "sick", "unpaid", "family", "maternity", "paternity", "training", "other"]),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  requestedDays: z.coerce.number().positive().max(366),
  reason: z.string().trim().max(2000).default(""),
}).refine(value => value.endsOn >= value.startsOn, { message: "Invalid leave period" });
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(2000).default(""),
});
const scheduleSchema = z.object({
  code: z.string().trim().min(1).max(40).transform(value => value.toUpperCase()),
  name: z.string().trim().min(2).max(200),
  timezone: z.string().trim().min(1).max(100).default("Asia/Ulaanbaatar"),
  weeklyPattern: z.record(z.string(), z.unknown()).default({}),
});
const scheduleAssignmentSchema = z.object({
  scheduleId: uuid,
  effectiveFrom: z.iso.date(),
  effectiveTo: optionalDate,
});
const correctionValuesSchema = z.object({
  status: z.enum(["worked", "absent", "leave", "sick", "vacation", "late", "remote", "holiday"]),
  workHours: z.coerce.number().min(0).max(8).default(0),
  leaveHours: z.coerce.number().min(0).max(8).default(0),
  overtimeHours: z.coerce.number().min(0).max(16).default(0),
  checkIn: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(""), z.null()]).optional(),
  checkOut: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(""), z.null()]).optional(),
  lateMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  note: z.string().trim().max(1000).default(""),
}).refine(value => value.workHours + value.leaveHours <= 8, { message: "Work and leave hours cannot exceed 8" });
const correctionSchema = z.object({
  employeeId: uuid,
  attendanceDate: z.iso.date(),
  requestedValues: correctionValuesSchema,
  reason: z.string().trim().min(3).max(2000),
});
const skillSchema = z.object({
  skillId: uuid,
  proficiencyLevel: z.coerce.number().int().min(1).max(5),
  certificateNo: z.string().trim().max(120).default(""),
  issuedAt: optionalDate,
  expiresAt: optionalDate,
});
const trainingSchema = z.object({
  title: z.string().trim().min(2).max(250),
  provider: z.string().trim().max(250).default(""),
  startsOn: optionalDate,
  completedOn: optionalDate,
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]).default("planned"),
  result: z.string().trim().max(2000).default(""),
});
const performanceSchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  goals: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  score: z.union([z.coerce.number().min(0).max(100), z.literal(""), z.null()]).optional(),
  summary: z.string().trim().max(5000).default(""),
  status: z.enum(["draft", "submitted", "acknowledged", "closed"]).default("draft"),
  reviewerUserId: uuid,
}).refine(value => value.periodEnd >= value.periodStart, { message: "Invalid review period" });
const checklistSchema = z.object({
  checklistType: z.enum(["onboarding", "offboarding"]),
  effectiveDate: z.iso.date(),
  items: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(250),
    responsibleUserId: z.union([uuid, z.literal(""), z.null()]).optional(),
  })).min(1).max(50),
});

router.use(authenticate, requireModule("hr"), requirePermissions("hr.manage"));

function can(req, permission) {
  return new Set(req.user.permissions || []).has(permission);
}

function requirePermission(req, res, permission) {
  if (can(req, permission)) return true;
  res.status(403).json({ error: "Insufficient permission" });
  return false;
}

async function employeeExists(client, organizationId, employeeId) {
  const result = await client.query(
    "SELECT id FROM employees WHERE organization_id=$1 AND id=$2",
    [organizationId, employeeId]
  );
  return result.rowCount > 0;
}

router.get("/operations", asyncHandler(async (req, res) => {
  const org = req.user.organization_id;
  const [leave, schedules, assignments, corrections, skills, organizationSkills, training, reviews, checklists, alerts] = await Promise.all([
    getPool().query(`SELECT l.*,e.full_name AS employee_name,u.full_name AS decided_by_name
      FROM hr_leave_requests l JOIN employees e ON e.organization_id=l.organization_id AND e.id=l.employee_id
      LEFT JOIN users u ON u.organization_id=l.organization_id AND u.id=l.decided_by
      WHERE l.organization_id=$1 ORDER BY l.created_at DESC LIMIT 300`, [org]),
    getPool().query("SELECT * FROM hr_work_schedules WHERE organization_id=$1 ORDER BY active DESC,name", [org]),
    getPool().query(`SELECT a.*,e.full_name AS employee_name,s.code AS schedule_code,s.name AS schedule_name
      FROM employee_schedule_assignments a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
      JOIN hr_work_schedules s ON s.organization_id=a.organization_id AND s.id=a.schedule_id
      WHERE a.organization_id=$1 ORDER BY a.effective_from DESC LIMIT 500`, [org]),
    getPool().query(`SELECT c.*,e.full_name AS employee_name,requester.full_name AS requested_by_name,decider.full_name AS decided_by_name
      FROM attendance_correction_requests c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
      LEFT JOIN users requester ON requester.organization_id=c.organization_id AND requester.id=c.requested_by
      LEFT JOIN users decider ON decider.organization_id=c.organization_id AND decider.id=c.decided_by
      WHERE c.organization_id=$1 ORDER BY c.created_at DESC LIMIT 300`, [org]),
    getPool().query(`SELECT es.*,os.code,os.name,e.full_name AS employee_name
      FROM employee_skills es JOIN organization_skills os ON os.organization_id=es.organization_id AND os.id=es.skill_id
      JOIN employees e ON e.organization_id=es.organization_id AND e.id=es.employee_id
      WHERE es.organization_id=$1 ORDER BY e.full_name,os.name`, [org]),
    getPool().query("SELECT * FROM organization_skills WHERE organization_id=$1 AND active=true ORDER BY category,name", [org]),
    getPool().query(`SELECT t.*,e.full_name AS employee_name FROM employee_training_records t
      JOIN employees e ON e.organization_id=t.organization_id AND e.id=t.employee_id
      WHERE t.organization_id=$1 ORDER BY COALESCE(t.completed_on,t.starts_on) DESC NULLS LAST LIMIT 500`, [org]),
    getPool().query(`SELECT r.*,e.full_name AS employee_name,u.full_name AS reviewer_name FROM employee_performance_reviews r
      JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id
      JOIN users u ON u.organization_id=r.organization_id AND u.id=r.reviewer_user_id
      WHERE r.organization_id=$1 ORDER BY r.period_end DESC LIMIT 300`, [org]),
    getPool().query(`SELECT c.*,e.full_name AS employee_name,COALESCE(jsonb_agg(jsonb_build_object(
        'id',i.id,'code',i.item_code,'title',i.title,'responsibleUserId',i.responsible_user_id,
        'completedAt',i.completed_at,'completedBy',i.completed_by,'note',i.note
      ) ORDER BY i.item_code) FILTER(WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
      FROM employee_transition_checklists c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id
      LEFT JOIN employee_transition_checklist_items i ON i.organization_id=c.organization_id AND i.checklist_id=c.id
      WHERE c.organization_id=$1 GROUP BY c.id,e.full_name ORDER BY c.created_at DESC LIMIT 300`, [org]),
    getPool().query(`SELECT 'contract_expiry' AS alert_type,e.id AS employee_id,e.full_name,
        ep.contract_end AS due_date,ep.contract_no AS reference
      FROM employees e JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
      WHERE e.organization_id=$1 AND e.active=true AND ep.contract_end BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '60 days'
      UNION ALL
      SELECT 'certificate_expiry',e.id,e.full_name,es.expires_at,os.name
      FROM employee_skills es JOIN employees e ON e.organization_id=es.organization_id AND e.id=es.employee_id
      JOIN organization_skills os ON os.organization_id=es.organization_id AND os.id=es.skill_id
      WHERE es.organization_id=$1 AND es.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '60 days'
      ORDER BY due_date`, [org]),
  ]);
  const sensitive = can(req, "hr.sensitive.read");
  res.json({
    canReadSensitive: sensitive,
    canApproveLeave: can(req, "hr.leave.approve"),
    canManagePerformance: can(req, "hr.performance.manage"),
    leaveRequests: leave.rows,
    schedules: schedules.rows,
    scheduleAssignments: assignments.rows,
    attendanceCorrections: corrections.rows,
    skills: skills.rows.map(item => sensitive ? item : { ...item, certificate_no: item.certificate_no ? "••••" : "" }),
    organizationSkills: organizationSkills.rows,
    training: training.rows,
    performanceReviews: can(req, "hr.performance.manage") ? reviews.rows : [],
    transitionChecklists: checklists.rows,
    alerts: alerts.rows,
  });
}));

router.post("/leave-requests", asyncHandler(async (req, res) => {
  const parsed = leaveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid leave request", detail: parsed.error.flatten() });
  const org = req.user.organization_id;
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (!await employeeExists(client, org, value.employeeId)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found" });
    }
    const overlap = await client.query(`SELECT id FROM hr_leave_requests WHERE organization_id=$1 AND employee_id=$2
      AND status IN('pending','approved') AND daterange(starts_on,ends_on,'[]') && daterange($3::date,$4::date,'[]') LIMIT 1`,
    [org, value.employeeId, value.startsOn, value.endsOn]);
    if (overlap.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Overlapping leave request exists" });
    }
    const result = await client.query(`INSERT INTO hr_leave_requests
      (organization_id,employee_id,leave_type,starts_on,ends_on,requested_days,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [org,value.employeeId,value.leaveType,value.startsOn,value.endsOn,value.requestedDays,value.reason,req.user.id]);
    await client.query(`INSERT INTO hr_leave_events(organization_id,leave_request_id,event_type,note,actor_user_id)
      VALUES($1,$2,'requested',$3,$4)`, [org,result.rows[0].id,value.reason,req.user.id]);
    await writeAudit(req,"hr.leave.requested","hr_leave_request",result.rows[0].id,{ employeeId:value.employeeId },client);
    await client.query("COMMIT");
    res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}));

router.patch("/leave-requests/:id/decision", asyncHandler(async (req, res) => {
  if (!requirePermission(req, res, "hr.leave.approve")) return;
  const id = uuid.safeParse(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid decision" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE hr_leave_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND status='pending' RETURNING *`,
    [req.user.organization_id,id.data,parsed.data.decision,req.user.id,parsed.data.note]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Pending request not found" }); }
    await client.query(`INSERT INTO hr_leave_events(organization_id,leave_request_id,event_type,note,actor_user_id)
      VALUES($1,$2,$3,$4,$5)`, [req.user.organization_id,id.data,parsed.data.decision,parsed.data.note,req.user.id]);
    await writeAudit(req,`hr.leave.${parsed.data.decision}`,"hr_leave_request",id.data,{ employeeId:result.rows[0].employee_id },client);
    await client.query("COMMIT");
    res.json({ item: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.post("/schedules", asyncHandler(async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid schedule", detail: parsed.error.flatten() });
  const value = parsed.data;
  const result = await getPool().query(`INSERT INTO hr_work_schedules
    (organization_id,code,name,timezone,weekly_pattern,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
    RETURNING *`, [req.user.organization_id,value.code,value.name,value.timezone,JSON.stringify(value.weeklyPattern),req.user.id]);
  await writeAudit(req,"hr.schedule.created","hr_work_schedule",result.rows[0].id,{ code:value.code });
  res.status(201).json({ item:result.rows[0] });
}));

router.post("/skills-catalog", asyncHandler(async (req, res) => {
  const parsed = z.object({
    code:z.string().trim().min(1).max(80).transform(value=>value.toUpperCase()),
    name:z.string().trim().min(2).max(200),
    category:z.string().trim().min(1).max(100).default("general"),
    description:z.string().trim().max(1000).default(""),
    certificationRequired:z.coerce.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:"Invalid skill definition", detail:parsed.error.flatten() });
  const v = parsed.data;
  const result = await getPool().query(`INSERT INTO organization_skills
    (organization_id,code,name,category,description,certification_required)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
  [req.user.organization_id,v.code,v.name,v.category,v.description,v.certificationRequired]);
  await writeAudit(req,"hr.skill_catalog.created","organization_skill",result.rows[0].id,{ code:v.code });
  res.status(201).json({ item:result.rows[0] });
}));

router.post("/employees/:employeeId/schedules", asyncHandler(async (req, res) => {
  const employeeId = uuid.safeParse(req.params.employeeId);
  const parsed = scheduleAssignmentSchema.safeParse(req.body);
  if (!employeeId.success || !parsed.success) return res.status(400).json({ error: "Invalid schedule assignment" });
  const org = req.user.organization_id;
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const valid = await client.query(`SELECT e.id FROM employees e JOIN hr_work_schedules s ON s.organization_id=e.organization_id
      WHERE e.organization_id=$1 AND e.id=$2 AND s.id=$3 AND s.active=true`, [org,employeeId.data,value.scheduleId]);
    if (!valid.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error:"Employee or schedule not found" }); }
    const overlap = await client.query(`SELECT id FROM employee_schedule_assignments WHERE organization_id=$1 AND employee_id=$2
      AND daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') && daterange($3::date,COALESCE($4::date,'infinity'::date),'[]') LIMIT 1`,
    [org,employeeId.data,value.effectiveFrom,value.effectiveTo||null]);
    if (overlap.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error:"Overlapping schedule assignment exists" }); }
    const result = await client.query(`INSERT INTO employee_schedule_assignments
      (organization_id,employee_id,schedule_id,effective_from,effective_to,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [org,employeeId.data,value.scheduleId,value.effectiveFrom,value.effectiveTo||null,req.user.id]);
    await writeAudit(req,"hr.schedule.assigned","employee_schedule_assignment",result.rows[0].id,{ employeeId:employeeId.data },client);
    await client.query("COMMIT");
    res.status(201).json({ item:result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.post("/attendance-corrections", asyncHandler(async (req, res) => {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:"Invalid attendance correction", detail:parsed.error.flatten() });
  const value = parsed.data;
  if (!await employeeExists(getPool(),req.user.organization_id,value.employeeId)) return res.status(404).json({ error:"Employee not found" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`INSERT INTO attendance_correction_requests
      (organization_id,employee_id,attendance_date,requested_values,reason,requested_by)
      VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
    [req.user.organization_id,value.employeeId,value.attendanceDate,JSON.stringify(value.requestedValues),value.reason,req.user.id]);
    await client.query(`INSERT INTO attendance_correction_events(organization_id,correction_request_id,event_type,detail,actor_user_id)
      VALUES($1,$2,'requested',$3::jsonb,$4)`, [req.user.organization_id,result.rows[0].id,JSON.stringify(value.requestedValues),req.user.id]);
    await writeAudit(req,"hr.attendance_correction.requested","attendance_correction_request",result.rows[0].id,{ employeeId:value.employeeId },client);
    await client.query("COMMIT");
    res.status(201).json({ item:result.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/attendance-corrections/:id/decision", asyncHandler(async (req, res) => {
  if (!requirePermission(req,res,"hr.leave.approve")) return;
  const id = uuid.safeParse(req.params.id);
  const parsed = decisionSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error:"Invalid decision" });
  const org = req.user.organization_id;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE attendance_correction_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5
      WHERE organization_id=$1 AND id=$2 AND status='pending' RETURNING *`, [org,id.data,parsed.data.decision,req.user.id,parsed.data.note]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error:"Pending correction not found" }); }
    const correction = result.rows[0];
    await client.query(`INSERT INTO attendance_correction_events(organization_id,correction_request_id,event_type,detail,actor_user_id)
      VALUES($1,$2,$3,$4::jsonb,$5)`, [org,id.data,parsed.data.decision,JSON.stringify({ note:parsed.data.note }),req.user.id]);
    if (parsed.data.decision === "approved") {
      const v = correction.requested_values;
      await client.query(`INSERT INTO attendance_records
        (organization_id,employee_id,attendance_date,status,work_hours,leave_hours,overtime_hours,check_in,check_out,late_minutes,note,source,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12,$12)
        ON CONFLICT(organization_id,employee_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,work_hours=EXCLUDED.work_hours,
        leave_hours=EXCLUDED.leave_hours,overtime_hours=EXCLUDED.overtime_hours,check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,
        late_minutes=EXCLUDED.late_minutes,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [org,correction.employee_id,correction.attendance_date,v.status,v.workHours||0,v.leaveHours||0,v.overtimeHours||0,
        v.checkIn||null,v.checkOut||null,v.lateMinutes||0,v.note||"",req.user.id]);
      await client.query(`INSERT INTO attendance_correction_events(organization_id,correction_request_id,event_type,detail,actor_user_id)
        VALUES($1,$2,'applied',$3::jsonb,$4)`, [org,id.data,JSON.stringify(v),req.user.id]);
    }
    await writeAudit(req,`hr.attendance_correction.${parsed.data.decision}`,"attendance_correction_request",id.data,{ employeeId:correction.employee_id },client);
    await client.query("COMMIT");
    res.json({ item:correction });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.put("/employees/:employeeId/skills", asyncHandler(async (req, res) => {
  const employeeId = uuid.safeParse(req.params.employeeId);
  const parsed = skillSchema.safeParse(req.body);
  if (!employeeId.success || !parsed.success) return res.status(400).json({ error:"Invalid skill record" });
  const value = parsed.data;
  const result = await getPool().query(`INSERT INTO employee_skills
    (organization_id,employee_id,skill_id,proficiency_level,certificate_no,issued_at,expires_at,verified_by,verified_at)
    SELECT $1,e.id,s.id,$4,$5,$6,$7,$8,now() FROM organization_skills s
    JOIN employees e ON e.organization_id=s.organization_id
    WHERE s.organization_id=$1 AND e.id=$2 AND s.id=$3
    ON CONFLICT(organization_id,employee_id,skill_id) DO UPDATE SET proficiency_level=EXCLUDED.proficiency_level,
      certificate_no=EXCLUDED.certificate_no,issued_at=EXCLUDED.issued_at,expires_at=EXCLUDED.expires_at,
      verified_by=EXCLUDED.verified_by,verified_at=now() RETURNING *`,
  [req.user.organization_id,employeeId.data,value.skillId,value.proficiencyLevel,value.certificateNo,value.issuedAt||null,value.expiresAt||null,req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error:"Employee or skill not found" });
  await writeAudit(req,"hr.skill.verified","employee_skill",value.skillId,{ employeeId:employeeId.data,level:value.proficiencyLevel });
  res.json({ item:result.rows[0] });
}));

router.post("/employees/:employeeId/training", asyncHandler(async (req, res) => {
  const employeeId = uuid.safeParse(req.params.employeeId);
  const parsed = trainingSchema.safeParse(req.body);
  if (!employeeId.success || !parsed.success) return res.status(400).json({ error:"Invalid training record" });
  const v = parsed.data;
  const result = await getPool().query(`INSERT INTO employee_training_records
    (organization_id,employee_id,title,provider,starts_on,completed_on,status,result,created_by)
    SELECT $1,e.id,$3,$4,$5,$6,$7,$8,$9 FROM employees e WHERE e.organization_id=$1 AND e.id=$2 RETURNING *`,
  [req.user.organization_id,employeeId.data,v.title,v.provider,v.startsOn||null,v.completedOn||null,v.status,v.result,req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error:"Employee not found" });
  await writeAudit(req,"hr.training.created","employee_training_record",result.rows[0].id,{ employeeId:employeeId.data });
  res.status(201).json({ item:result.rows[0] });
}));

router.post("/employees/:employeeId/performance", asyncHandler(async (req, res) => {
  if (!requirePermission(req,res,"hr.performance.manage")) return;
  const employeeId = uuid.safeParse(req.params.employeeId);
  const parsed = performanceSchema.safeParse(req.body);
  if (!employeeId.success || !parsed.success) return res.status(400).json({ error:"Invalid performance review" });
  const v = parsed.data;
  const result = await getPool().query(`INSERT INTO employee_performance_reviews
    (organization_id,employee_id,period_start,period_end,goals,score,summary,status,reviewer_user_id,created_by)
    SELECT $1,e.id,$3,$4,$5::jsonb,$6,$7,$8,u.id,$10 FROM employees e JOIN users u ON u.organization_id=e.organization_id
    WHERE e.organization_id=$1 AND e.id=$2 AND u.id=$9 RETURNING *`,
  [req.user.organization_id,employeeId.data,v.periodStart,v.periodEnd,JSON.stringify(v.goals),v.score===""?null:v.score??null,v.summary,v.status,v.reviewerUserId,req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error:"Employee or reviewer not found" });
  await writeAudit(req,"hr.performance.created","employee_performance_review",result.rows[0].id,{ employeeId:employeeId.data,status:v.status });
  res.status(201).json({ item:result.rows[0] });
}));

router.post("/employees/:employeeId/checklists", asyncHandler(async (req, res) => {
  const employeeId = uuid.safeParse(req.params.employeeId);
  const parsed = checklistSchema.safeParse(req.body);
  if (!employeeId.success || !parsed.success) return res.status(400).json({ error:"Invalid transition checklist" });
  const org = req.user.organization_id;
  const v = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (!await employeeExists(client,org,employeeId.data)) { await client.query("ROLLBACK"); return res.status(404).json({ error:"Employee not found" }); }
    const checklist = await client.query(`INSERT INTO employee_transition_checklists
      (organization_id,employee_id,checklist_type,effective_date,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [org,employeeId.data,v.checklistType,v.effectiveDate,req.user.id]);
    for (const item of v.items) {
      await client.query(`INSERT INTO employee_transition_checklist_items
        (organization_id,checklist_id,item_code,title,responsible_user_id) VALUES($1,$2,$3,$4,$5)`,
      [org,checklist.rows[0].id,item.code,item.title,item.responsibleUserId||null]);
    }
    await writeAudit(req,`hr.${v.checklistType}.started`,"employee_transition_checklist",checklist.rows[0].id,{ employeeId:employeeId.data },client);
    await client.query("COMMIT");
    res.status(201).json({ item:checklist.rows[0] });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}));

router.patch("/checklist-items/:id", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  const parsed = z.object({ completed:z.coerce.boolean(), note:z.string().trim().max(1000).default("") }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error:"Invalid checklist item" });
  const result = await getPool().query(`UPDATE employee_transition_checklist_items SET
    completed_at=CASE WHEN $3 THEN now() ELSE NULL END,completed_by=CASE WHEN $3 THEN $4 ELSE NULL END,note=$5
    WHERE organization_id=$1 AND id=$2 RETURNING *`, [req.user.organization_id,id.data,parsed.data.completed,req.user.id,parsed.data.note]);
  if (!result.rowCount) return res.status(404).json({ error:"Checklist item not found" });
  await writeAudit(req,"hr.checklist.item_updated","employee_transition_checklist_item",id.data,{ completed:parsed.data.completed });
  res.json({ item:result.rows[0] });
}));

module.exports = router;
