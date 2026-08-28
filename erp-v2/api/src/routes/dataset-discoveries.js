"use strict";

const express=require("express");
const multer=require("multer");
const {z}=require("zod");
const {getPool}=require("../db");
const {authenticate,requireSystemRoles}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const {writeAudit}=require("../services/audit");
const {fileHash}=require("../services/smart-import");
const {discoverWorkbook,ROLES}=require("../services/dataset-discovery");

const router=express.Router(),uuid=z.string().uuid();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const reviewSchema=z.object({decision:z.enum(["accepted","corrected","excluded"]),selectedRole:z.enum(ROLES).nullable().optional(),note:z.string().trim().max(1000).default("")});
router.use(authenticate,requireSystemRoles("owner"));

async function getDiscovery(org,id){
  const [job,sheets,targets,events]=await Promise.all([
    getPool().query("SELECT id,import_type,original_filename,mime_type,size_bytes,content_sha256,status,analysis_mode,summary,created_by,created_at FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type='dataset_discovery'",[org,id]),
    getPool().query(`SELECT s.*,review.decision,review.selected_role,review.note AS review_note,review.actor_user_id AS reviewed_by,review.created_at AS reviewed_at
      FROM smart_import_dataset_sheets s LEFT JOIN LATERAL (SELECT r.decision,r.selected_role,r.note,r.actor_user_id,r.created_at
        FROM smart_import_dataset_sheet_reviews r WHERE r.organization_id=s.organization_id AND r.sheet_id=s.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) review ON true
      WHERE s.organization_id=$1 AND s.job_id=$2 ORDER BY s.sheet_index`,[org,id]),
    getPool().query("SELECT id,domain_code,domain_name,readiness,source_sheets,rationale,created_at FROM smart_import_dataset_targets WHERE organization_id=$1 AND job_id=$2 ORDER BY domain_name",[org,id]),
    getPool().query("SELECT action,from_status,to_status,detail,created_at FROM smart_import_events WHERE organization_id=$1 AND job_id=$2 ORDER BY id",[org,id])
  ]);
  return job.rowCount?{...job.rows[0],sheets:sheets.rows,targets:targets.rows,events:events.rows,canonical_commit_allowed:false}:null;
}

