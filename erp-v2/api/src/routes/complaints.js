"use strict";

const express=require("express");
const {z}=require("zod");
const {authenticate,requireModule}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const {withTenantTransaction}=require("../db");
const {createAggregate,transitionAggregate,assignAggregate,authorizeAny}=require("../services/bounded-domain-workflow");
const {requestHrDisciplineAssessment}=require("../services/complaint-hr-handoff");

const router=express.Router();
const optionalUuid=z.union([z.string().uuid(),z.literal(""),z.null()]).optional();
const createSchema=z.object({
  caseType:z.enum(["request","complaint","suggestion","other"]),requesterName:z.string().trim().min(1).max(300),
  requesterContact:z.string().trim().max(300).default(""),sourceChannel:z.enum(["paper","email","web","phone","in_person","other"]),
  category:z.string().trim().min(1).max(160),subject:z.string().trim().min(1).max(500),description:z.string().trim().min(1).max(10000),
  confidentiality:z.enum(["public","internal","confidential","restricted"]).default("internal"),dueDate:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),
  assignedUnitId:optionalUuid,assignedUserId:optionalUuid,documentIds:z.array(z.string().uuid()).max(30).default([]),idempotencyKey:z.string().uuid(),
});
const assignSchema=z.object({expectedVersion:z.coerce.number().int().min(0),assigneeUserId:z.string().uuid(),assignedUnitId:optionalUuid,reason:z.string().trim().min(1).max(2000),idempotencyKey:z.string().uuid()});
const commandSchema=z.object({expectedVersion:z.coerce.number().int().min(0),reason:z.string().trim().max(4000).default(""),comment:z.string().trim().max(4000).default(""),resolution:z.string().trim().max(10000).optional(),responseDocumentId:optionalUuid,closeReason:z.string().trim().max(2000).optional(),deliveryReference:z.string().trim().max(500).optional(),recipient:z.string().trim().max(500).optional(),idempotencyKey:z.string().uuid()});
const handoffSchema=z.object({
  expectedVersion:z.coerce.number().int().min(0),subjectReference:z.string().trim().min(1).max(500),
  reason:z.string().trim().min(1).max(4000),documentIds:z.array(z.string().uuid()).max(30).default([]),
  idempotencyKey:z.string().uuid(),
});

