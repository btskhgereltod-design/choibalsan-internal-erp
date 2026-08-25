"use strict";

const express = require("express");
const { z } = require("zod");
const { loadConfig } = require("../config");
const { getPool } = require("../db");
const { authenticate, requireSystemRoles } = require("../middleware/auth");
const { asyncHandler } = require("../utils/async-handler");
const { writeAudit } = require("../services/audit");
const { selectBlueprintCatalog } = require("../services/organization-blueprint");
const { nextInterviewQuestion } = require("../services/requirements-method");
const { normalizeInterviewAnswer } = require("../services/openai-requirements");
const { ensureGrowthProfile, recordGrowthEvent } = require("../services/growth-journey");

const router = express.Router();
const owner = requireSystemRoles("owner");
const uuid = z.string().uuid();
const sectors = ["general","retail","services","healthcare","education","construction","road","mining","transport","delivery","manufacturing","food-production","agriculture","government","public-service","ngo","other"];
const needs = ["finance","accounting","hr","attendance","sales","customers","service","inventory","warehouse","procurement","operations","field","maintenance","delivery","safety","quality","compliance","it","devices","digital"];
const profileSchema = z.object({
  organizationType:z.enum(["company","government","ngo","individual","cooperative","other"]),
  sector:z.enum(sectors),
  employeeCount:z.coerce.number().int().min(1).max(1000000),
  branchCount:z.coerce.number().int().min(1).max(10000).default(1),
  hasShifts:z.boolean().default(false),
  needs:z.array(z.enum(needs)).max(needs.length).default([]),
  activities:z.string().trim().max(3000).default("")
});
const answerSchema=z.object({questionCode:z.string().trim().min(2).max(100),answerText:z.string().trim().min(1).max(12000)});
const confirmSchema=z.object({answerText:z.string().trim().min(1).max(12000).optional(),corrected:z.boolean().default(false)});

router.use(authenticate, owner);

router.get("/catalog", asyncHandler(async (req,res) => {
  const [catalog,latest] = await Promise.all([
    getPool().query(`SELECT code,name,category,description,sectors,signals,min_employees,departments,recommended_modules,version
      FROM organization_blueprint_catalog WHERE active=true ORDER BY
      CASE category WHEN 'Суурь' THEN 1 WHEN 'Бизнес' THEN 2 WHEN 'Үйл ажиллагаа' THEN 3 WHEN 'Хяналт' THEN 4 ELSE 5 END,name`),
    getPool().query(`SELECT id,status,profile,proposal,catalog_version,created_at,applied_at
      FROM organization_blueprints WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`,[req.user.organization_id])
  ]);
  res.json({sectors,needs,catalog:catalog.rows,latest:latest.rows[0]||null});
}));

router.get("/method", asyncHandler(async (_req,res)=>{
  const method=await getPool().query(`SELECT code,version,name,description,method_definition,status,approved_at
    FROM ai_method_versions ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,version DESC LIMIT 1`);
  if(!method.rowCount)return res.status(404).json({error:"OVERVA requirements method is not installed"});
  const item=method.rows[0];
  const questions=await getPool().query(`SELECT code,sequence_no,stage,prompt_mn,answer_kind,options,branch_rule,required,active
    FROM ai_interview_questions WHERE method_code=$1 AND method_version=$2 AND active=true ORDER BY sequence_no`,[item.code,item.version]);
  res.json({item,questions:questions.rows,canStart:item.status==="active"});
}));

