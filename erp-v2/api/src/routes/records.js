"use strict";
const crypto=require("node:crypto"),express=require("express");
const {z}=require("zod");
const {authenticate,requireModule}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const {withTenantTransaction}=require("../db");
const {writeAudit}=require("../services/audit");
const {createAggregate,transitionAggregate,assignAggregate,authorizeAny}=require("../services/bounded-domain-workflow");
const router=express.Router(),optionalUuid=z.union([z.string().uuid(),z.literal(""),z.null()]).optional();
const createSchema=z.object({direction:z.enum(["incoming","outgoing","internal"]),documentType:z.string().trim().min(1).max(120).default("official_letter"),documentNo:z.string().trim().max(120).default(""),documentDate:z.iso.date(),registeredAt:z.iso.date().optional(),counterparty:z.string().trim().max(300).default(""),subject:z.string().trim().min(1).max(500),priority:z.enum(["low","normal","high","urgent"]).default("normal"),dueDate:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),responsibleUserId:optionalUuid,assignedUnitId:optionalUuid,channel:z.enum(["paper","electronic","both","email","web","hand_delivery","other"]).default("paper"),confidentiality:z.enum(["public","internal","confidential","restricted"]).default("internal"),canonicalDocumentId:optionalUuid,documentIds:z.array(z.string().uuid()).max(30).default([]),idempotencyKey:z.string().uuid().optional()});
const assignSchema=z.object({expectedVersion:z.coerce.number().int().min(0),assigneeUserId:z.string().uuid(),assignedUnitId:optionalUuid,reason:z.string().trim().min(1).max(2000),idempotencyKey:z.string().uuid()});
const commandSchema=z.object({expectedVersion:z.coerce.number().int().min(0),reason:z.string().trim().max(4000).default(""),comment:z.string().trim().max(4000).default(""),resolution:z.string().trim().max(10000).optional(),managementResolution:z.string().trim().max(5000).optional(),responseDocumentId:optionalUuid,dueDate:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),recipient:z.string().trim().max(500).optional(),deliveryReference:z.string().trim().max(500).optional(),channel:z.string().trim().max(80).optional(),idempotencyKey:z.string().uuid()});
const legacySchema=z.object({responsibleUserId:optionalUuid,resolution:z.string().trim().max(4000).optional(),dueDate:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),status:z.string().optional()}).refine(v=>Object.keys(v).length>0);
router.use(authenticate,requireModule("records"));
const readPermissions=["records.read","records.register","records.assign","records.process","records.response.approve","records.response.send","records.manage"];
function deny(req,res){if((req.user.permissions||[]).some(p=>readPermissions.includes(p)))return false;res.status(403).json({error:"DOMAIN_FORBIDDEN"});return true}
router.use((req,res,next)=>{if(req.method!=="GET"||(req.user.permissions||[]).includes("documents.restricted.read"))return next();const send=res.json.bind(res);res.json=body=>{if(body?.item?.confidentiality==="restricted"){res.status(403);return send({error:"RESTRICTED_DOCUMENT_FORBIDDEN"})}if(Array.isArray(body?.items)){body={...body,items:body.items.filter(x=>x.confidentiality!=="restricted")};if(body.pagination)body.pagination={...body.pagination,total:body.items.length}}if(Array.isArray(body?.documents))body={...body,documents:body.documents.filter(x=>x.confidentiality!=="restricted")};return send(body)};next()});

