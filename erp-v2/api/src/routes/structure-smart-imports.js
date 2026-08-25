"use strict";

const express = require("express");
const multer = require("multer");
const { z } = require("zod");
const { getPool } = require("../db");
const { loadConfig } = require("../config");
const { authenticate, requireModule, requirePermissions, requireSystemRoles } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");
const { writeAudit } = require("../services/audit");
const { parseImportFile, fileHash } = require("../services/smart-import");
const { STRUCTURE_FIELDS, structureMapping, validateStructureRows, structureSummary } = require("../services/structure-import");
const { suggestStructureMapping } = require("../services/openai-structure-import");

const router = express.Router();
const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:10*1024*1024, files:1} });
const uuid = z.string().uuid();
const IMPORT_TYPE = "organization_structure";
router.use(authenticate, requireModule("structure"), requireSystemRoles("owner"), requirePermissions("structure.import.manage"));

const key = value => String(value || "").trim().toLocaleLowerCase("mn-MN");
const REVIEW_DECISIONS = new Set(["accepted", "corrected", "excluded"]);
const safeReviewReason = value => String(value || "").trim().slice(0, 500);

async function importContext(client, organizationId) {
  const [units, positions, jobs] = await Promise.all([
    client.query(`SELECT d.id,d.code,d.name,d.parent_id,d.unit_type_code,p.code parent_code,p.name parent_name
                    FROM departments d LEFT JOIN departments p ON p.organization_id=d.organization_id AND p.id=d.parent_id
                   WHERE d.organization_id=$1 AND d.active=true`, [organizationId]),
    client.query(`SELECT p.id,p.code,p.title,p.department_id,p.rank_level,p.headcount_limit,d.code department_code,d.name department_name
                    FROM positions p LEFT JOIN departments d ON d.organization_id=p.organization_id AND d.id=p.department_id
                   WHERE p.organization_id=$1 AND p.active=true`, [organizationId]),
    client.query("SELECT id,code,name FROM jobs WHERE organization_id=$1 AND active=true", [organizationId]),
  ]);
  return { units:units.rows, positions:positions.rows, jobs:jobs.rows };
}

function mergeMapping(headers, base, ai) {
  const result = {...base}, used = new Set(Object.values(result));
  for (const item of ai?.mappings || []) {
    if (headers.includes(item.sourceColumn) && !result[item.sourceColumn] && !used.has(item.targetField)) {
      result[item.sourceColumn] = item.targetField;
      used.add(item.targetField);
    }
  }
  return result;
}

function confidenceFor(headers, base, ai) {
  const bySource = new Map((ai?.mappings || []).map(item => [item.sourceColumn, item]));
  return Object.fromEntries(headers.map(source => [source, bySource.has(source)
    ? {score:bySource.get(source).confidence, reason:bySource.get(source).reason, method:"ai"}
    : base[source] ? {score:1, reason:"Стандарт баганын нэрээр танив", method:"rule"}
      : {score:0, reason:"Тохиргоо шаардлагатай", method:"unmapped"}]));
}

async function persistRows(client, organizationId, jobId, rows) {
  const payload = rows.map(row => ({row_number:row.rowNumber, source_data:row.sourceData, normalized_data:row.normalizedData, validation:row.validation, status:row.status, proposed_action:row.proposedAction, validation_state:row.validationState}));
  await client.query(`INSERT INTO smart_import_rows(organization_id,job_id,row_number,source_data,normalized_data,validation,status,proposed_action,validation_state)
    SELECT $1,$2,x.row_number,x.source_data,x.normalized_data,x.validation,x.status,x.proposed_action,x.validation_state
      FROM jsonb_to_recordset($3::jsonb) AS x(row_number integer,source_data jsonb,normalized_data jsonb,validation jsonb,status text,proposed_action text,validation_state text)`, [organizationId, jobId, JSON.stringify(payload)]);
}

async function updateRows(client, organizationId, jobId, rows) {
  const payload = rows.map(row => ({row_number:row.rowNumber, normalized_data:row.normalizedData, validation:row.validation, status:row.status, proposed_action:row.proposedAction, validation_state:row.validationState}));
  await client.query(`UPDATE smart_import_rows r
                         SET normalized_data=x.normalized_data,validation=x.validation,status=x.status,
                             proposed_action=x.proposed_action,validation_state=x.validation_state,
                             review_decision='pending',reviewed_data='{}'::jsonb,review_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,
                             commit_outcome='not_applied',updated_at=now()
                        FROM jsonb_to_recordset($3::jsonb) AS x(row_number integer,normalized_data jsonb,validation jsonb,status text,proposed_action text,validation_state text)
                       WHERE r.organization_id=$1 AND r.job_id=$2 AND r.row_number=x.row_number`, [organizationId, jobId, JSON.stringify(payload)]);
}

