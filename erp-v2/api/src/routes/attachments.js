"use strict";

const express = require("express");
const multer = require("multer");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || "/app/uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const allowedTypes = new Set([
  "image/jpeg","image/png","image/webp","application/pdf","text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const storage = multer.diskStorage({
  destination: (_req,_file,callback) => callback(null,uploadDirectory),
  filename: (_req,_file,callback) => callback(null,crypto.randomUUID()),
});
const upload = multer({ storage, limits:{ fileSize:10*1024*1024,files:1,fields:0,parts:2 },
  fileFilter:(_req,file,callback)=>allowedTypes.has(file.mimetype)?callback(null,true):callback(new Error("UNSUPPORTED_FILE_TYPE")) });

function uploadOne(req,res,next) {
  upload.single("file")(req,res,error=>{
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error:"Файлын хэмжээ 10 MB-аас их байна" });
    return res.status(400).json({ error:error.message === "UNSUPPORTED_FILE_TYPE"?"Дэмжигдээгүй файлын төрөл":"Файл upload хийхэд алдаа гарлаа" });
  });
}

async function validateEntity(req,res,next) {
  const type = z.enum(["assets","work-orders","employees"]).safeParse(req.params.entityType);
  const id = z.string().uuid().safeParse(req.params.entityId);
  if (!type.success||!id.success) return res.status(400).json({ error:"Invalid attachment target" });
  if (type.data === "employees") {
    const permissions = new Set(req.user.permissions || []);
    const modules = new Set(req.user.enabled_modules || []);
    if (!modules.has("hr") || !permissions.has("hr.manage") || !permissions.has("hr.sensitive.read")) {
      return res.status(403).json({ error:"Insufficient permission" });
    }
  }
  const table = { assets:"assets", "work-orders":"work_orders", employees:"employees" }[type.data];
  const result = await getPool().query(`SELECT id FROM ${table} WHERE organization_id=$1 AND id=$2`, [req.user.organization_id,id.data]);
  if (!result.rowCount) return res.status(404).json({ error:"Холбогдох бүртгэл олдсонгүй" });
  req.attachmentEntity = { type:type.data,id:id.data };
  next();
}

router.use(authenticate);

router.get("/entity/:entityType/:entityId", asyncHandler(validateEntity), asyncHandler(async (req,res)=>{
  const column = { assets:"asset_id", "work-orders":"work_order_id", employees:"employee_id" }[req.attachmentEntity.type];
  const result = await getPool().query(
    `SELECT a.id,a.original_name,a.mime_type,a.size_bytes,a.created_at,a.uploaded_by,u.full_name AS uploaded_by_name
       FROM attachments a LEFT JOIN users u ON u.organization_id=a.organization_id AND u.id=a.uploaded_by
      WHERE a.organization_id=$1 AND a.${column}=$2 ORDER BY a.created_at DESC`,
    [req.user.organization_id,req.attachmentEntity.id]
  );
  res.json({ items:result.rows });
}));

router.post("/entity/:entityType/:entityId", asyncHandler(validateEntity), uploadOne, asyncHandler(async (req,res)=>{
  if (!req.file) return res.status(400).json({ error:"Файл сонгоно уу" });
  const isAsset = req.attachmentEntity.type === "assets";
  const isWorkOrder = req.attachmentEntity.type === "work-orders";
  const isEmployee = req.attachmentEntity.type === "employees";
  try {
    const result = await getPool().query(
      `INSERT INTO attachments(organization_id,asset_id,work_order_id,employee_id,uploaded_by,original_name,stored_name,mime_type,size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,original_name,mime_type,size_bytes,created_at,uploaded_by`,
      [req.user.organization_id,isAsset?req.attachmentEntity.id:null,isWorkOrder?req.attachmentEntity.id:null,
        isEmployee?req.attachmentEntity.id:null,req.user.id,
        path.basename(req.file.originalname).slice(0,255),req.file.filename,req.file.mimetype,req.file.size]
    );
    await writeAudit(req,"attachment.upload","attachment",result.rows[0].id,{entityType:req.attachmentEntity.type,entityId:req.attachmentEntity.id,mimeType:req.file.mimetype,size:req.file.size});
    res.status(201).json({ item:result.rows[0] });
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch(()=>{});
    throw error;
  }
}));

router.get("/file/:id", asyncHandler(async (req,res,next)=>{
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error:"Invalid attachment" });
  const result = await getPool().query(
    "SELECT original_name,stored_name,mime_type,employee_id FROM attachments WHERE organization_id=$1 AND id=$2",
    [req.user.organization_id,id.data]
  );
  if (!result.rowCount) return res.status(404).json({ error:"Файл олдсонгүй" });
  const item = result.rows[0], filePath = path.join(uploadDirectory,item.stored_name);
  if (item.employee_id && !(req.user.permissions || []).includes("hr.sensitive.read")) {
    return res.status(403).json({ error:"Insufficient permission" });
  }
  res.type(item.mime_type);
  res.download(filePath,item.original_name,{ dotfiles:"deny" },error=>{ if(error&&!res.headersSent)next(error); });
}));

router.delete("/file/:id", asyncHandler(async (req,res)=>{
  const id = z.string().uuid().safeParse(req.params.id);
  const existing = id.success ? await getPool().query(
    "SELECT employee_id FROM attachments WHERE organization_id=$1 AND id=$2",
    [req.user.organization_id,id.data]
  ) : { rowCount:0, rows:[] };
  if (id.success && existing.rowCount && existing.rows[0].employee_id) {
    return res.status(409).json({ error:"Personnel-file attachments are retained as history and cannot be deleted" });
  }
  if (!id.success) return res.status(400).json({ error:"Invalid attachment" });
  const result = await getPool().query(
    `DELETE FROM attachments WHERE organization_id=$1 AND id=$2
       AND (uploaded_by=$3 OR $4::boolean) RETURNING stored_name`,
    [req.user.organization_id,id.data,req.user.id,["director","chief_engineer"].includes(req.user.role)]
  );
  if (!result.rowCount) return res.status(404).json({ error:"Файл олдсонгүй эсвэл устгах эрхгүй" });
  await fs.promises.unlink(path.join(uploadDirectory,result.rows[0].stored_name)).catch(error=>{ if(error.code!=="ENOENT")console.error("[attachment unlink]",error); });
  await writeAudit(req,"attachment.delete","attachment",id.data,{});
  res.json({ ok:true });
}));

module.exports = router;
