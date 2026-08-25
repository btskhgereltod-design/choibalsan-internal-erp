"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireSystemRoles } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { writeLifecycleEvent } = require("../services/data-lifecycle");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const assetCode = z.string().trim().regex(/^[a-z][a-z0-9-]{1,79}$/);
const text = (max = 2000) => z.string().trim().min(1).max(max);
const optionalDays = z.preprocess(
  value => value === "" || value === null || value === undefined ? null : value,
  z.coerce.number().int().positive().max(365000).nullable()
);
const dispositionAction = z.enum(["review", "archive", "anonymize", "delete"]);
const requestAction = z.enum(["archive", "anonymize", "delete"]);
const architectureControlSchema = z.object({
  authoritativeSystem: text(200),
  updatePolicy: z.enum(["overva_only", "source_only", "bidirectional", "manual_review"]),
  historyStrategy: z.enum(["audit", "event", "snapshot", "archive", "none"]),
  criticality: z.enum(["standard", "important", "critical"]),
  availabilityClass: z.enum(["standard", "high", "mission_critical"]),
  recoveryPointMinutes: optionalDays,
  recoveryTimeMinutes: optionalDays,
  archiveTier: z.enum(["standard", "warm", "cold", "offline"]),
  notes: z.string().trim().max(2000).default(""),
});
const findingType = z.enum([
  "semantic_mismatch","duplicate","missing_reference","invalid_value",
  "ambiguous_definition","relationship_gap","measurement_gap",
  "ownership_gap","lineage_gap","other",
]);
const findingSeverity = z.enum(["info","low","medium","high","critical"]);
const findingStatus = z.enum([
  "triaged","awaiting_owner","accepted_for_correction",
  "resolved","accepted_exception","rejected",
]);
const safeSourceReference = z.object({
  table: z.string().trim().max(120).optional(),
  column: z.string().trim().max(120).optional(),
  rowNumber: z.coerce.number().int().positive().optional(),
  importJobId: uuid.optional(),
  recordKeyHash: z.string().trim().max(128).optional(),
}).strict().default({});

router.use(authenticate, requireSystemRoles("owner"));

async function inTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

