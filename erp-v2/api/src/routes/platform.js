"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { getPool } = require("../db");
const { signPlatformToken } = require("../security/token");
const { authenticatePlatform, requirePlatformPermissions } = require("../middleware/auth");
const { writeSecurityAudit } = require("../services/audit");
const { provisionTenant } = require("../services/tenant-provisioning");
const { validateModuleManifest } = require("../services/module-contract");
const { asyncHandler } = require("../utils/async-handler");
const { ensureGrowthProfile, recordGrowthEvent } = require("../services/growth-journey");

const router = express.Router();
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(200) });
const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email().max(200),
  currentPassword: z.string().min(12).max(200),
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(12).max(200),
  newPassword: z.string().min(12).max(200),
});
const createSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  adminName: z.string().trim().min(2).max(200),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  adminUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]+$/).min(3).max(80),
  adminPassword: z.string().min(12).max(200),
  planCode: z.enum(["pilot", "starter", "business"]).default("pilot"),
  trialDays: z.coerce.number().int().min(1).max(365).default(30),
});
const updateSchema = z.object({
  organizationStatus: z.enum(["active", "suspended", "archived"]).optional(),
  subscriptionStatus: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]).optional(),
  planCode: z.enum(["pilot", "starter", "business"]).optional(),
  endsAt: z.union([z.iso.datetime(), z.null()]).optional(),
}).refine(value => Object.keys(value).length > 0, "No changes supplied");
const journeyEventSchema = z.object({
  eventType: z.enum(["go_live", "champion_identified", "referral_recorded", "journey_note"]),
  occurredAt: z.iso.datetime().optional(),
  championUserId: z.uuid().optional(),
  referralOrganizationId: z.uuid().optional(),
  note: z.string().trim().max(2000).default(""),
}).superRefine((value,ctx)=>{
  if(value.eventType==="champion_identified"&&!value.championUserId)ctx.addIssue({code:"custom",path:["championUserId"],message:"Champion user is required"});
  if(value.eventType==="referral_recorded"&&!value.referralOrganizationId)ctx.addIssue({code:"custom",path:["referralOrganizationId"],message:"Referral organization is required"});
});

async function platformAudit(client, admin, req, action, entityId, detail = {}) {
  await client.query(
    `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
     VALUES ($1,$2,'organization',$3,$4::jsonb,$5)`,
    [admin.id, action, entityId, JSON.stringify(detail), req.ip || null]
  );
}

async function directoryStats(root) {
  let files=0,bytes=0;
  async function walk(directory) {
    const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>error.code==="ENOENT"?[]:Promise.reject(error));
    for(const entry of entries){const full=path.join(directory,entry.name);if(entry.isDirectory())await walk(full);else if(entry.isFile()){files+=1;bytes+=(await fs.stat(full)).size;}}
  }
  await walk(root); return {files,bytes};
}

router.post("/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Хэт олон удаа оролдлоо. 15 минутын дараа дахин оролдоно уу." },
}),
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid login request" });
    const result = await getPool().query(
      "SELECT id,email,full_name,password_hash FROM platform_admins WHERE lower(email)=lower($1) AND active=true LIMIT 1",
      [parsed.data.email]
    );
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password_hash))) {
      await writeSecurityAudit({
        actorType: "anonymous",
        action: "platform.auth.login",
        outcome: "failure",
        subjectHash: require("node:crypto").createHash("sha256").update(parsed.data.email.toLowerCase()).digest("hex"),
        ipAddress: req.ip || null,
      });
      return res.status(401).json({ error: "Invalid platform credentials" });
    }
    await writeSecurityAudit({
      actorType: "platform_admin",
      actorId: admin.id,
      action: "platform.auth.login",
      outcome: "success",
      ipAddress: req.ip || null,
    });
    delete admin.password_hash;
    res.json({ token: signPlatformToken(admin.id), admin });
  })
);

