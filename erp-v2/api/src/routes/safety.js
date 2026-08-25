"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { riskBand, nextReference } = require("../services/safety");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const optionalUuid = uuid.nullable().optional();
const requiredText = (max=1000) => z.string().trim().min(1).max(max);
const optionalText = (max=3000) => z.string().trim().max(max).default("");
const riskStatus = z.enum(["open","in_progress","controlled","closed"]);
const incidentStatus = z.enum(["reported","investigating","corrective_action","closed"]);
const manage = requirePermissions("safety.manage");
const investigate = requirePermissions("safety.investigate");

const createRiskSchema = z.object({
  title: requiredText(250), category: requiredText(120), location: optionalText(250),
  description: requiredText(3000), existingControls: optionalText(3000),
  likelihood: z.coerce.number().int().min(1).max(5), severity: z.coerce.number().int().min(1).max(5),
  responsibleUserId: optionalUuid, dueDate: z.union([z.iso.date(),z.literal(""),z.null()]).optional(),
});
const updateRiskSchema = z.object({
  status: riskStatus.optional(), responsibleUserId: optionalUuid,
  dueDate: z.union([z.iso.date(),z.literal(""),z.null()]).optional(),
  existingControls: z.string().trim().max(3000).optional(), correctiveAction: z.string().trim().max(3000).optional(),
  likelihood: z.coerce.number().int().min(1).max(5).optional(), severity: z.coerce.number().int().min(1).max(5).optional(),
}).refine(value=>Object.keys(value).length>0,"No changes supplied");
const createIncidentSchema = z.object({
  incidentType:z.enum(["unsafe_condition","near_miss","incident","injury","occupational_illness","property_damage","environmental"]),
  severity:z.enum(["low","medium","high","critical"]), occurredAt:z.iso.datetime(),
  location:optionalText(250), description:requiredText(4000), immediateAction:optionalText(3000),
  injuredCount:z.coerce.number().int().min(0).max(10000).default(0), lostTime:z.boolean().default(false),
});
const updateIncidentSchema = z.object({
  status:incidentStatus.optional(), assignedTo:optionalUuid, rootCause:z.string().trim().max(4000).optional(),
  correctiveAction:z.string().trim().max(4000).optional(), severity:z.enum(["low","medium","high","critical"]).optional(),
}).refine(value=>Object.keys(value).length>0,"No changes supplied");
const briefingSchema = z.object({
  briefingType:z.enum(["induction","toolbox","refresher","emergency","other"]), title:requiredText(250),
  content:optionalText(5000), conductedAt:z.iso.datetime(), facilitatorUserId:optionalUuid,
  location:optionalText(250), attendeeCount:z.coerce.number().int().min(0).max(100000).default(0),
});

router.use(authenticate,requireModule("safety"));

router.get("/overview",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const [summary,risks,incidents,briefings]=await Promise.all([
    getPool().query(`SELECT
      count(*) FILTER(WHERE status<>'closed')::int AS open_risks,
      count(*) FILTER(WHERE status<>'closed' AND risk_score>=17)::int AS critical_risks,
      count(*) FILTER(WHERE status<>'closed' AND due_date<CURRENT_DATE)::int AS overdue_actions,
      (SELECT count(*)::int FROM safety_incidents i WHERE i.organization_id=$1 AND i.status<>'closed') AS open_incidents,
      (SELECT count(*)::int FROM safety_incidents i WHERE i.organization_id=$1 AND i.occurred_at>=date_trunc('month',CURRENT_DATE)) AS incidents_this_month,
      (SELECT COALESCE(sum(attendee_count),0)::int FROM safety_briefings b WHERE b.organization_id=$1 AND b.conducted_at>=date_trunc('month',CURRENT_DATE)) AS briefed_this_month
      FROM safety_risks WHERE organization_id=$1`,[org]),
    getPool().query(`SELECT r.*,reporter.full_name AS reported_by_name,responsible.full_name AS responsible_name
      FROM safety_risks r JOIN users reporter ON reporter.organization_id=r.organization_id AND reporter.id=r.reported_by
      LEFT JOIN users responsible ON responsible.organization_id=r.organization_id AND responsible.id=r.responsible_user_id
      WHERE r.organization_id=$1 ORDER BY CASE r.status WHEN 'open' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'controlled' THEN 3 ELSE 4 END,r.risk_score DESC,r.created_at DESC LIMIT 300`,[org]),
    getPool().query(`SELECT i.*,reporter.full_name AS reported_by_name,assigned.full_name AS assigned_name
      FROM safety_incidents i JOIN users reporter ON reporter.organization_id=i.organization_id AND reporter.id=i.reported_by
      LEFT JOIN users assigned ON assigned.organization_id=i.organization_id AND assigned.id=i.assigned_to
      WHERE i.organization_id=$1 ORDER BY i.occurred_at DESC LIMIT 300`,[org]),
    getPool().query(`SELECT b.*,facilitator.full_name AS facilitator_name,creator.full_name AS created_by_name
      FROM safety_briefings b LEFT JOIN users facilitator ON facilitator.organization_id=b.organization_id AND facilitator.id=b.facilitator_user_id
      JOIN users creator ON creator.organization_id=b.organization_id AND creator.id=b.created_by
      WHERE b.organization_id=$1 ORDER BY b.conducted_at DESC LIMIT 100`,[org]),
  ]);
  res.json({summary:summary.rows[0],risks:risks.rows.map(row=>({...row,risk_band:riskBand(row.risk_score)})),incidents:incidents.rows,briefings:briefings.rows,canManage:(req.user.permissions||[]).includes("safety.manage")});
}));