function sourceWithReview(row, mapping) {
  const sourceData = {...(row.source_data || {})};
  const reviewedData = row.reviewed_data || {};
  for (const target of STRUCTURE_FIELDS) if (Object.prototype.hasOwnProperty.call(reviewedData, target)) sourceData[`__overva_review_${target}`] = reviewedData[target];
  return sourceData;
}

function mappingWithReview(mapping) {
  return {...(mapping || {}), ...Object.fromEntries(STRUCTURE_FIELDS.map(field => [`__overva_review_${field}`, field]))};
}

function summaryWithExcluded(rows, context, excluded) {
  const summary = structureSummary(rows, context);
  return {...summary, total:summary.total + excluded, excluded};
}

async function event(client, organizationId, jobId, userId, action, fromStatus, toStatus, detail={}) {
  await client.query("INSERT INTO smart_import_events(organization_id,job_id,actor_user_id,action,from_status,to_status,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)", [organizationId, jobId, userId, action, fromStatus, toStatus, JSON.stringify(detail)]);
}

async function getJob(organizationId, id) {
  const [job, rows, events] = await Promise.all([
    getPool().query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3", [organizationId, id, IMPORT_TYPE]),
    getPool().query(`SELECT r.row_number,r.normalized_data,r.validation,r.status,r.proposed_action,r.validation_state,
                            r.review_decision,r.reviewed_data,r.review_reason,r.reviewed_at,r.commit_outcome
                       FROM smart_import_rows r JOIN smart_import_jobs j ON j.organization_id=r.organization_id AND j.id=r.job_id
                      WHERE r.organization_id=$1 AND r.job_id=$2 AND j.import_type=$3 ORDER BY r.row_number LIMIT 200`, [organizationId, id, IMPORT_TYPE]),
    getPool().query(`SELECT e.action,e.from_status,e.to_status,e.detail,e.created_at
                       FROM smart_import_events e JOIN smart_import_jobs j ON j.organization_id=e.organization_id AND j.id=e.job_id
                      WHERE e.organization_id=$1 AND e.job_id=$2 AND j.import_type=$3 ORDER BY e.id`, [organizationId, id, IMPORT_TYPE]),
  ]);
  return job.rowCount ? {...job.rows[0], rows:rows.rows, events:events.rows, preview_limited:Number(job.rows[0].summary?.total || 0) > 200} : null;
}

router.get("/", asyncHandler(async (req, res) => {
  const result = await getPool().query("SELECT id,import_type,original_filename,status,analysis_mode,summary,created_at,reviewed_at,completed_at FROM smart_import_jobs WHERE organization_id=$1 AND import_type=$2 ORDER BY created_at DESC LIMIT 30", [req.user.organization_id, IMPORT_TYPE]);
  res.json({items:result.rows});
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({error:"Invalid import ID"});
  const item = await getJob(req.user.organization_id, id.data);
  if (!item) return res.status(404).json({error:"Import not found"});
  res.json({item});
}));