router.post("/interviews", asyncHandler(async(req,res)=>{
  const method=await getPool().query(`SELECT code,version,method_definition FROM ai_method_versions
    WHERE code='overva-requirements' AND status='active' ORDER BY version DESC LIMIT 1`);
  if(!method.rowCount)return res.status(409).json({error:"OVERVA requirements method must be approved by the platform administrator before use"});
  const catalogVersion=await getPool().query("SELECT GREATEST(COALESCE(max(version),1),1) AS version FROM organization_blueprint_catalog WHERE active=true");
  const result=await getPool().query(`INSERT INTO ai_interview_sessions
    (organization_id,method_code,method_version,prompt_version,catalog_version,started_by)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.organization_id,method.rows[0].code,method.rows[0].version,"requirements-v1",catalogVersion.rows[0].version,req.user.id]);
  await ensureGrowthProfile(getPool(),req.user.organization_id,"self_service");
  await recordGrowthEvent(getPool(),{
    organizationId:req.user.organization_id,eventType:"discovery_started",source:"tenant",actorUserId:req.user.id,
    detail:{methodCode:method.rows[0].code,methodVersion:method.rows[0].version,sessionId:result.rows[0].id},
    idempotencyKey:`discovery:${result.rows[0].id}`
  });
  await writeAudit(req,"ai.requirements_interview_start","ai_interview_session",result.rows[0].id,{methodCode:method.rows[0].code,methodVersion:method.rows[0].version});
  res.status(201).json({item:result.rows[0]});
}));

router.get("/interviews/latest", asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT id FROM ai_interview_sessions WHERE organization_id=$1
    AND status IN('active','ready_for_review') ORDER BY started_at DESC LIMIT 1`,[req.user.organization_id]);
  res.json({item:result.rows[0]||null});
}));