router.get("/",asyncHandler(async(req,res)=>{
  const result=await getPool().query(`SELECT id,original_filename,size_bytes,content_sha256,status,summary,created_at FROM smart_import_jobs
    WHERE organization_id=$1 AND import_type='dataset_discovery' ORDER BY created_at DESC LIMIT 30`,[req.user.organization_id]);
  res.json({items:result.rows});
}));
router.get("/:id",asyncHandler(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid discovery ID"});const item=await getDiscovery(req.user.organization_id,id.data);if(!item)return res.status(404).json({error:"Dataset discovery not found"});res.json({item});}));

router.post("/",upload.single("file"),asyncHandler(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Excel файл сонгоно уу"});
  const filename=String(req.file.originalname||"").slice(0,255);
  if(!/\.xlsx$/i.test(filename))return res.status(400).json({error:"Олон sheet-тэй dataset discovery-д зөвхөн .xlsx файл ашиглана"});
  let discovery;try{discovery=await discoverWorkbook(req.file.buffer);}catch(error){return res.status(400).json({error:error.message});}
  const org=req.user.organization_id,client=await getPool().connect();
  try{await client.query("BEGIN");
    const job=(await client.query(`INSERT INTO smart_import_jobs
      (organization_id,import_type,original_filename,mime_type,size_bytes,content_sha256,status,source_columns,proposed_mapping,mapping_confidence,analysis_mode,summary,created_by)
      VALUES($1,'dataset_discovery',$2,$3,$4,$5,'needs_review',$6::jsonb,'{}'::jsonb,'{}'::jsonb,'deterministic',$7::jsonb,$8) RETURNING id`,
      [org,filename,req.file.mimetype||"",req.file.size,fileHash(req.file.buffer),JSON.stringify(discovery.sheets.map(item=>item.sheetName)),JSON.stringify(discovery.summary),req.user.id])).rows[0];
    for(const sheet of discovery.sheets)await client.query(`INSERT INTO smart_import_dataset_sheets
      (organization_id,job_id,sheet_index,sheet_name,proposed_role,header_row,row_count,column_count,truncated,column_profile,findings)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,[org,job.id,sheet.sheetIndex,sheet.sheetName,sheet.proposedRole,sheet.headerRow,sheet.rowCount,sheet.columnCount,sheet.truncated,JSON.stringify(sheet.columns),JSON.stringify(sheet.findings)]);
    for(const target of discovery.targets)await client.query(`INSERT INTO smart_import_dataset_targets
      (organization_id,job_id,domain_code,domain_name,readiness,source_sheets,rationale) VALUES($1,$2,$3,$4,$5,$6,$7)`,[org,job.id,target.domainCode,target.domainName,target.readiness,target.sourceSheets,target.rationale]);
    await client.query(`INSERT INTO smart_import_events(organization_id,job_id,actor_user_id,action,from_status,to_status,detail)
      VALUES($1,$2,$3,'dataset_profiled','analyzing','needs_review',$4::jsonb)`,[org,job.id,req.user.id,JSON.stringify({...discovery.summary,canonicalCommitAllowed:false})]);
    await writeAudit(req,"smart_import.dataset_profiled","smart_import_job",job.id,{filename,fileHash:fileHash(req.file.buffer),...discovery.summary,canonicalCommitAllowed:false},client);
    await client.query("COMMIT");res.status(201).json({item:await getDiscovery(org,job.id)});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

router.post("/:jobId/sheets/:sheetId/reviews",asyncHandler(async(req,res)=>{
  const jobId=uuid.safeParse(req.params.jobId),sheetId=uuid.safeParse(req.params.sheetId),parsed=reviewSchema.safeParse(req.body);
  if(!jobId.success||!sheetId.success||!parsed.success)return res.status(400).json({error:"Sheet review мэдээлэл буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  if(v.decision!=="excluded"&&!v.selectedRole)return res.status(400).json({error:"Sheet-ийн үүргийг сонгоно уу"});
  if(v.decision==="excluded"&&v.selectedRole)return res.status(400).json({error:"Хассан sheet-д үүрэг сонгохгүй"});
  const client=await getPool().connect();
  try{await client.query("BEGIN");
    const sheet=await client.query(`SELECT s.id,s.proposed_role FROM smart_import_dataset_sheets s JOIN smart_import_jobs j ON j.organization_id=s.organization_id AND j.id=s.job_id
      WHERE s.organization_id=$1 AND s.job_id=$2 AND s.id=$3 AND j.import_type='dataset_discovery'`,[org,jobId.data,sheetId.data]);
    if(!sheet.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Dataset sheet not found"});}
    const decision=v.decision==="accepted"&&v.selectedRole!==sheet.rows[0].proposed_role?"corrected":v.decision;
    const item=(await client.query(`INSERT INTO smart_import_dataset_sheet_reviews(organization_id,sheet_id,decision,selected_role,note,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[org,sheetId.data,decision,decision==="excluded"?null:v.selectedRole,v.note,req.user.id])).rows[0];
    await client.query(`INSERT INTO smart_import_events(organization_id,job_id,actor_user_id,action,from_status,to_status,detail)
      VALUES($1,$2,$3,'dataset_sheet_reviewed','needs_review','needs_review',$4::jsonb)`,[org,jobId.data,req.user.id,JSON.stringify({sheetId:sheetId.data,decision,selectedRole:item.selected_role})]);
    await writeAudit(req,"smart_import.dataset_sheet_reviewed","smart_import_job",jobId.data,{sheetId:sheetId.data,decision,selectedRole:item.selected_role},client);
    await client.query("COMMIT");res.status(201).json({item:await getDiscovery(org,jobId.data)});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}
}));

module.exports=router;
