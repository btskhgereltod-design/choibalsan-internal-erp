"use strict";

const express=require("express");
const {z}=require("zod");
const {getPool}=require("../db");
const {authenticate,requirePermissions}=require("../middleware/auth");
const {writeAudit}=require("../services/audit");
const {asyncHandler}=require("../utils/async-handler");

const router=express.Router();
const uuid=z.string().uuid();
const code=z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const text=max=>z.string().trim().min(1).max(max);
const optionalText=max=>z.string().trim().max(max).default("");
const manage=requirePermissions("industry.manage");

router.use(authenticate);

router.get("/overview",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const [profiles,modules,assetCategories,workTypes,skills,positionRequirements,userSkills,templates]=await Promise.all([
    getPool().query(`SELECT p.template_code,p.primary_profile,p.applied_at,t.name,t.description FROM organization_industry_profiles p JOIN industry_templates t ON t.code=p.template_code WHERE p.organization_id=$1 ORDER BY p.primary_profile DESC,t.name`,[org]),
    getPool().query(`SELECT m.module_code,c.name,c.description,COALESCE(om.enabled,c.core) AS enabled,m.enabled_by_default FROM organization_industry_profiles p JOIN industry_template_modules m ON m.template_code=p.template_code JOIN module_catalog c ON c.code=m.module_code LEFT JOIN organization_modules om ON om.organization_id=p.organization_id AND om.module_code=m.module_code WHERE p.organization_id=$1 AND m.recommended ORDER BY m.enabled_by_default DESC,c.category,c.name`,[org]),
    getPool().query(`SELECT * FROM organization_asset_categories WHERE organization_id=$1 AND active ORDER BY name`,[org]),
    getPool().query(`SELECT * FROM organization_work_types WHERE organization_id=$1 AND active ORDER BY category,name`,[org]),
    getPool().query(`SELECT * FROM organization_skills WHERE organization_id=$1 AND active ORDER BY name`,[org]),
    getPool().query(`SELECT r.*,p.title AS position_title,s.name AS skill_name FROM position_skill_requirements r JOIN positions p ON p.organization_id=r.organization_id AND p.id=r.position_id JOIN organization_skills s ON s.organization_id=r.organization_id AND s.id=r.skill_id WHERE r.organization_id=$1 ORDER BY p.rank_level,p.title,s.name`,[org]),
    getPool().query(`SELECT us.*,u.full_name,s.name AS skill_name FROM user_skills us JOIN users u ON u.organization_id=us.organization_id AND u.id=us.user_id JOIN organization_skills s ON s.organization_id=us.organization_id AND s.id=us.skill_id WHERE us.organization_id=$1 ORDER BY u.full_name,s.name`,[org]),
    getPool().query(`SELECT code,name,description FROM industry_templates WHERE active ORDER BY name`)
  ]);
  res.json({profiles:profiles.rows,recommendedModules:modules.rows,assetCategories:assetCategories.rows,workTypes:workTypes.rows,skills:skills.rows,positionRequirements:positionRequirements.rows,userSkills:userSkills.rows,templates:templates.rows,canManage:(req.user.permissions||[]).includes("industry.manage")});
}));

router.post("/asset-categories",manage,asyncHandler(async(req,res)=>{const parsed=z.object({code,name:text(200),description:optionalText(1000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Хөрөнгийн ангиллын мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO organization_asset_categories(organization_id,code,name,description) VALUES($1,$2,$3,$4) RETURNING *`,[req.user.organization_id,v.code,v.name,v.description]);await writeAudit(req,"industry.asset_category_create","asset_category",result.rows[0].id,v);res.status(201).json({item:result.rows[0]})}));

router.post("/work-types",manage,asyncHandler(async(req,res)=>{const parsed=z.object({code,name:text(200),category:text(150),description:optionalText(2000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Ажлын төрлийн мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO organization_work_types(organization_id,code,name,category,description) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.user.organization_id,v.code,v.name,v.category,v.description]);await writeAudit(req,"industry.work_type_create","work_type",result.rows[0].id,v);res.status(201).json({item:result.rows[0]})}));

router.post("/skills",manage,asyncHandler(async(req,res)=>{const parsed=z.object({code,name:text(200),description:optionalText(2000),certificationRequired:z.boolean().default(false)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Ур чадварын мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO organization_skills(organization_id,code,name,description,certification_required) VALUES($1,$2,$3,$4,$5) RETURNING *`,[req.user.organization_id,v.code,v.name,v.description,v.certificationRequired]);await writeAudit(req,"industry.skill_create","skill",result.rows[0].id,v);res.status(201).json({item:result.rows[0]})}));

router.put("/positions/:positionId/skills/:skillId",manage,asyncHandler(async(req,res)=>{const positionId=uuid.safeParse(req.params.positionId),skillId=uuid.safeParse(req.params.skillId),parsed=z.object({requiredLevel:z.coerce.number().int().min(1).max(5),mandatory:z.boolean().default(true)}).safeParse(req.body);if(!positionId.success||!skillId.success||!parsed.success)return res.status(400).json({error:"Албан тушаалын чадварын шаардлага буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO position_skill_requirements(organization_id,position_id,skill_id,required_level,mandatory) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,position_id,skill_id) DO UPDATE SET required_level=EXCLUDED.required_level,mandatory=EXCLUDED.mandatory RETURNING *`,[req.user.organization_id,positionId.data,skillId.data,v.requiredLevel,v.mandatory]);await writeAudit(req,"industry.position_skill","position",positionId.data,{skillId:skillId.data,...v});res.json({item:result.rows[0]})}));

router.put("/users/:userId/skills/:skillId",manage,asyncHandler(async(req,res)=>{const userId=uuid.safeParse(req.params.userId),skillId=uuid.safeParse(req.params.skillId),parsed=z.object({proficiencyLevel:z.coerce.number().int().min(1).max(5),certificateNo:optionalText(150),issuedAt:z.union([z.iso.date(),z.literal(""),z.null()]).optional(),expiresAt:z.union([z.iso.date(),z.literal(""),z.null()]).optional()}).safeParse(req.body);if(!userId.success||!skillId.success||!parsed.success)return res.status(400).json({error:"Ажилтны ур чадварын мэдээлэл буруу байна"});const v=parsed.data,result=await getPool().query(`INSERT INTO user_skills(organization_id,user_id,skill_id,proficiency_level,certificate_no,issued_at,expires_at,verified_by,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(organization_id,user_id,skill_id) DO UPDATE SET proficiency_level=EXCLUDED.proficiency_level,certificate_no=EXCLUDED.certificate_no,issued_at=EXCLUDED.issued_at,expires_at=EXCLUDED.expires_at,verified_by=EXCLUDED.verified_by,verified_at=now() RETURNING *`,[req.user.organization_id,userId.data,skillId.data,v.proficiencyLevel,v.certificateNo,v.issuedAt||null,v.expiresAt||null,req.user.id]);await writeAudit(req,"industry.user_skill","user",userId.data,{skillId:skillId.data,proficiencyLevel:v.proficiencyLevel});res.json({item:result.rows[0]})}));

module.exports=router;