router.get("/interviews/:id", asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid interview id"});
  const session=await getPool().query(`SELECT * FROM ai_interview_sessions WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,id.data]);
  if(!session.rowCount)return res.status(404).json({error:"Interview not found"});
  const questions=await getPool().query(`SELECT code,sequence_no,stage,prompt_mn,answer_kind,options,branch_rule,required,active
    FROM ai_interview_questions WHERE method_code=$1 AND method_version=$2 AND active=true ORDER BY sequence_no`,[session.rows[0].method_code,session.rows[0].method_version]);
  const answers=await getPool().query(`SELECT id,question_code,answer_text,normalized_answer,confidence,confirmation_status,supersedes_answer_id,source,model,created_at
    FROM ai_interview_answers WHERE organization_id=$1 AND session_id=$2 ORDER BY created_at,id`,[req.user.organization_id,id.data]);
  res.json({item:session.rows[0],questions:questions.rows,answers:answers.rows,nextQuestion:nextInterviewQuestion(questions.rows,answers.rows)});
}));

router.post("/interviews/:id/answers", asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=answerSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid interview answer",issues:parsed.error?.issues});
  const org=req.user.organization_id;
  const session=await getPool().query(`SELECT s.*,m.method_definition FROM ai_interview_sessions s JOIN ai_method_versions m
    ON m.code=s.method_code AND m.version=s.method_version WHERE s.organization_id=$1 AND s.id=$2 AND s.status='active'`,[org,id.data]);
  if(!session.rowCount)return res.status(404).json({error:"Active interview not found"});
  const question=await getPool().query(`SELECT code,stage,prompt_mn FROM ai_interview_questions
    WHERE method_code=$1 AND method_version=$2 AND code=$3 AND active=true`,[session.rows[0].method_code,session.rows[0].method_version,parsed.data.questionCode]);
  if(!question.rowCount)return res.status(400).json({error:"Question is not part of this method version"});
  const [confirmed,catalog,knowledge]=await Promise.all([
    getPool().query(`SELECT question_code,normalized_answer FROM ai_interview_answers WHERE organization_id=$1 AND session_id=$2
      AND confirmation_status IN('confirmed','corrected') ORDER BY created_at`,[org,id.data]),
    getPool().query("SELECT DISTINCT unnest(signals) AS code FROM organization_blueprint_catalog WHERE active=true"),
    getPool().query(`SELECT code,topic,title,principle_mn,decision_rules,recommended_artifacts
      FROM ai_method_knowledge_units WHERE method_code=$1 AND method_version=$2 AND active=true
      AND stage IN('cross_cutting',$3) ORDER BY CASE WHEN stage=$3 THEN 0 ELSE 1 END,sequence_no LIMIT 8`,
      [session.rows[0].method_code,session.rows[0].method_version,question.rows[0].stage])
  ]);
  let normalized;
  try{normalized=await normalizeInterviewAnswer({config:loadConfig(),method:session.rows[0].method_definition,question:question.rows[0],answerText:parsed.data.answerText,
    confirmedContext:confirmed.rows,approvedSignals:catalog.rows.map(x=>x.code),knowledgeUnits:knowledge.rows,organizationId:org,userId:req.user.id});}
  catch(error){console.error("[requirements ai]",{code:error.code,message:error.message});return res.status(502).json({error:"OVERVA AI could not normalize this answer. Your answer was not saved; please retry."});}
  const result=await getPool().query(`INSERT INTO ai_interview_answers
    (organization_id,session_id,question_code,answer_text,normalized_answer,confidence,source,model,provider_response_id,created_by)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`,[org,id.data,parsed.data.questionCode,parsed.data.answerText,
      JSON.stringify({message:normalized.message,understood:normalized.understood,...normalized.normalized,clarificationQuestions:normalized.clarificationQuestions,mode:normalized.mode}),normalized.confidence,
      normalized.mode==="ai"?"ai_assisted":"user",normalized.model,normalized.providerResponseId,req.user.id]);
  await getPool().query("UPDATE ai_interview_sessions SET current_stage=$3,last_activity_at=now() WHERE organization_id=$1 AND id=$2",[org,id.data,question.rows[0].stage]);
  await writeAudit(req,"ai.requirements_answer_normalized","ai_interview_answer",result.rows[0].id,{sessionId:id.data,questionCode:parsed.data.questionCode,mode:normalized.mode,confirmationStatus:"pending"});
  res.status(201).json({item:result.rows[0],normalization:normalized});
}));

router.post("/interviews/:sessionId/answers/:answerId/confirm", asyncHandler(async(req,res)=>{
  const sessionId=uuid.safeParse(req.params.sessionId),answerId=uuid.safeParse(req.params.answerId),parsed=confirmSchema.safeParse(req.body||{});
  if(!sessionId.success||!answerId.success||!parsed.success)return res.status(400).json({error:"Invalid confirmation"});
  const org=req.user.organization_id,client=await getPool().connect();
  try{await client.query("BEGIN");
    const pending=await client.query(`SELECT a.*,s.method_code,s.method_version FROM ai_interview_answers a JOIN ai_interview_sessions s
      ON s.organization_id=a.organization_id AND s.id=a.session_id WHERE a.organization_id=$1 AND a.session_id=$2 AND a.id=$3
      AND a.confirmation_status='pending' AND s.status='active' FOR UPDATE OF s`,[org,sessionId.data,answerId.data]);
    if(!pending.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Pending answer not found"});}
    const original=pending.rows[0],answerText=parsed.data.answerText||original.answer_text,status=parsed.data.corrected||answerText!==original.answer_text?"corrected":"confirmed";
    const normalized={...original.normalized_answer};if(status==="corrected"){normalized.facts=[answerText];normalized.values=[{key:"raw",value:answerText}];normalized.correctedByUser=true;}
    const result=await client.query(`INSERT INTO ai_interview_answers
      (organization_id,session_id,question_code,answer_text,normalized_answer,confidence,confirmation_status,supersedes_answer_id,source,created_by)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'user',$9) RETURNING *`,[org,sessionId.data,original.question_code,answerText,JSON.stringify(normalized),status==="corrected"?1:original.confidence,status,original.id,req.user.id]);
    const [questions,answers]=await Promise.all([
      client.query(`SELECT code,sequence_no,stage,prompt_mn,answer_kind,options,branch_rule,required,active FROM ai_interview_questions
        WHERE method_code=$1 AND method_version=$2 AND active=true ORDER BY sequence_no`,[original.method_code,original.method_version]),
      client.query(`SELECT question_code,confirmation_status FROM ai_interview_answers WHERE organization_id=$1 AND session_id=$2`,[org,sessionId.data])
    ]);
    const next=nextInterviewQuestion(questions.rows,answers.rows);
    await client.query(`UPDATE ai_interview_sessions SET last_activity_at=now(),current_stage=$3,status=$4 WHERE organization_id=$1 AND id=$2`,
      [org,sessionId.data,next?.stage||"review",next?"active":"ready_for_review"]);
    await writeAudit(req,"ai.requirements_answer_confirm","ai_interview_answer",result.rows[0].id,{sessionId:sessionId.data,questionCode:original.question_code,status,supersedes:original.id},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0],nextQuestion:next,readyForReview:!next});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/preview", asyncHandler(async (req,res) => {
  const parsed=profileSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Байгууллагын танилцуулгын мэдээлэл дутуу эсвэл буруу байна",issues:parsed.error.issues});
  const profile=parsed.data;
  const catalog=await getPool().query(`SELECT code,name,category,description,sectors,signals,min_employees,departments,recommended_modules,version
    FROM organization_blueprint_catalog WHERE active=true ORDER BY code`);
  const templates=selectBlueprintCatalog(catalog.rows,profile);
  const moduleCodes=[...new Set(templates.flatMap(item=>item.recommended_modules||[]))];
  const proposal={templates,moduleCodes,departmentCount:templates.reduce((sum,item)=>sum+(item.departments||[]).length,0),positionCount:templates.reduce((sum,item)=>sum+(item.departments||[]).reduce((n,d)=>n+(d.positions||[]).length,0),0)};
  const result=await getPool().query(`INSERT INTO organization_blueprints(organization_id,profile,proposal,catalog_version,created_by)
    VALUES($1,$2::jsonb,$3::jsonb,$4,$5) RETURNING id,status,profile,proposal,catalog_version,created_at`,
    [req.user.organization_id,JSON.stringify(profile),JSON.stringify(proposal),Math.max(...catalog.rows.map(x=>x.version),1),req.user.id]);
  await writeAudit(req,"organization.blueprint_preview","organization_blueprint",result.rows[0].id,{sector:profile.sector,templateCodes:templates.map(x=>x.code)});
  res.status(201).json({item:result.rows[0]});
}));

router.post("/:id/apply", asyncHandler(async (req,res) => {
  const id=uuid.safeParse(req.params.id);
  const body=z.object({catalogCodes:z.array(z.string().min(1).max(100)).min(1).max(30)}).safeParse(req.body);
  if(!id.success||!body.success)return res.status(400).json({error:"Хэрэгжүүлэх бүтцийн сонголт буруу байна"});
  const client=await getPool().connect();
  try{
    await client.query("BEGIN");
    const draft=await client.query(`SELECT * FROM organization_blueprints WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[req.user.organization_id,id.data]);
    if(!draft.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Бүтцийн төсөл олдсонгүй"});}
    if(draft.rows[0].status!=="draft"){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ бүтцийн төсөл өмнө нь хэрэгжсэн байна"});}
    const allowed=new Set((draft.rows[0].proposal.templates||[]).map(item=>item.code));
    if(body.data.catalogCodes.some(code=>!allowed.has(code))){await client.query("ROLLBACK");return res.status(400).json({error:"Зөвлөмжид байхгүй загвар сонгосон байна"});}
    const catalog=await client.query(`SELECT code,name,departments,recommended_modules FROM organization_blueprint_catalog
      WHERE active=true AND code=ANY($1::text[])`,[body.data.catalogCodes]);
    let departmentsCreated=0,positionsCreated=0;
    for(const template of catalog.rows){
      for(const department of template.departments||[]){
        let departmentResult=await client.query(`INSERT INTO departments(organization_id,code,name,source_blueprint_code)
          VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,code) DO NOTHING RETURNING id`,
          [req.user.organization_id,department.code,department.name,template.code]);
        if(departmentResult.rowCount)departmentsCreated+=1;
        else departmentResult=await client.query(`SELECT id FROM departments WHERE organization_id=$1 AND code=$2`,[req.user.organization_id,department.code]);
        for(const position of department.positions||[]){
          const job=await client.query(`INSERT INTO jobs(organization_id,code,name,metadata)
            VALUES($1,$2,$3,jsonb_build_object('sourceBlueprintCode',$4::text))
            ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,updated_at=now() RETURNING id`,
            [req.user.organization_id,position.code,position.title,template.code]);
          const created=await client.query(`INSERT INTO positions(organization_id,department_id,code,title,rank_level,source_blueprint_code,job_id)
            VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,code) DO NOTHING RETURNING id`,
            [req.user.organization_id,departmentResult.rows[0].id,position.code,position.title,position.rank,template.code,job.rows[0].id]);
          positionsCreated+=created.rowCount;
        }
      }
    }
    const appliedProposal={...draft.rows[0].proposal,selectedCatalogCodes:body.data.catalogCodes};
    const interview=await client.query(`SELECT id FROM ai_interview_sessions
      WHERE organization_id=$1 AND status='ready_for_review' ORDER BY last_activity_at DESC LIMIT 1 FOR UPDATE`,[req.user.organization_id]);
    const interviewId=interview.rows[0]?.id||null;
    await client.query(`UPDATE organization_blueprints SET status='superseded' WHERE organization_id=$1 AND status='applied'`,[req.user.organization_id]);
    const applied=await client.query(`UPDATE organization_blueprints SET status='applied',proposal=$3::jsonb,applied_by=$4,applied_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING id,status,profile,proposal,applied_at`,[req.user.organization_id,id.data,JSON.stringify(appliedProposal),req.user.id]);
    await ensureGrowthProfile(client,req.user.organization_id,"self_service");
    await recordGrowthEvent(client,{
      organizationId:req.user.organization_id,eventType:"blueprint_ready",source:"tenant",actorUserId:req.user.id,
      occurredAt:applied.rows[0].applied_at,detail:{blueprintId:id.data,catalogCodes:body.data.catalogCodes},
      idempotencyKey:`blueprint:${id.data}`
    });
    for(const code of allowed){
      await client.query(`INSERT INTO ai_recommendation_feedback
        (organization_id,session_id,blueprint_id,recommendation_type,recommendation_code,decision,reason_code,proposed_value,accepted_value,decided_by)
        VALUES($1,$2,$3,'blueprint',$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,[req.user.organization_id,interviewId,id.data,code,
          body.data.catalogCodes.includes(code)?"accepted":"rejected",body.data.catalogCodes.includes(code)?"selected_by_owner":"not_selected",
          JSON.stringify({catalogCode:code}),JSON.stringify(body.data.catalogCodes.includes(code)?{catalogCode:code}:{}),req.user.id]);
    }
    if(interviewId){
      await client.query(`UPDATE ai_interview_sessions SET status='completed',completed_at=now(),last_activity_at=now()
        WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,interviewId]);
      await client.query(`INSERT INTO ai_adoption_outcomes
        (organization_id,session_id,measurement_window,metric_code,metric_value,outcome,evidence_summary)
        VALUES($1,$2,'immediate','blueprint_applied',1,'positive',$3::jsonb)
        ON CONFLICT(organization_id,session_id,measurement_window,metric_code) DO NOTHING`,
        [req.user.organization_id,interviewId,JSON.stringify({blueprintId:id.data,catalogCodes:body.data.catalogCodes})]);
    }
    await writeAudit(req,"organization.blueprint_apply","organization_blueprint",id.data,{catalogCodes:body.data.catalogCodes,departmentsCreated,positionsCreated},client);
    await client.query("COMMIT");
    res.json({item:applied.rows[0],summary:{departmentsCreated,positionsCreated,recommendedModules:[...new Set(catalog.rows.flatMap(x=>x.recommended_modules||[]))]}});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

module.exports=router;
