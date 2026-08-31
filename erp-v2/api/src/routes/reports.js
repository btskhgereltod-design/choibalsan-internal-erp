"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate } = require("../middleware/auth");
const { toCsv } = require("../utils/csv");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const accessRoles = ["director", "chief_engineer", "accountant"];
const rangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).superRefine((value, context) => {
  const from = new Date(`${value.from}T00:00:00Z`);
  const to = new Date(`${value.to}T00:00:00Z`);
  const days = Math.floor((to - from) / 86400000) + 1;
  if (from > to) context.addIssue({ code: "custom", message: "Invalid date range" });
  if (days > 366) context.addIssue({ code: "custom", message: "Range is longer than one year" });
});

function isoDate(value) { return value.toISOString().slice(0, 10); }
function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function parseRange(query, res, timeZone) {
  const today = dateInTimeZone(new Date(), timeZone);
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 29);
  const parsed = rangeSchema.safeParse({ from: query.from || isoDate(from), to: query.to || today });
  if (!parsed.success) {
    res.status(400).json({ error: "Тайлангийн хугацаа буруу байна. Нэг удаад 366 хүртэл хоног сонгоно уу." });
  }
  return parsed.success ? parsed.data : null;
}
function periodContext(range) {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);
  const days = Math.floor((to - from) / 86400000) + 1;
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(from);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days);
  return { ...range, days, previous: { from: isoDate(previousFrom), to: isoDate(previousTo) } };
}
function numberRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, value === null ? null : Number(value)]));
}
function reportAccess(req, res, next) {
  const roles = new Set(req.user.system_roles || []);
  if (roles.has("owner") || accessRoles.includes(req.user.role)) return next();
  return res.status(403).json({ error: "Нэгдсэн тайлан харах эрх хүрэлцэхгүй байна" });
}

router.use(authenticate, reportAccess);

async function loadOrganization(pool, organizationId) {
  const result = await pool.query(
    `SELECT o.name,o.slug,o.timezone,s.logo_url FROM organizations o
      LEFT JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=$1`,
    [organizationId]
  );
  return result.rows[0];
}

async function loadWorkPeriod(pool, organizationId, from, to, timeZone) {
  const result = await pool.query(
    `WITH boundaries AS (
       SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
              LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at
     ), status_at_start AS (
       SELECT w.id,w.due_at,COALESCE(history.to_status,CASE WHEN w.updated_at<b.starts_at THEN w.status ELSE 'unknown' END) AS status
         FROM work_orders w CROSS JOIN boundaries b
         LEFT JOIN LATERAL (
           SELECT e.to_status FROM work_order_events e
            WHERE e.organization_id=w.organization_id AND e.work_order_id=w.id
              AND e.event_type IN ('created','status_changed') AND e.to_status IS NOT NULL AND e.created_at<b.starts_at
            ORDER BY e.created_at DESC,e.id DESC LIMIT 1
         ) history ON true
        WHERE w.organization_id=$1 AND w.created_at<b.starts_at
     ), status_at_end AS (
       SELECT w.id,w.due_at,COALESCE(history.to_status,CASE WHEN w.updated_at<b.ends_at THEN w.status ELSE 'unknown' END) AS status
         FROM work_orders w CROSS JOIN boundaries b
         LEFT JOIN LATERAL (
           SELECT e.to_status FROM work_order_events e
            WHERE e.organization_id=w.organization_id AND e.work_order_id=w.id
              AND e.event_type IN ('created','status_changed') AND e.to_status IS NOT NULL AND e.created_at<b.ends_at
            ORDER BY e.created_at DESC,e.id DESC LIMIT 1
         ) history ON true
        WHERE w.organization_id=$1 AND w.created_at<b.ends_at
     ), completed AS (
       SELECT DISTINCT e.work_order_id FROM work_order_events e CROSS JOIN boundaries b
        WHERE e.organization_id=$1 AND e.event_type='status_changed' AND e.to_status='completed'
          AND e.created_at>=b.starts_at AND e.created_at<b.ends_at
     ), cancelled AS (
       SELECT DISTINCT e.work_order_id FROM work_order_events e CROSS JOIN boundaries b
        WHERE e.organization_id=$1 AND e.event_type='status_changed' AND e.to_status='cancelled'
          AND e.created_at>=b.starts_at AND e.created_at<b.ends_at
     ) SELECT
       (SELECT count(*) FROM status_at_start WHERE status NOT IN ('completed','cancelled','unknown'))::int AS opening_backlog,
       (SELECT count(*) FROM work_orders w,boundaries b WHERE w.organization_id=$1 AND w.created_at>=b.starts_at AND w.created_at<b.ends_at)::int AS created,
       (SELECT count(*) FROM completed)::int AS completed,
       (SELECT count(*) FROM cancelled)::int AS cancelled,
       (SELECT count(*) FROM status_at_end WHERE status NOT IN ('completed','cancelled','unknown'))::int AS closing_backlog,
       (SELECT count(*) FROM status_at_end,boundaries b WHERE status NOT IN ('completed','cancelled','unknown') AND due_at<b.ends_at)::int AS overdue,
       (SELECT count(*) FROM status_at_start WHERE status='unknown')::int AS unknown_status_at_start,
       (SELECT count(*) FROM status_at_end WHERE status='unknown')::int AS unknown_status_at_end,
       (SELECT count(*) FROM work_orders w,boundaries b WHERE w.organization_id=$1 AND w.created_at>=b.starts_at AND w.created_at<b.ends_at AND w.assigned_to IS NULL)::int AS unassigned_created`,
    [organizationId, from, to, timeZone]
  );
  return numberRow(result.rows[0]);
}