router.get("/", asyncHandler(async (req, res) => {
  const org = req.user.organization_id;
  const [assets, stewards, employees, holds, requests, events, findings, findingEvents] = await Promise.all([
    getPool().query(
      `SELECT c.code,c.name,c.domain,c.description,c.classification_code,
              c.contains_personal_data,c.owner_role_code,
              p.id AS policy_id,p.name AS policy_name,p.archive_after_days,
              p.retention_days,p.disposition_action,p.requires_approval,p.active AS policy_active,
              ac.authoritative_system,ac.update_policy,ac.history_strategy,ac.criticality,
              ac.availability_class,ac.recovery_point_minutes,ac.recovery_time_minutes,
              ac.archive_tier,ac.notes AS architecture_notes,
              count(q.code)::int AS quality_rule_count
         FROM data_catalog_assets c
         LEFT JOIN data_lifecycle_policies p
           ON p.organization_id=$1 AND p.asset_code=c.code
         LEFT JOIN organization_data_asset_controls ac
           ON ac.organization_id=$1 AND ac.asset_code=c.code
         LEFT JOIN data_quality_rules q ON q.asset_code=c.code AND q.active=true
        WHERE c.active=true
        GROUP BY c.code,p.id,ac.organization_id,ac.asset_code
        ORDER BY c.domain,c.name`, [org]),
    getPool().query(
      `SELECT s.domain,s.employee_id,s.assigned_at,e.full_name AS employee_name
         FROM organization_data_stewards s
         JOIN employees e ON e.organization_id=s.organization_id AND e.id=s.employee_id
        WHERE s.organization_id=$1 ORDER BY s.domain`, [org]),
    getPool().query(
      `SELECT id,full_name,employee_no FROM employees
        WHERE organization_id=$1 AND active=true ORDER BY full_name`, [org]),
    getPool().query(
      `SELECT h.*,u.full_name AS placed_by_name,r.full_name AS released_by_name
         FROM data_legal_holds h
         JOIN users u ON u.organization_id=h.organization_id AND u.id=h.placed_by
         LEFT JOIN users r ON r.organization_id=h.organization_id AND r.id=h.released_by
        WHERE h.organization_id=$1 ORDER BY (h.status='active') DESC,h.placed_at DESC LIMIT 100`, [org]),
    getPool().query(
      `SELECT d.*,u.full_name AS requested_by_name,r.full_name AS reviewed_by_name
         FROM data_disposition_requests d
         JOIN users u ON u.organization_id=d.organization_id AND u.id=d.requested_by
         LEFT JOIN users r ON r.organization_id=d.organization_id AND r.id=d.reviewed_by
        WHERE d.organization_id=$1 ORDER BY d.created_at DESC LIMIT 100`, [org]),
    getPool().query(
      `SELECT e.*,u.full_name AS actor_name FROM data_lifecycle_events e
         LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
        WHERE e.organization_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 100`, [org]),
    getPool().query(
      `SELECT f.*,p.name AS pattern_name,e.full_name AS assigned_employee_name,
              u.full_name AS created_by_name,r.full_name AS resolved_by_name
         FROM data_quality_findings f
         LEFT JOIN data_quality_patterns p ON p.code=f.pattern_code
         LEFT JOIN employees e ON e.organization_id=f.organization_id AND e.id=f.assigned_employee_id
         LEFT JOIN users u ON u.organization_id=f.organization_id AND u.id=f.created_by
         LEFT JOIN users r ON r.organization_id=f.organization_id AND r.id=f.resolved_by
        WHERE f.organization_id=$1
        ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 f.created_at DESC LIMIT 200`, [org]),
    getPool().query(
      `SELECT e.*,u.full_name AS actor_name
         FROM data_quality_finding_events e
         LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
        WHERE e.organization_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 200`, [org]),
  ]);
  const configured = assets.rows.filter(item => item.policy_id).length;
  const architectureConfigured = assets.rows.filter(item => item.authoritative_system).length;
  res.json({
    assets: assets.rows,
    stewards: stewards.rows,
    employees: employees.rows,
    holds: holds.rows,
    requests: requests.rows,
    events: events.rows,
    findings: findings.rows,
    findingEvents: findingEvents.rows,
    summary: {
      catalogAssets: assets.rowCount,
      configuredPolicies: configured,
      architectureConfigured,
      activeHolds: holds.rows.filter(item => item.status === "active").length,
      pendingRequests: requests.rows.filter(item => item.status === "pending").length,
      openFindings: findings.rows.filter(item => !["resolved","accepted_exception","rejected"].includes(item.status)).length,
      highRiskFindings: findings.rows.filter(item => ["high","critical"].includes(item.severity) && !["resolved","rejected"].includes(item.status)).length,
      resolvedFindings: findings.rows.filter(item => item.status === "resolved").length,
      learningCandidates: findings.rows.filter(item => item.learning_status === "candidate").length,
    },
  });
}));

