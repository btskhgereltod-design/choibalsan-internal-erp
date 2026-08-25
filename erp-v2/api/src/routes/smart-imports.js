"use strict";

const express=require("express");
const multer=require("multer");
const {z}=require("zod");
const {getPool}=require("../db");
const {loadConfig}=require("../config");
const {authenticate,requireModule,requirePermissions}=require("../middleware/auth");
const {asyncHandler}=require("../utils/async-handler");
const {writeAudit}=require("../services/audit");
const {syncPrimaryAssignment}=require("../services/employee-assignment");
const {TARGET_FIELDS,deterministicMapping,parseImportFile,validateRows,summarize,fileHash,stableCode}=require("../services/smart-import");
const {suggestImportMapping}=require("../services/openai-smart-import");

const router=express.Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const uuid=z.string().uuid();
const IMPORT_TYPE="employee_master";
router.use(authenticate,requireModule("hr"),requirePermissions("hr.import.manage"));
router.param("id",asyncHandler(async(req,res,next,id)=>{
  if(!uuid.safeParse(id).success)return next();
  const result=await getPool().query("SELECT 1 FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3",[req.user.organization_id,id,IMPORT_TYPE]);
  if(!result.rowCount)return res.status(404).json({error:"Import not found"});
  next();
}));

async function importContext(client,org){
  const [employees,departments,positions]=await Promise.all([
    client.query(`SELECT e.employee_no,ep.personal_email FROM employees e LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id WHERE e.organization_id=$1`,[org]),
    client.query("SELECT id,name FROM departments WHERE organization_id=$1 AND active=true",[org]),
    client.query("SELECT id,title,department_id FROM positions WHERE organization_id=$1 AND active=true",[org]),
  ]);
  return {employeeNos:employees.rows.map(x=>x.employee_no).filter(Boolean),emails:employees.rows.map(x=>x.personal_email).filter(Boolean),departments:departments.rows.map(x=>x.name),positions:positions.rows.map(x=>x.title),departmentRows:departments.rows,positionRows:positions.rows};
}

