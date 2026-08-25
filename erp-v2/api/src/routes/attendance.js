"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireRoles, requireModule } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const editors = requireRoles("director", "hr");
const allReaders = new Set(["director", "hr", "chief_engineer"]);
const status = z.enum(["worked", "absent", "leave", "sick", "vacation", "late", "remote", "holiday"]);
const monthSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
const recordSchema = z.object({
  status,
  workHours: z.coerce.number().min(0).max(8).default(0),
  leaveHours: z.coerce.number().min(0).max(8).default(0),
  overtimeHours: z.coerce.number().min(0).max(16).default(0),
  checkIn: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(""), z.null()]).optional(),
  checkOut: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal(""), z.null()]).optional(),
  lateMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  note: z.string().trim().max(1000).default(""),
}).refine(value => value.workHours + value.leaveHours <= 8, { message: "Work and leave hours cannot exceed 8" });

router.use(authenticate, requireModule("attendance"));

function period(year, month) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, next };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function loadMonth(req, year, month) {
  const org = req.user.organization_id;
  const { start, next } = period(year, month);
  const canSeeAll = allReaders.has(req.user.role);
  const employeeParams = canSeeAll ? [org] : [org, req.user.employee_id];
  const employeeWhere = canSeeAll ? "e.organization_id=$1 AND e.active=true" : "e.organization_id=$1 AND e.id=$2";
  const recordParams = canSeeAll ? [org, start, next] : [org, start, next, req.user.employee_id];
  const recordWhere = canSeeAll ? "a.organization_id=$1 AND a.attendance_date >= $2 AND a.attendance_date < $3" : "a.organization_id=$1 AND a.attendance_date >= $2 AND a.attendance_date < $3 AND a.employee_id=$4";
  const [employees, records] = await Promise.all([
    getPool().query(`SELECT e.id,e.full_name,e.job_role AS role,d.name AS department_name,p.title AS position_title
      FROM employees e
      LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
      LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
      WHERE ${employeeWhere}
      ORDER BY CASE
        WHEN lower(COALESCE(p.title,'')) ~ '(манаач|сахиул)' THEN 90
        WHEN e.job_role='director' AND p.id IS NOT NULL THEN 10 WHEN e.job_role='director' THEN 11
        WHEN e.job_role='chief_engineer' THEN 20
        WHEN e.job_role IN ('accountant','hr','safety','storekeeper','camera_engineer','engineer','electric') THEN 30
        WHEN e.job_role='worker' THEN 40 ELSE 50 END,
        COALESCE(p.rank_level,20),p.title NULLS LAST,e.full_name`, employeeParams),
    getPool().query(`SELECT a.id,a.employee_id,a.employee_id AS user_id,a.attendance_date,a.status,a.work_hours,a.leave_hours,
      a.overtime_hours,a.check_in,a.check_out,a.late_minutes,a.note,a.source,a.updated_at,
      u.full_name AS employee_name,editor.full_name AS updated_by_name
      FROM attendance_records a
      JOIN employees u ON u.organization_id=a.organization_id AND u.id=a.employee_id
      LEFT JOIN users editor ON editor.organization_id=a.organization_id AND editor.id=a.updated_by
      WHERE ${recordWhere} ORDER BY a.attendance_date,a.employee_id`, recordParams),
  ]);
  const summary = records.rows.reduce((out, item) => {
    out.records += 1;
    out[item.status] = (out[item.status] || 0) + 1;
    out.workHours += Number(item.work_hours);
    out.leaveHours += Number(item.leave_hours);
    out.overtimeHours += Number(item.overtime_hours);
    out.lateMinutes += Number(item.late_minutes);
    return out;
  }, { records:0, worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, remote:0, holiday:0, workHours:0, leaveHours:0, overtimeHours:0, lateMinutes:0 });
  return { year, month, canEdit: ["director", "hr"].includes(req.user.role), employees: employees.rows, records: records.rows, summary };
}

router.get("/", asyncHandler(async (req, res) => {
  const parsed = monthSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Он, сар буруу байна" });
  res.json(await loadMonth(req, parsed.data.year, parsed.data.month));
}));