router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    if (deny(req, res)) return;
    const org = req.user.organization_id,
      status = String(req.query.status || ""),
      direction = String(req.query.direction || ""),
      search = String(req.query.search || "").trim(),
      mine = req.query.mine === "true",
      overdue = req.query.overdue === "true",
      page = Math.max(1, Number(req.query.page) || 1),
      pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 30)),
      offset = (page - 1) * pageSize;
    res.json(
      await withTenantTransaction(org, async (client) => {
        const p = [org],
          w = ["c.organization_id=$1"];
        if (status) {
          p.push(status);
          w.push(`c.status=$${p.length}`);
        }
        if (direction) {
          p.push(direction);
          w.push(`c.direction=$${p.length}`);
        }
        if (search) {
          p.push(`%${search}%`);
          w.push(
            `(c.registration_no ILIKE $${p.length} OR c.subject ILIKE $${p.length} OR c.counterparty ILIKE $${p.length})`,
          );
        }
        if (mine) {
          p.push(req.user.id);
          w.push(`c.responsible_user_id=$${p.length}`);
        }
        if (overdue)
          w.push(
            "c.due_date<CURRENT_DATE AND c.status NOT IN('responded','closed','archived','cancelled')",
          );
        const summary = (
          await client.query(
            `SELECT count(*)::int total,count(*) FILTER(WHERE registered_at=CURRENT_DATE)::int received_today,count(*) FILTER(WHERE status IN('registered','assigned','in_progress','response_draft','response_review','returned'))::int pending_response,count(*) FILTER(WHERE due_date<CURRENT_DATE AND status NOT IN('responded','closed','archived','cancelled'))::int overdue,count(*) FILTER(WHERE responsible_user_id=$2 AND status NOT IN('closed','archived','cancelled'))::int assigned_to_me,count(*) FILTER(WHERE status IN('closed','archived') AND updated_at>=CURRENT_DATE-INTERVAL '30 days')::int recently_closed FROM correspondence_records WHERE organization_id=$1`,
            [org, req.user.id],
          )
        ).rows[0];
        const total = (
          await client.query(
            `SELECT count(*)::int value FROM correspondence_records c WHERE ${w.join(" AND ")}`,
            p,
          )
        ).rows[0].value;
        const items = (
          await client.query(
            `SELECT c.*,u.full_name responsible_name,d.name assigned_unit_name,creator.full_name created_by_name,(c.due_date<CURRENT_DATE AND c.status NOT IN('responded','closed','archived','cancelled')) overdue FROM correspondence_records c LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=c.responsible_user_id LEFT JOIN departments d ON d.organization_id=c.organization_id AND d.id=c.assigned_unit_id JOIN users creator ON creator.organization_id=c.organization_id AND creator.id=c.created_by WHERE ${w.join(" AND ")} ORDER BY c.registered_at DESC,c.created_at DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
            [...p, pageSize, offset],
          )
        ).rows;
        return { summary, items, pagination: { page, pageSize, total } };
      }),
    );
  }),
);
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (deny(req, res)) return;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "INVALID_ID" });
    const out = await withTenantTransaction(
      req.user.organization_id,
      async (client) => {
        const item = await client.query(
          `SELECT c.*,u.full_name responsible_name,d.name assigned_unit_name FROM correspondence_records c LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=c.responsible_user_id LEFT JOIN departments d ON d.organization_id=c.organization_id AND d.id=c.assigned_unit_id WHERE c.organization_id=$1 AND c.id=$2`,
          [req.user.organization_id, id.data],
        );
        if (!item.rowCount) return null;
        const [events, deliveries, documents] = await Promise.all([
          client.query(
            `SELECT e.*,u.full_name actor_name FROM correspondence_events e JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id WHERE e.organization_id=$1 AND e.correspondence_id=$2 ORDER BY e.created_at,e.id`,
            [req.user.organization_id, id.data],
          ),
          client.query(
            "SELECT * FROM correspondence_delivery_events WHERE organization_id=$1 AND correspondence_id=$2 ORDER BY created_at,id",
            [req.user.organization_id, id.data],
          ),
          client.query(
            `SELECT d.id,d.document_no,d.title,d.classification_code AS confidentiality,d.status FROM document_links l JOIN documents d ON d.organization_id=l.organization_id AND d.id=l.document_id WHERE l.organization_id=$1 AND l.entity_type='correspondence' AND l.entity_id=$2`,
            [req.user.organization_id, id.data],
          ),
        ]);
        return {
          item: item.rows[0],
          events: events.rows,
          deliveries: deliveries.rows,
          documents: documents.rows,
        };
      },
    );
    if (!out) return res.status(404).json({ error: "RECORD_NOT_FOUND" });
    res.json(out);
  }),
);
router.post("/",asyncHandler(async(req,res)=>{const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_CORRESPONDENCE",issues:parsed.error.issues});const v=parsed.data;authorizeAny(req,["records.register","records.manage"]);const requestId=v.idempotencyKey||crypto.randomUUID(),documents=[v.canonicalDocumentId,...v.documentIds].filter(Boolean);const result=await createAggregate({req,domain:"correspondence",initialState:v.responsibleUserId?"assigned":"registered",idempotencyKey:requestId,payload:{...v,idempotencyKey:requestId},permissions:["records.register","records.manage"],documentIds:documents,insert:async(client,c)=>{await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${c.organizationId}:records:${new Date().getFullYear()}`]);const n=(await client.query("SELECT COALESCE(max(substring(registration_no from '[0-9]+$')::int),0)+1 next FROM correspondence_records WHERE organization_id=$1 AND extract(year from registered_at)=extract(year from CURRENT_DATE)",[c.organizationId])).rows[0].next;return (await client.query(`INSERT INTO correspondence_records(id,organization_id,registration_no,direction,document_type,document_no,document_date,registered_at,counterparty,subject,priority,due_date,responsible_user_id,status,created_by,channel,confidentiality,assigned_unit_id,canonical_document_id,idempotency_key,payload_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,CURRENT_DATE),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[c.id,c.organizationId,`DOC-${new Date().getFullYear()}-${String(n).padStart(5,"0")}`,v.direction,v.documentType,v.documentNo,v.documentDate,v.registeredAt||null,v.counterparty,v.subject,v.priority,v.dueDate||null,v.responsibleUserId||null,v.responsibleUserId?"assigned":"registered",c.actorUserId,v.channel,v.confidentiality,v.assignedUnitId||null,v.canonicalDocumentId||null,c.idempotencyKey,c.payloadSha256])).rows[0]}});res.status(result.replayed?200:201).json(result)}));
router.post("/:id/assign",asyncHandler(async(req,res)=>{const parsed=assignSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_ASSIGNMENT",issues:parsed.error.issues});res.json(await assignAggregate({req,domain:"correspondence",id:req.params.id,...parsed.data,permissions:["records.assign","records.manage"]}))}));
const commands={start:{to:"in_progress",from:["registered","assigned","returned"],permissions:["records.process","records.manage"]},submit_response:{to:"response_review",from:["in_progress","response_draft"],permissions:["records.process","records.manage"]},approve_response:{to:"response_approved",from:["response_review"],permissions:["records.response.approve"],decision:"approved"},return:{to:"returned",from:["response_review"],permissions:["records.response.approve"],decision:"returned"},reject_response:{to:"returned",from:["response_review"],permissions:["records.response.approve"],decision:"rejected"},send_response:{to:"responded",from:["response_approved"],permissions:["records.response.send"]},close:{to:"closed",from:["responded"],permissions:["records.process","records.manage"]},archive:{to:"archived",from:["closed"],permissions:["records.manage"]},cancel:{to:"cancelled",from:["registered","assigned","returned"],permissions:["records.manage"]}};
router.post("/:id/commands/:command",asyncHandler(async(req,res)=>{const rule=commands[req.params.command];if(!rule)return res.status(404).json({error:"UNKNOWN_COMMAND"});const parsed=commandSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"INVALID_COMMAND",issues:parsed.error.issues});const v=parsed.data;if(rule.decision&&!v.reason)return res.status(400).json({error:"DECISION_REASON_REQUIRED"});if(["submit_response","approve_response"].includes(req.params.command)&&!v.responseDocumentId)return res.status(400).json({error:"RESPONSE_DOCUMENT_REQUIRED"});if(req.params.command==="send_response"&&(!v.recipient||!v.deliveryReference))return res.status(400).json({error:"DELIVERY_EVIDENCE_REQUIRED"});const set={};if(v.resolution!==undefined)set.resolution=v.resolution;if(v.managementResolution!==undefined)set.management_resolution=v.managementResolution;if(v.responseDocumentId)set.response_document_id=v.responseDocumentId;if(v.dueDate!==undefined)set.due_date=v.dueDate||null;if(req.params.command==="close")set.closed_at=new Date();res.json(await transitionAggregate({req,domain:"correspondence",id:req.params.id,expectedVersion:v.expectedVersion,command:req.params.command,toState:rule.to,allowedFrom:rule.from,permissions:rule.permissions,reason:v.reason,comment:v.comment,decision:rule.decision||null,stepCode:req.params.command,idempotencyKey:v.idempotencyKey,set,documentIds:v.responseDocumentId?[v.responseDocumentId]:[],precondition:req.params.command==="send_response"?async(_client,current)=>{if(!current.response_document_id)throw Object.assign(new Error("RESPONSE_DOCUMENT_REQUIRED"),{code:"RESPONSE_DOCUMENT_REQUIRED",status:409})}:null,after:req.params.command==="send_response"?async(client,ctx)=>client.query(`INSERT INTO correspondence_delivery_events(organization_id,correspondence_id,channel,recipient,delivery_reference,outcome,evidence,actor_user_id) VALUES($1,$2,$3,$4,$5,'sent',$6::jsonb,$7)`,[ctx.organizationId,ctx.updated.id,v.channel||"official",v.recipient,v.deliveryReference,JSON.stringify({serverConfirmed:true}),ctx.actorUserId]):null}))}));
router.patch("/:id",asyncHandler(async(req,res)=>{const id=z.string().uuid().safeParse(req.params.id),parsed=legacySchema.safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"INVALID_UPDATE"});if(parsed.data.status!==undefined)return res.status(409).json({error:"NAMED_COMMAND_REQUIRED"});authorizeAny(req,["records.manage"]);const item=await withTenantTransaction(req.user.organization_id,async client=>{const v=parsed.data,r=await client.query(`UPDATE correspondence_records SET responsible_user_id=CASE WHEN $3 THEN $4::uuid ELSE responsible_user_id END,resolution=COALESCE($5,resolution),due_date=CASE WHEN $6 THEN $7::date ELSE due_date END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data,Object.hasOwn(v,"responsibleUserId"),v.responsibleUserId||null,v.resolution,Object.hasOwn(v,"dueDate"),v.dueDate||null]);if(r.rowCount)await writeAudit(req,"records.compatibility_metadata_update","correspondence",id.data,v,client);return r.rows[0]});if(!item)return res.status(404).json({error:"RECORD_NOT_FOUND"});res.json({item})}));
module.exports=router;
