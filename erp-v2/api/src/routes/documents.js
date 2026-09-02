"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { writeLifecycleEvent } = require("../services/data-lifecycle");
const { recordDocumentLink } = require("../services/document-links");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const uploadDirectory = path.resolve(process.env.DOCUMENT_UPLOAD_DIR || process.env.UPLOAD_DIR || "/app/uploads/documents");
fs.mkdirSync(uploadDirectory, { recursive:true });
const allowedTypes = new Set([
  "image/jpeg","image/png","image/webp","application/pdf","text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:50*1024*1024,files:1,fields:0,parts:2},
  fileFilter:(_req,file,done)=>allowedTypes.has(file.mimetype)?done(null,true):done(new Error("UNSUPPORTED_FILE_TYPE")) });

function uploadOne(req,res,next){upload.single("file")(req,res,error=>{
  if(!error)return next();
  if(error.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"Файлын хэмжээ 50 MB-аас их байна"});
  return res.status(400).json({error:error.message==="UNSUPPORTED_FILE_TYPE"?"Дэмжигдээгүй файлын төрөл":"Файл хүлээн авахад алдаа гарлаа"});
})}

const createSchema=z.object({
  documentNo:z.string().trim().min(1).max(120),title:z.string().trim().min(2).max(500),
  documentType:z.string().trim().min(1).max(120).default("general"),
  classificationCode:z.enum(["public","internal","confidential","restricted"]).default("internal"),
  retentionClass:z.string().trim().min(1).max(120).default("standard"),
  linkedEntityType:z.string().trim().min(1).max(120).nullable().optional(),linkedEntityId:z.string().trim().min(1).max(200).nullable().optional(),
}).superRefine((v,ctx)=>{if(Boolean(v.linkedEntityType)!==Boolean(v.linkedEntityId))ctx.addIssue({code:"custom",message:"Entity type and id must be supplied together"})});

const transitions={
  draft:{submit:["in_review"]},in_review:{approve:["approved"],reject:["draft"]},
  approved:{sign:["signed"],activate:["active"]},signed:{activate:["active"]},active:{archive:["archived"]},archived:{dispose:["disposed"]},
};

function documentAccess(req){
  const permissions=new Set(req.user.permissions||[]);
  return {restricted:permissions.has("documents.restricted.read"),discipline:permissions.has("hr.discipline.confidential.read")};
}
function accessPredicate(alias,restrictedParameter,disciplineParameter){return `
  (${alias}.classification_code<>'restricted' OR $${restrictedParameter}::boolean)
  AND ($${disciplineParameter}::boolean OR NOT EXISTS(
    SELECT 1 FROM document_links access_link
    WHERE access_link.organization_id=${alias}.organization_id
      AND access_link.document_id=${alias}.id
      AND access_link.entity_type='hr_discipline_case'
  ))`}

router.use(authenticate,requirePermissions("documents.manage"));

router.get("/",asyncHandler(async(req,res)=>{
  const status=z.enum(["draft","in_review","approved","signed","active","archived","disposed"]).optional().safeParse(req.query.status||undefined);
  if(!status.success)return res.status(400).json({error:"Invalid document status"});
  const access=documentAccess(req),result=await getPool().query(`SELECT d.*,v.version_no,v.original_name,v.mime_type,v.size_bytes,v.content_sha256
    FROM documents d LEFT JOIN document_versions v ON v.organization_id=d.organization_id AND v.id=d.current_version_id
    WHERE d.organization_id=$1 AND ($2::text IS NULL OR d.status=$2) AND ${accessPredicate("d",3,4)}
    ORDER BY d.updated_at DESC LIMIT 250`,[req.user.organization_id,status.data||null,access.restricted,access.discipline]);
  res.json({items:result.rows});
}));