router.get("/overview", asyncHandler(async (req, res) => {
  const pool = getPool();
  const organizationId = req.user.organization_id;
  const organization = await loadOrganization(pool, organizationId);
  const range = parseRange(req.query, res, organization.timezone);
  if (!range) return;
  const period = periodContext(range);
  const params = [organizationId, period.from, period.to, organization.timezone];
  const granularity = period.days > 62 ? "month" : "day";
  const step = granularity === "month" ? "1 month" : "1 day";
  const [current, previous, statuses, priorities, assets, assignees, trend, unlinkedAssignees] = await Promise.all([
    loadWorkPeriod(pool, organizationId, period.from, period.to, organization.timezone),
    loadWorkPeriod(pool, organizationId, period.previous.from, period.previous.to, organization.timezone),
    pool.query(
      `WITH boundaries AS (SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
        LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS at)
       SELECT state.status,count(*)::int AS count FROM work_orders w CROSS JOIN boundaries b
       CROSS JOIN LATERAL (SELECT COALESCE((SELECT e.to_status FROM work_order_events e
         WHERE e.organization_id=w.organization_id AND e.work_order_id=w.id
           AND e.event_type IN ('created','status_changed') AND e.to_status IS NOT NULL AND e.created_at<b.at
         ORDER BY e.created_at DESC,e.id DESC LIMIT 1),CASE WHEN w.updated_at<b.at THEN w.status ELSE 'unknown' END) AS status) state
       WHERE w.organization_id=$1 AND w.created_at<b.at GROUP BY state.status ORDER BY count DESC`, params),
    pool.query(
      `WITH boundaries AS (SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
        LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at)
       SELECT priority,count(*)::int AS count FROM work_orders,boundaries
        WHERE organization_id=$1 AND created_at>=starts_at AND created_at<ends_at GROUP BY priority ORDER BY count DESC`, params),
    pool.query(
      `SELECT status,count(*)::int AS count FROM assets WHERE organization_id=$1
        AND COALESCE(metadata->>'excludedFromAssetMaster','false')<>'true' GROUP BY status ORDER BY count DESC`,
      [organizationId]),
    pool.query(
      `WITH boundaries AS (SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
        LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at), completed AS (
         SELECT DISTINCT e.work_order_id FROM work_order_events e CROSS JOIN boundaries b WHERE e.organization_id=$1
          AND e.event_type='status_changed' AND e.to_status='completed'
          AND e.created_at>=b.starts_at AND e.created_at<b.ends_at
       ), activity AS (
         SELECT e.id,e.full_name,e.active,e.job_role,d.name AS department,p.title AS position,u.id AS user_id,
           count(w.id) FILTER(WHERE w.created_at>=b.starts_at AND w.created_at<b.ends_at)::int AS assigned,
           count(c.work_order_id)::int AS completed,
           count(w.id) FILTER(WHERE w.status NOT IN ('completed','cancelled'))::int AS open_now,
           count(w.id) FILTER(WHERE w.due_at<now() AND w.status NOT IN ('completed','cancelled'))::int AS overdue_now
         FROM employees e CROSS JOIN boundaries b
         LEFT JOIN users u ON u.organization_id=e.organization_id AND u.employee_id=e.id
         LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
         LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
         LEFT JOIN work_orders w ON w.organization_id=e.organization_id AND w.assigned_to=u.id
         LEFT JOIN completed c ON c.work_order_id=w.id
        WHERE e.organization_id=$1 GROUP BY e.id,d.name,p.title,u.id,b.starts_at,b.ends_at
       ) SELECT * FROM activity WHERE assigned>0 OR completed>0 ORDER BY completed DESC,assigned DESC,full_name`, params),
    pool.query(
      `WITH boundaries AS (SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
          LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at),
       buckets AS (
         SELECT generate_series(date_trunc('${granularity}',$2::date),date_trunc('${granularity}',$3::date),interval '${step}')::date AS bucket
       ), created AS (
         SELECT date_trunc('${granularity}',w.created_at AT TIME ZONE $4)::date AS bucket,count(*)::int AS count
           FROM work_orders w CROSS JOIN boundaries b
          WHERE w.organization_id=$1 AND w.created_at>=b.starts_at AND w.created_at<b.ends_at GROUP BY 1
       ), completed AS (
         SELECT date_trunc('${granularity}',e.created_at AT TIME ZONE $4)::date AS bucket,count(DISTINCT e.work_order_id)::int AS count
           FROM work_order_events e CROSS JOIN boundaries b
          WHERE e.organization_id=$1 AND e.event_type='status_changed' AND e.to_status='completed'
            AND e.created_at>=b.starts_at AND e.created_at<b.ends_at GROUP BY 1
       ) SELECT b.bucket,COALESCE(c.count,0)::int AS created,COALESCE(x.count,0)::int AS completed
         FROM buckets b LEFT JOIN created c USING(bucket) LEFT JOIN completed x USING(bucket) ORDER BY b.bucket`, params),
    pool.query(
      `WITH boundaries AS (SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
        LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at)
       SELECT count(DISTINCT w.assigned_to)::int AS count FROM work_orders w CROSS JOIN boundaries b
       JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
       LEFT JOIN employees e ON e.organization_id=u.organization_id AND e.id=u.employee_id
       WHERE w.organization_id=$1 AND e.id IS NULL
         AND (w.created_at>=b.starts_at AND w.created_at<b.ends_at OR w.status NOT IN ('completed','cancelled'))`, params),
  ]);
  const generatedAt = new Date().toISOString();
  res.json({
    report: { type: "management_work", version: 2, state: "live_draft", generatedAt, dataCutoff: generatedAt },
    organization, period, comparison: { period: period.previous, work: previous },
    work: current, statuses: statuses.rows, priorities: priorities.rows,
    assetSnapshot: { asOf: generatedAt, statuses: assets.rows },
    people: { basis: "canonical_employees_current_assignee", participants: assignees.rows },
    trend: { granularity, timeZone: organization.timezone, points: trend.rows },
    dataQuality: {
      unknownHistoricalStatus: current.unknown_status_at_end,
      unknownStatusAtStart: current.unknown_status_at_start,
      unknownStatusAtEnd: current.unknown_status_at_end,
      previousUnknownStatusAtStart: previous.unknown_status_at_start,
      previousUnknownStatusAtEnd: previous.unknown_status_at_end,
      unassignedCreated: current.unassigned_created,
      unlinkedAssignees: Number(unlinkedAssignees.rows[0].count),
      historicalStatusSource: "work_order_events",
    },
  });
}));