router.post("/", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({error:"Excel эсвэл CSV файл сонгоно уу"});
  const filename = String(req.file.originalname || "").slice(0, 255);
  if (!/\.(xlsx|csv)$/i.test(filename)) return res.status(400).json({error:"Зөвхөн .xlsx эсвэл .csv файл оруулна уу"});
  let parsed;
  try { parsed = await parseImportFile(req.file.buffer, filename); }
  catch (error) { return res.status(400).json({error:error.message}); }
  const base = structureMapping(parsed.headers), config = loadConfig();
  let ai = null, aiWarning = null;
  try { ai = await suggestStructureMapping({config, headers:parsed.headers, rows:parsed.rows}); }
  catch (error) { aiWarning = error.code === "AI_NOT_CONFIGURED" ? "AI идэвхгүй тул стандарт дүрмээр танилаа" : `AI санал түр боломжгүй: ${error.message}`; }
  const mapping = mergeMapping(parsed.headers, base, ai), confidence = confidenceFor(parsed.headers, base, ai);
  const client = await getPool().connect(), organizationId = req.user.organization_id;
  try {
    await client.query("BEGIN");
    const context = await importContext(client, organizationId);
    const rows = validateStructureRows(parsed.rows, mapping, context);
    const summary = {...structureSummary(rows, context), truncated:parsed.truncated, aiWarnings:[...(ai?.warnings || []), ...(aiWarning ? [aiWarning] : [])]};
    const job = await client.query(`INSERT INTO smart_import_jobs(organization_id,import_type,original_filename,mime_type,size_bytes,content_sha256,status,source_columns,proposed_mapping,mapping_confidence,analysis_mode,ai_model,provider_response_id,summary,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'needs_review',$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14) RETURNING id`, [organizationId, IMPORT_TYPE, filename, req.file.mimetype || "", req.file.size, fileHash(req.file.buffer), JSON.stringify(parsed.headers), JSON.stringify(mapping), JSON.stringify(confidence), ai ? "ai_assisted" : "deterministic", ai?.model || null, ai?.providerResponseId || null, JSON.stringify(summary), req.user.id]);
    await persistRows(client, organizationId, job.rows[0].id, rows);
    await event(client, organizationId, job.rows[0].id, req.user.id, "analyzed", "analyzing", "needs_review", {summary, analysisMode:ai ? "ai_assisted" : "deterministic"});
    await writeAudit(req, "organization.structure_import_analyzed", "smart_import_job", job.rows[0].id, {filename, rowCount:rows.length, analysisMode:ai ? "ai_assisted" : "deterministic"}, client);
    await client.query("COMMIT");
    res.status(201).json({item:await getJob(organizationId, job.rows[0].id)});
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}));

router.patch("/:id/mapping", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id), mapping = req.body?.mapping;
  if (!id.success) return res.status(400).json({error:"Invalid import ID"});
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return res.status(400).json({error:"Mapping буруу байна"});
  const client = await getPool().connect(), organizationId = req.user.organization_id;
  try {
    await client.query("BEGIN");
    const job = await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE", [organizationId, id.data, IMPORT_TYPE]);
    if (!job.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({error:"Import not found"}); }
    if (job.rows[0].status !== "needs_review") { await client.query("ROLLBACK"); return res.status(409).json({error:"Зөвхөн хянаж буй импортын mapping-ийг өөрчилнө"}); }
    const cleaned = {}, used = new Set();
    for (const source of job.rows[0].source_columns) {
      const target = String(mapping[source] || "");
      if (!target) continue;
      if (!STRUCTURE_FIELDS.includes(target) || used.has(target)) { await client.query("ROLLBACK"); return res.status(400).json({error:"Mapping-д зөвшөөрөгдөөгүй эсвэл давхардсан талбар байна"}); }
      cleaned[source] = target; used.add(target);
    }
    if (!used.has("unitName")) { await client.query("ROLLBACK"); return res.status(400).json({error:"Нэгжийн нэрийн баганыг заавал холбоно"}); }
    const staged = await client.query("SELECT row_number,source_data FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2 ORDER BY row_number", [organizationId, id.data]);
    const context = await importContext(client, organizationId);
    const rows = validateStructureRows(staged.rows.map(row => ({rowNumber:row.row_number, sourceData:row.source_data})), cleaned, context);
    const summary = {...structureSummary(rows, context), aiWarnings:job.rows[0].summary?.aiWarnings || []};
    await updateRows(client, organizationId, id.data, rows);
    await client.query("UPDATE smart_import_jobs SET proposed_mapping=$3::jsonb,summary=$4::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, id.data, JSON.stringify(cleaned), JSON.stringify(summary)]);
    await event(client, organizationId, id.data, req.user.id, "mapping_updated", "needs_review", "needs_review", {summary});
    await writeAudit(req, "organization.structure_import_mapping_update", "smart_import_job", id.data, {summary}, client);
    await client.query("COMMIT");
    res.json({item:await getJob(organizationId, id.data)});
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}));