router.get("/export.csv", asyncHandler(async (req, res) => {
  const parsed = monthSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Он, сар буруу байна" });
  const data = await loadMonth(req, parsed.data.year, parsed.data.month);
  const employeeById = new Map(data.employees.map(item => [item.id, item]));
  const rows = [["Огноо","Ажилтан","Хэлтэс","Албан тушаал","Төлөв","Ажилласан цаг","Чөлөөний цаг","Илүү цаг","Хоцорсон минут","Ирсэн","Гарсан","Тайлбар"]];
  for (const record of data.records) {
    const employee = employeeById.get(record.user_id) || {};
    rows.push([String(record.attendance_date).slice(0,10),record.employee_name,employee.department_name,employee.position_title,record.status,record.work_hours,record.leave_hours,record.overtime_hours,record.late_minutes,record.check_in,record.check_out,record.note]);
  }
  const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="attendance-${parsed.data.year}-${String(parsed.data.month).padStart(2,"0")}.csv"`);
  res.send(csv);
}));

router.put("/:userId/:date", editors, asyncHandler(async (req, res) => {
  const userId = z.string().uuid().safeParse(req.params.userId);
  const attendanceDate = z.iso.date().safeParse(req.params.date);
  const parsed = recordSchema.safeParse(req.body);
  if (!userId.success || !attendanceDate.success || !parsed.success) return res.status(400).json({ error: "Ирцийн мэдээлэл буруу байна" });
  const value = parsed.data;
  const employee = await getPool().query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 AND active=true", [req.user.organization_id,userId.data]);
  if (!employee.rowCount) return res.status(404).json({ error: "Идэвхтэй ажилтан олдсонгүй" });
  const result = await getPool().query(
    `INSERT INTO attendance_records(organization_id,employee_id,attendance_date,status,work_hours,leave_hours,overtime_hours,check_in,check_out,late_minutes,note,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT(organization_id,employee_id,attendance_date) DO UPDATE SET
       status=EXCLUDED.status,work_hours=EXCLUDED.work_hours,leave_hours=EXCLUDED.leave_hours,
       overtime_hours=EXCLUDED.overtime_hours,check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,
       late_minutes=EXCLUDED.late_minutes,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [req.user.organization_id,userId.data,attendanceDate.data,value.status,value.workHours,value.leaveHours,value.overtimeHours,
      value.checkIn||null,value.checkOut||null,value.lateMinutes,value.note,req.user.id]
  );
  await writeAudit(req,"attendance.upsert","attendance_record",result.rows[0].id,{userId:userId.data,date:attendanceDate.data,status:value.status});
  res.json({ item: result.rows[0] });
}));

router.post("/mark-all-worked", editors, asyncHandler(async (req, res) => {
  const parsed = z.object({ date: z.iso.date(), workHours: z.coerce.number().min(0).max(8).default(8) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Огноо эсвэл цаг буруу байна" });
  const result = await getPool().query(
    `INSERT INTO attendance_records(organization_id,employee_id,attendance_date,status,work_hours,created_by,updated_by)
     SELECT $1,e.id,$2,'worked',$3,$4,$4 FROM employees e
     WHERE e.organization_id=$1 AND e.active=true
     ON CONFLICT(organization_id,employee_id,attendance_date) DO NOTHING`,
    [req.user.organization_id,parsed.data.date,parsed.data.workHours,req.user.id]
  );
  await writeAudit(req,"attendance.bulk_worked","attendance_record",null,{date:parsed.data.date,created:result.rowCount});
  res.json({ ok:true, created:result.rowCount });
}));

router.delete("/:userId/:date", editors, asyncHandler(async (req, res) => {
  const userId = z.string().uuid().safeParse(req.params.userId);
  const attendanceDate = z.iso.date().safeParse(req.params.date);
  if (!userId.success || !attendanceDate.success) return res.status(400).json({ error: "Ирцийн түлхүүр буруу байна" });
  const result = await getPool().query(
    "SELECT id FROM attendance_records WHERE organization_id=$1 AND employee_id=$2 AND attendance_date=$3",
    [req.user.organization_id,userId.data,attendanceDate.data]
  );
  if (!result.rowCount) return res.status(404).json({ error: "Ирцийн бүртгэл олдсонгүй" });
  return res.status(409).json({ error:"Attendance history cannot be deleted. Submit an audited correction request.", code:"ATTENDANCE_CORRECTION_REQUIRED" });
}));

module.exports = router;
