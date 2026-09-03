"use strict";

const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { loadConfig } = require("../config");
const { getPool, setTenantContext } = require("../db");
const { authenticate, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { buildPlan, applyConfiguration } = require("../services/builder-engine");
const { askBuilderAi } = require("../services/openai-builder");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const code = z.string().trim().regex(/^[a-z0-9-]{2,80}$/);
const answers = z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 20000, "Answers are too large");
const projectSchema = z.object({ name: z.string().trim().min(2).max(160), answers: answers.default({}) });
const planSchema = z.object({ profileCode: code, moduleCodes: z.array(code).max(50).default([]), answers: answers.default({}), buildKind:z.enum(["build","repair"]).default("build") });
const aiSessionSchema = z.object({ title: z.string().trim().min(2).max(160).default("ERP хэрэгцээ тодорхойлох"), projectId: uuid.nullable().optional(), operationMode:z.enum(["advisory","build","repair"]).default("advisory") });
const aiMessageSchema = z.object({ content: z.string().trim().min(2).max(6000) });
const aiMessageLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

router.use(authenticate, requirePermissions("builder.manage"));

async function loadCatalog(client = getPool()) {
  const [modules, templates, templateModules, templateAssets, templateWorkTypes, questions, rules] = await Promise.all([
    client.query("SELECT code,name,description,category,monthly_price,core,active FROM module_catalog WHERE active=true ORDER BY core DESC,category,name"),
    client.query("SELECT code,name,description,active,maturity,version FROM industry_templates WHERE active=true AND maturity<>'deprecated' ORDER BY CASE maturity WHEN 'verified' THEN 0 WHEN 'pilot' THEN 1 ELSE 2 END,name"),
    client.query("SELECT template_code,module_code,recommended,enabled_by_default FROM industry_template_modules ORDER BY template_code,module_code"),
    client.query("SELECT template_code,code,name,description FROM industry_template_asset_categories ORDER BY template_code,code"),
    client.query("SELECT template_code,code,name,category,description FROM industry_template_work_types ORDER BY template_code,code"),
    client.query("SELECT code,section,prompt,help_text,input_type,options,required,sequence FROM builder_questions WHERE active=true ORDER BY sequence,code"),
    client.query("SELECT code,rule_type,subject_type,subject_code,condition,effect,message,priority,active FROM builder_rules WHERE active=true ORDER BY priority,code"),
  ]);
  return { modules: modules.rows, templates: templates.rows, templateModules: templateModules.rows,
    templateAssets: templateAssets.rows, templateWorkTypes: templateWorkTypes.rows, questions: questions.rows, rules: rules.rows };
}

router.get("/catalog", asyncHandler(async (_req, res) => res.json(await loadCatalog())));

router.get("/current", asyncHandler(async (req, res) => {
  const org = req.user.organization_id;
  const [modules, profile, projects, builds] = await Promise.all([
    getPool().query(`SELECT mc.code,mc.name,mc.category,mc.core,COALESCE(om.enabled,mc.core) AS enabled
      FROM module_catalog mc LEFT JOIN organization_modules om ON om.organization_id=$1 AND om.module_code=mc.code
      WHERE mc.active=true ORDER BY mc.core DESC,mc.category,mc.name`, [org]),
    getPool().query(`SELECT p.template_code,t.name,t.maturity,t.version FROM organization_industry_profiles p
      JOIN industry_templates t ON t.code=p.template_code WHERE p.organization_id=$1 AND p.primary_profile=true LIMIT 1`, [org]),
    getPool().query("SELECT id,name,status,answers,created_at,updated_at FROM builder_projects WHERE organization_id=$1 AND name<>'Одоогийн тохиргоо' ORDER BY updated_at DESC LIMIT 20", [org]),
    getPool().query(`SELECT b.id,b.project_id,b.version_no,b.build_kind,b.configuration,b.validation,b.status,b.created_at,b.applied_at
      FROM builder_builds b WHERE b.organization_id=$1 ORDER BY b.created_at DESC LIMIT 30`, [org]),
  ]);
  res.json({ modules: modules.rows, profile: profile.rows[0] || null, projects: projects.rows, builds: builds.rows });
}));

router.get("/ai/status", asyncHandler(async (_req, res) => {
  const config = loadConfig();
  res.json({ enabled: config.ai.enabled, model: config.ai.model, agent: "ba_builder", execution: "proposal_only" });
}));

router.get("/ai/sessions", asyncHandler(async (req, res) => {
  const result = await getPool().query(
    `SELECT id,project_id,title,operation_mode,status,created_at,updated_at FROM ai_agent_sessions
     WHERE organization_id=$1 AND agent_type='ba_builder' ORDER BY updated_at DESC LIMIT 30`,
    [req.user.organization_id]
  );
  res.json({ items: result.rows });
}));

