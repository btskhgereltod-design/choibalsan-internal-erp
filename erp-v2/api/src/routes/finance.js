"use strict";

const crypto = require("crypto");
const express = require("express");
const ExcelJS = require("exceljs");
const multer = require("multer");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireRoles, requireModule } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { emitAutomationEvent } = require("../services/automation");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const editors = requireRoles("director", "accountant");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const typeAliases = { income:"income", орлого:"income", expense:"expense", зарлага:"expense", receivable:"receivable", авлага:"receivable", payable:"payable", өглөг:"payable", transfer:"transfer", шилжүүлэг:"transfer", adjustment:"adjustment", тохируулга:"adjustment" };
const headers = {
  date:["date","огноо"], type:["type","төрөл"], amount:["amount","дүн"], currency:["currency","валют"],
  account:["account","account code","данс","дансны код"], accountName:["account name","дансны нэр"],
  counterparty:["counterparty","харилцагч"], description:["description","гүйлгээний утга","утга"],
  reference:["reference","баримт","лавлагаа"], externalId:["external id","external_id","гүйлгээний дугаар","id"]
};

router.use(authenticate, requireModule("finance"));

function normalizedKey(value){ return String(value ?? "").trim().toLocaleLowerCase("mn-MN"); }
function valueFor(row, names){ for(const name of names){ if(Object.hasOwn(row,name)) return row[name]; } return ""; }
function parseCsv(text){
  const rows=[]; let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){ const c=text[i],n=text[i+1]; if(c==='"'&&quoted&&n==='"'){cell+='"';i++;}else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>String(v).trim()))rows.push(row);row=[];cell="";}else cell+=c; }
  row.push(cell); if(row.some(v=>String(v).trim()))rows.push(row); return rows;
}
async function parseWorkbook(file){
  if(/\.csv$/i.test(file.originalname)){ return parseCsv(file.buffer.toString("utf8").replace(/^\uFEFF/,"")); }
  if(!/\.xlsx$/i.test(file.originalname)) throw Object.assign(new Error("CSV эсвэл XLSX файл сонгоно уу"),{status:400});
  const book=new ExcelJS.Workbook(); await book.xlsx.load(file.buffer); const sheet=book.worksheets[0];
  if(!sheet) return []; const rows=[]; sheet.eachRow({includeEmpty:false},r=>rows.push(r.values.slice(1).map(v=>v&&typeof v==="object"&&"text" in v?v.text:v))); return rows;
}
function rowsToObjects(matrix){
  if(matrix.length<2)return []; const keys=matrix[0].map(normalizedKey); return matrix.slice(1).map(values=>Object.fromEntries(keys.map((k,i)=>[k,values[i]??""])));
}
function excelDate(value){ if(value instanceof Date)return value.toISOString().slice(0,10); if(typeof value==="number"){const d=new Date(Date.UTC(1899,11,30)+value*86400000);return d.toISOString().slice(0,10);} const raw=String(value||"").trim(); const d=new Date(raw); return Number.isNaN(d.valueOf())?null:d.toISOString().slice(0,10); }
function normalizeRow(row,index){
  const date=excelDate(valueFor(row,headers.date)), type=typeAliases[normalizedKey(valueFor(row,headers.type))], amount=Number(String(valueFor(row,headers.amount)).replace(/[,\s₮]/g,"")), account=String(valueFor(row,headers.account)||"").trim().toUpperCase();
  if(!date)throw new Error("Огноо буруу"); if(!type)throw new Error("Төрөл буруу"); if(!Number.isFinite(amount)||amount<0)throw new Error("Дүн буруу"); if(!account)throw new Error("Дансны код хоосон");
  const base={date,type,amount,account,accountName:String(valueFor(row,headers.accountName)||account).trim(),currency:String(valueFor(row,headers.currency)||"MNT").trim().toUpperCase(),counterparty:String(valueFor(row,headers.counterparty)||"").trim(),description:String(valueFor(row,headers.description)||"").trim(),reference:String(valueFor(row,headers.reference)||"").trim()};
  if(!/^[A-Z]{3}$/.test(base.currency))throw new Error("Валютын код буруу");
  base.externalId=String(valueFor(row,headers.externalId)||"").trim()||crypto.createHash("sha256").update(JSON.stringify(base)).digest("hex"); base.row=index+2; return base;
}
function accountType(type){return ({income:"revenue",expense:"expense",receivable:"receivable",payable:"payable",transfer:"bank",adjustment:"asset"})[type];}

