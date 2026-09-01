"use strict";

const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { authenticate, requireModule, requirePermissions } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { syncPrimaryAssignment } = require("../services/employee-assignment");
const { recordDocumentLink } = require("../services/document-links");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal(""), z.null()]).optional();
const blankableDate = z.union([z.iso.date(), z.literal(""), z.null()]).optional();
const blankableNumber = z.union([z.coerce.number(), z.literal(""), z.null()]).optional();

const profileFields = {
  employeeNo:"employee_no", personalEmail:"personal_email", registerNo:"register_no", idCardNo:"id_card_no",
  phone:"phone", address:"address", gender:"gender", birthdate:"birthdate", nationality:"nationality",
  hireDate:"hire_date", contractDate:"contract_date", contractType:"contract_type", contractNo:"contract_no",
  contractEnd:"contract_end", contractNotes:"contract_notes", statusHr:"status_hr", jobCategory:"job_category",
  education:"education", diploma:"diploma", professionalCert:"professional_cert", workCondition:"work_condition",
  salary:"salary", skillAllowanceRate:"skill_allowance_rate", skillAllowance:"skill_allowance",
  mealAllowance:"meal_allowance", tenureYears:"tenure_years", tenureAllowanceRate:"tenure_allowance_rate",
  tenureAllowance:"tenure_allowance", haotExempt:"haot_exempt", emergencyContact:"emergency_contact",
  familyStatus:"family_status", spouseName:"spouse_name", childrenCount:"children_count",
  childrenNames:"children_names", jobDescription:"job_description",
};
const profileShape = {
  employeeNo:z.string().trim().max(80).optional(), personalEmail:z.union([z.string().trim().email().max(200),z.literal("")]).optional(),
  registerNo:z.string().trim().max(40).optional(), idCardNo:z.string().trim().max(80).optional(), phone:z.string().trim().max(80).optional(),
  address:z.string().trim().max(500).optional(), gender:z.string().trim().max(40).optional(), birthdate:blankableDate,
  nationality:z.string().trim().max(100).optional(), hireDate:blankableDate, contractDate:blankableDate,
  contractType:z.string().trim().max(100).optional(), contractNo:z.string().trim().max(100).optional(), contractEnd:blankableDate,
  contractNotes:z.string().trim().max(1000).optional(), statusHr:z.string().trim().max(100).optional(),
  jobCategory:z.string().trim().max(100).optional(), education:z.string().trim().max(500).optional(),
  diploma:z.string().trim().max(500).optional(), professionalCert:z.string().trim().max(500).optional(),
  workCondition:z.string().trim().max(100).optional(), salary:blankableNumber, skillAllowanceRate:blankableNumber,
  skillAllowance:blankableNumber, mealAllowance:blankableNumber, tenureYears:blankableNumber,
  tenureAllowanceRate:blankableNumber, tenureAllowance:blankableNumber, haotExempt:z.coerce.boolean().optional(),
  emergencyContact:z.string().trim().max(300).optional(), familyStatus:z.string().trim().max(100).optional(),
  spouseName:z.string().trim().max(200).optional(), childrenCount:blankableNumber, childrenNames:z.string().trim().max(500).optional(),
  jobDescription:z.string().trim().max(3000).optional(),
};
const profileSchema = z.object(profileShape).refine(v => Object.keys(v).length > 0, "No changes supplied");
const createEmployeeSchema = z.object({
  fullName:z.string().trim().min(2).max(200), jobRole:z.string().trim().min(1).max(80).default("worker"),
  departmentId:optionalUuid, positionId:optionalUuid, managerEmployeeId:optionalUuid,
  ...profileShape,
});
const eventSchema = z.object({
  eventType:z.enum(["hired","contract_renewed","position_changed","department_changed","leave_started","leave_ended","suspended","terminated","note"]),
  effectiveDate:z.iso.date(), title:z.string().trim().min(1).max(250), note:z.string().trim().max(3000).default(""),
});
const contractSchema = z.object({
  contractKey:optionalUuid, contractNo:z.string().trim().min(1).max(100), contractType:z.string().trim().min(1).max(100),
  status:z.enum(["draft","active","expired","terminated","superseded"]).default("active"),
  startsOn:z.iso.date(), endsOn:blankableDate, signedOn:blankableDate,
  termsSummary:z.string().trim().max(3000).default(""), documentId:optionalUuid,
});
const compensationSchema = z.object({
  effectiveFrom:z.iso.date(), effectiveTo:blankableDate, currency:z.string().trim().length(3).transform(v=>v.toUpperCase()).default("MNT"),
  baseSalary:z.coerce.number().min(0), allowances:z.record(z.string(),z.coerce.number().min(0)).default({}),
  reason:z.string().trim().max(1000).default(""), approved:z.coerce.boolean().default(false),
});
const lifecycleSchema = z.object({
  status:z.enum(["candidate","offered","onboarding","active","on_leave","suspended","terminated","retired"]),
  effectiveDate:z.iso.date(), reason:z.string().trim().max(2000).default(""),
});
const positionDescriptionSchema = z.object({
  title:z.string().trim().min(1).max(250), purpose:z.string().trim().max(3000).default(""),
  duties:z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  responsibilities:z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  requirements:z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  status:z.enum(["draft","approved","retired"]).default("draft"), effectiveFrom:z.iso.date(),
});
const employeeDocumentSchema = z.object({
  documentNo:z.string().trim().min(1).max(100), title:z.string().trim().min(1).max(250),
  documentType:z.string().trim().min(1).max(100).default("employee_file"),
  classification:z.enum(["internal","confidential","restricted"]).default("confidential"),
  retentionClass:z.string().trim().min(1).max(100).default("employment_plus_10_years"),
});
const lifecycleTransitions = {
  candidate:new Set(["offered","onboarding","active"]), offered:new Set(["onboarding","active"]),
  onboarding:new Set(["active","terminated"]), active:new Set(["on_leave","suspended","terminated"]),
  on_leave:new Set(["active","terminated"]), suspended:new Set(["active","terminated"]),
  terminated:new Set(["retired"]), retired:new Set(),
};
const hrStatusLabel=status=>({candidate:"Горилогч",offered:"Ажлын санал хүргэсэн",onboarding:"Ажилд авах шат",active:"Идэвхтэй",on_leave:"Чөлөөтэй",suspended:"Түр түдгэлзсэн",terminated:"Ажлаас гарсан",retired:"Тэтгэвэрт гарсан"}[status]||status);