router.post("/ai/sessions", asyncHandler(async (req, res) => {
  const parsed = aiSessionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "AI ярилцлагын мэдээлэл буруу байна", issues: parsed.error.issues });
  const org = req.user.organization_id, projectId = parsed.data.projectId || null;
  if (projectId) {
    const project = await getPool().query("SELECT id FROM builder_projects WHERE organization_id=$1 AND id=$2", [org, projectId]);
    if (!project.rowCount) return res.status(404).json({ error: "Builder төсөл олдсонгүй" });
  }
  const result = await getPool().query(
    `INSERT INTO ai_agent_sessions(organization_id,project_id,agent_type,title,operation_mode,created_by)
     VALUES($1,$2,'ba_builder',$3,$4,$5) RETURNING id,project_id,title,operation_mode,status,created_at,updated_at`,
    [org, projectId, parsed.data.title, parsed.data.operationMode, req.user.id]
  );
  await writeAudit(req, "ai.builder_session_create", "ai_agent_session", result.rows[0].id, { projectId, agentType: "ba_builder", operationMode:parsed.data.operationMode });
  res.status(201).json({ item: result.rows[0] });
}));

router.get("/ai/sessions/:id", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "AI ярилцлагын дугаар буруу байна" });
  const org = req.user.organization_id;
  const [session, messages, proposals] = await Promise.all([
    getPool().query(`SELECT id,project_id,title,operation_mode,status,created_at,updated_at FROM ai_agent_sessions
      WHERE organization_id=$1 AND id=$2 AND agent_type='ba_builder'`, [org, id.data]),
    getPool().query(`SELECT id,role,content,model,metadata,created_at FROM ai_agent_messages
      WHERE organization_id=$1 AND session_id=$2 ORDER BY created_at,id LIMIT 200`, [org, id.data]),
    getPool().query(`SELECT id,message_id,proposal,deterministic_validation,status,reviewed_at,created_at
      FROM ai_builder_proposals WHERE organization_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 30`, [org, id.data]),
  ]);
  if (!session.rowCount) return res.status(404).json({ error: "AI ярилцлага олдсонгүй" });
  res.json({ item: session.rows[0], messages: messages.rows, proposals: proposals.rows });
}));