router.patch("/:id/rows/:rowNumber", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  const rowNumber = Number(req.params.rowNumber);
  const decision = String(req.body?.decision || "");
  const reason = safeReviewReason(req.body?.reason);
  const changes = req.body?.changes == null ? {} : req.body.changes;
  if (!id.success || !Number.isInteger(rowNumber) || rowNumber < 1) return res.status(400).json({error:"Invalid import row"});
  if (!REVIEW_DECISIONS.has(decision)) return res.status(400).json({error:"Invalid review decision"});
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return res.status(400).json({error:"Invalid reviewed fields"});
  if (decision === "excluded" && !reason) return res.status(400).json({error:"Exclusion reason is required"});
  if (decision === "accepted" && Object.keys(changes).length) return res.status(400).json({error:"Accepted rows cannot contain corrections"});
  const reviewedData = {};
  for (const [field, value] of Object.entries(changes)) {
    if (!STRUCTURE_FIELDS.includes(field)) return res.status(400).json({error:`Field is not reviewable: ${field}`});
    reviewedData[field] = typeof value === "string" ? value.trim().slice(0, 500) : value;
  }
  if (decision === "corrected" && !Object.keys(reviewedData).length) return res.status(400).json({error:"Corrected rows require at least one changed field"});

  const client = await getPool().connect(), organizationId = req.user.organization_id;
  try {
    await client.query("BEGIN");
    const job = await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE", [organizationId, id.data, IMPORT_TYPE]);
    if (!job.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({error:"Import not found"}); }
    if (job.rows[0].status !== "needs_review") { await client.query("ROLLBACK"); return res.status(409).json({error:"Only imports awaiting review can be changed"}); }
    const target = await client.query("SELECT review_decision FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2 AND row_number=$3 FOR UPDATE", [organizationId, id.data, rowNumber]);
    if (!target.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({error:"Import row not found"}); }
    if (decision === "accepted" && target.rows[0].review_decision === "corrected") { await client.query("ROLLBACK"); return res.status(409).json({error:"Corrected rows must keep their corrected review decision"}); }
    await client.query(`UPDATE smart_import_rows
                           SET reviewed_data=$4::jsonb,review_reason=$5,reviewed_by=$6,reviewed_at=now(),review_decision=$7,updated_at=now()
                         WHERE organization_id=$1 AND job_id=$2 AND row_number=$3`, [organizationId, id.data, rowNumber, JSON.stringify(decision === "excluded" ? {} : reviewedData), reason || null, req.user.id, decision]);

    const staged = await client.query("SELECT row_number,source_data,reviewed_data,review_decision FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2 ORDER BY row_number FOR UPDATE", [organizationId, id.data]);
    const active = staged.rows.filter(row => row.review_decision !== "excluded");
    const context = await importContext(client, organizationId);
    const rows = validateStructureRows(active.map(row => ({rowNumber:row.row_number, sourceData:sourceWithReview(row, job.rows[0].proposed_mapping)})), mappingWithReview(job.rows[0].proposed_mapping), context);
    const byRow = new Map(rows.map(row => [row.rowNumber, row]));
    for (const row of active) {
      const checked = byRow.get(row.row_number);
      let nextDecision = row.review_decision;
      if (row.row_number === rowNumber && decision === "corrected") nextDecision = checked.validationState === "error" ? "pending" : "corrected";
      if (row.row_number === rowNumber && decision === "accepted") nextDecision = checked.validationState === "error" ? "pending" : "accepted";
      if (checked.validationState === "error") nextDecision = "pending";
      await client.query(`UPDATE smart_import_rows
                             SET normalized_data=$4::jsonb,validation=$5::jsonb,status=$6,proposed_action=$7,validation_state=$8,
                                 review_decision=$9,reviewed_by=CASE WHEN $9='pending' THEN NULL ELSE reviewed_by END,
                                 reviewed_at=CASE WHEN $9='pending' THEN NULL ELSE reviewed_at END,updated_at=now()
                           WHERE organization_id=$1 AND job_id=$2 AND row_number=$3`, [organizationId, id.data, row.row_number, JSON.stringify(checked.normalizedData), JSON.stringify(checked.validation), checked.status, checked.proposedAction, checked.validationState, nextDecision]);
    }
    const excluded = staged.rows.filter(row => row.review_decision === "excluded").length;
    const summary = {...summaryWithExcluded(rows, context, excluded), aiWarnings:job.rows[0].summary?.aiWarnings || []};
    await client.query("UPDATE smart_import_jobs SET summary=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, id.data, JSON.stringify(summary)]);
    await event(client, organizationId, id.data, req.user.id, "row_reviewed", "needs_review", "needs_review", {rowNumber, decision, changedFields:Object.keys(reviewedData), validationState:byRow.get(rowNumber)?.validationState || "excluded"});
    await writeAudit(req, "organization.structure_import_row_reviewed", "smart_import_job", id.data, {rowNumber, decision, changedFields:Object.keys(reviewedData), reason:reason || null}, client);
    await client.query("COMMIT");
    res.json({item:await getJob(organizationId, id.data)});
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}));