router.post("/findings", asyncHandler(async (req, res) => {
  const parsed = z.object({
    fingerprint: z.string().trim().min(8).max(160).regex(/^[a-z0-9][a-z0-9._:-]+$/),
    sourceType: z.enum(["import","migration","runtime","user_report","audit","analysis"]).default("user_report"),
    sourceSystem: text(120).default("OVERVA"),
    assetCode: assetCode.nullable().optional(),
    entityType: z.string().trim().min(1).max(120),
    sourceReference: safeSourceReference,
    patternCode: z.string().trim().max(120).nullable().optional(),
    findingType,
    severity: findingSeverity,
    title: text(240),
    description: text(4000),
    businessImpact: z.string().trim().max(4000).default(""),
    recommendation: z.string().trim().max(4000).default(""),
    learningCandidate: z.boolean().default(false),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Өгөгдлийн асуудлын мэдээлэл буруу байна" });
  const value = parsed.data;
  const item = await inTransaction(async client => {
    const result = await client.query(
      `INSERT INTO data_quality_findings(
         organization_id,fingerprint,source_type,source_system,asset_code,entity_type,
         record_key_hash,source_reference,pattern_code,finding_type,severity,title,description,
         business_impact,recommendation,detected_by,learning_status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,'user',$16,$17)
       ON CONFLICT(organization_id,fingerprint) DO UPDATE SET
         updated_at=now(),severity=EXCLUDED.severity,business_impact=EXCLUDED.business_impact,
         recommendation=EXCLUDED.recommendation
       RETURNING *`,
      [req.user.organization_id,value.fingerprint,value.sourceType,value.sourceSystem,value.assetCode||null,
        value.entityType,value.sourceReference.recordKeyHash||null,JSON.stringify(value.sourceReference),
        value.patternCode||null,value.findingType,value.severity,value.title,value.description,
        value.businessImpact,value.recommendation,value.learningCandidate?"candidate":"not_applicable",req.user.id]
    );
    const finding = result.rows[0];
    await client.query(
      `INSERT INTO data_quality_finding_events(organization_id,finding_id,actor_user_id,event_type,to_status,detail)
       VALUES($1,$2,$3,'detected',$4,$5::jsonb)`,
      [req.user.organization_id,finding.id,req.user.id,finding.status,
        JSON.stringify({ sourceType:value.sourceType, sourceSystem:value.sourceSystem, rawValuesStored:false })]
    );
    await writeAudit(req,"data.finding.detect","data_quality_finding",finding.id,
      {findingType:value.findingType,severity:value.severity,rawValuesStored:false},client);
    return finding;
  });
  res.status(201).json({ item, canonicalMutationPerformed:false });
}));

router.post("/findings/:id/decision", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  const parsed = z.object({
    status: findingStatus,
    severity: findingSeverity.optional(),
    assignedEmployeeId: uuid.nullable().optional(),
    note: text(4000),
    learningStatus: z.enum(["not_applicable","candidate","approved","rejected"]).optional(),
  }).safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error:"Өгөгдлийн асуудлын шийдвэр буруу байна" });
  const value = parsed.data;
  const item = await inTransaction(async client => {
    const existing = await client.query(
      "SELECT * FROM data_quality_findings WHERE organization_id=$1 AND id=$2 FOR UPDATE",
      [req.user.organization_id,id.data]
    );
    if (!existing.rowCount) { const error=new Error("Өгөгдлийн асуудал олдсонгүй"); error.code="DATA_FINDING_NOT_FOUND"; throw error; }
    if (value.assignedEmployeeId) {
      const employee = await client.query(
        "SELECT id FROM employees WHERE organization_id=$1 AND id=$2 AND active=true",
        [req.user.organization_id,value.assignedEmployeeId]
      );
      if (!employee.rowCount) { const error=new Error("Идэвхтэй өгөгдөл хариуцагч олдсонгүй"); error.code="DATA_FINDING_INVALID_OWNER"; throw error; }
    }
    const terminal = ["resolved","accepted_exception","rejected"].includes(value.status);
    const result = await client.query(
      `UPDATE data_quality_findings SET status=$3,severity=COALESCE($4,severity),
         assigned_employee_id=COALESCE($5,assigned_employee_id),resolution_note=$6,
         learning_status=COALESCE($7,learning_status),resolved_by=CASE WHEN $8 THEN $9 ELSE NULL END,
         resolved_at=CASE WHEN $8 THEN now() ELSE NULL END,updated_at=now()
       WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [req.user.organization_id,id.data,value.status,value.severity||null,value.assignedEmployeeId||null,
        value.note,value.learningStatus||null,terminal,req.user.id]
    );
    const eventType = value.status==="resolved"?"resolved":value.status==="accepted_exception"?"exception_accepted":
      value.status==="accepted_for_correction"?"correction_approved":value.status==="triaged"?"triaged":"status_changed";
    await client.query(
      `INSERT INTO data_quality_finding_events(
         organization_id,finding_id,actor_user_id,event_type,from_status,to_status,detail)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [req.user.organization_id,id.data,req.user.id,eventType,existing.rows[0].status,value.status,
        JSON.stringify({note:value.note,canonicalMutationPerformed:false,learningStatus:value.learningStatus||existing.rows[0].learning_status})]
    );
    await writeAudit(req,"data.finding.decision","data_quality_finding",id.data,
      {fromStatus:existing.rows[0].status,toStatus:value.status,canonicalMutationPerformed:false},client);
    return result.rows[0];
  });
  res.json({ item, canonicalMutationPerformed:false });
}));