router.post("/ai/sessions/:id/messages", aiMessageLimiter, asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id), parsed = aiMessageSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "AI-д илгээх мэдээлэл буруу байна" });
  const config = loadConfig();
  if (!config.ai.enabled) return res.status(503).json({ error: "OVERVA BA AI одоогоор идэвхжээгүй байна" });
  const org = req.user.organization_id;
  const session = await getPool().query(`SELECT id,operation_mode FROM ai_agent_sessions
    WHERE organization_id=$1 AND id=$2 AND agent_type='ba_builder' AND status='active'`, [org, id.data]);
  if (!session.rowCount) return res.status(404).json({ error: "Идэвхтэй AI ярилцлага олдсонгүй" });

  const userMessage = await getPool().query(`INSERT INTO ai_agent_messages(organization_id,session_id,role,content,created_by)
    VALUES($1,$2,'user',$3,$4) RETURNING id,role,content,created_at`, [org,id.data,parsed.data.content,req.user.id]);
  await writeAudit(req,"ai.builder_message_create","ai_agent_message",userMessage.rows[0].id,{sessionId:id.data,role:"user"});

  const [history, catalog, current] = await Promise.all([
    getPool().query(`SELECT role,content FROM ai_agent_messages WHERE organization_id=$1 AND session_id=$2
      ORDER BY created_at DESC,id DESC LIMIT 30`, [org,id.data]),
    loadCatalog(),
    getPool().query(`SELECT mc.code FROM module_catalog mc LEFT JOIN organization_modules om
      ON om.organization_id=$1 AND om.module_code=mc.code WHERE mc.active=true AND (mc.core=true OR om.enabled=true)`, [org]),
  ]);
  let reply;
  try {
    reply = await askBuilderAi({ config, catalog, messages: history.rows.reverse() });
  } catch (error) {
    console.error("[builder ai]", { code: error.code, message: error.message });
    const status = error.code === "AI_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json({ error: status === 503 ? "OVERVA BA AI идэвхжээгүй байна" : "OVERVA BA AI үйлчилгээ түр хариу өгөхгүй байна" });
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const assistant = await client.query(`INSERT INTO ai_agent_messages
      (organization_id,session_id,role,content,model,provider_response_id,metadata)
      VALUES($1,$2,'assistant',$3,$4,$5,$6::jsonb) RETURNING id,role,content,model,metadata,created_at`,
      [org,id.data,reply.message,reply.model,reply.providerResponseId,JSON.stringify({stage:reply.stage,understood:reply.understood,questions:reply.questions,readyForPlan:reply.readyForPlan,usage:reply.usage})]);
    await client.query(`INSERT INTO ai_usage_events(organization_id,session_id,message_id,provider,operation_mode,model,
      provider_response_id,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,scope,created_by,metadata)
      VALUES($1,$2,$3,'openai',$4,$5,$6,$7,$8,$9,$10,$11,'builder_interview',$12,$13::jsonb)`,
      [org,id.data,assistant.rows[0].id,session.rows[0].operation_mode,reply.model,reply.providerResponseId,
       reply.usage.inputTokens,reply.usage.cachedInputTokens,reply.usage.outputTokens,reply.usage.reasoningTokens,reply.usage.totalTokens,
       req.user.id,JSON.stringify({stage:reply.stage,proposalCreated:Boolean(reply.proposal)})]);
    let proposal = null;
    if (reply.proposal) {
      const validation = buildPlan({ ...reply.proposal, answers: {}, currentEnabledModules: current.rows.map(row=>row.code) }, catalog);
      const created = await client.query(`INSERT INTO ai_builder_proposals
        (organization_id,session_id,message_id,proposal,deterministic_validation)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb)
        RETURNING id,message_id,proposal,deterministic_validation,status,created_at`,
        [org,id.data,assistant.rows[0].id,JSON.stringify(reply.proposal),JSON.stringify(validation)]);
      proposal = created.rows[0];
    }
    await client.query("UPDATE ai_agent_sessions SET updated_at=now() WHERE organization_id=$1 AND id=$2", [org,id.data]);
    await writeAudit(req,"ai.builder_response_create","ai_agent_message",assistant.rows[0].id,
      {sessionId:id.data,model:reply.model,stage:reply.stage,proposalId:proposal?.id||null,proposalValid:proposal?.deterministic_validation?.valid??null},client);
    await client.query("COMMIT");
    res.status(201).json({ userMessage:userMessage.rows[0], assistantMessage:assistant.rows[0], proposal });
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}));

router.get("/ai/usage", asyncHandler(async (req, res) => {
  const days=z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.days);
  const result=await getPool().query(`SELECT provider,operation_mode,model,count(*)::int AS calls,
    COALESCE(sum(input_tokens),0)::bigint AS input_tokens,COALESCE(sum(cached_input_tokens),0)::bigint AS cached_input_tokens,
    COALESCE(sum(output_tokens),0)::bigint AS output_tokens,COALESCE(sum(total_tokens),0)::bigint AS total_tokens,
    COALESCE(sum(external_credits),0)::numeric AS external_credits
    FROM ai_usage_events WHERE organization_id=$1 AND created_at>=now()-($2::text||' days')::interval
    GROUP BY provider,operation_mode,model ORDER BY total_tokens DESC,provider,operation_mode`,[req.user.organization_id,days]);
  res.json({days,items:result.rows});
}));

router.post("/ai/proposals/:id/accept", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "AI саналын дугаар буруу байна" });
  const org=req.user.organization_id, client=await getPool().connect();
  try {
    await client.query("BEGIN");
    const found=await client.query(`SELECT * FROM ai_builder_proposals WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[org,id.data]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"AI санал олдсонгүй"});}
    if(found.rows[0].status!=="proposed"){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ AI саналыг өмнө нь хянасан байна"});}
    const catalog=await loadCatalog(client);
    const current=await client.query(`SELECT mc.code FROM module_catalog mc LEFT JOIN organization_modules om
      ON om.organization_id=$1 AND om.module_code=mc.code WHERE mc.active=true AND (mc.core=true OR om.enabled=true)`,[org]);
    const fresh=buildPlan({...found.rows[0].proposal,answers:{},currentEnabledModules:current.rows.map(row=>row.code)},catalog);
    if(!fresh.valid){await client.query("ROLLBACK");return res.status(422).json({error:"AI санал одоогийн дүрмийн сангийн шалгалтыг даваагүй",validation:fresh});}
    const accepted=await client.query(`UPDATE ai_builder_proposals SET status='accepted',reviewed_by=$3,reviewed_at=now(),
      deterministic_validation=$4::jsonb WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data,req.user.id,JSON.stringify(fresh)]);
    await writeAudit(req,"ai.builder_proposal_accept","ai_builder_proposal",id.data,
      {sessionId:accepted.rows[0].session_id,profileCode:fresh.configuration.profileCode,modules:fresh.configuration.enabledModules},client);
    await client.query("COMMIT");
    res.json({item:accepted.rows[0],configuration:fresh.configuration,notice:"Санал Builder-д ороход бэлэн. Төлөвлөгөө үүсгэж, тусад нь хэрэгжүүлнэ."});
  } catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;} finally{client.release();}
}));