router.post("/",asyncHandler(async(req,res)=>{
  const parsed=createSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Баримтын мэдээлэл буруу байна",issues:parsed.error.issues});
  const v=parsed.data,access=documentAccess(req);
  if(v.classificationCode==="restricted"&&!access.restricted)return res.status(403).json({error:"RESTRICTED_DOCUMENT_FORBIDDEN"});
  if(v.linkedEntityType==="hr_discipline_case"&&!access.discipline)return res.status(403).json({error:"DISCIPLINE_DOCUMENT_FORBIDDEN"});
  const client=await getPool().connect();let item;
  try{await client.query("BEGIN");item=(await client.query(`INSERT INTO documents
    (organization_id,document_no,title,document_type,classification_code,retention_class,linked_entity_type,linked_entity_id,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,[req.user.organization_id,v.documentNo,v.title,v.documentType,v.classificationCode,v.retentionClass,v.linkedEntityType||null,v.linkedEntityId||null,req.user.id])).rows[0];
    await client.query(`INSERT INTO document_lifecycle_events(organization_id,document_id,action,to_status,actor_user_id) VALUES($1,$2,'created','draft',$3)`,[req.user.organization_id,item.id,req.user.id]);
    if(v.linkedEntityType){await recordDocumentLink({req,documentId:item.id,entityType:v.linkedEntityType,entityId:v.linkedEntityId,source:"api",client});}
    await writeLifecycleEvent(req,{assetCode:"document",recordKey:item.id,eventType:"document.created",entityType:"document",entityId:item.id,detail:{documentNo:item.document_no}},client);
    await writeAudit(req,"document.create","document",item.id,{documentNo:item.document_no},client);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  res.status(201).json({item});
}));

router.get("/:id/versions",asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid document"});
  const access=documentAccess(req),result=await getPool().query(`SELECT v.id,v.version_no,v.original_name,v.mime_type,v.size_bytes,v.content_sha256,v.metadata,v.created_by,v.created_at
    FROM document_versions v JOIN documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
    WHERE v.organization_id=$1 AND v.document_id=$2 AND ${accessPredicate("d",3,4)}
    ORDER BY v.version_no DESC`,[req.user.organization_id,id.data,access.restricted,access.discipline]);
  res.json({items:result.rows});
}));

router.post("/:id/versions",uploadOne,asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id);if(!id.success||!req.file)return res.status(400).json({error:"Баримт эсвэл файл буруу байна"});
  const access=documentAccess(req),hash=crypto.createHash("sha256").update(req.file.buffer).digest("hex"),storageKey=crypto.randomUUID(),filePath=path.join(uploadDirectory,storageKey);
  await fs.promises.writeFile(filePath,req.file.buffer,{flag:"wx"});
  const client=await getPool().connect();let item;
  try{await client.query("BEGIN");const doc=await client.query(`SELECT d.id,d.status FROM documents d WHERE d.organization_id=$1 AND d.id=$2 AND ${accessPredicate("d",3,4)} FOR UPDATE`,[req.user.organization_id,id.data,access.restricted,access.discipline]);
    if(!doc.rowCount){const e=new Error("DOCUMENT_NOT_FOUND");e.status=404;throw e}if(["archived","disposed"].includes(doc.rows[0].status)){const e=new Error("DOCUMENT_IMMUTABLE_STATE");e.status=409;throw e}
    const next=(await client.query(`SELECT COALESCE(max(version_no),0)+1 AS value FROM document_versions WHERE organization_id=$1 AND document_id=$2`,[req.user.organization_id,id.data])).rows[0].value;
    item=(await client.query(`INSERT INTO document_versions(organization_id,document_id,version_no,original_name,storage_key,mime_type,size_bytes,content_sha256,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version_no,original_name,mime_type,size_bytes,content_sha256,created_at`,[req.user.organization_id,id.data,next,path.basename(req.file.originalname).slice(0,255),storageKey,req.file.mimetype,req.file.size,hash,req.user.id])).rows[0];
    await client.query(`UPDATE documents SET current_version_id=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,[req.user.organization_id,id.data,item.id,req.user.id]);
    await client.query(`INSERT INTO document_lifecycle_events(organization_id,document_id,version_id,action,from_status,to_status,actor_user_id,evidence) VALUES($1,$2,$3,'version_added',$4,$4,$5,$6::jsonb)`,[req.user.organization_id,id.data,item.id,doc.rows[0].status,req.user.id,JSON.stringify({version:item.version_no,sha256:hash,size:req.file.size})]);
    await writeAudit(req,"document.version_add","document",id.data,{version:item.version_no,sha256:hash,size:req.file.size},client);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});await fs.promises.unlink(filePath).catch(()=>{});if(error.status)return res.status(error.status).json({error:error.message});throw error}finally{client.release()}
  res.status(201).json({item});
}));