router.put("/architecture/:assetCode", asyncHandler(async (req, res) => {
  const code = assetCode.safeParse(req.params.assetCode);
  const parsed = architectureControlSchema.safeParse(req.body);
  if (!code.success || !parsed.success) return res.status(400).json({ error: "Өгөгдлийн архитектурын мэдээлэл буруу байна" });
  const value = parsed.data;
  if (value.criticality === "critical" && (!value.recoveryPointMinutes || !value.recoveryTimeMinutes)) {
    return res.status(400).json({ error: "Маш чухал өгөгдөлд RPO болон RTO заавал тохируулна" });
  }
  const item = await inTransaction(async client => {
    const catalog = await client.query("SELECT code FROM data_catalog_assets WHERE code=$1 AND active=true", [code.data]);
    if (!catalog.rowCount) { const error = new Error("Каталогийн өгөгдөл олдсонгүй"); error.code="GOVERNANCE_ASSET_NOT_FOUND"; throw error; }
    const existing = await client.query(
      "SELECT asset_code FROM organization_data_asset_controls WHERE organization_id=$1 AND asset_code=$2",
      [req.user.organization_id, code.data]
    );
    const result = await client.query(
      `INSERT INTO organization_data_asset_controls
        (organization_id,asset_code,authoritative_system,update_policy,history_strategy,criticality,
         availability_class,recovery_point_minutes,recovery_time_minutes,archive_tier,notes,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(organization_id,asset_code) DO UPDATE SET
         authoritative_system=EXCLUDED.authoritative_system,update_policy=EXCLUDED.update_policy,
         history_strategy=EXCLUDED.history_strategy,criticality=EXCLUDED.criticality,
         availability_class=EXCLUDED.availability_class,recovery_point_minutes=EXCLUDED.recovery_point_minutes,
         recovery_time_minutes=EXCLUDED.recovery_time_minutes,archive_tier=EXCLUDED.archive_tier,
         notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING *`,
      [req.user.organization_id,code.data,value.authoritativeSystem,value.updatePolicy,value.historyStrategy,
        value.criticality,value.availabilityClass,value.recoveryPointMinutes,value.recoveryTimeMinutes,
        value.archiveTier,value.notes,req.user.id]
    );
    await writeLifecycleEvent(req,{assetCode:code.data,
      eventType:existing.rowCount?"architecture.updated":"architecture.created",
      entityType:"data_asset_control",entityId:code.data,
      detail:{authoritativeSystem:value.authoritativeSystem,updatePolicy:value.updatePolicy,
        historyStrategy:value.historyStrategy,criticality:value.criticality,
        availabilityClass:value.availabilityClass,recoveryPointMinutes:value.recoveryPointMinutes,
        recoveryTimeMinutes:value.recoveryTimeMinutes,archiveTier:value.archiveTier}},client);
    await writeAudit(req,existing.rowCount?"data.architecture.update":"data.architecture.create",
      "data_asset_control",code.data,{criticality:value.criticality,availabilityClass:value.availabilityClass},client);
    return result.rows[0];
  });
  res.json({item});
}));

router.put("/policies/:assetCode", asyncHandler(async (req, res) => {
  const code = assetCode.safeParse(req.params.assetCode);
  const parsed = z.object({
    name: text(200),
    archiveAfterDays: optionalDays,
    retentionDays: optionalDays,
    dispositionAction,
    active: z.boolean().default(true),
  }).safeParse(req.body);
  if (!code.success || !parsed.success) return res.status(400).json({ error: "Хадгалалтын бодлогын мэдээлэл буруу байна" });
  const value = parsed.data;
  if (value.archiveAfterDays && value.retentionDays && value.archiveAfterDays > value.retentionDays) {
    return res.status(400).json({ error: "Архивлах хугацаа нийт хадгалах хугацаанаас их байж болохгүй" });
  }
  if (code.data === "audit-log" && value.dispositionAction !== "review") {
    return res.status(409).json({ error: "Өөрчлөгдөшгүй аудит журналд архивлах эсвэл устгах үйлдэл тохируулахгүй" });
  }
  const item = await inTransaction(async client => {
    const existing = await client.query(
      "SELECT id FROM data_lifecycle_policies WHERE organization_id=$1 AND asset_code=$2",
      [req.user.organization_id, code.data]
    );
    const result = await client.query(
      `INSERT INTO data_lifecycle_policies
         (organization_id,asset_code,name,archive_after_days,retention_days,disposition_action,requires_approval,active,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,true,$7,$8,$8)
       ON CONFLICT(organization_id,asset_code) DO UPDATE SET
         name=EXCLUDED.name,archive_after_days=EXCLUDED.archive_after_days,
         retention_days=EXCLUDED.retention_days,disposition_action=EXCLUDED.disposition_action,
         requires_approval=true,active=EXCLUDED.active,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING *`,
      [req.user.organization_id, code.data, value.name, value.archiveAfterDays,
        value.retentionDays, value.dispositionAction, value.active, req.user.id]
    );
    await writeLifecycleEvent(req, { assetCode: code.data,
      eventType: existing.rowCount ? "policy.updated" : "policy.created",
      entityType: "data_lifecycle_policy", entityId: result.rows[0].id,
      detail: { archiveAfterDays:value.archiveAfterDays, retentionDays:value.retentionDays,
        dispositionAction:value.dispositionAction, requiresApproval:true, active:value.active } }, client);
    await writeAudit(req, existing.rowCount ? "data.policy.update" : "data.policy.create",
      "data_lifecycle_policy", result.rows[0].id, { assetCode: code.data }, client);
    return result.rows[0];
  });
  res.json({ item });
}));