router.post("/ai/proposals/:id/reject", asyncHandler(async (req, res) => {
  const id=uuid.safeParse(req.params.id);
  if(!id.success)return res.status(400).json({error:"AI саналын дугаар буруу байна"});
  const result=await getPool().query(`UPDATE ai_builder_proposals SET status='rejected',reviewed_by=$3,reviewed_at=now()
    WHERE organization_id=$1 AND id=$2 AND status='proposed' RETURNING *`,[req.user.organization_id,id.data,req.user.id]);
  if(!result.rowCount)return res.status(404).json({error:"Хүлээгдэж буй AI санал олдсонгүй"});
  await writeAudit(req,"ai.builder_proposal_reject","ai_builder_proposal",id.data,{sessionId:result.rows[0].session_id});
  res.json({item:result.rows[0]});
}));

router.post("/projects", asyncHandler(async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Builder төслийн мэдээлэл буруу байна", issues: parsed.error.issues });
  const result = await getPool().query(
    `INSERT INTO builder_projects(organization_id,name,answers,created_by) VALUES($1,$2,$3::jsonb,$4) RETURNING *`,
    [req.user.organization_id, parsed.data.name, JSON.stringify(parsed.data.answers), req.user.id]
  );
  await writeAudit(req, "builder.project_create", "builder_project", result.rows[0].id, { name: parsed.data.name });
  res.status(201).json({ item: result.rows[0] });
}));

router.post("/projects/:id/plan", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id), parsed = planSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Builder төлөвлөгөөний мэдээлэл буруу байна" });
  const org = req.user.organization_id, client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client,org);
    const project = await client.query("SELECT id FROM builder_projects WHERE organization_id=$1 AND id=$2 FOR UPDATE", [org, id.data]);
    if (!project.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Builder төсөл олдсонгүй" }); }
    const catalog = await loadCatalog(client);
    const current = await client.query(`SELECT mc.code FROM module_catalog mc LEFT JOIN organization_modules om
      ON om.organization_id=$1 AND om.module_code=mc.code WHERE mc.active=true AND (mc.core=true OR om.enabled=true)`, [org]);
    const plan = buildPlan({ ...parsed.data, currentEnabledModules: current.rows.map(row => row.code) }, catalog);
    if (!plan.valid) { await client.query("ROLLBACK"); return res.status(422).json({ error: "Төлөвлөгөө баталгаажсангүй", validation: plan }); }
    const version = await client.query("SELECT COALESCE(max(version_no),0)+1 AS next FROM builder_builds WHERE organization_id=$1 AND project_id=$2", [org, id.data]);
    const snapshot = { modules: catalog.modules, templates: catalog.templates, rules: catalog.rules };
    const result = await client.query(
      `INSERT INTO builder_builds(organization_id,project_id,version_no,build_kind,catalog_snapshot,configuration,validation,created_by)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) RETURNING *`,
      [org, id.data, version.rows[0].next, parsed.data.buildKind, JSON.stringify(snapshot), JSON.stringify(plan.configuration), JSON.stringify(plan), req.user.id]
    );
    await client.query("UPDATE builder_projects SET status='planned',answers=$3::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2", [org, id.data, JSON.stringify(parsed.data.answers)]);
    await writeAudit(req, "builder.plan_create", "builder_build", result.rows[0].id, { projectId: id.data, version: result.rows[0].version_no, profileCode: parsed.data.profileCode, modules: plan.configuration.enabledModules }, client);
    await client.query("COMMIT");
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}));