router.post("/:id/approve", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({error:"Invalid import ID"});
  const client = await getPool().connect(), organizationId = req.user.organization_id;
  try {
    await client.query("BEGIN");
    const job = await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE", [organizationId, id.data, IMPORT_TYPE]);
    const blockers = await client.query(`SELECT
      count(*) FILTER(WHERE review_decision<>'excluded' AND validation_state='error')::int errors,
      count(*) FILTER(WHERE review_decision='pending' AND validation_state='warning' AND proposed_action<>'skip')::int pending_warnings
      FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2`, [organizationId, id.data]);
    if (!job.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({error:"Import not found"}); }
    if (job.rows[0].status !== "needs_review") { await client.query("ROLLBACK"); return res.status(409).json({error:"Импорт батлах төлөвт биш байна"}); }
    if (Number(job.rows[0].summary?.errors || 0) > 0) { await client.query("ROLLBACK"); return res.status(409).json({error:"Алдаатай мөрүүдийг засахгүйгээр батлах боломжгүй"}); }
    if (blockers.rows[0].errors > 0) { await client.query("ROLLBACK"); return res.status(409).json({error:"Rows with validation errors must be corrected or excluded"}); }
    if (blockers.rows[0].pending_warnings > 0) { await client.query("ROLLBACK"); return res.status(409).json({error:"Warnings that can create records require explicit review"}); }
    await client.query(`UPDATE smart_import_rows
                           SET review_decision='accepted',reviewed_by=$3,reviewed_at=now(),updated_at=now()
                         WHERE organization_id=$1 AND job_id=$2 AND review_decision='pending' AND validation_state<>'error'`, [organizationId, id.data, req.user.id]);
    await client.query("UPDATE smart_import_jobs SET status='approved',approved_by=$3,reviewed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, id.data, req.user.id]);
    await event(client, organizationId, id.data, req.user.id, "approved", "needs_review", "approved", {rowCount:job.rows[0].summary?.total || 0});
    await writeAudit(req, "organization.structure_import_approved", "smart_import_job", id.data, {rowCount:job.rows[0].summary?.total || 0}, client);
    await client.query("COMMIT");
    res.json({item:await getJob(organizationId, id.data)});
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}));

