"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireRoles } = require("../middleware/auth");
const { toCsv } = require("../utils/csv");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const accessRoles = ["director", "chief_engineer", "accountant"];
const rangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).refine(value => value.from <= value.to, "Invalid date range");

function parseRange(query, res) {
  const today = new Date(), from = new Date(today);
  from.setDate(from.getDate() - 29);
  const parsed = rangeSchema.safeParse({
    from: query.from || from.toISOString().slice(0,10), to: query.to || today.toISOString().slice(0,10),
  });
  if (!parsed.success) res.status(400).json({ error: "Тайлангийн огноо буруу байна" });
  return parsed.success ? parsed.data : null;
}

router.use(authenticate, requireRoles(...accessRoles));

router.get("/overview", asyncHandler(async (req, res) => {
  const range = parseRange(req.query,res); if (!range) return;
  const params = [req.user.organization_id,range.from,range.to];
  const [summary,statuses,priorities,assets,assignees,daily] = await Promise.all([
    getPool().query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status='completed')::int AS completed,
              count(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int AS open,
              count(*) FILTER (WHERE due_at<now() AND status NOT IN ('completed','cancelled'))::int AS overdue
         FROM work_orders WHERE organization_id=$1 AND created_at >= $2::date AND created_at < ($3::date+1)`, params),
    getPool().query(
      `SELECT status,count(*)::int AS count FROM work_orders
        WHERE organization_id=$1 AND created_at >= $2::date AND created_at < ($3::date+1)
        GROUP BY status ORDER BY count DESC`, params),
    getPool().query(
      `SELECT priority,count(*)::int AS count FROM work_orders
        WHERE organization_id=$1 AND created_at >= $2::date AND created_at < ($3::date+1)
        GROUP BY priority ORDER BY count DESC`, params),
    getPool().query(
      `SELECT status,count(*)::int AS count FROM assets WHERE organization_id=$1 AND COALESCE(metadata->>'excludedFromAssetMaster','false')<>'true' GROUP BY status ORDER BY count DESC`, [req.user.organization_id]),
    getPool().query(
      `SELECT u.id,u.full_name,u.role,
              count(w.id)::int AS total,
              count(w.id) FILTER (WHERE w.status='completed')::int AS completed,
              count(w.id) FILTER (WHERE w.status NOT IN ('completed','cancelled'))::int AS open,
              count(w.id) FILTER (WHERE w.due_at<now() AND w.status NOT IN ('completed','cancelled'))::int AS overdue
         FROM users u LEFT JOIN work_orders w ON w.organization_id=u.organization_id AND w.assigned_to=u.id
              AND w.created_at >= $2::date AND w.created_at < ($3::date+1)
        WHERE u.organization_id=$1 AND u.active=true
        GROUP BY u.id ORDER BY total DESC,u.full_name`, params),
    getPool().query(
      `SELECT created_at::date AS day,count(*)::int AS created,
              count(*) FILTER (WHERE status='completed')::int AS completed
         FROM work_orders WHERE organization_id=$1 AND created_at >= $2::date AND created_at < ($3::date+1)
        GROUP BY created_at::date ORDER BY day`, params),
  ]);
  res.json({ range,summary:summary.rows[0],statuses:statuses.rows,priorities:priorities.rows,
    assetStatuses:assets.rows,assignees:assignees.rows,daily:daily.rows });
}));

router.get("/work-orders.csv", asyncHandler(async (req, res) => {
  const range = parseRange(req.query,res); if (!range) return;
  const result = await getPool().query(
    `SELECT w.title,w.category,w.priority,w.status,a.code AS asset_code,a.name AS asset_name,
            u.full_name AS assigned_name,w.due_at,w.created_at
       FROM work_orders w
       LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id
       LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      WHERE w.organization_id=$1 AND w.created_at >= $2::date AND w.created_at < ($3::date+1)
      ORDER BY w.created_at DESC`, [req.user.organization_id,range.from,range.to]
  );
  const rows = result.rows.map(item => [item.title,item.category,item.priority,item.status,item.asset_code,item.asset_name,
    item.assigned_name,item.due_at?new Date(item.due_at).toISOString():"",new Date(item.created_at).toISOString()]);
  const csv = toCsv(["Ажлын нэр","Ангилал","Яаралтай эсэх","Төлөв","Хөрөнгийн код","Хөрөнгийн нэр","Хариуцагч","Дуусах хугацаа","Үүсгэсэн огноо"],rows);
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition",`attachment; filename="work-orders-${range.from}-${range.to}.csv"`);
  res.send(csv);
}));

module.exports = router;