router.get("/auth/me", authenticatePlatform, (req, res) => res.json({ admin: req.platformAdmin }));
router.patch("/auth/profile", authenticatePlatform, asyncHandler(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Нэр, и-мэйл болон одоогийн нууц үгээ зөв оруулна уу" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id,email,full_name,password_hash FROM platform_admins WHERE id=$1::uuid AND active=true FOR UPDATE",
      [req.platformAdmin.id]
    );
    const admin = current.rows[0];
    if (!admin || !(await bcrypt.compare(parsed.data.currentPassword, admin.password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Одоогийн нууц үг буруу байна" });
    }
    const updated = await client.query(
      `UPDATE platform_admins SET email=$2,full_name=$3,updated_at=now()
        WHERE id=$1::uuid RETURNING id,email,full_name`,
      [admin.id, parsed.data.email, parsed.data.fullName]
    );
    const detail = {
      previous: { email: admin.email, fullName: admin.full_name },
      current: { email: parsed.data.email, fullName: parsed.data.fullName },
    };
    await client.query(
      `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
       VALUES($1::uuid,'platform.admin.profile.changed','platform_admin',$1::text,$2::jsonb,$3)`,
      [admin.id, JSON.stringify(detail), req.ip || null]
    );
    await writeSecurityAudit({
      client, actorType: "platform_admin", actorId: admin.id,
      action: "platform.admin.profile.changed", outcome: "success", detail, ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ admin: updated.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Энэ и-мэйл бүртгэлтэй байна" });
    throw error;
  } finally {
    client.release();
  }
}));
router.post("/auth/change-password", authenticatePlatform, asyncHandler(async (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Нууц үг хамгийн багадаа 12 тэмдэгт байна" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id,password_hash FROM platform_admins WHERE id=$1::uuid AND active=true FOR UPDATE",
      [req.platformAdmin.id]
    );
    const admin = current.rows[0];
    if (!admin || !(await bcrypt.compare(parsed.data.currentPassword, admin.password_hash))) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Одоогийн нууц үг буруу байна" });
    }
    if (await bcrypt.compare(parsed.data.newPassword, admin.password_hash)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Шинэ нууц үг одоогийнхоос өөр байна" });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await client.query("UPDATE platform_admins SET password_hash=$2,updated_at=now() WHERE id=$1::uuid", [admin.id, passwordHash]);
    await client.query(
      `INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
       VALUES($1::uuid,'platform.admin.password.changed','platform_admin',$1::text,'{}'::jsonb,$2)`,
      [admin.id, req.ip || null]
    );
    await writeSecurityAudit({
      client, actorType: "platform_admin", actorId: admin.id,
      action: "platform.admin.password.changed", outcome: "success", ipAddress: req.ip || null,
    });
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));
router.post("/auth/logout", authenticatePlatform, asyncHandler(async (req, res) => {
  await writeSecurityAudit({
    actorType: "platform_admin",
    actorId: req.platformAdmin.id,
    action: "platform.auth.logout",
    outcome: "success",
    ipAddress: req.ip || null,
  });
  res.status(204).end();
}));
router.use(authenticatePlatform);

const knowledgeReviewSchema=z.object({
  reviewStatus:z.enum(["approved","rejected","needs_more_evidence"]),
  anonymizationStatus:z.enum(["verified","rejected"]).optional(),
  reviewNote:z.string().trim().max(2000).default(""),
});
const externalAiUsageSchema=z.object({
  provider:z.enum(["hercules","other"]),
  operationMode:z.enum(["build","repair","design","review"]),
  externalCredits:z.coerce.number().nonnegative().max(100000000),
  scope:z.string().trim().min(2).max(500),
  artifactReference:z.string().trim().max(1000).optional().default(""),
  outcome:z.enum(["accepted","rejected","partial","error"]).default("partial"),
});
const supportAccessSchema=z.object({
  organizationId:z.uuid(),
  reason:z.string().trim().min(12).max(1000),
  durationMinutes:z.coerce.number().int().min(5).max(60).default(30),
  scopes:z.array(z.enum(["diagnostics","configuration","audit"])).min(1).max(3)
    .transform(scopes=>[...new Set(scopes)]),
});

router.get("/founder/control", requirePlatformPermissions("platform.founder.read"), asyncHandler(async(req,res)=>{
  const [assignments,grants]=await Promise.all([
    getPool().query(`SELECT role.code,role.name,assignment.assigned_at
      FROM platform_admin_role_assignments assignment
      JOIN platform_admin_roles role ON role.id=assignment.role_id
      WHERE assignment.platform_admin_id=$1 AND assignment.revoked_at IS NULL AND role.active=true
      ORDER BY role.code`,[req.platformAdmin.id]),
    getPool().query(`SELECT g.id,g.organization_id,organization.name AS organization_name,
      g.reason,g.scopes,g.issued_at,g.expires_at,g.revoked_at,
      CASE WHEN g.revoked_at IS NOT NULL THEN 'revoked'
           WHEN g.expires_at<=now() THEN 'expired' ELSE 'active' END AS status
      FROM platform_support_access_grants g
      JOIN organizations organization ON organization.id=g.organization_id
      WHERE g.platform_admin_id=$1
      ORDER BY g.issued_at DESC LIMIT 50`,[req.platformAdmin.id]),
  ]);
  res.json({
    founder:{id:req.platformAdmin.id,roles:assignments.rows,permissions:req.platformAdmin.permissions},
    contexts:[
      {code:"platform",state:"live",authority:"platform-rbac",description:"Tenant lifecycle, runtime, governance, billing, support, and Platform audit"},
      {code:"apps",state:"planned",authority:"separate-future-boundary",description:"Developer/vendor membership is not a Platform permission"},
      {code:"market-customer",state:"preview",authority:"market-membership",description:"Customer mode is currently a public browser preview"},
      {code:"market-provider",state:"preview",authority:"market-membership",description:"Provider mode is currently a public browser preview"},
      {code:"market-operator",state:"planned",authority:"separate-future-boundary",description:"Operator authority must remain separate from vendor participation"},
      {code:"system-operator",state:"external",authority:"host-and-deployment",description:"Deployment, migration, backup, and restore remain outside application RBAC"},
      {code:"break-glass",state:"external",authority:"offline-recovery",description:"Explicit recovery script; never a daily web session or Market outcome override"},
    ],
    supportGrants:grants.rows,
    boundaries:{tenantApiBypass:false,marketOutcomeOverride:false,auditMutable:false,maxSupportMinutes:60},
  });
}));

router.post("/support-access", requirePlatformPermissions("platform.support-access.manage"), asyncHandler(async(req,res)=>{
  const parsed=supportAccessSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid support access request",details:parsed.error.flatten()});
  const value=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const organization=await client.query("SELECT id,name,status FROM organizations WHERE id=$1 FOR SHARE",[value.organizationId]);
    if(!organization.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Organization not found"});}
    const result=await client.query(`INSERT INTO platform_support_access_grants
      (platform_admin_id,organization_id,reason,scopes,expires_at)
      VALUES($1,$2,$3,$4,now()+($5::int*interval '1 minute'))
      RETURNING id,organization_id,reason,scopes,issued_at,expires_at,revoked_at`,
      [req.platformAdmin.id,value.organizationId,value.reason,value.scopes,value.durationMinutes]);
    const grant=result.rows[0],detail={organizationId:value.organizationId,scopes:value.scopes,durationMinutes:value.durationMinutes};
    await client.query(`INSERT INTO platform_support_access_events
      (grant_id,platform_admin_id,event_type,detail,ip_address)
      VALUES($1,$2,'issued',$3::jsonb,$4)`,[grant.id,req.platformAdmin.id,JSON.stringify(detail),req.ip||null]);
    await client.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
      VALUES($1,'platform.support_access.issued','support_access',$2,$3::jsonb,$4)`,
      [req.platformAdmin.id,grant.id,JSON.stringify(detail),req.ip||null]);
    await client.query("COMMIT");res.status(201).json({item:{...grant,organization_name:organization.rows[0].name,status:"active"}});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/support-access/:id/revoke", requirePlatformPermissions("platform.support-access.manage"), asyncHandler(async(req,res)=>{
  const id=z.uuid().safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"Invalid support grant id"});
  const client=await getPool().connect();
  try{await client.query("BEGIN");
    const result=await client.query(`UPDATE platform_support_access_grants
      SET revoked_at=now(),revoked_by=$2
      WHERE id=$1 AND platform_admin_id=$2 AND revoked_at IS NULL
      RETURNING id,organization_id,revoked_at`,[id.data,req.platformAdmin.id]);
    if(!result.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active support grant not found"});}
    const grant=result.rows[0],detail={organizationId:grant.organization_id};
    await client.query(`INSERT INTO platform_support_access_events
      (grant_id,platform_admin_id,event_type,detail,ip_address)
      VALUES($1,$2,'revoked',$3::jsonb,$4)`,[grant.id,req.platformAdmin.id,JSON.stringify(detail),req.ip||null]);
    await client.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
      VALUES($1,'platform.support_access.revoked','support_access',$2,$3::jsonb,$4)`,
      [req.platformAdmin.id,grant.id,JSON.stringify(detail),req.ip||null]);
    await client.query("COMMIT");res.json({item:grant});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.get("/support-access/:id/snapshot", requirePlatformPermissions("platform.support-access.manage"), asyncHandler(async(req,res)=>{
  const id=z.uuid().safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"Invalid support grant id"});
  const client=await getPool().connect();
  try{await client.query("BEGIN");
    const access=await client.query(`SELECT g.*,organization.name AS organization_name,organization.slug,
      organization.status AS organization_status
      FROM platform_support_access_grants g JOIN organizations organization ON organization.id=g.organization_id
      WHERE g.id=$1 AND g.platform_admin_id=$2 FOR UPDATE`,[id.data,req.platformAdmin.id]);
    if(!access.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Support grant not found"});}
    const grant=access.rows[0];
    if(grant.revoked_at||new Date(grant.expires_at)<=new Date()){
      await client.query(`INSERT INTO platform_support_access_events
        (grant_id,platform_admin_id,event_type,detail,ip_address)
        VALUES($1,$2,'expired_denied',$3::jsonb,$4)`,[grant.id,req.platformAdmin.id,JSON.stringify({revoked:Boolean(grant.revoked_at)}),req.ip||null]);
      await client.query("COMMIT");return res.status(403).json({error:"Support grant is revoked or expired",code:"SUPPORT_ACCESS_INACTIVE"});
    }
    const snapshot={organization:{id:grant.organization_id,name:grant.organization_name,slug:grant.slug,status:grant.organization_status}};
    if(grant.scopes.includes("diagnostics"))snapshot.diagnostics=(await client.query(`SELECT
      (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active=true AND can_login=true) AS active_accounts,
      (SELECT count(*)::int FROM assets WHERE organization_id=$1) AS assets,
      (SELECT count(*)::int FROM work_orders WHERE organization_id=$1) AS work_orders,
      (SELECT count(*)::int FROM integration_executions WHERE organization_id=$1 AND status='dead_letter') AS dead_letters,
      (SELECT count(*)::int FROM security_audit_events WHERE organization_id=$1 AND outcome IN('failure','denied') AND created_at>=now()-interval '24 hours') AS security_events_24h`,[grant.organization_id])).rows[0];
    if(grant.scopes.includes("configuration"))snapshot.configuration=(await client.query(`SELECT module.code,module.name,module.category,
      COALESCE(enabled.enabled,module.core) AS enabled
      FROM module_catalog module LEFT JOIN organization_modules enabled
      ON enabled.organization_id=$1 AND enabled.module_code=module.code
      WHERE module.active=true ORDER BY module.code`,[grant.organization_id])).rows;
    if(grant.scopes.includes("audit"))snapshot.audit=(await client.query(`SELECT action,outcome,count(*)::int AS events,max(created_at) AS last_at
      FROM security_audit_events WHERE organization_id=$1 AND created_at>=now()-interval '24 hours'
      GROUP BY action,outcome ORDER BY max(created_at) DESC LIMIT 20`,[grant.organization_id])).rows;
    await client.query(`INSERT INTO platform_support_access_events
      (grant_id,platform_admin_id,event_type,detail,ip_address)
      VALUES($1,$2,'snapshot_read',$3::jsonb,$4)`,[grant.id,req.platformAdmin.id,JSON.stringify({scopes:grant.scopes}),req.ip||null]);
    await client.query("COMMIT");res.json({grant:{id:grant.id,reason:grant.reason,scopes:grant.scopes,expires_at:grant.expires_at},snapshot,
      boundaries:{rawTenantRows:false,tenantApiBypass:false,mutationsAllowed:false}});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.get("/ai-knowledge/overview", requirePlatformPermissions("platform.ai-knowledge.read"), asyncHandler(async(_req,res)=>{
  const [methods,sessions,feedback,candidates,outcomes,sources,coverage]=await Promise.all([
    getPool().query(`SELECT code,version,name,description,status,approved_at,created_at
      FROM ai_method_versions ORDER BY code,version DESC`),
    getPool().query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE status='active')::int AS active,
      count(*) FILTER(WHERE status='ready_for_review')::int AS ready_for_review,
      count(*) FILTER(WHERE status='completed')::int AS completed,
      count(DISTINCT organization_id)::int AS organizations
      FROM ai_interview_sessions`),
    getPool().query(`SELECT decision,count(*)::int AS count FROM ai_recommendation_feedback GROUP BY decision ORDER BY decision`),
    getPool().query(`SELECT id,candidate_type,generalized_content,anonymization_status,evidence_count,review_status,review_note,created_at
      FROM ai_knowledge_candidates ORDER BY CASE review_status WHEN 'pending' THEN 0 WHEN 'needs_more_evidence' THEN 1 ELSE 2 END,created_at DESC LIMIT 100`),
    getPool().query(`SELECT measurement_window,outcome,count(*)::int AS count FROM ai_adoption_outcomes
      GROUP BY measurement_window,outcome ORDER BY measurement_window,outcome`),
    getPool().query(`SELECT s.code,s.title,s.source_type,s.source_reference,s.scope_summary,s.exclusion_note,s.review_status,s.reviewed_at,
      count(us.knowledge_code)::int AS knowledge_units
      FROM ai_knowledge_sources s LEFT JOIN ai_knowledge_unit_sources us ON us.source_code=s.code
      GROUP BY s.code,s.title,s.source_type,s.source_reference,s.scope_summary,s.exclusion_note,s.review_status,s.reviewed_at
      ORDER BY s.code`),
    getPool().query(`SELECT u.method_code,u.method_version,u.topic,count(*)::int AS knowledge_units,
      array_agg(DISTINCT u.stage ORDER BY u.stage) AS stages
      FROM ai_method_knowledge_units u WHERE u.active=true
      GROUP BY u.method_code,u.method_version,u.topic ORDER BY u.method_code,u.method_version DESC,u.topic`),
  ]);
  res.json({methods:methods.rows,interviews:sessions.rows[0],feedback:feedback.rows,candidates:candidates.rows,outcomes:outcomes.rows,
    sources:sources.rows,coverage:coverage.rows,
    privacy:{rawTenantEvidenceExposed:false,sharedKnowledgeRequiresAnonymization:true,humanApprovalRequired:true}});
}));

router.post("/ai-knowledge/methods/:code/:version/activate", requirePlatformPermissions("platform.ai-knowledge.manage"), asyncHandler(async(req,res)=>{
  const methodCode=z.string().trim().regex(/^[a-z0-9-]{2,80}$/).safeParse(req.params.code);
  const version=z.coerce.number().int().positive().safeParse(req.params.version);
  if(!methodCode.success||!version.success)return res.status(400).json({error:"Invalid method version"});
  const client=await getPool().connect();
  try{await client.query("BEGIN");
    const found=await client.query("SELECT code,version,status FROM ai_method_versions WHERE code=$1 AND version=$2 FOR UPDATE",[methodCode.data,version.data]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Method version not found"});}
    await client.query("UPDATE ai_method_versions SET status='retired' WHERE code=$1 AND status='active'",[methodCode.data]);
    const active=await client.query(`UPDATE ai_method_versions SET status='active',approved_by=$3,approved_at=now()
      WHERE code=$1 AND version=$2 RETURNING code,version,name,description,status,approved_at`,[methodCode.data,version.data,req.platformAdmin.id]);
    await client.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
      VALUES($1,'ai.method.activate','ai_method',$2,$3::jsonb,$4)`,[req.platformAdmin.id,`${methodCode.data}:${version.data}`,JSON.stringify({code:methodCode.data,version:version.data}),req.ip||null]);
    await client.query("COMMIT");res.json({item:active.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.patch("/ai-knowledge/candidates/:id", requirePlatformPermissions("platform.ai-knowledge.manage"), asyncHandler(async(req,res)=>{
  const id=z.uuid().safeParse(req.params.id),parsed=knowledgeReviewSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid knowledge review"});
  if(parsed.data.reviewStatus==="approved"&&parsed.data.anonymizationStatus!=="verified")return res.status(400).json({error:"Anonymization must be verified before approval"});
  const client=await getPool().connect();
  try{await client.query("BEGIN");
    const result=await client.query(`UPDATE ai_knowledge_candidates SET review_status=$2,
      anonymization_status=COALESCE($3,anonymization_status),review_note=$4,reviewed_by=$5,reviewed_at=now()
      WHERE id=$1 RETURNING id,candidate_type,generalized_content,anonymization_status,evidence_count,review_status,review_note,reviewed_at`,
      [id.data,parsed.data.reviewStatus,parsed.data.anonymizationStatus||null,parsed.data.reviewNote,req.platformAdmin.id]);
    if(!result.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Knowledge candidate not found"});}
    await client.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
      VALUES($1,'ai.knowledge.review','ai_knowledge_candidate',$2,$3::jsonb,$4)`,[req.platformAdmin.id,id.data,JSON.stringify(parsed.data),req.ip||null]);
    await client.query("COMMIT");res.json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.get("/ai-usage/overview", requirePlatformPermissions("platform.ai-usage.read"), asyncHandler(async(req,res)=>{
  const days=z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.days);
  const [summary,breakdown,recent,manifests,routes]=await Promise.all([
    getPool().query(`SELECT count(*)::int AS events,
      COALESCE(sum(input_tokens),0)::bigint AS input_tokens,
      COALESCE(sum(cached_input_tokens),0)::bigint AS cached_input_tokens,
      COALESCE(sum(output_tokens),0)::bigint AS output_tokens,
      COALESCE(sum(total_tokens),0)::bigint AS total_tokens,
      COALESCE(sum(external_credits),0)::numeric AS external_credits,
      count(*) FILTER(WHERE outcome='accepted')::int AS accepted,
      count(*) FILTER(WHERE outcome='rejected')::int AS rejected
      FROM ai_usage_events WHERE created_at>=now()-($1::int*interval '1 day')`,[days]),
    getPool().query(`SELECT provider,operation_mode,COALESCE(model,'—') AS model,count(*)::int AS events,
      COALESCE(sum(total_tokens),0)::bigint AS total_tokens,COALESCE(sum(external_credits),0)::numeric AS external_credits,
      count(*) FILTER(WHERE outcome='accepted')::int AS accepted
      FROM ai_usage_events WHERE created_at>=now()-($1::int*interval '1 day')
      GROUP BY provider,operation_mode,COALESCE(model,'—') ORDER BY provider,operation_mode,model`,[days]),
    getPool().query(`SELECT id,provider,operation_mode,model,total_tokens,external_credits,outcome,scope,artifact_reference,created_at
      FROM ai_usage_events ORDER BY created_at DESC LIMIT 50`),
    getPool().query(`SELECT m.code,m.name,m.category,m.active AS catalog_active,
      mm.manifest_version,mm.lifecycle_status,mm.route_prefix,mm.updated_at
      FROM module_catalog m LEFT JOIN module_manifests mm ON mm.module_code=m.code ORDER BY m.category,m.code`),
    getPool().query(`SELECT route_prefix,owner_type,owner_code,surface,reserved,active,description
      FROM platform_route_registry ORDER BY route_prefix`),
  ]);
  res.json({days,summary:summary.rows[0],breakdown:breakdown.rows,recent:recent.rows,
    moduleGovernance:{modules:manifests.rows,routes:routes.rows}});
}));

router.post("/ai-usage/external", requirePlatformPermissions("platform.ai-usage.manage"), asyncHandler(async(req,res)=>{
  const parsed=externalAiUsageSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid external AI usage",details:parsed.error.flatten()});
  const value=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const result=await client.query(`INSERT INTO ai_usage_events(provider,operation_mode,external_credits,outcome,scope,artifact_reference,metadata)
      VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7::jsonb)
      RETURNING id,provider,operation_mode,external_credits,outcome,scope,artifact_reference,created_at`,
      [value.provider,value.operationMode,value.externalCredits,value.outcome,value.scope,value.artifactReference,JSON.stringify({recordedByPlatformAdmin:req.platformAdmin.id})]);
    await client.query(`INSERT INTO platform_audit_logs(platform_admin_id,action,entity_type,entity_id,detail,ip_address)
      VALUES($1,'ai.external_usage.record','ai_usage_event',$2,$3::jsonb,$4)`,
      [req.platformAdmin.id,result.rows[0].id,JSON.stringify({provider:value.provider,operationMode:value.operationMode,externalCredits:value.externalCredits,outcome:value.outcome}),req.ip||null]);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/module-governance/validate", requirePlatformPermissions("platform.catalog.validate"), asyncHandler(async(req,res)=>{
  const routes=await getPool().query(`SELECT route_prefix,owner_code,active FROM platform_route_registry WHERE active=true`);
  const result=validateModuleManifest(req.body,routes.rows);
  res.status(result.valid?200:400).json(result);
}));

router.get("/command-center", requirePlatformPermissions("platform.operations.read"), asyncHandler(async (_req, res) => {
  const [summary, attention, activity] = await Promise.all([
    getPool().query(
      `SELECT count(*)::int AS organizations,
              count(*) FILTER(WHERE o.status='active')::int AS active_organizations,
              count(*) FILTER(WHERE s.status='trial')::int AS trials,
              count(*) FILTER(WHERE s.status='active')::int AS paid_organizations,
              count(*) FILTER(WHERE s.status='past_due')::int AS past_due_organizations,
              count(*) FILTER(WHERE s.ends_at BETWEEN now() AND now()+interval '14 days')::int AS expiring_soon,
              (SELECT count(*)::int FROM users WHERE active=true AND can_login=true) AS active_login_accounts,
              (SELECT count(*)::int FROM security_audit_events
                WHERE outcome IN('failure','denied') AND created_at>=now()-interval '24 hours') AS security_events_24h,
              (SELECT count(*)::int FROM builder_support_requests WHERE status IN('open','reviewing')) AS open_support_requests,
              (SELECT count(*)::int FROM integration_executions WHERE status='dead_letter')
                +(SELECT count(*)::int FROM webhook_deliveries WHERE status='dead_letter') AS dead_letter_executions,
              (SELECT count(*)::int FROM data_quality_measurements WHERE outcome='fail') AS quality_failures,
              (SELECT count(*)::int FROM billing_invoices WHERE status IN('issued','overdue') AND due_date<CURRENT_DATE) AS overdue_invoices
         FROM organizations o
         LEFT JOIN subscriptions s ON s.organization_id=o.id`
    ),
    getPool().query(
      `SELECT * FROM (
         SELECT o.id AS organization_id,o.name AS organization_name,o.slug,
                'subscription'::text AS category,
                CASE WHEN s.status='past_due' THEN 'critical' ELSE 'warning' END AS severity,
                CASE WHEN s.status='past_due' THEN 'Төлбөрийн хугацаа хэтэрсэн'
                     ELSE 'Үйлчилгээний эрх 14 хоногт дуусна' END AS title,
                COALESCE(s.ends_at,s.updated_at) AS occurred_at
           FROM organizations o JOIN subscriptions s ON s.organization_id=o.id
          WHERE s.status='past_due' OR (s.ends_at BETWEEN now() AND now()+interval '14 days')
         UNION ALL
         SELECT o.id,o.name,o.slug,'integration','critical','Интеграцийн dead-letter алдаа',max(x.created_at)
           FROM organizations o JOIN (
             SELECT organization_id,created_at FROM integration_executions WHERE status='dead_letter'
             UNION ALL SELECT organization_id,created_at FROM webhook_deliveries WHERE status='dead_letter'
           ) x ON x.organization_id=o.id GROUP BY o.id
         UNION ALL
         SELECT o.id,o.name,o.slug,'data_quality','warning','Өгөгдлийн чанарын шалгалт амжилтгүй',max(q.measured_at)
           FROM organizations o JOIN data_quality_measurements q ON q.organization_id=o.id AND q.outcome='fail'
          GROUP BY o.id
         UNION ALL
         SELECT o.id,o.name,o.slug,'support','warning','Шийдвэрлээгүй тусламжийн хүсэлт',max(r.created_at)
           FROM organizations o JOIN builder_support_requests r ON r.organization_id=o.id AND r.status IN('open','reviewing')
          GROUP BY o.id
       ) queue ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,occurred_at DESC NULLS LAST LIMIT 30`
    ),
    getPool().query(
      `SELECT l.action,l.entity_type,l.entity_id,l.created_at,a.full_name AS admin_name
         FROM platform_audit_logs l LEFT JOIN platform_admins a ON a.id=l.platform_admin_id
        ORDER BY l.created_at DESC LIMIT 12`
    ),
  ]);
  res.json({ summary: summary.rows[0], attention: attention.rows, activity: activity.rows });
}));

router.post("/organizations/:id/journey-events", requirePlatformPermissions("platform.adoption.manage"), asyncHandler(async (req,res)=>{
  const organizationId=z.uuid().safeParse(req.params.id);
  const parsed=journeyEventSchema.safeParse(req.body||{});
  if(!organizationId.success||!parsed.success)return res.status(400).json({error:"Invalid customer journey event",details:parsed.error?.flatten()});
  const value=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const organization=await client.query("SELECT id,name FROM organizations WHERE id=$1 FOR UPDATE",[organizationId.data]);
    if(!organization.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Organization not found"});}
    if(value.championUserId){
      const champion=await client.query("SELECT id,full_name FROM users WHERE organization_id=$1 AND id=$2 AND active=true",[organizationId.data,value.championUserId]);
      if(!champion.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Champion must be an active user of this organization"});}
    }
    if(value.referralOrganizationId){
      if(value.referralOrganizationId===organizationId.data){await client.query("ROLLBACK");return res.status(400).json({error:"An organization cannot refer itself"});}
      const referral=await client.query("SELECT id FROM organizations WHERE id=$1",[value.referralOrganizationId]);
      if(!referral.rowCount){await client.query("ROLLBACK");return res.status(400).json({error:"Referral source organization not found"});}
    }
    await ensureGrowthProfile(client,organizationId.data,"platform_admin");
    if(value.eventType==="go_live")await client.query(`UPDATE organization_growth_profiles SET go_live_at=COALESCE($2::timestamptz,now()),notes=CASE WHEN $3='' THEN notes ELSE $3 END,updated_at=now() WHERE organization_id=$1`,[organizationId.data,value.occurredAt||null,value.note]);
    if(value.eventType==="champion_identified")await client.query(`UPDATE organization_growth_profiles SET internal_champion_user_id=$2,champion_identified_at=COALESCE($3::timestamptz,now()),notes=CASE WHEN $4='' THEN notes ELSE $4 END,updated_at=now() WHERE organization_id=$1`,[organizationId.data,value.championUserId,value.occurredAt||null,value.note]);
    if(value.eventType==="referral_recorded")await client.query(`UPDATE organization_growth_profiles SET referral_source_organization_id=$2,acquisition_source='referral',referral_recorded_at=COALESCE($3::timestamptz,now()),notes=CASE WHEN $4='' THEN notes ELSE $4 END,updated_at=now() WHERE organization_id=$1`,[organizationId.data,value.referralOrganizationId,value.occurredAt||null,value.note]);
    const event=await recordGrowthEvent(client,{organizationId:organizationId.data,eventType:value.eventType,source:"platform_admin",platformAdminId:req.platformAdmin.id,occurredAt:value.occurredAt,detail:{note:value.note,championUserId:value.championUserId||null,referralOrganizationId:value.referralOrganizationId||null}});
    await platformAudit(client,req.platformAdmin,req,`organization.journey.${value.eventType}`,organizationId.data,{eventId:event.id,...value});
    await client.query("COMMIT");res.status(201).json({item:event});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.get("/adoption/overview", requirePlatformPermissions("platform.adoption.read"), asyncHandler(async (_req, res) => {
  const result = await getPool().query(
    `WITH organization_milestones AS (
       SELECT o.id,o.slug,o.name,o.status,o.created_at,
              COALESCE(
                (SELECT min(occurred_at) FROM organization_growth_events WHERE organization_id=o.id AND event_type='discovery_started'),
                (SELECT min(started_at) FROM ai_interview_sessions WHERE organization_id=o.id)
              ) AS discovery_at,
              COALESCE(
                (SELECT min(occurred_at) FROM organization_growth_events WHERE organization_id=o.id AND event_type='blueprint_ready'),
                (SELECT min(applied_at) FROM organization_blueprints WHERE organization_id=o.id AND status='applied')
              ) AS blueprint_at,
              COALESCE(
                (SELECT min(occurred_at) FROM organization_growth_events WHERE organization_id=o.id AND event_type='pilot_started'),
                (SELECT min(starts_at) FROM subscriptions WHERE organization_id=o.id)
              ) AS pilot_at,
              (SELECT go_live_at FROM organization_growth_profiles WHERE organization_id=o.id) AS go_live_at,
              (SELECT min(received_at) FROM billing_payments WHERE organization_id=o.id) AS paid_usage_at,
              (SELECT champion_identified_at FROM organization_growth_profiles WHERE organization_id=o.id) AS champion_at,
              (SELECT referral_recorded_at FROM organization_growth_profiles WHERE organization_id=o.id) AS referral_at,
              (SELECT internal_champion_user_id FROM organization_growth_profiles WHERE organization_id=o.id) AS champion_user_id,
              (SELECT min(created_at) FROM audit_logs
                WHERE organization_id=o.id AND action='auth.login') AS first_login_at,
              LEAST(
                (SELECT min(created_at) FROM departments WHERE organization_id=o.id),
                (SELECT min(created_at) FROM positions WHERE organization_id=o.id),
                (SELECT min(created_at) FROM smart_import_jobs
                  WHERE organization_id=o.id AND import_type='organization_structure')
              ) AS structure_started_at,
              CASE WHEN EXISTS(SELECT 1 FROM departments WHERE organization_id=o.id)
                     AND EXISTS(SELECT 1 FROM positions WHERE organization_id=o.id)
                   THEN GREATEST(
                     (SELECT min(created_at) FROM departments WHERE organization_id=o.id),
                     (SELECT min(created_at) FROM positions WHERE organization_id=o.id)
                   ) END AS structure_ready_at,
              LEAST(
                (SELECT min(created_at) FROM work_orders WHERE organization_id=o.id),
                (SELECT min(created_at) FROM attendance_records WHERE organization_id=o.id),
                (SELECT min(created_at) FROM documents WHERE organization_id=o.id),
                (SELECT min(created_at) FROM stock_movements WHERE organization_id=o.id),
                (SELECT min(created_at) FROM purchase_requests WHERE organization_id=o.id)
              ) AS first_value_at,
              (SELECT max(created_at) FROM audit_logs WHERE organization_id=o.id) AS last_activity_at,
              (SELECT count(*)::int FROM smart_import_jobs
                WHERE organization_id=o.id AND import_type='organization_structure') AS structure_attempts,
              (SELECT count(*)::int FROM smart_import_jobs
                WHERE organization_id=o.id AND import_type='organization_structure' AND status='failed') AS failed_structure_attempts
         FROM organizations o
     ), activity AS (
       SELECT m.*,
              (SELECT max(day_at) FROM (
                 SELECT date_trunc('day',l.created_at) AS day_at
                   FROM audit_logs l
                  WHERE l.organization_id=m.id
                    AND m.first_value_at IS NOT NULL
                    AND l.created_at>=m.first_value_at
                  GROUP BY date_trunc('day',l.created_at)
                  ORDER BY day_at
                  LIMIT 3
               ) active_days HAVING count(*)=3) AS third_active_day,
              (SELECT count(DISTINCT l.created_at::date)::int FROM audit_logs l
                WHERE l.organization_id=m.id
                  AND m.first_value_at IS NOT NULL
                  AND l.created_at>=m.first_value_at) AS active_days_after_value
         FROM organization_milestones m
     ), adoption AS (
       SELECT a.*,
              CASE WHEN third_active_day IS NOT NULL
                   THEN GREATEST(first_value_at+interval '7 days',third_active_day) END AS stable_at,
              COALESCE(last_activity_at,created_at) AS effective_last_activity_at
         FROM activity a
     ), classified AS (
       SELECT a.*,
              CASE WHEN referral_at IS NOT NULL THEN 'referral'
                   WHEN champion_at IS NOT NULL THEN 'champion'
                   WHEN paid_usage_at IS NOT NULL THEN 'paid_usage'
                   WHEN go_live_at IS NOT NULL THEN 'go_live'
                   WHEN first_value_at IS NOT NULL THEN 'first_value'
                   WHEN pilot_at IS NOT NULL THEN 'pilot'
                   WHEN blueprint_at IS NOT NULL OR structure_ready_at IS NOT NULL THEN 'blueprint'
                   WHEN discovery_at IS NOT NULL THEN 'discovery'
                   ELSE 'attempt' END AS current_stage,
              (stable_at IS NULL AND effective_last_activity_at<now()-interval '7 days') AS stalled,
              (stable_at IS NULL AND effective_last_activity_at<now()-interval '14 days') AS likely_abandoned
         FROM adoption a
     )
     SELECT *,
            round((extract(epoch FROM (first_login_at-created_at))/3600)::numeric,1) AS hours_to_first_login,
            round((extract(epoch FROM (structure_ready_at-created_at))/3600)::numeric,1) AS hours_to_structure_ready,
            round((extract(epoch FROM (first_value_at-created_at))/3600)::numeric,1) AS hours_to_first_value,
            round((extract(epoch FROM (stable_at-created_at))/86400)::numeric,1) AS days_to_stable,
            floor(extract(epoch FROM (now()-created_at))/86400)::int AS days_since_start
       FROM classified ORDER BY created_at DESC`
  );
  const items = result.rows;
  const count = predicate => items.filter(predicate).length;
  const median = (field) => {
    const values = items.map(item => Number(item[field])).filter(Number.isFinite).sort((a,b)=>a-b);
    if (!values.length) return null;
    const middle = Math.floor(values.length/2);
    return values.length%2 ? values[middle] : Math.round(((values[middle-1]+values[middle])/2)*10)/10;
  };
  const stages = [
    ["attempt","Оролдлого",items.length],
    ["discovery","Тандан судалгаа",count(item=>item.discovery_at)],
    ["blueprint","Бүтцийн зураглал",count(item=>item.blueprint_at||item.structure_ready_at)],
    ["pilot","Туршилт",count(item=>item.pilot_at)],
    ["first_value","Анхны үнэ цэнэ",count(item=>item.first_value_at)],
    ["go_live","Үйл ажиллагаанд орсон",count(item=>item.go_live_at)],
    ["paid_usage","Төлбөртэй ашиглалт",count(item=>item.paid_usage_at)],
    ["champion","Дотоод манлайлагч",count(item=>item.champion_at)],
    ["referral","Санал болгосон",count(item=>item.referral_at)],
  ];
  res.json({
    summary: {
      total_attempts: items.length,
      reached_first_value: stages[4][2],
      stable_organizations: count(item=>item.stable_at && new Date(item.stable_at)<=new Date()),
      go_live_organizations: stages[5][2],
      paid_organizations: stages[6][2],
      champion_organizations: stages[7][2],
      referred_organizations: stages[8][2],
      stalled: count(item=>item.stalled),
      likely_abandoned: count(item=>item.likely_abandoned),
      median_hours_to_structure_ready: median("hours_to_structure_ready"),
      median_hours_to_first_value: median("hours_to_first_value"),
      median_days_to_stable: median("days_to_stable"),
    },
    funnel: stages.map(([code,label,total],index)=>({
      code,label,total,
      conversion_percent: index===0 || !stages[index-1][2] ? (index===0?100:0)
        : Math.round(total/stages[index-1][2]*1000)/10,
      overall_percent: items.length ? Math.round(total/items.length*1000)/10 : 0,
    })),
    items,
    definitions: {
      discovery: "AI ярилцлага эсвэл шаардлага тодорхойлох тандан судалгаа эхэлсэн",
      blueprint: "Байгууллагын баталсан бүтэц, процессын зураглал үүссэн",
      first_value: "Анхны бодит ажил, ирц, баримт, агуулахын хөдөлгөөн эсвэл худалдан авалтын бүртгэл",
      go_live: "Platform admin байгууллагын бодит үйл ажиллагаанд орсныг баталсан",
      paid_usage: "Төлбөрийн бодит гүйлгээ бүртгэгдсэн; гараар таамаглахгүй",
      champion: "Байгууллага дотор OVERVA-г хариуцан түгээх идэвхтэй ажилтан баталгаажсан",
      referral: "Өөр байгууллагаас ирсэн баталгаатай санал, холбоос бүртгэгдсэн",
      stable: "Анхны үнэ цэнээс хойш 7+ хоногийн хугацаанд 3 өөр өдөр ашигласан",
      stalled: "Тогтмол хэрэглээнд хүрээгүй бөгөөд 7+ хоног үйлдэлгүй",
      likely_abandoned: "Тогтмол хэрэглээнд хүрээгүй бөгөөд 14+ хоног үйлдэлгүй",
    },
  });
}));

router.get("/system/status", requirePlatformPermissions("platform.system.read"), asyncHandler(async (_req,res)=>{
  const [database,governance,governanceOrganizations,uploads,backupNames] = await Promise.all([
    getPool().query(
      `SELECT pg_database_size(current_database())::bigint AS database_bytes,
              (SELECT count(*)::int FROM organizations) AS organizations,
              (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM assets) AS assets,
              (SELECT count(*)::int FROM work_orders) AS work_orders,
              (SELECT max(version) FROM schema_migrations) AS schema_version,
              now() AS database_time`
    ),
    getPool().query(
      `SELECT (SELECT count(*)::int FROM data_catalog_assets WHERE active=true) AS catalog_assets,
              (SELECT count(*)::int FROM data_catalog_assets WHERE active=true AND data_kind='master') AS master_assets,
              (SELECT count(*)::int FROM data_catalog_assets WHERE active=true AND data_kind='reference') AS reference_assets,
              (SELECT count(*)::int FROM data_catalog_assets WHERE active=true AND data_kind='transaction') AS transaction_assets,
              (SELECT count(*)::int FROM reference_sets WHERE active=true) AS reference_sets,
              (SELECT count(*)::int FROM reference_values WHERE active=true AND (valid_to IS NULL OR valid_to>=CURRENT_DATE)) AS reference_values,
              (SELECT count(*)::int FROM data_dictionary_elements WHERE active=true) AS dictionary_elements,
              (SELECT count(*)::int FROM data_dictionary_elements WHERE active=true AND critical_data_element=true) AS critical_data_elements,
              (SELECT count(*)::int FROM data_lineage_edges WHERE active=true) AS lineage_edges,
              (SELECT count(*)::int FROM kpi_catalog WHERE active=true) AS kpi_templates,
              (SELECT count(*)::int FROM data_quality_rules WHERE active=true) AS quality_rule_templates,
              (SELECT count(*)::int FROM data_quality_measurements) AS quality_measurements,
              (SELECT count(*)::int FROM data_quality_measurements WHERE outcome='fail') AS quality_failures,
              (SELECT count(*)::int FROM data_quality_findings
                WHERE status NOT IN('resolved','accepted_exception','rejected')) AS open_findings,
              (SELECT count(*)::int FROM data_quality_findings
                WHERE severity IN('high','critical') AND status NOT IN('resolved','rejected')) AS high_risk_findings,
              (SELECT count(*)::int FROM data_quality_findings WHERE status='resolved') AS resolved_findings,
              (SELECT count(*)::int FROM data_quality_findings WHERE learning_status='candidate') AS learning_candidates,
              (SELECT count(*)::int FROM organization_data_asset_controls) AS architecture_controls,
              (SELECT count(*)::int FROM data_lifecycle_policies WHERE active=true) AS lifecycle_policies,
              (SELECT count(*)::int FROM organization_data_stewards) AS assigned_stewards,
              (SELECT count(*)::int FROM data_legal_holds WHERE status='active') AS active_holds,
              (SELECT count(*)::int FROM data_disposition_requests WHERE status='pending') AS pending_dispositions,
              (SELECT count(*)::int FROM documents) AS documents,
              (SELECT count(*)::int FROM documents WHERE current_version_id IS NULL AND status<>'disposed') AS documents_without_version,
              (SELECT count(*)::int FROM integration_contracts WHERE status='active') AS active_integrations,
              (SELECT count(*)::int FROM integration_executions WHERE status='dead_letter')
                +(SELECT count(*)::int FROM webhook_deliveries WHERE status='dead_letter') AS dead_letter_executions`
    ),
    getPool().query(
      `SELECT o.id,o.slug,o.name,
              count(DISTINCT c.code)::int AS catalog_assets,
              count(DISTINCT ac.asset_code)::int AS architecture_controls,
              count(DISTINCT p.asset_code) FILTER(WHERE p.active=true)::int AS lifecycle_policies,
              count(DISTINCT s.domain)::int AS assigned_stewards,
              count(DISTINCT h.id) FILTER(WHERE h.status='active')::int AS active_holds,
              count(DISTINCT d.id) FILTER(WHERE d.status='pending')::int AS pending_dispositions,
              (SELECT count(*)::int FROM documents doc WHERE doc.organization_id=o.id) AS documents,
              (SELECT count(*)::int FROM documents doc WHERE doc.organization_id=o.id AND doc.current_version_id IS NULL AND doc.status<>'disposed') AS documents_without_version,
              (SELECT count(*)::int FROM integration_contracts ic WHERE ic.organization_id=o.id AND ic.status='active') AS active_integrations,
              (SELECT count(*)::int FROM integration_executions ie WHERE ie.organization_id=o.id AND ie.status='dead_letter')
                +(SELECT count(*)::int FROM webhook_deliveries wd WHERE wd.organization_id=o.id AND wd.status='dead_letter') AS dead_letter_executions,
              (SELECT count(*)::int FROM organization_kpis ok WHERE ok.organization_id=o.id AND ok.enabled=true) AS enabled_kpis,
              (SELECT count(*)::int FROM data_quality_measurements qm WHERE qm.organization_id=o.id) AS quality_measurements,
              (SELECT count(*)::int FROM data_quality_measurements qm WHERE qm.organization_id=o.id AND qm.outcome='fail') AS quality_failures,
              (SELECT count(*)::int FROM data_quality_findings qf WHERE qf.organization_id=o.id
                AND qf.status NOT IN('resolved','accepted_exception','rejected')) AS open_findings,
              (SELECT count(*)::int FROM data_quality_findings qf WHERE qf.organization_id=o.id
                AND qf.severity IN('high','critical') AND qf.status NOT IN('resolved','rejected')) AS high_risk_findings,
              (SELECT count(*)::int FROM data_quality_findings qf WHERE qf.organization_id=o.id
                AND qf.learning_status='candidate') AS learning_candidates
         FROM organizations o
         CROSS JOIN data_catalog_assets c
         LEFT JOIN organization_data_asset_controls ac ON ac.organization_id=o.id AND ac.asset_code=c.code
         LEFT JOIN data_lifecycle_policies p ON p.organization_id=o.id AND p.asset_code=c.code
         LEFT JOIN organization_data_stewards s ON s.organization_id=o.id AND s.domain=c.domain
         LEFT JOIN data_legal_holds h ON h.organization_id=o.id AND h.asset_code=c.code
         LEFT JOIN data_disposition_requests d ON d.organization_id=o.id AND d.asset_code=c.code
        WHERE o.status='active' AND c.active=true
        GROUP BY o.id ORDER BY o.name`
    ),
    directoryStats(path.resolve(process.env.UPLOAD_DIR||"/app/uploads")),
    fs.readdir(path.resolve(process.env.BACKUP_DIR||"/app/backups")).catch(error=>error.code==="ENOENT"?[]:Promise.reject(error)),
  ]);
  const latestBackup=backupNames.filter(name=>/^(overva|erp-v2)-\d{8}T\d{6}Z$/.test(name)).sort().at(-1)||null;
  let latestBackupBytes=0;
  if(latestBackup){const stats=await directoryStats(path.join(path.resolve(process.env.BACKUP_DIR||"/app/backups"),latestBackup));latestBackupBytes=stats.bytes;}
  const backupTimestamp=latestBackup?.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const backupDate=backupTimestamp?new Date(`${backupTimestamp[1]}-${backupTimestamp[2]}-${backupTimestamp[3]}T${backupTimestamp[4]}:${backupTimestamp[5]}:${backupTimestamp[6]}Z`):null;
  const latestBackupAgeHours=backupDate?Math.max(0,(Date.now()-backupDate.getTime())/3600000):null;
  const backupStaleHours=Math.max(1,Number(process.env.BACKUP_STALE_HOURS||36));
  res.json({ status:"healthy",...database.rows[0],upload_files:uploads.files,upload_bytes:uploads.bytes,
    latest_backup:latestBackup,latest_backup_bytes:latestBackupBytes,
    latest_backup_age_hours:latestBackupAgeHours,backup_stale_hours:backupStaleHours,
    backup_status:latestBackupAgeHours!==null&&latestBackupAgeHours<=backupStaleHours?"current":"stale",
    governance:{...governance.rows[0],organizations:governanceOrganizations.rows},
    api_uptime_seconds:Math.floor(process.uptime()) });
}));

router.get("/organizations", requirePlatformPermissions("platform.organizations.read"), asyncHandler(async (_req, res) => {
  const result = await getPool().query(
    `SELECT o.id,o.slug,o.name,o.status,o.created_at,
            s.plan_code,s.status AS subscription_status,s.starts_at,s.ends_at,
            count(DISTINCT u.id)::int AS user_count,
            count(DISTINCT a.id)::int AS asset_count,
            count(DISTINCT w.id)::int AS work_order_count
       FROM organizations o
       LEFT JOIN subscriptions s ON s.organization_id=o.id
       LEFT JOIN users u ON u.organization_id=o.id
       LEFT JOIN assets a ON a.organization_id=o.id
       LEFT JOIN work_orders w ON w.organization_id=o.id
      GROUP BY o.id,s.id
      ORDER BY o.created_at DESC`
  );
  res.json({ items: result.rows });
}));

router.get("/organizations/:id/control", requirePlatformPermissions("platform.organizations.read"), asyncHandler(async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid organization id" });
  const organizationId = id.data;
  const [organization, modules, readiness, governance, operations, billing, recentActivity] = await Promise.all([
    getPool().query(
      `SELECT o.id,o.slug,o.name,o.status,o.timezone,o.created_at,o.updated_at,
              s.plan_code,s.status AS subscription_status,s.starts_at,s.ends_at,
              p.name AS plan_name,p.user_limit,p.storage_gb,
              ip.template_code,it.name AS industry_name,
              (os.short_name<>'') AS has_short_name,(os.registration_no<>'') AS has_registration,
              (os.email<>'' OR os.phone<>'') AS has_contact
         FROM organizations o
         LEFT JOIN subscriptions s ON s.organization_id=o.id
         LEFT JOIN plan_catalog p ON p.code=s.plan_code
         LEFT JOIN organization_settings os ON os.organization_id=o.id
         LEFT JOIN organization_industry_profiles ip ON ip.organization_id=o.id AND ip.primary_profile=true
         LEFT JOIN industry_templates it ON it.code=ip.template_code
        WHERE o.id=$1`, [organizationId]
    ),
    getPool().query(
      `SELECT m.code,m.name,m.category,COALESCE(om.enabled,false) AS enabled
         FROM module_catalog m LEFT JOIN organization_modules om
           ON om.module_code=m.code AND om.organization_id=$1
        WHERE m.active=true ORDER BY m.core DESC,m.category,m.name`, [organizationId]
    ),
    getPool().query(
      `SELECT (SELECT count(*)::int FROM departments WHERE organization_id=$1) AS departments,
              (SELECT count(*)::int FROM positions WHERE organization_id=$1) AS positions,
              (SELECT count(*)::int FROM employees WHERE organization_id=$1 AND active=true) AS active_employees,
              (SELECT count(*)::int FROM users WHERE organization_id=$1) AS login_accounts,
              (SELECT count(*)::int FROM users WHERE organization_id=$1 AND active=true AND can_login=true) AS active_login_accounts,
              (SELECT count(DISTINCT ur.user_id)::int FROM user_roles ur JOIN organization_roles r
                ON r.organization_id=ur.organization_id AND r.id=ur.role_id
                WHERE ur.organization_id=$1 AND r.code IN('owner','administrator')) AS admin_accounts,
              (SELECT count(*)::int FROM builder_projects WHERE organization_id=$1) AS builder_projects,
              (SELECT count(*)::int FROM builder_builds WHERE organization_id=$1 AND status='applied') AS applied_builds,
              (SELECT count(*)::int FROM ai_builder_proposals WHERE organization_id=$1 AND status='proposed') AS pending_ai_proposals,
              (SELECT max(created_at) FROM audit_logs WHERE organization_id=$1 AND action='auth.login') AS last_tenant_login`,
      [organizationId]
    ),
    getPool().query(
      `SELECT (SELECT count(*)::int FROM organization_data_asset_controls WHERE organization_id=$1) AS architecture_controls,
              (SELECT count(*)::int FROM data_lifecycle_policies WHERE organization_id=$1 AND active=true) AS lifecycle_policies,
              (SELECT count(*)::int FROM organization_data_stewards WHERE organization_id=$1) AS data_stewards,
              (SELECT count(*)::int FROM organization_kpis WHERE organization_id=$1 AND enabled=true) AS enabled_kpis,
              (SELECT count(*)::int FROM data_quality_measurements WHERE organization_id=$1) AS quality_measurements,
              (SELECT count(*)::int FROM data_quality_measurements WHERE organization_id=$1 AND outcome='fail') AS quality_failures,
              (SELECT count(*)::int FROM data_legal_holds WHERE organization_id=$1 AND status='active') AS active_holds,
              (SELECT count(*)::int FROM data_disposition_requests WHERE organization_id=$1 AND status='pending') AS pending_dispositions`,
      [organizationId]
    ),
    getPool().query(
      `SELECT (SELECT count(*)::int FROM documents WHERE organization_id=$1) AS documents,
              (SELECT count(*)::int FROM documents WHERE organization_id=$1 AND current_version_id IS NULL AND status<>'disposed') AS documents_without_version,
              (SELECT count(*)::int FROM integration_contracts WHERE organization_id=$1 AND status='active') AS active_integrations,
              (SELECT count(*)::int FROM integration_executions WHERE organization_id=$1 AND status='dead_letter')
                +(SELECT count(*)::int FROM webhook_deliveries WHERE organization_id=$1 AND status='dead_letter') AS dead_letter_executions,
              (SELECT count(*)::int FROM security_audit_events WHERE organization_id=$1 AND outcome IN('failure','denied') AND created_at>=now()-interval '24 hours') AS security_events_24h,
              (SELECT count(*)::int FROM builder_support_requests WHERE organization_id=$1 AND status IN('open','reviewing')) AS open_support_requests`,
      [organizationId]
    ),
    getPool().query(
      `SELECT COALESCE(sum(i.amount),0)::numeric AS invoiced_total,
              COALESCE(sum(p.paid_amount),0)::numeric AS paid_total,
              count(*) FILTER(WHERE i.status IN('issued','overdue'))::int AS unpaid_invoices,
              count(*) FILTER(WHERE i.status IN('issued','overdue') AND i.due_date<CURRENT_DATE)::int AS overdue_invoices
         FROM billing_invoices i
         LEFT JOIN (SELECT organization_id,invoice_id,sum(amount)::numeric AS paid_amount
                      FROM billing_payments GROUP BY organization_id,invoice_id) p
           ON p.organization_id=i.organization_id AND p.invoice_id=i.id
        WHERE i.organization_id=$1`, [organizationId]
    ),
    getPool().query(
      `SELECT action,entity_type,created_at FROM audit_logs
        WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 10`, [organizationId]
    ),
  ]);
  if (!organization.rowCount) return res.status(404).json({ error: "Organization not found" });
  res.json({
    organization: organization.rows[0],
    modules: modules.rows,
    readiness: readiness.rows[0],
    governance: governance.rows[0],
    operations: operations.rows[0],
    billing: billing.rows[0],
    recent_activity: recentActivity.rows,
  });
}));

router.post("/organizations", requirePlatformPermissions("platform.organizations.manage"), asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Байгууллагын мэдээлэл дутуу эсвэл буруу байна" });
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const provisioned = await provisionTenant(client, value);
    const { organization, subscription } = provisioned;
    await platformAudit(client, req.platformAdmin, req, "organization.create", organization.id, {
      slug: value.slug, planCode: value.planCode, trialDays: value.trialDays,
    });
    await client.query("COMMIT");
    res.status(201).json({ item: { ...organization, ...subscription } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/organizations/:id", requirePlatformPermissions("platform.organizations.manage"), asyncHandler(async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Invalid organization update" });
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const org = await client.query(
      `UPDATE organizations SET status=COALESCE($2,status),updated_at=now()
        WHERE id=$1 RETURNING id,slug,name,status,created_at`,
      [id.data, value.organizationStatus]
    );
    if (!org.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Organization not found" });
    }
    const subscription = await client.query(
      `UPDATE subscriptions
          SET status=COALESCE($2,status),plan_code=COALESCE($3,plan_code),
              ends_at=CASE WHEN $4::boolean THEN $5::timestamptz ELSE ends_at END,updated_at=now()
        WHERE organization_id=$1 RETURNING plan_code,status AS subscription_status,starts_at,ends_at`,
      [id.data, value.subscriptionStatus, value.planCode, Object.hasOwn(value, "endsAt"), value.endsAt]
    );
    await platformAudit(client, req.platformAdmin, req, "organization.update", id.data, value);
    await client.query("COMMIT");
    res.json({ item: { ...org.rows[0], ...subscription.rows[0] } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