router.use(authenticate,requireModule("complaints"));
function canRead(req){return (req.user.permissions||[]).some(p=>["complaints.read","complaints.register","complaints.assign","complaints.process","complaints.response.approve","complaints.response.send"].includes(p))}
function denyRead(req,res){if(canRead(req))return false;res.status(403).json({error:"DOMAIN_FORBIDDEN"});return true}

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    if (denyRead(req, res)) return;
    const org = req.user.organization_id,
      status = String(req.query.status || ""),
      search = String(req.query.search || "").trim(),
      mine = req.query.mine === "true",
      overdue = req.query.overdue === "true";
    const page = Math.max(1, Number(req.query.page) || 1),
      pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 30)),
      offset = (page - 1) * pageSize;
    const result = await withTenantTransaction(org, async (client) => {
      const params = [org],
        where = ["c.organization_id=$1"];
      if (!(req.user.permissions || []).includes("documents.restricted.read"))
        where.push("c.confidentiality<>'restricted'");
      if (status) {
        params.push(status);
        where.push(`c.status=$${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(
          `(c.registration_no ILIKE $${params.length} OR c.subject ILIKE $${params.length} OR c.requester_name ILIKE $${params.length})`,
        );
      }
      if (mine) {
        params.push(req.user.id);
        where.push(`c.assigned_user_id=$${params.length}`);
      }
      if (overdue)
        where.push(
          "c.due_date<CURRENT_DATE AND c.status NOT IN('response_sent','implementation_monitoring','closed','rejected','cancelled')",
        );
      const counts = await client.query(
        `SELECT count(*)::int total,
      count(*) FILTER(WHERE status IN('received','validating','registered'))::int new,
      count(*) FILTER(WHERE status='assigned')::int assigned,
      count(*) FILTER(WHERE status IN('in_progress','under_review'))::int in_progress,
      count(*) FILTER(WHERE due_date<CURRENT_DATE AND status NOT IN('response_sent','implementation_monitoring','closed','rejected','cancelled'))::int overdue,
      count(*) FILTER(WHERE status IN('response_sent','implementation_monitoring'))::int responded,
      count(*) FILTER(WHERE status='implementation_monitoring')::int implementation_monitoring,
      count(*) FILTER(WHERE status='closed')::int closed FROM complaint_cases WHERE organization_id=$1`,
        [org],
      );
      const total = (
        await client.query(
          `SELECT count(*)::int value FROM complaint_cases c WHERE ${where.join(" AND ")}`,
          params,
        )
      ).rows[0].value;
      const listParams = [...params, pageSize, offset];
      const items = await client.query(
        `SELECT c.*,u.full_name assigned_name,d.name assigned_unit_name,
      (c.due_date<CURRENT_DATE AND c.status NOT IN('response_sent','implementation_monitoring','closed','rejected','cancelled')) overdue
      FROM complaint_cases c LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=c.assigned_user_id
      LEFT JOIN departments d ON d.organization_id=c.organization_id AND d.id=c.assigned_unit_id
      WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        listParams,
      );
      return {
        summary: counts.rows[0],
        items: items.rows,
        pagination: { page, pageSize, total },
      };
    });
    res.json(result);
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (denyRead(req, res)) return;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "INVALID_ID" });
    const result = await withTenantTransaction(
      req.user.organization_id,
      async (client) => {
        const item = await client.query(
          `SELECT c.*,u.full_name assigned_name,d.name assigned_unit_name FROM complaint_cases c
      LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=c.assigned_user_id
      LEFT JOIN departments d ON d.organization_id=c.organization_id AND d.id=c.assigned_unit_id
      WHERE c.organization_id=$1 AND c.id=$2`,
          [req.user.organization_id, id.data],
        );
        if (!item.rowCount) return null;
        if (
          item.rows[0].confidentiality === "restricted" &&
          !(req.user.permissions || []).includes("documents.restricted.read")
        )
          throw Object.assign(new Error("RESTRICTED_DOCUMENT_FORBIDDEN"), {
            status: 403,
          });
        const [events, workflow, documents, handoffs] = await Promise.all([
          client.query(
            `SELECT e.*,u.full_name actor_name FROM complaint_case_events e JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id WHERE e.organization_id=$1 AND e.complaint_case_id=$2 ORDER BY e.created_at,e.id`,
            [req.user.organization_id, id.data],
          ),
          client.query(
            `SELECT e.*,u.full_name actor_name FROM workflow_transition_events e JOIN workflow_cases w ON w.organization_id=e.organization_id AND w.id=e.case_id JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id WHERE w.organization_id=$1 AND w.subject_type='complaint_case' AND w.subject_id=$2 ORDER BY e.created_at,e.id`,
            [req.user.organization_id, id.data],
          ),
          client.query(
            `SELECT d.id,d.document_no,d.title,d.classification_code AS confidentiality,d.status FROM document_links l JOIN documents d ON d.organization_id=l.organization_id AND d.id=l.document_id WHERE l.organization_id=$1 AND l.entity_type='complaint_case' AND l.entity_id=$2`,
            [req.user.organization_id, id.data],
          ),
          client.query(
            `SELECT h.*,u.full_name requested_by_name,r.full_name responded_by_name
               FROM complaint_hr_handoffs h
               JOIN users u ON u.organization_id=h.organization_id AND u.id=h.requested_by
               LEFT JOIN users r ON r.organization_id=h.organization_id AND r.id=h.responded_by
              WHERE h.organization_id=$1 AND h.complaint_case_id=$2
              ORDER BY h.requested_at,h.id`,
            [req.user.organization_id,id.data],
          ),
        ]);
        const visibleDocuments = (req.user.permissions || []).includes(
          "documents.restricted.read",
        )
          ? documents.rows
          : documents.rows.filter((x) => x.confidentiality !== "restricted");
        return {
          item: item.rows[0],
          events: events.rows,
          workflow: workflow.rows,
          documents: visibleDocuments,
          handoffs: handoffs.rows,
        };
      },
    );
    if (!result) return res.status(404).json({ error: "CASE_NOT_FOUND" });
    res.json(result);
  }),
);

router.post("/",asyncHandler(async(req,res)=>{
  const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_COMPLAINT",issues:parsed.error.issues});
  const v=parsed.data;authorizeAny(req,["complaints.register"]);
  const result=await createAggregate({req,domain:"complaint",initialState:"received",idempotencyKey:v.idempotencyKey,payload:v,permissions:["complaints.register"],documentIds:v.documentIds,
    insert:async(client,c)=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${c.organizationId}:complaints:${new Date().getFullYear()}`]);
      const next=(await client.query("SELECT COALESCE(max(substring(registration_no from '[0-9]+$')::int),0)+1 next FROM complaint_cases WHERE organization_id=$1 AND extract(year from created_at)=extract(year from CURRENT_DATE)",[c.organizationId])).rows[0].next;
      return (await client.query(`INSERT INTO complaint_cases(id,organization_id,registration_no,case_type,requester_name,requester_contact,source_channel,category,subject,description,confidentiality,due_date,assigned_unit_id,assigned_user_id,idempotency_key,payload_sha256,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [c.id,c.organizationId,`CMP-${new Date().getFullYear()}-${String(next).padStart(5,"0")}`,v.caseType,v.requesterName,v.requesterContact,v.sourceChannel,v.category,v.subject,v.description,v.confidentiality,v.dueDate||null,v.assignedUnitId||null,v.assignedUserId||null,c.idempotencyKey,c.payloadSha256,c.actorUserId])).rows[0];
    }});
  res.status(result.replayed?200:201).json(result);
}));

