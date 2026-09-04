"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { z } = require("zod");
const { withTenantTransaction } = require("../db");
const { authenticate } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const frequency = z.enum(["daily", "weekly", "monthly", "quarterly", "semiannual", "annual", "one_time"]);
const scheduleInput = z.object({
  name: z.string().trim().min(2).max(240),
  frequency,
  nextDue: z.iso.date(),
  responsibleUserId: uuid.nullish().transform(value => value || null),
  responsibleLabel: z.string().trim().max(160).default(""),
  recipient: z.string().trim().max(240).default(""),
  warnDays: z.coerce.number().int().min(0).max(365).default(7),
  note: z.string().trim().max(2000).default(""),
});
const updateInput = scheduleInput.extend({ expectedVersion: z.coerce.number().int().positive() });
const submitInput = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  idempotencyKey: uuid,
  submittedOn: z.iso.date().optional(),
});
const retireInput = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});

class ReportScheduleError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ReportScheduleError";
    this.code = code;
    this.status = status;
  }
}

function requirePermission(req, code) {
  if (!(req.user.permissions || []).includes(code)) throw new ReportScheduleError("REPORT_SCHEDULE_PERMISSION_REQUIRED", 403);
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isoDateValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

function addMonthsClamped(iso, months, anchorDay) {
  const [year, month, day] = iso.split("-").map(Number);
  const targetFirst = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  targetFirst.setUTCDate(Math.min(anchorDay || day, lastDay));
  return targetFirst.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nextOccurrence(dueOn, recurrence, anchorDay) {
  dueOn = isoDateValue(dueOn);
  if (recurrence === "daily") return addDays(dueOn, 1);
  if (recurrence === "weekly") return addDays(dueOn, 7);
  if (recurrence === "monthly") return addMonthsClamped(dueOn, 1, anchorDay);
  if (recurrence === "quarterly") return addMonthsClamped(dueOn, 3, anchorDay);
  if (recurrence === "semiannual") return addMonthsClamped(dueOn, 6, anchorDay);
  if (recurrence === "annual") return addMonthsClamped(dueOn, 12, anchorDay);
  return dueOn;
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    frequency: row.frequency,
    nextDue: isoDateValue(row.next_due),
    responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_name || "",
    responsibleLabel: row.responsible_label,
    recipient: row.recipient,
    warnDays: row.warn_days,
    note: row.note,
    active: row.active,
    version: Number(row.version),
    lastSubmittedOn: row.last_submitted_on ? isoDateValue(row.last_submitted_on) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    retiredAt: row.retired_at,
  };
}

async function assertResponsible(client, organizationId, responsibleUserId) {
  if (!responsibleUserId) return;
  const user = await client.query(
    "SELECT id FROM users WHERE organization_id=$1 AND id=$2 AND active=true",
    [organizationId, responsibleUserId]
  );
  if (!user.rowCount) throw new ReportScheduleError("REPORT_SCHEDULE_RESPONSIBLE_NOT_FOUND", 400);
}

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.read");
  const includeInactive = req.query.includeInactive === "true";
  const response = await withTenantTransaction(req.user.organization_id, async client => {
    const rows = await client.query(
      `SELECT schedule.*,responsible.full_name AS responsible_name
         FROM report_schedules schedule
         LEFT JOIN users responsible
           ON responsible.organization_id=schedule.organization_id
          AND responsible.id=schedule.responsible_user_id
        WHERE schedule.organization_id=$1 AND ($2::boolean OR schedule.active=true)
        ORDER BY schedule.active DESC,schedule.next_due,schedule.name,schedule.id`,
      [req.user.organization_id, includeInactive]
    );
    const organization = await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date AS today,timezone
         FROM organizations WHERE id=$1`,
      [req.user.organization_id]
    );
    return {
      items: rows.rows.map(serialize),
      today: isoDateValue(organization.rows[0].today),
      timeZone: organization.rows[0].timezone,
    };
  });
  res.json({
    ...response,
    capabilities: {
      canManage: (req.user.permissions || []).includes("report-schedules.manage"),
      canSubmit: (req.user.permissions || []).includes("report-schedules.submit"),
    },
  });
}));

router.get("/:id/events", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.read");
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw new ReportScheduleError("REPORT_SCHEDULE_ID_INVALID", 400);
  const items = await withTenantTransaction(req.user.organization_id, async client => {
    const exists = await client.query(
      "SELECT 1 FROM report_schedules WHERE organization_id=$1 AND id=$2",
      [req.user.organization_id, id.data]
    );
    if (!exists.rowCount) throw new ReportScheduleError("REPORT_SCHEDULE_NOT_FOUND", 404);
    return (await client.query(
      `SELECT event.id,event.event_type,event.from_version,event.to_version,event.due_on,
              event.submitted_on,event.next_due,event.detail,event.request_id,event.created_at,
              actor.full_name AS actor_name
         FROM report_schedule_events event
         JOIN users actor ON actor.organization_id=event.organization_id AND actor.id=event.actor_user_id
        WHERE event.organization_id=$1 AND event.report_schedule_id=$2
        ORDER BY event.created_at DESC,event.id DESC LIMIT 200`,
      [req.user.organization_id, id.data]
    )).rows;
  });
  res.json({ items });
}));

router.post("/", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.manage");
  const parsed = scheduleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "REPORT_SCHEDULE_INVALID", issues: parsed.error.issues });
  const value = parsed.data;
  const item = await withTenantTransaction(req.user.organization_id, async client => {
    await assertResponsible(client, req.user.organization_id, value.responsibleUserId);
    const created = (await client.query(
      `INSERT INTO report_schedules(
         organization_id,name,frequency,next_due,responsible_user_id,responsible_label,
         recipient,warn_days,note,recurrence_anchor_day,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,extract(day FROM $4::date),$10,$10) RETURNING *`,
      [req.user.organization_id, value.name, value.frequency, value.nextDue,
        value.responsibleUserId, value.responsibleLabel, value.recipient, value.warnDays,
        value.note, req.user.id]
    )).rows[0];
    await client.query(
      `INSERT INTO report_schedule_events(
         organization_id,report_schedule_id,event_type,to_version,due_on,next_due,actor_user_id,detail
       ) VALUES($1,$2,'created',1,$3,$3,$4,$5::jsonb)`,
      [req.user.organization_id, created.id, created.next_due, req.user.id, JSON.stringify({
        name: created.name, frequency: created.frequency, responsibleUserId: created.responsible_user_id,
        responsibleLabel: created.responsible_label, recipient: created.recipient,
        warnDays: created.warn_days, note: created.note,
      })]
    );
    await writeAudit(req, "report_schedule.create", "report_schedule", created.id,
      { name: created.name, frequency: created.frequency, nextDue: created.next_due }, client);
    return created;
  });
  res.status(201).json({ item: serialize(item) });
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.manage");
  const id = uuid.safeParse(req.params.id);
  const parsed = updateInput.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "REPORT_SCHEDULE_INVALID" });
  const value = parsed.data;
  const item = await withTenantTransaction(req.user.organization_id, async client => {
    await assertResponsible(client, req.user.organization_id, value.responsibleUserId);
    const current = (await client.query(
      "SELECT * FROM report_schedules WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [req.user.organization_id, id.data]
    )).rows[0];
    if (!current) throw new ReportScheduleError("REPORT_SCHEDULE_NOT_FOUND", 404);
    if (!current.active) throw new ReportScheduleError("REPORT_SCHEDULE_RETIRED", 409);
    if (Number(current.version) !== value.expectedVersion) throw new ReportScheduleError("REPORT_SCHEDULE_VERSION_CONFLICT", 409);
    const updated = (await client.query(
      `UPDATE report_schedules SET name=$3,frequency=$4,next_due=$5,
              recurrence_anchor_day=extract(day FROM $5::date),responsible_user_id=$6,
              responsible_label=$7,recipient=$8,warn_days=$9,note=$10,version=version+1,
              updated_by=$11,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND version=$12 RETURNING *`,
      [req.user.organization_id, id.data, value.name, value.frequency, value.nextDue,
        value.responsibleUserId, value.responsibleLabel, value.recipient, value.warnDays,
        value.note, req.user.id, value.expectedVersion]
    )).rows[0];
    await client.query(
      `INSERT INTO report_schedule_events(
         organization_id,report_schedule_id,event_type,from_version,to_version,due_on,next_due,actor_user_id,detail
       ) VALUES($1,$2,'updated',$3,$4,$5,$5,$6,$7::jsonb)`,
      [req.user.organization_id, id.data, value.expectedVersion, updated.version,
        updated.next_due, req.user.id, JSON.stringify({
          name: updated.name, frequency: updated.frequency,
          responsibleUserId: updated.responsible_user_id,
          responsibleLabel: updated.responsible_label, recipient: updated.recipient,
          warnDays: updated.warn_days, note: updated.note,
        })]
    );
    await writeAudit(req, "report_schedule.update", "report_schedule", id.data,
      { fromVersion: value.expectedVersion, toVersion: Number(updated.version) }, client);
    return updated;
  });
  res.json({ item: serialize(item) });
}));

router.post("/:id/submissions", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.submit");
  const id = uuid.safeParse(req.params.id);
  const parsed = submitInput.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "REPORT_SCHEDULE_SUBMISSION_INVALID" });
  const value = parsed.data;
  const payload = { scheduleId: id.data, expectedVersion: value.expectedVersion, submittedOn: value.submittedOn || null };
  const payloadSha256 = canonicalHash(payload);
  const result = await withTenantTransaction(req.user.organization_id, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${req.user.organization_id}:report-schedule-submit:${value.idempotencyKey}`,
    ]);
    const receipt = (await client.query(
      `SELECT report_schedule_id,actor_user_id,payload_sha256,result
         FROM report_schedule_command_receipts
        WHERE organization_id=$1 AND command_type='submit' AND idempotency_key=$2`,
      [req.user.organization_id, value.idempotencyKey]
    )).rows[0];
    if (receipt) {
      if (receipt.report_schedule_id !== id.data || receipt.actor_user_id !== req.user.id ||
          String(receipt.payload_sha256).trim() !== payloadSha256) {
        throw new ReportScheduleError("REPORT_SCHEDULE_IDEMPOTENCY_CONFLICT", 409);
      }
      return { ...receipt.result, replayed: true };
    }
    const organization = (await client.query(
      `SELECT (now() AT TIME ZONE timezone)::date AS today FROM organizations WHERE id=$1`,
      [req.user.organization_id]
    )).rows[0];
    const tenantToday = isoDateValue(organization.today);
    const submittedOn = value.submittedOn || tenantToday;
    if (submittedOn > tenantToday) throw new ReportScheduleError("REPORT_SCHEDULE_FUTURE_SUBMISSION", 400);
    const current = (await client.query(
      "SELECT * FROM report_schedules WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [req.user.organization_id, id.data]
    )).rows[0];
    if (!current) throw new ReportScheduleError("REPORT_SCHEDULE_NOT_FOUND", 404);
    if (!current.active) throw new ReportScheduleError("REPORT_SCHEDULE_RETIRED", 409);
    if (Number(current.version) !== value.expectedVersion) throw new ReportScheduleError("REPORT_SCHEDULE_VERSION_CONFLICT", 409);
    const nextDue = nextOccurrence(current.next_due, current.frequency, current.recurrence_anchor_day);
    const remainsActive = current.frequency !== "one_time";
    const updated = (await client.query(
      `UPDATE report_schedules SET next_due=$3,last_submitted_on=$4,active=$5::boolean,
              version=version+1,updated_by=$6::uuid,updated_at=now(),
              retired_at=CASE WHEN $5::boolean THEN NULL ELSE now() END,
              retired_by=CASE WHEN $5::boolean THEN NULL ELSE $6::uuid END
        WHERE organization_id=$1 AND id=$2 AND version=$7 RETURNING *`,
      [req.user.organization_id, id.data, nextDue, submittedOn, remainsActive,
        req.user.id, value.expectedVersion]
    )).rows[0];
    const commandResult = {
      item: serialize(updated), dueOn: isoDateValue(current.next_due), submittedOn,
      nextDue: remainsActive ? nextDue : null, replayed: false,
    };
    await client.query(
      `INSERT INTO report_schedule_events(
         organization_id,report_schedule_id,event_type,from_version,to_version,due_on,
         submitted_on,next_due,actor_user_id,detail,request_id
       ) VALUES($1,$2,'submitted',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [req.user.organization_id, id.data, value.expectedVersion, updated.version,
        current.next_due, submittedOn, remainsActive ? nextDue : null, req.user.id,
        JSON.stringify({ frequency: current.frequency, deactivated: !remainsActive }), value.idempotencyKey]
    );
    await writeAudit(req, "report_schedule.submit", "report_schedule", id.data,
      { requestId: value.idempotencyKey, dueOn: isoDateValue(current.next_due), submittedOn,
        nextDue: remainsActive ? nextDue : null, fromVersion: value.expectedVersion,
        toVersion: Number(updated.version) }, client);
    await client.query(
      `INSERT INTO report_schedule_command_receipts(
         organization_id,report_schedule_id,command_type,idempotency_key,payload_sha256,actor_user_id,result
       ) VALUES($1,$2,'submit',$3,$4,$5,$6::jsonb)`,
      [req.user.organization_id, id.data, value.idempotencyKey, payloadSha256,
        req.user.id, JSON.stringify(commandResult)]
    );
    return commandResult;
  });
  res.status(result.replayed ? 200 : 201).json(result);
}));

router.post("/:id/retire", asyncHandler(async (req, res) => {
  requirePermission(req, "report-schedules.manage");
  const id = uuid.safeParse(req.params.id);
  const parsed = retireInput.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "REPORT_SCHEDULE_RETIRE_INVALID" });
  const value = parsed.data;
  const item = await withTenantTransaction(req.user.organization_id, async client => {
    const current = (await client.query(
      "SELECT * FROM report_schedules WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [req.user.organization_id, id.data]
    )).rows[0];
    if (!current) throw new ReportScheduleError("REPORT_SCHEDULE_NOT_FOUND", 404);
    if (!current.active) throw new ReportScheduleError("REPORT_SCHEDULE_RETIRED", 409);
    if (Number(current.version) !== value.expectedVersion) throw new ReportScheduleError("REPORT_SCHEDULE_VERSION_CONFLICT", 409);
    const updated = (await client.query(
      `UPDATE report_schedules SET active=false,version=version+1,updated_by=$3,updated_at=now(),
              retired_at=now(),retired_by=$3
        WHERE organization_id=$1 AND id=$2 AND version=$4 RETURNING *`,
      [req.user.organization_id, id.data, req.user.id, value.expectedVersion]
    )).rows[0];
    await client.query(
      `INSERT INTO report_schedule_events(
         organization_id,report_schedule_id,event_type,from_version,to_version,due_on,next_due,actor_user_id,detail
       ) VALUES($1,$2,'retired',$3,$4,$5,NULL,$6,$7::jsonb)`,
      [req.user.organization_id, id.data, value.expectedVersion, updated.version,
        current.next_due, req.user.id, JSON.stringify({ reason: value.reason })]
    );
    await writeAudit(req, "report_schedule.retire", "report_schedule", id.data,
      { reason: value.reason, fromVersion: value.expectedVersion, toVersion: Number(updated.version) }, client);
    return updated;
  });
  res.json({ item: serialize(item) });
}));

module.exports = router;
module.exports._nextOccurrence = nextOccurrence;
module.exports._addMonthsClamped = addMonthsClamped;