router.get("/overview", asyncHandler(async(req,res)=>{
  const org=req.user.organization_id, from=req.query.from||new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10),to=req.query.to||new Date().toISOString().slice(0,10);
  const [summary,trend,transactions,jobs,accounts,budgets]=await Promise.all([
    getPool().query(`SELECT COALESCE(sum(amount) FILTER(WHERE transaction_type='income'),0)::numeric AS income,COALESCE(sum(amount) FILTER(WHERE transaction_type='expense'),0)::numeric AS expense,COALESCE(sum(amount) FILTER(WHERE transaction_type='receivable'),0)::numeric AS receivable,COALESCE(sum(amount) FILTER(WHERE transaction_type='payable'),0)::numeric AS payable,count(*)::int AS transaction_count FROM finance_transactions WHERE organization_id=$1 AND transaction_date BETWEEN $2 AND $3`,[org,from,to]),
    getPool().query(`SELECT to_char(date_trunc('month',transaction_date),'YYYY-MM') AS month,COALESCE(sum(amount) FILTER(WHERE transaction_type='income'),0)::numeric AS income,COALESCE(sum(amount) FILTER(WHERE transaction_type='expense'),0)::numeric AS expense FROM finance_transactions WHERE organization_id=$1 AND transaction_date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`,[org,from,to]),
    getPool().query(`SELECT t.*,a.code AS account_code,a.name AS account_name FROM finance_transactions t JOIN finance_accounts a ON a.organization_id=t.organization_id AND a.id=t.account_id WHERE t.organization_id=$1 AND t.transaction_date BETWEEN $2 AND $3 ORDER BY t.transaction_date DESC,t.imported_at DESC LIMIT 100`,[org,from,to]),
    getPool().query(`SELECT j.*,c.name AS connector_name FROM finance_import_jobs j JOIN finance_connectors c ON c.organization_id=j.organization_id AND c.id=j.connector_id WHERE j.organization_id=$1 ORDER BY j.started_at DESC LIMIT 20`,[org]),
    getPool().query(`SELECT * FROM finance_accounts WHERE organization_id=$1 ORDER BY active DESC,code`,[org]),
    getPool().query(`SELECT * FROM finance_budgets WHERE organization_id=$1 AND period_end >= $2 AND period_start <= $3 ORDER BY period_start DESC`,[org,from,to])
  ]); const s=summary.rows[0]; s.net=Number(s.income)-Number(s.expense); s.budget=budgets.rows.reduce((n,b)=>n+Number(b.planned_amount),0); res.json({from,to,summary:s,trend:trend.rows,transactions:transactions.rows,jobs:jobs.rows,accounts:accounts.rows,budgets:budgets.rows});
}));