router.get("/work-orders.csv", asyncHandler(async (req, res) => {
  const pool = getPool();
  const organization = await loadOrganization(pool, req.user.organization_id);
  const range = parseRange(req.query, res, organization.timezone);
  if (!range) return;
  const result = await pool.query(
    `WITH boundaries AS (
       SELECT ($2::date::timestamp AT TIME ZONE $4) AS starts_at,
              LEAST((($3::date+1)::timestamp AT TIME ZONE $4),now()) AS ends_at
     ), report_rows AS (
       SELECT w.*,a.code AS asset_code,a.name AS asset_name,e.full_name AS assigned_name,
              d.name AS department,p.title AS position,b.starts_at,b.ends_at,
              COALESCE(start_state.to_status,CASE WHEN w.created_at<b.starts_at AND w.updated_at<b.starts_at THEN w.status ELSE 'unknown' END) AS start_status,
              COALESCE(end_state.to_status,CASE WHEN w.updated_at<b.ends_at THEN w.status ELSE 'unknown' END) AS end_status,
              completed.completed_at,cancelled.cancelled_at
         FROM work_orders w CROSS JOIN boundaries b
         LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id
         LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
         LEFT JOIN employees e ON e.organization_id=u.organization_id AND e.id=u.employee_id
         LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
         LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
         LEFT JOIN LATERAL (SELECT event.to_status FROM work_order_events event
           WHERE event.organization_id=w.organization_id AND event.work_order_id=w.id
             AND event.event_type IN ('created','status_changed') AND event.to_status IS NOT NULL AND event.created_at<b.starts_at
           ORDER BY event.created_at DESC,event.id DESC LIMIT 1) start_state ON true
         LEFT JOIN LATERAL (SELECT event.to_status FROM work_order_events event
           WHERE event.organization_id=w.organization_id AND event.work_order_id=w.id
             AND event.event_type IN ('created','status_changed') AND event.to_status IS NOT NULL AND event.created_at<b.ends_at
           ORDER BY event.created_at DESC,event.id DESC LIMIT 1) end_state ON true
         LEFT JOIN LATERAL (SELECT max(event.created_at) AS completed_at FROM work_order_events event
           WHERE event.organization_id=w.organization_id AND event.work_order_id=w.id
             AND event.event_type='status_changed' AND event.to_status='completed'
             AND event.created_at>=b.starts_at AND event.created_at<b.ends_at) completed ON true
         LEFT JOIN LATERAL (SELECT max(event.created_at) AS cancelled_at FROM work_order_events event
           WHERE event.organization_id=w.organization_id AND event.work_order_id=w.id
             AND event.event_type='status_changed' AND event.to_status='cancelled'
             AND event.created_at>=b.starts_at AND event.created_at<b.ends_at) cancelled ON true
        WHERE w.organization_id=$1 AND w.created_at<b.ends_at
     ) SELECT * FROM report_rows
       WHERE (created_at<starts_at AND start_status NOT IN ('completed','cancelled','unknown'))
          OR (created_at>=starts_at AND created_at<ends_at)
          OR completed_at IS NOT NULL OR cancelled_at IS NOT NULL
       ORDER BY created_at DESC,id`,
    [req.user.organization_id, range.from, range.to, organization.timezone]
  );
  const rows = result.rows.map(item => [
    item.id,item.title,item.category,item.priority,item.asset_code,item.asset_name,item.assigned_name,item.department,item.position,
    item.start_status,item.end_status,item.status,
    item.created_at < item.starts_at && !["completed","cancelled","unknown"].includes(item.start_status) ? "1" : "0",
    item.created_at >= item.starts_at && item.created_at < item.ends_at ? "1" : "0",
    item.completed_at ? "1" : "0",item.cancelled_at ? "1" : "0",
    !["completed","cancelled","unknown"].includes(item.end_status) ? "1" : "0",
    item.due_at && item.due_at < item.ends_at && !["completed","cancelled","unknown"].includes(item.end_status) ? "1" : "0",
    item.due_at ? new Date(item.due_at).toISOString() : "",new Date(item.created_at).toISOString(),
    item.completed_at ? new Date(item.completed_at).toISOString() : "",item.cancelled_at ? new Date(item.cancelled_at).toISOString() : "",
  ]);
  const csv = toCsv([
    "Ажлын ID","Ажлын нэр","Ангилал","Яаралтай эсэх","Хөрөнгийн код","Хөрөнгийн нэр","Одоогийн хариуцагч",
    "Хэлтэс","Албан тушаал","Эхний төлөв","Эцсийн төлөв","Одоогийн төлөв","Эхний үлдэгдэл","Хугацаанд үүссэн",
    "Хугацаанд дууссан","Хугацаанд цуцалсан","Эцсийн үлдэгдэл","Эцэст хугацаа хэтэрсэн","Дуусах хугацаа",
    "Үүсгэсэн огноо","Хугацаанд дууссан огноо","Хугацаанд цуцалсан огноо",
  ], rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="work-orders-${range.from}-${range.to}.csv"`);
  res.send(csv);
}));

module.exports = router;