const profileValue = value => value === "" ? null : value;
async function upsertProfile(client, organizationId, employeeId, values) {
  const entries = Object.entries(profileFields).filter(([key]) => values[key] !== undefined);
  await client.query(
    `INSERT INTO employee_profiles(organization_id,employee_id) VALUES($1,$2)
     ON CONFLICT(organization_id,employee_id) DO NOTHING`, [organizationId,employeeId]
  );
  if (entries.length) {
    const params = [organizationId,employeeId,...entries.map(([key]) => profileValue(values[key]))];
    const setters = entries.map(([,column],index) => `${column}=$${index+3}`).join(",");
    await client.query(`UPDATE employee_profiles SET ${setters},updated_at=now() WHERE organization_id=$1 AND employee_id=$2`, params);
  }
  if (values.employeeNo !== undefined) {
    await client.query("UPDATE employees SET employee_no=NULLIF($3,''),updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId,employeeId,values.employeeNo]);
  }
}

router.use(authenticate, requireModule("hr"), requirePermissions("hr.manage"));

router.get("/overview", asyncHandler(async (req, res) => {
  const org = req.user.organization_id;
  const [summary,employees,events,departments,positions] = await Promise.all([
    getPool().query(
      `SELECT count(*)::int AS total_employees,
              count(*) FILTER(WHERE e.active)::int AS active_employees,
              count(*) FILTER(WHERE NOT e.active)::int AS inactive_employees,
              count(*) FILTER(WHERE e.active AND lower(COALESCE(ep.status_hr,'')) ~ '(амралт|өвч|чөлөө)')::int AS on_leave,
              count(*) FILTER(WHERE ep.contract_end BETWEEN CURRENT_DATE AND CURRENT_DATE+INTERVAL '30 days')::int AS contracts_expiring,
              count(*) FILTER(WHERE ep.id IS NULL OR NULLIF(ep.phone,'') IS NULL OR ep.hire_date IS NULL)::int AS incomplete_profiles
         FROM employees e LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
        WHERE e.organization_id=$1`, [org]),
    getPool().query(
      `SELECT e.id,e.full_name,e.job_role AS role,e.active,e.department_id,e.position_id,e.manager_employee_id,
              d.name AS department_name,p.title AS position_title,m.full_name AS manager_name,
              u.id AS user_id,u.username,u.email,COALESCE(u.can_login,false) AS can_login,
              COALESCE(ep.employee_no,e.employee_no) AS employee_no,ep.personal_email,ep.register_no,ep.id_card_no,
              ep.phone,ep.address,ep.gender,ep.birthdate,ep.nationality,ep.hire_date,ep.contract_date,
              ep.contract_type,ep.contract_no,ep.contract_end,ep.contract_notes,ep.status_hr,ep.job_category,
              ep.education,ep.diploma,ep.professional_cert,ep.work_condition,ep.salary,ep.skill_allowance_rate,
              ep.skill_allowance,ep.meal_allowance,ep.tenure_years,ep.tenure_allowance_rate,ep.tenure_allowance,
              ep.haot_exempt,ep.emergency_contact,ep.family_status,ep.spouse_name,ep.children_count,
              ep.children_names,ep.job_description,ep.avatar_url,
              lc.status AS lifecycle_status,lc.effective_date AS lifecycle_effective_date,
              ec.contract_no AS current_contract_no,ec.contract_type AS current_contract_type,
              ec.starts_on AS current_contract_start,ec.ends_on AS current_contract_end,
              pay.base_salary AS current_base_salary,pay.currency AS current_currency
         FROM employees e
    LEFT JOIN users u ON u.organization_id=e.organization_id AND u.employee_id=e.id
    LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id
    LEFT JOIN positions p ON p.organization_id=e.organization_id AND p.id=e.position_id
    LEFT JOIN employees m ON m.organization_id=e.organization_id AND m.id=e.manager_employee_id
    LEFT JOIN employee_profiles ep ON ep.organization_id=e.organization_id AND ep.employee_id=e.id
    LEFT JOIN LATERAL (SELECT status,effective_date FROM employment_lifecycle_events
                        WHERE organization_id=e.organization_id AND employee_id=e.id
                        ORDER BY effective_date DESC,created_at DESC LIMIT 1) lc ON true
    LEFT JOIN LATERAL (SELECT contract_no,contract_type,starts_on,ends_on FROM employment_contracts
                        WHERE organization_id=e.organization_id AND employee_id=e.id
                        ORDER BY starts_on DESC,version_no DESC,created_at DESC LIMIT 1) ec ON true
    LEFT JOIN LATERAL (SELECT base_salary,currency FROM employee_compensation_history
                        WHERE organization_id=e.organization_id AND employee_id=e.id
                          AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)
                        ORDER BY effective_from DESC,created_at DESC LIMIT 1) pay ON true
        WHERE e.organization_id=$1 ORDER BY e.active DESC,COALESCE(p.rank_level,999),e.full_name`, [org]),
    getPool().query(
      `SELECT ev.*,ev.employee_id AS user_id,e.full_name,creator.full_name AS created_by_name
         FROM employee_events ev JOIN employees e ON e.organization_id=ev.organization_id AND e.id=ev.employee_id
         JOIN users creator ON creator.organization_id=ev.organization_id AND creator.id=ev.created_by
        WHERE ev.organization_id=$1 ORDER BY ev.effective_date DESC,ev.created_at DESC LIMIT 200`, [org]),
    getPool().query("SELECT id,name FROM departments WHERE organization_id=$1 AND active=true ORDER BY name", [org]),
    getPool().query("SELECT id,title,department_id,rank_level FROM positions WHERE organization_id=$1 AND active=true ORDER BY rank_level,title", [org]),
  ]);
  const sensitive=(req.user.permissions||[]).includes("hr.sensitive.read");
  const safeEmployees=employees.rows.map(item=>sensitive?item:{...item,register_no:null,id_card_no:null,salary:null,current_base_salary:null,emergency_contact:null,family_status:null,spouse_name:null,children_count:null,children_names:null});
  res.json({ summary:summary.rows[0],employees:safeEmployees,events:events.rows,departments:departments.rows,positions:positions.rows,canReadSensitive:sensitive,canManageCompensation:(req.user.permissions||[]).includes("hr.compensation.manage") });
}));

router.post("/employees", asyncHandler(async (req, res) => {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error:"Ажилтны мэдээлэл буруу байна",issues:parsed.error.issues });
  const value = parsed.data;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const employee = await client.query(
      `INSERT INTO employees(organization_id,full_name,employee_no,job_role) VALUES($1,$2,NULLIF($3,''),$4)
       RETURNING id,full_name,employee_no,job_role AS role,active`,
      [req.user.organization_id,value.fullName,value.employeeNo||null,value.jobRole]
    );
    await syncPrimaryAssignment(client, {
      organizationId:req.user.organization_id,employeeId:employee.rows[0].id,
      departmentId:value.departmentId||null,positionId:value.positionId||null,
      managerEmployeeId:value.managerEmployeeId||null,actorUserId:req.user.id,source:"hr",
    });
    await upsertProfile(client,req.user.organization_id,employee.rows[0].id,value);
    await client.query(
      `INSERT INTO employment_lifecycle_events(organization_id,employee_id,status,effective_date,reason,created_by)
       VALUES($1,$2,'active',$3,'Employee registered through HR',$4)`,
      [req.user.organization_id,employee.rows[0].id,value.hireDate||new Date().toISOString().slice(0,10),req.user.id]
    );
    if(value.contractNo){
      await client.query(
        `INSERT INTO employment_contracts(organization_id,employee_id,contract_no,contract_type,status,starts_on,ends_on,terms_summary,created_by)
         VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8)`,
        [req.user.organization_id,employee.rows[0].id,value.contractNo,value.contractType||"unspecified",value.contractDate||value.hireDate||new Date().toISOString().slice(0,10),value.contractEnd||null,value.contractNotes||"",req.user.id]
      );
    }
    if(value.salary!==undefined&&value.salary!==""&&value.salary!==null){
      await client.query(
        `INSERT INTO employee_compensation_history(organization_id,employee_id,effective_from,base_salary,reason,created_by)
         VALUES($1,$2,$3,$4,'Initial compensation', $5)`,
        [req.user.organization_id,employee.rows[0].id,value.hireDate||new Date().toISOString().slice(0,10),value.salary,req.user.id]
      );
    }
    await writeAudit(req,"hr.employee_create","employee",employee.rows[0].id,{ fullName:value.fullName,departmentId:value.departmentId||null,positionId:value.positionId||null },client);
    await client.query("COMMIT");
    res.status(201).json({ item:employee.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.get("/employees/:id/file", asyncHandler(async (req, res) => {
  const id=uuid.safeParse(req.params.id);
  if(!id.success) return res.status(400).json({ error:"Invalid employee ID" });
  const org=req.user.organization_id;
  const employee=await getPool().query("SELECT id,full_name,position_id FROM employees WHERE organization_id=$1 AND id=$2",[org,id.data]);
  if(!employee.rowCount) return res.status(404).json({ error:"Employee not found" });
  const [contracts,compensation,lifecycle,documents,positionDescriptions]=await Promise.all([
    getPool().query("SELECT * FROM employment_contracts WHERE organization_id=$1 AND employee_id=$2 ORDER BY starts_on DESC,version_no DESC",[org,id.data]),
    getPool().query("SELECT * FROM employee_compensation_history WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_from DESC,created_at DESC",[org,id.data]),
    getPool().query("SELECT * FROM employment_lifecycle_events WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_date DESC,created_at DESC",[org,id.data]),
    getPool().query("SELECT id,document_no,title,document_type,status,classification_code,retention_class,current_version_id,created_at,updated_at FROM documents WHERE organization_id=$1 AND linked_entity_type='employee' AND linked_entity_id=$2 ORDER BY updated_at DESC",[org,id.data]),
    employee.rows[0].position_id
      ? getPool().query("SELECT * FROM position_description_versions WHERE organization_id=$1 AND position_id=$2 ORDER BY version_no DESC",[org,employee.rows[0].position_id])
      : Promise.resolve({rows:[]}),
  ]);
  const sensitive=(req.user.permissions||[]).includes("hr.sensitive.read");
  res.json({ employee:employee.rows[0],contracts:contracts.rows,compensation:sensitive?compensation.rows:[],lifecycle:lifecycle.rows,documents:sensitive?documents.rows:[],positionDescriptions:positionDescriptions.rows,canReadSensitive:sensitive,canManageCompensation:(req.user.permissions||[]).includes("hr.compensation.manage") });
}));

router.post("/employees/:id/contracts", asyncHandler(async (req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=contractSchema.safeParse(req.body);
  if(!id.success||!parsed.success) return res.status(400).json({error:"Invalid contract data",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");
    const employee=await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);
    if(!employee.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Employee not found"});}
    let key=v.contractKey||null,version=1;
    if(key){const previous=await client.query("SELECT COALESCE(max(version_no),0)::int AS version FROM employment_contracts WHERE organization_id=$1 AND employee_id=$2 AND contract_key=$3",[org,id.data,key]);if(!previous.rows[0].version){await client.query("ROLLBACK");return res.status(404).json({error:"Contract series not found"});}version=previous.rows[0].version+1;}
    const result=await client.query(
      `INSERT INTO employment_contracts(organization_id,employee_id,contract_key,version_no,contract_no,contract_type,status,starts_on,ends_on,signed_on,terms_summary,document_id,created_by)
       VALUES($1,$2,COALESCE($3,gen_random_uuid()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [org,id.data,key,version,v.contractNo,v.contractType,v.status,v.startsOn,v.endsOn||null,v.signedOn||null,v.termsSummary,v.documentId||null,req.user.id]);
    await client.query(`UPDATE employee_profiles SET contract_no=$3,contract_type=$4,contract_date=$5,contract_end=$6,contract_notes=$7,updated_at=now() WHERE organization_id=$1 AND employee_id=$2`,[org,id.data,v.contractNo,v.contractType,v.startsOn,v.endsOn||null,v.termsSummary]);
    await writeAudit(req,"hr.contract_version_create","employment_contract",result.rows[0].id,{employeeId:id.data,contractKey:result.rows[0].contract_key,version},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/employees/:id/compensation", requirePermissions("hr.compensation.manage"), asyncHandler(async (req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=compensationSchema.safeParse(req.body);
  if(!id.success||!parsed.success) return res.status(400).json({error:"Invalid compensation data",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");
    const employee=await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);
    if(!employee.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Employee not found"});}
    const overlap=await client.query(`SELECT id FROM employee_compensation_history WHERE organization_id=$1 AND employee_id=$2 AND daterange(effective_from,COALESCE(effective_to,'infinity'::date),'[]') && daterange($3::date,COALESCE($4::date,'infinity'::date),'[]') LIMIT 1`,[org,id.data,v.effectiveFrom,v.effectiveTo||null]);
    if(overlap.rowCount){await client.query("ROLLBACK");return res.status(409).json({error:"Compensation effective dates overlap an existing record"});}
    const result=await client.query(`INSERT INTO employee_compensation_history(organization_id,employee_id,effective_from,effective_to,currency,base_salary,allowances,reason,approved_by,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *`,[org,id.data,v.effectiveFrom,v.effectiveTo||null,v.currency,v.baseSalary,JSON.stringify(v.allowances),v.reason,v.approved?req.user.id:null,req.user.id]);
    await client.query("UPDATE employee_profiles SET salary=$3,updated_at=now() WHERE organization_id=$1 AND employee_id=$2",[org,id.data,v.baseSalary]);
    await writeAudit(req,"hr.compensation_create","employee_compensation",result.rows[0].id,{employeeId:id.data,effectiveFrom:v.effectiveFrom,currency:v.currency},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/employees/:id/lifecycle", asyncHandler(async (req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=lifecycleSchema.safeParse(req.body);
  if(!id.success||!parsed.success) return res.status(400).json({error:"Invalid lifecycle data",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");
    const employee=await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);
    if(!employee.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Employee not found"});}
    const current=await client.query("SELECT status,effective_date FROM employment_lifecycle_events WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_date DESC,created_at DESC LIMIT 1",[org,id.data]);
    const from=current.rows[0]?.status;
    const currentDate=current.rows[0]?.effective_date instanceof Date?current.rows[0].effective_date.toISOString().slice(0,10):String(current.rows[0]?.effective_date||"").slice(0,10);
    if(from&&(!lifecycleTransitions[from]?.has(v.status)||v.effectiveDate<currentDate)){await client.query("ROLLBACK");return res.status(409).json({error:`Invalid lifecycle transition: ${from} -> ${v.status}`});}
    const result=await client.query("INSERT INTO employment_lifecycle_events(organization_id,employee_id,status,effective_date,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[org,id.data,v.status,v.effectiveDate,v.reason,req.user.id]);
    await client.query("UPDATE employees SET active=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",[org,id.data,!['terminated','retired'].includes(v.status)]);
    await client.query("UPDATE employee_profiles SET status_hr=$3,updated_at=now() WHERE organization_id=$1 AND employee_id=$2",[org,id.data,hrStatusLabel(v.status)]);
    await writeAudit(req,"hr.lifecycle_transition","employment_lifecycle",result.rows[0].id,{employeeId:id.data,from:from||null,to:v.status,effectiveDate:v.effectiveDate},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/positions/:id/descriptions", asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=positionDescriptionSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid position description",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");
    const position=await client.query("SELECT id FROM positions WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);
    if(!position.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Position not found"});}
    const version=await client.query("SELECT COALESCE(max(version_no),0)::int+1 AS version FROM position_description_versions WHERE organization_id=$1 AND position_id=$2",[org,id.data]);
    const result=await client.query(`INSERT INTO position_description_versions(organization_id,position_id,version_no,title,purpose,duties,responsibilities,requirements,status,effective_from,approved_by,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12) RETURNING *`,[org,id.data,version.rows[0].version,v.title,v.purpose,JSON.stringify(v.duties),JSON.stringify(v.responsibilities),JSON.stringify(v.requirements),v.status,v.effectiveFrom,v.status==='approved'?req.user.id:null,req.user.id]);
    await writeAudit(req,"hr.position_description_version_create","position_description",result.rows[0].id,{positionId:id.data,version:version.rows[0].version,status:v.status},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/employees/:id/documents", asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=employeeDocumentSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid employee document",issues:parsed.error?.issues});
  const v=parsed.data,client=await getPool().connect(),org=req.user.organization_id;
  try{await client.query("BEGIN");
    const employee=await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE",[org,id.data]);
    if(!employee.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Employee not found"});}
    const result=await client.query(`INSERT INTO documents(organization_id,document_no,title,document_type,status,classification_code,retention_class,linked_entity_type,linked_entity_id,created_by,updated_by) VALUES($1,$2,$3,$4,'draft',$5,$6,'employee',$7,$8,$8) RETURNING *`,[org,v.documentNo,v.title,v.documentType,v.classification,v.retentionClass,id.data,req.user.id]);
    await client.query(`INSERT INTO document_lifecycle_events(organization_id,document_id,action,to_status,note,actor_user_id) VALUES($1,$2,'created','draft','Created from employee personal file',$3)`,[org,result.rows[0].id,req.user.id]);
    await recordDocumentLink({req,documentId:result.rows[0].id,entityType:"employee",entityId:id.data,source:"domain",requiredPermissions:["hr.manage"],client});
    await writeAudit(req,"hr.employee_document_create","document",result.rows[0].id,{employeeId:id.data,documentNo:v.documentNo,classification:v.classification},client);
    await client.query("COMMIT");res.status(201).json({item:result.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.patch("/employees/:id", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id), parsed = profileSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error:"Ажилтны мэдээлэл буруу байна",issues:parsed.error?.issues });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT id FROM employees WHERE organization_id=$1 AND id=$2 FOR UPDATE", [req.user.organization_id,id.data]);
    if (!exists.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error:"Ажилтан олдсонгүй" }); }
    await upsertProfile(client,req.user.organization_id,id.data,parsed.data);
    await writeAudit(req,"hr.profile_update","employee",id.data,parsed.data,client);
    await client.query("COMMIT");
    const result = await getPool().query("SELECT * FROM employee_profiles WHERE organization_id=$1 AND employee_id=$2", [req.user.organization_id,id.data]);
    res.json({ item:result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}));

router.post("/employees/:id/events", asyncHandler(async (req, res) => {
  const id = uuid.safeParse(req.params.id), parsed = eventSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error:"Хөдөлгөөний мэдээлэл буруу байна",issues:parsed.error?.issues });
  const value = parsed.data;
  const result = await getPool().query(
    `INSERT INTO employee_events(organization_id,employee_id,event_type,effective_date,title,note,created_by)
     SELECT $1,id,$3,$4,$5,$6,$7 FROM employees WHERE organization_id=$1 AND id=$2 RETURNING *,employee_id AS user_id`,
    [req.user.organization_id,id.data,value.eventType,value.effectiveDate,value.title,value.note,req.user.id]
  );
  if (!result.rowCount) return res.status(404).json({ error:"Ажилтан олдсонгүй" });
  await writeAudit(req,"hr.event_create","employee_event",result.rows[0].id,{ employeeId:id.data,eventType:value.eventType });
  res.status(201).json({ item:result.rows[0] });
}));

module.exports = router;