router.put("/stewards/:domain", asyncHandler(async (req, res) => {
  const domain = z.string().trim().regex(/^[a-z][a-z0-9-]{1,79}$/).safeParse(req.params.domain);
  const parsed = z.object({ employeeId: uuid }).safeParse(req.body);
  if (!domain.success || !parsed.success) return res.status(400).json({ error: "Өгөгдөл хариуцагчийн мэдээлэл буруу байна" });
  const item = await inTransaction(async client => {
    const employee = await client.query(
      "SELECT id,full_name FROM employees WHERE organization_id=$1 AND id=$2 AND active=true",
      [req.user.organization_id, parsed.data.employeeId]
    );
    if (!employee.rowCount) { const error = new Error("Идэвхтэй ажилтан олдсонгүй"); error.code="GOVERNANCE_INVALID_STEWARD"; throw error; }
    const result = await client.query(
      `INSERT INTO organization_data_stewards(organization_id,domain,employee_id,assigned_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(organization_id,domain) DO UPDATE SET
         employee_id=EXCLUDED.employee_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()
       RETURNING *`, [req.user.organization_id, domain.data, parsed.data.employeeId, req.user.id]
    );
    await writeLifecycleEvent(req, { eventType:"steward.assigned", entityType:"data_domain",
      entityId:domain.data, detail:{ employeeId:parsed.data.employeeId, employeeName:employee.rows[0].full_name } }, client);
    await writeAudit(req,"data.steward.assign","data_domain",domain.data,{employeeId:parsed.data.employeeId},client);
    return result.rows[0];
  });
  res.json({ item });
}));