router.post("/:id/commit", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({error:"Invalid import ID"});
  const client = await getPool().connect(), organizationId = req.user.organization_id;
  try {
    await client.query("BEGIN");
    const job = await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3 FOR UPDATE", [organizationId, id.data, IMPORT_TYPE]);
    if (!job.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({error:"Import not found"}); }
    if (job.rows[0].status !== "approved") { await client.query("ROLLBACK"); return res.status(409).json({error:"Зөвхөн баталсан импортыг үндсэн санд оруулна"}); }
    await client.query("UPDATE smart_import_jobs SET status='importing',updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, id.data]);
    await event(client, organizationId, id.data, req.user.id, "commit_started", "approved", "importing");
    const staged = await client.query(`SELECT id,row_number,normalized_data,proposed_action,review_decision
      FROM smart_import_rows
      WHERE organization_id=$1 AND job_id=$2
        AND review_decision IN('accepted','corrected')
        AND proposed_action='create'
        AND validation_state<>'error'
      ORDER BY row_number FOR UPDATE`, [organizationId, id.data]);

    await client.query(`UPDATE smart_import_rows
                           SET status='imported',commit_outcome='rejected',source_data='{}'::jsonb,updated_at=now()
                         WHERE organization_id=$1 AND job_id=$2 AND review_decision='excluded'`, [organizationId, id.data]);
    await client.query(`UPDATE smart_import_rows
                           SET status='imported',commit_outcome='skipped',source_data='{}'::jsonb,updated_at=now()
                         WHERE organization_id=$1 AND job_id=$2
                           AND review_decision IN('accepted','corrected') AND proposed_action='skip'`, [organizationId, id.data]);

    const context = await importContext(client, organizationId), unitByCode = new Map(), unitByName = new Map();
    for (const unit of context.units) { unitByCode.set(key(unit.code), unit); unitByName.set(key(unit.name), unit); }
    const proposed = new Map();
    for (const row of staged.rows) proposed.set(key(row.normalized_data.unitCode), row.normalized_data);
    const createdUnitCodes = new Set(), createdPositionCodes = new Set();
    let departmentsCreated = 0, departmentsSkipped = 0, positionsCreated = 0, positionsSkipped = 0, jobsCreated = 0, progress = true;
    while (proposed.size && progress) {
      progress = false;
      for (const [code, value] of [...proposed.entries()]) {
        if (unitByCode.has(code)) { proposed.delete(code); departmentsSkipped += 1; progress = true; continue; }
        const parent = value.parentUnit ? (unitByCode.get(key(value.parentUnit)) || unitByName.get(key(value.parentUnit))) : null;
        if (value.parentUnit && !parent) continue;
        const created = await client.query("INSERT INTO departments(organization_id,parent_id,code,name,unit_type_code,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,code,name,parent_id,unit_type_code", [organizationId, parent?.id || null, value.unitCode, value.unitName, value.unitType, JSON.stringify({source:"structure_smart_import", importJobId:id.data})]);
        const unit = created.rows[0]; unitByCode.set(key(unit.code), unit); unitByName.set(key(unit.name), unit);
        createdUnitCodes.add(key(unit.code));
        proposed.delete(code); departmentsCreated += 1; progress = true;
      }
    }
    if (proposed.size) throw Object.assign(new Error("Дээд нэгжийн хамаарлыг бүрэн шийдвэрлэж чадсангүй"), {code:"IMPORT_STRUCTURE_PARENT_UNRESOLVED"});

    const positionByCode = new Map(context.positions.map(position => [key(position.code), position]));
    const jobByCode = new Map(context.jobs.map(item => [key(item.code), item]));
    for (const row of staged.rows) {
      const value = row.normalized_data;
      if (value.positionTitle && !positionByCode.has(key(value.positionCode))) {
        const unit = unitByCode.get(key(value.unitCode)) || unitByName.get(key(value.unitName));
        let job = jobByCode.get(key(value.positionCode));
        if (!job) {
          const created = await client.query("INSERT INTO jobs(organization_id,code,name,metadata) VALUES($1,$2,$3,$4::jsonb) RETURNING id,code,name", [organizationId, value.positionCode, value.positionTitle, JSON.stringify({source:"structure_smart_import", importJobId:id.data})]);
          job = created.rows[0]; jobByCode.set(key(job.code), job); jobsCreated += 1;
        }
        const created = await client.query("INSERT INTO positions(organization_id,department_id,job_id,code,title,rank_level,headcount_limit,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id,code,title", [organizationId, unit.id, job.id, value.positionCode, value.positionTitle, value.rankLevel, value.headcountLimit, JSON.stringify({source:"structure_smart_import", importJobId:id.data})]);
        positionByCode.set(key(created.rows[0].code), created.rows[0]);
        createdPositionCodes.add(key(created.rows[0].code));
        positionsCreated += 1;
      } else if (value.positionTitle) positionsSkipped += 1;
      const created = createdUnitCodes.has(key(value.unitCode)) || (value.positionTitle && createdPositionCodes.has(key(value.positionCode)));
      await client.query("UPDATE smart_import_rows SET status='imported',commit_outcome=$4,source_data='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND job_id=$2 AND id=$3", [organizationId, id.data, row.id, created ? "created" : "skipped"]);
    }
    await client.query(`UPDATE smart_import_rows
                           SET status='imported',commit_outcome='skipped',source_data='{}'::jsonb,updated_at=now()
                         WHERE organization_id=$1 AND job_id=$2 AND status<>'imported'`, [organizationId, id.data]);
    const result = {departmentsCreated, departmentsSkipped, jobsCreated, positionsCreated, positionsSkipped, employeesCreated:0, userAccountsCreated:0, rolesChanged:0, permissionsChanged:0, modulesEnabled:0, recordsDeleted:0, stagingSourceRedacted:true};
    await client.query("UPDATE smart_import_jobs SET status='completed',completed_at=now(),updated_at=now(),summary=summary||$3::jsonb WHERE organization_id=$1 AND id=$2", [organizationId, id.data, JSON.stringify(result)]);
    await event(client, organizationId, id.data, req.user.id, "committed", "importing", "completed", result);
    await writeAudit(req, "organization.structure_import_committed", "smart_import_job", id.data, result, client);
    await client.query("COMMIT");
    res.json({item:await getJob(organizationId, id.data)});
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}));

module.exports = router;