async function applyBuild(req, res, buildId) {
  const org = req.user.organization_id, client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client,org);
    const result = await client.query(`SELECT * FROM builder_builds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [org, buildId]);
    if (!result.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Builder хувилбар олдсонгүй" }); }
    const build = result.rows[0];
    if (build.status !== "planned") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Зөвхөн төлөвлөсөн хувилбарыг хэрэгжүүлнэ" }); }
    const catalog = await loadCatalog(client);
    const current = await client.query(`SELECT mc.code FROM module_catalog mc LEFT JOIN organization_modules om
      ON om.organization_id=$1 AND om.module_code=mc.code WHERE mc.active=true AND (mc.core=true OR om.enabled=true)`, [org]);
    const validation = buildPlan({ moduleCodes: build.configuration.enabledModules, profileCode: build.configuration.profileCode,
      answers: build.configuration.answers, currentEnabledModules: current.rows.map(row => row.code) }, catalog);
    if (!validation.valid) { await client.query("ROLLBACK"); return res.status(422).json({ error: "Одоогийн каталогийн дүрмээр хэрэгжүүлэх боломжгүй", validation }); }
    await applyConfiguration(client, org, req.user.id, validation.configuration);
    await client.query("UPDATE builder_builds SET status='superseded' WHERE organization_id=$1 AND project_id=$2 AND status='applied'", [org, build.project_id]);
    const applied = await client.query("UPDATE builder_builds SET status='applied',configuration=$3::jsonb,validation=$4::jsonb,applied_by=$5,applied_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *", [org, build.id, JSON.stringify(validation.configuration), JSON.stringify(validation), req.user.id]);
    await client.query("UPDATE builder_projects SET status='applied',updated_at=now() WHERE organization_id=$1 AND id=$2", [org, build.project_id]);
    await writeAudit(req, "builder.build_apply", "builder_build", build.id, { projectId: build.project_id, version: build.version_no, profileCode: validation.configuration.profileCode, modules: validation.configuration.enabledModules }, client);
    await client.query("COMMIT");
    return res.json({ item: applied.rows[0] });
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

router.post("/builds/:id/apply", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Builder хувилбарын дугаар буруу байна" });
  return applyBuild(req, res, id.data);
}));

router.post("/builds/:id/restore", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Сэргээх хувилбарын дугаар буруу байна" });
  const org = req.user.organization_id, client = await getPool().connect();
  let restoredId;
  try {
    await client.query("BEGIN");
    const target = await client.query("SELECT * FROM builder_builds WHERE organization_id=$1 AND id=$2", [org, id.data]);
    if (!target.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Сэргээх хувилбар олдсонгүй" }); }
    await client.query("SELECT id FROM builder_projects WHERE organization_id=$1 AND id=$2 FOR UPDATE", [org, target.rows[0].project_id]);
    const version = await client.query("SELECT COALESCE(max(version_no),0)+1 AS next FROM builder_builds WHERE organization_id=$1 AND project_id=$2", [org, target.rows[0].project_id]);
    const catalog = await loadCatalog(client);
    const current = await client.query(`SELECT mc.code FROM module_catalog mc LEFT JOIN organization_modules om
      ON om.organization_id=$1 AND om.module_code=mc.code WHERE mc.active=true AND (mc.core=true OR om.enabled=true)`, [org]);
    const plan = buildPlan({ moduleCodes: target.rows[0].configuration.enabledModules, profileCode: target.rows[0].configuration.profileCode,
      answers: target.rows[0].configuration.answers, currentEnabledModules: current.rows.map(row => row.code) }, catalog);
    if (!plan.valid) { await client.query("ROLLBACK"); return res.status(422).json({ error: "Энэ хувилбарыг одоогийн каталогоор сэргээх боломжгүй", validation: plan }); }
    const created = await client.query(`INSERT INTO builder_builds(organization_id,project_id,version_no,build_kind,based_on_build_id,catalog_snapshot,configuration,validation,created_by)
      VALUES($1,$2,$3,'restore',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) RETURNING id`, [org,target.rows[0].project_id,version.rows[0].next,target.rows[0].id,
      JSON.stringify({ modules: catalog.modules, templates: catalog.templates, rules: catalog.rules }),JSON.stringify(plan.configuration),JSON.stringify(plan),req.user.id]);
    restoredId = created.rows[0].id;
    await writeAudit(req,"builder.restore_plan_create","builder_build",restoredId,{restoredFrom:id.data,version:version.rows[0].next},client);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
  return applyBuild(req, res, restoredId);
}));

router.post("/support-requests", asyncHandler(async (req, res) => {
  const parsed = z.object({ projectId: uuid.nullable().optional(), buildId: uuid.nullable().optional(), title: z.string().trim().min(3).max(200), description: z.string().trim().min(10).max(5000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Зөвлөгөөний хүсэлтийн мэдээлэл буруу байна" });
  const v = parsed.data, result = await getPool().query(`INSERT INTO builder_support_requests(organization_id,project_id,build_id,title,description,created_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [req.user.organization_id,v.projectId||null,v.buildId||null,v.title,v.description,req.user.id]);
  await writeAudit(req,"builder.support_request_create","builder_support_request",result.rows[0].id,{projectId:v.projectId||null,buildId:v.buildId||null,title:v.title});
  res.status(201).json({ item: result.rows[0] });
}));

module.exports = router;