router.get("/:documentId/versions/:versionId/file",asyncHandler(async(req,res,next)=>{
  const documentId=uuid.safeParse(req.params.documentId),versionId=uuid.safeParse(req.params.versionId);if(!documentId.success||!versionId.success)return res.status(400).json({error:"Invalid document version"});
  const access=documentAccess(req),result=await getPool().query(`SELECT v.original_name,v.storage_key,v.mime_type FROM document_versions v
    JOIN documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
    WHERE v.organization_id=$1 AND v.document_id=$2 AND v.id=$3 AND ${accessPredicate("d",4,5)}`,
  [req.user.organization_id,documentId.data,versionId.data,access.restricted,access.discipline]);
  if(!result.rowCount)return res.status(404).json({error:"Баримтын хувилбар олдсонгүй"});const item=result.rows[0];res.type(item.mime_type);res.download(path.join(uploadDirectory,item.storage_key),item.original_name,{dotfiles:"deny"},error=>{if(error&&!res.headersSent)next(error)});
}));

router.post("/:id/transitions",asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=z.object({action:z.enum(["submit","approve","reject","sign","activate","archive","dispose"]),note:z.string().trim().max(2000).default(""),evidence:z.record(z.string(),z.unknown()).default({}),dispositionRequestId:uuid.nullable().optional()}).safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Lifecycle үйлдэл буруу байна"});const v=parsed.data,client=await getPool().connect();let item;
  const access=documentAccess(req);
  try{await client.query("BEGIN");const current=await client.query(`SELECT d.* FROM documents d WHERE d.organization_id=$1 AND d.id=$2 AND ${accessPredicate("d",3,4)} FOR UPDATE`,[req.user.organization_id,id.data,access.restricted,access.discipline]);if(!current.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Баримт олдсонгүй"})}
    const from=current.rows[0].status,to=transitions[from]?.[v.action]?.[0];if(!to){await client.query("ROLLBACK");return res.status(409).json({error:"Энэ төлөвөөс сонгосон үйлдэл хийх боломжгүй"})}
    if(v.action!=="reject"&&!current.rows[0].current_version_id){await client.query("ROLLBACK");return res.status(409).json({error:"Баримтын файлтай хувилбар шаардлагатай"})}
    if(v.action==="sign"&&(!String(v.evidence.provider||"").trim()||!String(v.evidence.reference||"").trim()||!z.iso.datetime().safeParse(v.evidence.signedAt).success)){await client.query("ROLLBACK");return res.status(400).json({error:"Гарын үсгийн provider, reference болон signedAt нотолгоо шаардлагатай"})}
    if(v.action==="dispose"){const approval=await client.query(`SELECT id FROM data_disposition_requests WHERE organization_id=$1 AND id=$2 AND asset_code='document' AND record_key=$3 AND status='approved'`,[req.user.organization_id,v.dispositionRequestId||null,id.data]);if(!approval.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"Батлагдсан disposition хүсэлт шаардлагатай"})}}
    item=(await client.query(`UPDATE documents SET status=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data,to,req.user.id])).rows[0];
    await client.query(`INSERT INTO document_lifecycle_events(organization_id,document_id,version_id,action,from_status,to_status,note,evidence,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[req.user.organization_id,id.data,item.current_version_id,v.action,from,to,v.note,JSON.stringify(v.evidence),req.user.id]);
    await writeLifecycleEvent(req,{assetCode:"document",recordKey:id.data,eventType:`document.${v.action}`,entityType:"document",entityId:id.data,detail:{from,to}},client);await writeAudit(req,`document.${v.action}`,"document",id.data,{from,to},client);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
  res.json({item});
}));

module.exports=router;