router.post("/holds", asyncHandler(async (req, res) => {
  const parsed = z.object({ assetCode, recordKey:z.string().trim().max(500).nullable().optional(), reason:text(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Хадгалалтын хоригийн мэдээлэл буруу байна" });
  const value=parsed.data;
  const item=await inTransaction(async client=>{
    const result=await client.query(
      `INSERT INTO data_legal_holds(organization_id,asset_code,record_key,reason,placed_by)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.organization_id,value.assetCode,value.recordKey||null,value.reason,req.user.id]);
    await writeLifecycleEvent(req,{assetCode:value.assetCode,recordKey:value.recordKey,
      eventType:"hold.placed",entityType:"data_legal_hold",entityId:result.rows[0].id,
      detail:{reason:value.reason}},client);
    await writeAudit(req,"data.hold.place","data_legal_hold",result.rows[0].id,{assetCode:value.assetCode,recordKey:value.recordKey||null},client);
    return result.rows[0];
  });
  res.status(201).json({item});
}));

router.post("/holds/:id/release", asyncHandler(async (req, res) => {
  const id=uuid.safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"Хадгалалтын хоригийн ID буруу байна"});
  const item=await inTransaction(async client=>{
    const result=await client.query(
      `UPDATE data_legal_holds SET status='released',released_by=$3,released_at=now()
        WHERE organization_id=$1 AND id=$2 AND status='active' RETURNING *`,
      [req.user.organization_id,id.data,req.user.id]);
    if(!result.rowCount){const error=new Error("Идэвхтэй хадгалалтын хориг олдсонгүй");error.code="GOVERNANCE_HOLD_NOT_FOUND";throw error;}
    const hold=result.rows[0];
    await writeLifecycleEvent(req,{assetCode:hold.asset_code,recordKey:hold.record_key,
      eventType:"hold.released",entityType:"data_legal_hold",entityId:hold.id},client);
    await writeAudit(req,"data.hold.release","data_legal_hold",hold.id,{assetCode:hold.asset_code},client);
    return hold;
  });
  res.json({item});
}));

router.post("/dispositions", asyncHandler(async (req, res) => {
  const parsed=z.object({assetCode,recordKey:text(500),requestedAction:requestAction,reason:text(2000)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Архивлах/устгах хүсэлтийн мэдээлэл буруу байна"});
  const value=parsed.data;
  if(value.assetCode==="audit-log")return res.status(409).json({error:"Өөрчлөгдөшгүй аудит журналд устгах хүсэлт үүсгэхгүй"});
  const item=await inTransaction(async client=>{
    const policy=await client.query(
      `SELECT * FROM data_lifecycle_policies WHERE organization_id=$1 AND asset_code=$2 AND active=true`,
      [req.user.organization_id,value.assetCode]);
    if(!policy.rowCount){const error=new Error("Энэ өгөгдөлд идэвхтэй lifecycle бодлого эхлээд тохируулна уу");error.code="GOVERNANCE_POLICY_REQUIRED";throw error;}
    if(policy.rows[0].disposition_action!=="review"&&policy.rows[0].disposition_action!==value.requestedAction){
      const error=new Error("Хүссэн үйлдэл хадгалалтын бодлоготой тохирохгүй байна");error.code="GOVERNANCE_POLICY_MISMATCH";throw error;
    }
    const result=await client.query(
      `INSERT INTO data_disposition_requests
        (organization_id,policy_id,asset_code,record_key,requested_action,reason,policy_snapshot,requested_by)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
      [req.user.organization_id,policy.rows[0].id,value.assetCode,value.recordKey,value.requestedAction,
        value.reason,JSON.stringify(policy.rows[0]),req.user.id]);
    await writeLifecycleEvent(req,{assetCode:value.assetCode,recordKey:value.recordKey,
      eventType:"disposition.requested",entityType:"data_disposition_request",entityId:result.rows[0].id,
      detail:{requestedAction:value.requestedAction,reason:value.reason}},client);
    await writeAudit(req,"data.disposition.request","data_disposition_request",result.rows[0].id,
      {assetCode:value.assetCode,recordKey:value.recordKey,requestedAction:value.requestedAction},client);
    return result.rows[0];
  });
  res.status(201).json({item});
}));

router.post("/dispositions/:id/decision", asyncHandler(async (req, res) => {
  const id=uuid.safeParse(req.params.id);
  const parsed=z.object({decision:z.enum(["approved","rejected","cancelled"]),note:z.string().trim().max(2000).default("")}).safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Шийдвэрийн мэдээлэл буруу байна"});
  const item=await inTransaction(async client=>{
    const result=await client.query(
      `UPDATE data_disposition_requests SET status=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND status='pending' RETURNING *`,
      [req.user.organization_id,id.data,parsed.data.decision,req.user.id,parsed.data.note]);
    if(!result.rowCount){const error=new Error("Хүлээгдэж буй хүсэлт олдсонгүй");error.code="GOVERNANCE_REQUEST_NOT_FOUND";throw error;}
    const request=result.rows[0];
    await writeLifecycleEvent(req,{assetCode:request.asset_code,recordKey:request.record_key,
      eventType:`disposition.${parsed.data.decision}`,entityType:"data_disposition_request",entityId:request.id,
      detail:{requestedAction:request.requested_action,note:parsed.data.note,executionPerformed:false}},client);
    await writeAudit(req,`data.disposition.${parsed.data.decision}`,"data_disposition_request",request.id,
      {assetCode:request.asset_code,executionPerformed:false},client);
    return request;
  });
  res.json({item,executionPerformed:false});
}));

module.exports = router;