router.post("/accounts",editors,asyncHandler(async(req,res)=>{const parsed=z.object({code:z.string().trim().min(1).max(40).transform(v=>v.toUpperCase()),name:z.string().trim().min(1).max(200),accountType:z.enum(["cash","bank","receivable","payable","revenue","expense","asset","liability","equity"]),currency:z.string().length(3).transform(v=>v.toUpperCase()).default("MNT")}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Дансны мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO finance_accounts(organization_id,code,name,account_type,currency) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.user.organization_id,v.code,v.name,v.accountType,v.currency]);await writeAudit(req,"finance.account.create","finance_account",result.rows[0].id,v);res.status(201).json({item:result.rows[0]});}));
router.post("/budgets",editors,asyncHandler(async(req,res)=>{const parsed=z.object({category:z.string().trim().min(1).max(150),periodStart:z.iso.date(),periodEnd:z.iso.date(),plannedAmount:z.coerce.number().min(0),currency:z.string().length(3).transform(v=>v.toUpperCase()).default("MNT")}).safeParse(req.body);if(!parsed.success||parsed.data.periodEnd<parsed.data.periodStart)return res.status(400).json({error:"Төсвийн мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO finance_budgets(organization_id,category,period_start,period_end,planned_amount,currency,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[req.user.organization_id,v.category,v.periodStart,v.periodEnd,v.plannedAmount,v.currency,req.user.id]);await writeAudit(req,"finance.budget.create","finance_budget",result.rows[0].id,v);res.status(201).json({item:result.rows[0]});}));

router.post("/imports",editors,upload.single("file"),asyncHandler(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Импортлох файл сонгоно уу"}); const org=req.user.organization_id,checksum=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const existing=await getPool().query(`SELECT id,status,rows_imported FROM finance_import_jobs WHERE organization_id=$1 AND file_checksum=$2`,[org,checksum]);if(existing.rowCount)return res.status(409).json({error:"Энэ файлыг өмнө нь импортолсон байна",job:existing.rows[0]});
  let matrix; try{matrix=await parseWorkbook(req.file);}catch(error){return res.status(error.status||400).json({error:error.message});} const rawRows=rowsToObjects(matrix);if(!rawRows.length)return res.status(400).json({error:"Файлд импортлох мөр алга"});if(rawRows.length>10000)return res.status(400).json({error:"Нэг удаад 10,000 мөрөөс ихгүй импортлоно"});
  const connector=await getPool().query(`INSERT INTO finance_connectors(organization_id,code,name,connector_type,created_by) VALUES($1,'FILE-IMPORT','Excel / CSV импорт','csv',$2) ON CONFLICT(organization_id,code) DO UPDATE SET updated_at=now() RETURNING *`,[org,req.user.id]);
  const client=await getPool().connect();let job;try{await client.query("BEGIN");job=(await client.query(`INSERT INTO finance_import_jobs(organization_id,connector_id,status,source_file_name,file_checksum,rows_received,created_by) VALUES($1,$2,'running',$3,$4,$5,$6) RETURNING *`,[org,connector.rows[0].id,req.file.originalname.slice(0,250),checksum,rawRows.length,req.user.id])).rows[0];let imported=0;const errors=[];
    for(let i=0;i<rawRows.length;i++){try{const v=normalizeRow(rawRows[i],i),account=(await client.query(`INSERT INTO finance_accounts(organization_id,code,name,account_type,currency) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,code) DO UPDATE SET updated_at=now() RETURNING id`,[org,v.account,v.accountName,accountType(v.type),v.currency])).rows[0];const inserted=await client.query(`INSERT INTO finance_transactions(organization_id,connector_id,import_job_id,account_id,external_id,transaction_date,transaction_type,amount,currency,counterparty,description,reference,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(organization_id,connector_id,external_id) DO NOTHING RETURNING id`,[org,connector.rows[0].id,job.id,account.id,v.externalId,v.date,v.type,v.amount,v.currency,v.counterparty,v.description,v.reference,{sourceRow:v.row}]);if(inserted.rowCount)imported++;else errors.push({row:v.row,error:"Давхардсан гүйлгээ"});}catch(error){errors.push({row:i+2,error:error.message});}}
    const rejected=rawRows.length-imported,status=rejected===0?"completed":imported?"partial":"failed";job=(await client.query(`UPDATE finance_import_jobs SET status=$3,rows_imported=$4,rows_rejected=$5,errors=$6,completed_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,job.id,status,imported,rejected,JSON.stringify(errors.slice(0,200))])).rows[0];await client.query(`UPDATE finance_connectors SET last_synced_at=now(),connector_type=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,[org,connector.rows[0].id,/\.xlsx$/i.test(req.file.originalname)?"xlsx":"csv"]);await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}finally{client.release();}await writeAudit(req,"finance.import","finance_import_job",job.id,{file:req.file.originalname,rowsImported:job.rows_imported,rowsRejected:job.rows_rejected});await emitAutomationEvent({organizationId:org,eventType:"finance.import.completed",payload:{status:job.status,rowsImported:job.rows_imported,rowsRejected:job.rows_rejected,fileName:req.file.originalname},sourceEntityType:"finance_import_job",sourceEntityId:job.id}).catch(error=>console.error("[automation]",error));res.status(201).json({job});
}));

router.get("/template.csv",(_req,res)=>{res.type("text/csv; charset=utf-8").attachment("finance-import-template.csv").send("\uFEFFогноо,төрөл,дүн,валют,дансны код,дансны нэр,харилцагч,гүйлгээний утга,баримт,гүйлгээний дугаар\n2026-08-20,орлого,1500000,MNT,1001,Харилцах данс,Харилцагч ХХК,Үйлчилгээний орлого,INV-001,TX-001\n");});

module.exports=router;