router.post("/risks",asyncHandler(async(req,res)=>{
  const parsed=createRiskSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Эрсдэлийн мэдээлэл буруу байна",issues:parsed.error.issues});
  const v=parsed.data,client=await getPool().connect();let item;
  try{await client.query("BEGIN");await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`${req.user.organization_id}:safety-risk`]);
    const seq=await client.query(`SELECT COALESCE(max(substring(reference_no from '[0-9]+$')::int),0)+1 AS next FROM safety_risks WHERE organization_id=$1`,[req.user.organization_id]);
    item=(await client.query(`INSERT INTO safety_risks(organization_id,reference_no,title,category,location,description,existing_controls,likelihood,severity,reported_by,responsible_user_id,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.organization_id,nextReference("RSK",seq.rows[0].next),v.title,v.category,v.location,v.description,v.existingControls,v.likelihood,v.severity,req.user.id,v.responsibleUserId||null,v.dueDate||null])).rows[0];
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  await writeAudit(req,"safety.risk_create","safety_risk",item.id,{referenceNo:item.reference_no,riskScore:item.risk_score});res.status(201).json({item:{...item,risk_band:riskBand(item.risk_score)}});
}));

router.patch("/risks/:id",manage,asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=updateRiskSchema.safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Эрсдэлийн шинэчлэлт буруу байна"});const v=parsed.data;
  const result=await getPool().query(`UPDATE safety_risks SET status=COALESCE($3,status),responsible_user_id=CASE WHEN $4 THEN $5::uuid ELSE responsible_user_id END,due_date=CASE WHEN $6 THEN $7::date ELSE due_date END,existing_controls=COALESCE($8,existing_controls),corrective_action=COALESCE($9,corrective_action),likelihood=COALESCE($10,likelihood),severity=COALESCE($11,severity),closed_at=CASE WHEN $3='closed' THEN now() WHEN $3 IS NOT NULL THEN NULL ELSE closed_at END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data,v.status||null,Object.hasOwn(v,"responsibleUserId"),v.responsibleUserId||null,Object.hasOwn(v,"dueDate"),v.dueDate||null,v.existingControls,v.correctiveAction,v.likelihood,v.severity]);
  if(!result.rowCount)return res.status(404).json({error:"Эрсдэл олдсонгүй"});await writeAudit(req,"safety.risk_update","safety_risk",id.data,v);res.json({item:{...result.rows[0],risk_band:riskBand(result.rows[0].risk_score)}});
}));

router.post("/incidents",asyncHandler(async(req,res)=>{
  const parsed=createIncidentSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Осол, зөрчлийн мэдээлэл буруу байна",issues:parsed.error.issues});const v=parsed.data,client=await getPool().connect();let item;
  try{await client.query("BEGIN");await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`${req.user.organization_id}:safety-incident`]);const seq=await client.query(`SELECT COALESCE(max(substring(reference_no from '[0-9]+$')::int),0)+1 AS next FROM safety_incidents WHERE organization_id=$1`,[req.user.organization_id]);item=(await client.query(`INSERT INTO safety_incidents(organization_id,reference_no,incident_type,severity,occurred_at,location,description,immediate_action,injured_count,lost_time,reported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.user.organization_id,nextReference("INC",seq.rows[0].next),v.incidentType,v.severity,v.occurredAt,v.location,v.description,v.immediateAction,v.injuredCount,v.lostTime,req.user.id])).rows[0];await client.query("COMMIT");}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  await writeAudit(req,"safety.incident_create","safety_incident",item.id,{referenceNo:item.reference_no,severity:item.severity,type:item.incident_type});res.status(201).json({item});
}));

router.patch("/incidents/:id",investigate,asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=updateIncidentSchema.safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Осол, зөрчлийн шинэчлэлт буруу байна"});const v=parsed.data;
  const result=await getPool().query(`UPDATE safety_incidents SET status=COALESCE($3,status),assigned_to=CASE WHEN $4 THEN $5::uuid ELSE assigned_to END,root_cause=COALESCE($6,root_cause),corrective_action=COALESCE($7,corrective_action),severity=COALESCE($8,severity),closed_at=CASE WHEN $3='closed' THEN now() WHEN $3 IS NOT NULL THEN NULL ELSE closed_at END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data,v.status||null,Object.hasOwn(v,"assignedTo"),v.assignedTo||null,v.rootCause,v.correctiveAction,v.severity]);
  if(!result.rowCount)return res.status(404).json({error:"Осол, зөрчил олдсонгүй"});await writeAudit(req,"safety.incident_update","safety_incident",id.data,v);res.json({item:result.rows[0]});
}));

router.post("/briefings",manage,asyncHandler(async(req,res)=>{
  const parsed=briefingSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Зааварчилгааны мэдээлэл буруу байна",issues:parsed.error.issues});const v=parsed.data;
  const result=await getPool().query(`INSERT INTO safety_briefings(organization_id,briefing_type,title,content,conducted_at,facilitator_user_id,location,attendee_count,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.organization_id,v.briefingType,v.title,v.content,v.conductedAt,v.facilitatorUserId||null,v.location,v.attendeeCount,req.user.id]);await writeAudit(req,"safety.briefing_create","safety_briefing",result.rows[0].id,{title:v.title,attendeeCount:v.attendeeCount});res.status(201).json({item:result.rows[0]});
}));

module.exports=router;