router.post("/:id/assign",asyncHandler(async(req,res)=>{const parsed=assignSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_ASSIGNMENT",issues:parsed.error.issues});res.json(await assignAggregate({req,domain:"complaint",id:req.params.id,...parsed.data,permissions:["complaints.assign"]}))}));

router.post("/:id/hr-handoffs",asyncHandler(async(req,res)=>{
  const parsed=handoffSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_HR_HANDOFF",issues:parsed.error.issues});
  const caseId=z.string().uuid().safeParse(req.params.id);if(!caseId.success)return res.status(400).json({error:"INVALID_ID"});
  const result=await requestHrDisciplineAssessment({req,complaintCaseId:caseId.data,...parsed.data});
  res.status(result.replayed?200:201).json(result);
}));

const commands={
  validate:{to:"validating",from:["received","returned_for_completion"],permissions:["complaints.register"]},
  register:{to:"registered",from:["received","validating"],permissions:["complaints.register"]},
  start:{to:"in_progress",from:["registered","assigned","returned_for_completion"],permissions:["complaints.process"]},
  request_information:{to:"returned_for_completion",from:["validating","in_progress","under_review"],permissions:["complaints.register","complaints.process"]},
  submit_response:{to:"under_review",from:["in_progress"],permissions:["complaints.process"]},
  approve_response:{to:"response_approved",from:["under_review"],permissions:["complaints.response.approve"],decision:"approved"},
  return:{to:"returned_for_completion",from:["validating","under_review"],permissions:["complaints.register","complaints.response.approve"],decision:"returned"},
  reject:{to:"rejected",from:["validating","under_review"],permissions:["complaints.response.approve"],decision:"rejected"},
  send_response:{to:"response_sent",from:["response_approved"],permissions:["complaints.response.send"]},
  start_implementation_monitoring:{to:"implementation_monitoring",from:["response_sent"],permissions:["complaints.process"]},
  complete_implementation:{to:"closed",from:["implementation_monitoring"],permissions:["complaints.process"]},
  close:{to:"closed",from:["response_sent"],permissions:["complaints.process"]},
  cancel:{to:"cancelled",from:["received","validating","registered","assigned","returned_for_completion"],permissions:["complaints.register"]},
};

router.post("/:id/commands/:command",asyncHandler(async(req,res)=>{
  const rule=commands[req.params.command];if(!rule)return res.status(404).json({error:"UNKNOWN_COMMAND"});const parsed=commandSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_COMMAND",issues:parsed.error.issues});const v=parsed.data;
  if(rule.decision&&!v.reason)return res.status(400).json({error:"DECISION_REASON_REQUIRED"});
  if(["request_information","start_implementation_monitoring","complete_implementation"].includes(req.params.command)&&!v.reason)return res.status(400).json({error:"COMMAND_REASON_REQUIRED"});
  if(["submit_response","approve_response"].includes(req.params.command)&&!v.responseDocumentId)return res.status(400).json({error:"RESPONSE_DOCUMENT_REQUIRED"});
  if(req.params.command==="send_response"&&(!v.recipient||!v.deliveryReference))return res.status(400).json({error:"DELIVERY_EVIDENCE_REQUIRED"});
  const set={};if(v.resolution!==undefined)set.resolution=v.resolution;if(v.responseDocumentId)set.response_document_id=v.responseDocumentId;if(v.closeReason!==undefined)set.close_reason=v.closeReason;if(["close","complete_implementation"].includes(req.params.command)){set.close_reason=v.closeReason||v.reason;set.closed_at=new Date()}
  const result=await transitionAggregate({req,domain:"complaint",id:req.params.id,expectedVersion:v.expectedVersion,command:req.params.command,toState:rule.to,allowedFrom:rule.from,permissions:rule.permissions,reason:v.reason,comment:v.comment,decision:rule.decision||null,stepCode:req.params.command,idempotencyKey:v.idempotencyKey,set,documentIds:v.responseDocumentId?[v.responseDocumentId]:[],
    precondition:req.params.command==="send_response"?async(_client,current)=>{if(!current.response_document_id)throw Object.assign(new Error("RESPONSE_DOCUMENT_REQUIRED"),{code:"RESPONSE_DOCUMENT_REQUIRED",status:409})}:null,
    after:req.params.command==="send_response"?async(client,ctx)=>{await client.query(`INSERT INTO complaint_delivery_events(organization_id,complaint_case_id,channel,recipient,delivery_reference,outcome,evidence,actor_user_id)
      VALUES($1,$2,'official_response',$3,$4,'sent',$5::jsonb,$6)`,[ctx.organizationId,ctx.updated.id,v.recipient,v.deliveryReference,JSON.stringify({serverConfirmed:true}),ctx.actorUserId]);}:null,
  });
  res.json(result);
}));

module.exports=router;