function mergeMapping(headers,base,ai){
  const result={...base},used=new Set(Object.values(result));
  for(const item of ai?.mappings||[]) if(headers.includes(item.sourceColumn)&&!result[item.sourceColumn]&&!used.has(item.targetField)){result[item.sourceColumn]=item.targetField;used.add(item.targetField);}
  return result;
}
function confidenceFor(headers,base,ai){
  const bySource=new Map((ai?.mappings||[]).map(x=>[x.sourceColumn,x]));
  return Object.fromEntries(headers.map(source=>[source,bySource.has(source)?{score:bySource.get(source).confidence,reason:bySource.get(source).reason,method:"ai"}:base[source]?{score:1,reason:"Стандарт баганын нэрээр танив",method:"rule"}:{score:0,reason:"Тохиргоо шаардлагатай",method:"unmapped"}]));
}
async function persistRows(client,org,jobId,rows){
  const payload=rows.map(row=>({row_number:row.rowNumber,source_data:row.sourceData,normalized_data:row.normalizedData,validation:row.validation,status:row.status}));
  await client.query(`INSERT INTO smart_import_rows(organization_id,job_id,row_number,source_data,normalized_data,validation,status)
    SELECT $1,$2,x.row_number,x.source_data,x.normalized_data,x.validation,x.status
    FROM jsonb_to_recordset($3::jsonb) AS x(row_number integer,source_data jsonb,normalized_data jsonb,validation jsonb,status text)`,[org,jobId,JSON.stringify(payload)]);
}
async function updateRows(client,org,jobId,rows){
  const payload=rows.map(row=>({row_number:row.rowNumber,normalized_data:row.normalizedData,validation:row.validation,status:row.status}));
  await client.query(`UPDATE smart_import_rows r SET normalized_data=x.normalized_data,validation=x.validation,status=x.status,updated_at=now()
    FROM jsonb_to_recordset($3::jsonb) AS x(row_number integer,normalized_data jsonb,validation jsonb,status text)
    WHERE r.organization_id=$1 AND r.job_id=$2 AND r.row_number=x.row_number`,[org,jobId,JSON.stringify(payload)]);
}
async function event(client,org,jobId,userId,action,fromStatus,toStatus,detail={}){
  await client.query("INSERT INTO smart_import_events(organization_id,job_id,actor_user_id,action,from_status,to_status,detail) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[org,jobId,userId,action,fromStatus,toStatus,JSON.stringify(detail)]);
}
async function getJob(org,id){
  const [job,rows,events]=await Promise.all([
    getPool().query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 AND import_type=$3",[org,id,IMPORT_TYPE]),
    getPool().query("SELECT r.row_number,r.normalized_data,r.validation,r.status,r.imported_employee_id FROM smart_import_rows r JOIN smart_import_jobs j ON j.organization_id=r.organization_id AND j.id=r.job_id WHERE r.organization_id=$1 AND r.job_id=$2 AND j.import_type=$3 ORDER BY r.row_number LIMIT 200",[org,id,IMPORT_TYPE]),
    getPool().query("SELECT e.action,e.from_status,e.to_status,e.detail,e.created_at FROM smart_import_events e JOIN smart_import_jobs j ON j.organization_id=e.organization_id AND j.id=e.job_id WHERE e.organization_id=$1 AND e.job_id=$2 AND j.import_type=$3 ORDER BY e.id",[org,id,IMPORT_TYPE]),
  ]);
  return job.rowCount?{...job.rows[0],rows:rows.rows,events:events.rows,preview_limited:Number(job.rows[0].summary?.total||0)>200}:null;
}

router.get("/",asyncHandler(async(req,res)=>{
  const result=await getPool().query("SELECT id,import_type,original_filename,status,analysis_mode,summary,created_at,reviewed_at,completed_at FROM smart_import_jobs WHERE organization_id=$1 AND import_type=$2 ORDER BY created_at DESC LIMIT 30",[req.user.organization_id,IMPORT_TYPE]);
  res.json({items:result.rows});
}));
router.get("/:id",asyncHandler(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid import ID"});const item=await getJob(req.user.organization_id,id.data);if(!item)return res.status(404).json({error:"Import not found"});res.json({item});}));

router.post("/",upload.single("file"),asyncHandler(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Excel эсвэл CSV файл сонгоно уу"});
  const filename=String(req.file.originalname||"").slice(0,255);
  if(!/\.(xlsx|csv)$/i.test(filename))return res.status(400).json({error:"Зөвхөн .xlsx эсвэл .csv файл оруулна уу"});
  let parsed;try{parsed=await parseImportFile(req.file.buffer,filename);}catch(error){return res.status(400).json({error:error.message});}
  const base=deterministicMapping(parsed.headers),config=loadConfig();let ai=null,aiWarning=null;
  try{ai=await suggestImportMapping({config,headers:parsed.headers,rows:parsed.rows});}catch(error){aiWarning=error.code==="AI_NOT_CONFIGURED"?"AI идэвхгүй тул стандарт дүрмээр танилаа":`AI санал түр боломжгүй: ${error.message}`;}
  const mapping=mergeMapping(parsed.headers,base,ai),confidence=confidenceFor(parsed.headers,base,ai);
  const client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");const context=await importContext(client,org);const rows=validateRows(parsed.rows,mapping,context),summary={...summarize(rows,context),truncated:parsed.truncated,aiWarnings:[...(ai?.warnings||[]),...(aiWarning?[aiWarning]:[])]};
    const job=await client.query(`INSERT INTO smart_import_jobs(organization_id,import_type,original_filename,mime_type,size_bytes,content_sha256,status,source_columns,proposed_mapping,mapping_confidence,analysis_mode,ai_model,provider_response_id,summary,created_by)
      VALUES($1,'employee_master',$2,$3,$4,$5,'needs_review',$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13) RETURNING id`,[org,filename,req.file.mimetype||"",req.file.size,fileHash(req.file.buffer),JSON.stringify(parsed.headers),JSON.stringify(mapping),JSON.stringify(confidence),ai?"ai_assisted":"deterministic",ai?.model||null,ai?.providerResponseId||null,JSON.stringify(summary),req.user.id]);
    await persistRows(client,org,job.rows[0].id,rows);await event(client,org,job.rows[0].id,req.user.id,"analyzed","analyzing","needs_review",{summary,analysisMode:ai?"ai_assisted":"deterministic"});
    await writeAudit(req,"hr.smart_import_analyzed","smart_import_job",job.rows[0].id,{filename,rowCount:rows.length,analysisMode:ai?"ai_assisted":"deterministic"},client);await client.query("COMMIT");
    res.status(201).json({item:await getJob(org,job.rows[0].id)});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.patch("/:id/mapping",asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid import ID"});
  const mapping=req.body?.mapping;if(!mapping||typeof mapping!=="object"||Array.isArray(mapping))return res.status(400).json({error:"Mapping буруу байна"});
  const client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");const job=await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);if(!job.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Import not found"});}if(job.rows[0].status!=="needs_review"){await client.query("ROLLBACK");return res.status(409).json({error:"Зөвхөн хянаж буй импортын mapping-ийг өөрчилнө"});}
    const headers=job.rows[0].source_columns,cleaned={},used=new Set();for(const source of headers){const target=String(mapping[source]||"");if(!target)continue;if(!TARGET_FIELDS.includes(target)||used.has(target)){await client.query("ROLLBACK");return res.status(400).json({error:"Mapping-д зөвшөөрөгдөөгүй эсвэл давхардсан талбар байна"});}cleaned[source]=target;used.add(target);}if(!used.has("fullName")){await client.query("ROLLBACK");return res.status(400).json({error:"Овог нэрийн баганыг заавал холбоно"});}
    const staged=await client.query("SELECT row_number,source_data FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2 ORDER BY row_number",[org,id.data]);const context=await importContext(client,org);const rows=validateRows(staged.rows.map(x=>({rowNumber:x.row_number,sourceData:x.source_data})),cleaned,context),summary={...summarize(rows,context),aiWarnings:job.rows[0].summary?.aiWarnings||[]};await updateRows(client,org,id.data,rows);
    await client.query("UPDATE smart_import_jobs SET proposed_mapping=$3::jsonb,summary=$4::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2",[org,id.data,JSON.stringify(cleaned),JSON.stringify(summary)]);await event(client,org,id.data,req.user.id,"mapping_updated","needs_review","needs_review",{summary});await writeAudit(req,"hr.smart_import_mapping_update","smart_import_job",id.data,{summary},client);await client.query("COMMIT");res.json({item:await getJob(org,id.data)});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/:id/approve",asyncHandler(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid import ID"});const client=await getPool().connect(),org=req.user.organization_id;try{await client.query("BEGIN");const job=await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);if(!job.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Import not found"});}if(job.rows[0].status!=="needs_review"){await client.query("ROLLBACK");return res.status(409).json({error:"Импорт батлах төлөвт биш байна"});}if(Number(job.rows[0].summary?.errors||0)>0){await client.query("ROLLBACK");return res.status(409).json({error:"Алдаатай мөрүүдийг засахгүйгээр батлах боломжгүй"});}await client.query("UPDATE smart_import_jobs SET status='approved',approved_by=$3,reviewed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2",[org,id.data,req.user.id]);await event(client,org,id.data,req.user.id,"approved","needs_review","approved",{rowCount:job.rows[0].summary?.total||0});await writeAudit(req,"hr.smart_import_approved","smart_import_job",id.data,{rowCount:job.rows[0].summary?.total||0},client);await client.query("COMMIT");res.json({item:await getJob(org,id.data)});}catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}));

router.post("/:id/commit",asyncHandler(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid import ID"});const client=await getPool().connect(),org=req.user.organization_id;try{await client.query("BEGIN");const job=await client.query("SELECT * FROM smart_import_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);if(!job.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Import not found"});}if(job.rows[0].status!=="approved"){await client.query("ROLLBACK");return res.status(409).json({error:"Зөвхөн баталсан импортыг үндсэн санд оруулна"});}await client.query("UPDATE smart_import_jobs SET status='importing',updated_at=now() WHERE organization_id=$1 AND id=$2",[org,id.data]);await event(client,org,id.data,req.user.id,"commit_started","approved","importing",{});
    const staged=await client.query("SELECT id,row_number,normalized_data FROM smart_import_rows WHERE organization_id=$1 AND job_id=$2 AND status IN('ready','warning') ORDER BY row_number FOR UPDATE",[org,id.data]);const departmentCache=new Map(),positionCache=new Map();let imported=0;
    for(const row of staged.rows){const v=row.normalized_data;let departmentId=null,positionId=null;if(v.departmentName){const key=v.departmentName.toLocaleLowerCase("mn-MN");if(!departmentCache.has(key)){let found=await client.query("SELECT id FROM departments WHERE organization_id=$1 AND lower(name)=lower($2) AND active=true LIMIT 1",[org,v.departmentName]);if(!found.rowCount)found=await client.query("INSERT INTO departments(organization_id,code,name) VALUES($1,$2,$3) RETURNING id",[org,stableCode("IMP-D",v.departmentName),v.departmentName]);departmentCache.set(key,found.rows[0].id);}departmentId=departmentCache.get(key);}if(v.positionTitle){const key=`${departmentId||"none"}:${v.positionTitle.toLocaleLowerCase("mn-MN")}`;if(!positionCache.has(key)){let found=await client.query("SELECT id FROM positions WHERE organization_id=$1 AND lower(title)=lower($2) AND department_id IS NOT DISTINCT FROM $3 AND active=true LIMIT 1",[org,v.positionTitle,departmentId]);if(!found.rowCount)found=await client.query("INSERT INTO positions(organization_id,department_id,code,title,rank_level) VALUES($1,$2,$3,$4,10) RETURNING id",[org,departmentId,stableCode("IMP-P",`${departmentId||"none"}:${v.positionTitle}`),v.positionTitle]);positionCache.set(key,found.rows[0].id);}positionId=positionCache.get(key);}
      const employee=await client.query("INSERT INTO employees(organization_id,full_name,employee_no,job_role) VALUES($1,$2,$3,'worker') RETURNING id",[org,v.fullName,v.employeeNo||null]);await syncPrimaryAssignment(client,{organizationId:org,employeeId:employee.rows[0].id,departmentId,positionId,actorUserId:req.user.id,source:"smart_import",note:`Import ${id.data}, row ${row.row_number}`});await client.query(`INSERT INTO employee_profiles(organization_id,employee_id,employee_no,personal_email,phone,hire_date,gender,work_condition,education,contract_type,contract_no,contract_end,status_hr)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Идэвхтэй') ON CONFLICT(organization_id,employee_id) DO UPDATE SET employee_no=EXCLUDED.employee_no,personal_email=EXCLUDED.personal_email,phone=EXCLUDED.phone,hire_date=EXCLUDED.hire_date,gender=EXCLUDED.gender,work_condition=EXCLUDED.work_condition,education=EXCLUDED.education,contract_type=EXCLUDED.contract_type,contract_no=EXCLUDED.contract_no,contract_end=EXCLUDED.contract_end,updated_at=now()`,[org,employee.rows[0].id,v.employeeNo||null,v.personalEmail||null,v.phone||null,v.hireDate||null,v.gender||null,v.workCondition||null,v.education||null,v.contractType||null,v.contractNo||null,v.contractEnd||null]);await client.query("INSERT INTO employment_lifecycle_events(organization_id,employee_id,status,effective_date,reason,created_by) VALUES($1,$2,'active',$3,'Smart Import-аар бүртгэв',$4)",[org,employee.rows[0].id,v.hireDate||new Date().toISOString().slice(0,10),req.user.id]);await client.query("UPDATE smart_import_rows SET status='imported',imported_employee_id=$4,updated_at=now() WHERE organization_id=$1 AND job_id=$2 AND id=$3",[org,id.data,row.id,employee.rows[0].id]);imported+=1;}
    await client.query("UPDATE smart_import_rows SET source_data='{}'::jsonb,updated_at=now() WHERE organization_id=$1 AND job_id=$2 AND status='imported'",[org,id.data]);
    await client.query("UPDATE smart_import_jobs SET status='completed',completed_at=now(),updated_at=now(),summary=summary||$3::jsonb WHERE organization_id=$1 AND id=$2",[org,id.data,JSON.stringify({imported,stagingSourceRedacted:true})]);await event(client,org,id.data,req.user.id,"committed","importing","completed",{imported,loginAccountsCreated:0,stagingSourceRedacted:true});await writeAudit(req,"hr.smart_import_committed","smart_import_job",id.data,{imported,loginAccountsCreated:0,stagingSourceRedacted:true},client);await client.query("COMMIT");res.json({item:await getJob(org,id.data)});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}}));

module.exports=router;
