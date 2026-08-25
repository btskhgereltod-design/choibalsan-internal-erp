"use strict";

const express=require("express");
const {z}=require("zod");
const {getPool}=require("../db");
const {authenticate,requireRoles,requireModule}=require("../middleware/auth");
const {writeAudit}=require("../services/audit");
const {asyncHandler}=require("../utils/async-handler");

const router=express.Router();
const uuid=z.string().uuid();
const coordinateSchema=z.object({latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180)});
const editors=requireRoles("director","chief_engineer","engineer","electric","camera_engineer","storekeeper");
const managers=requireRoles("director","chief_engineer");
router.use(authenticate,requireModule("map"));

router.get("/",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  await getPool().query(`INSERT INTO map_layers(organization_id,code,name,color,icon) VALUES($1,'general','Ерөнхий тэмдэглэгээ','#7c3aed','point') ON CONFLICT(organization_id,code) DO NOTHING`,[org]);
  const [settings,layers,assets,workOrders,features,vehicles,iotDevices]=await Promise.all([
    getPool().query(`SELECT map_center_lat,map_center_lng,map_default_zoom FROM organization_settings WHERE organization_id=$1`,[org]),
    getPool().query(`SELECT id,code,name,color,icon,visible_default FROM map_layers WHERE organization_id=$1 AND active=true ORDER BY name`,[org]),
    getPool().query(`SELECT id,code,name,category,status,location,latitude,longitude FROM assets WHERE organization_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY name`,[org]),
    getPool().query(`SELECT w.id,w.title,w.status,w.priority,w.due_at,w.asset_id,a.code AS asset_code,a.name AS asset_name,COALESCE(w.latitude,a.latitude) AS latitude,COALESCE(w.longitude,a.longitude) AS longitude FROM work_orders w LEFT JOIN assets a ON a.organization_id=w.organization_id AND a.id=w.asset_id WHERE w.organization_id=$1 AND COALESCE(w.latitude,a.latitude) IS NOT NULL AND COALESCE(w.longitude,a.longitude) IS NOT NULL AND w.status NOT IN('completed','cancelled') ORDER BY w.created_at DESC`,[org]),
    getPool().query(`SELECT f.id,f.layer_id,f.name,f.description,f.latitude,f.longitude,f.status,f.metadata,f.updated_at,l.name AS layer_name,l.color,l.icon FROM map_features f JOIN map_layers l ON l.organization_id=f.organization_id AND l.id=f.layer_id WHERE f.organization_id=$1 AND l.active=true ORDER BY f.updated_at DESC`,[org]),
    getPool().query(`SELECT v.id,v.plate_number,v.make,v.model,v.status,v.driver_user_id,u.full_name AS driver_name,p.latitude,p.longitude,p.speed_kph,p.heading,p.ignition,p.fuel_level_pct,p.recorded_at,(p.recorded_at>now()-interval '5 minutes') AS online FROM fleet_vehicles v LEFT JOIN users u ON u.organization_id=v.organization_id AND u.id=v.driver_user_id LEFT JOIN LATERAL(SELECT latitude,longitude,speed_kph,heading,ignition,fuel_level_pct,recorded_at FROM gps_positions p WHERE p.organization_id=v.organization_id AND p.vehicle_id=v.id ORDER BY p.recorded_at DESC LIMIT 1)p ON true WHERE v.organization_id=$1 AND v.status<>'inactive' AND p.latitude IS NOT NULL ORDER BY v.plate_number`,[org]),
    getPool().query(`SELECT d.id,d.name,d.device_uid,d.device_type,d.latitude,d.longitude,d.last_seen_at,(d.last_seen_at>now()-interval '5 minutes') AS online,t.state,t.health,t.power_watt,t.temperature_c,t.recorded_at FROM iot_devices d LEFT JOIN LATERAL(SELECT state,health,power_watt,temperature_c,recorded_at FROM iot_telemetry t WHERE t.organization_id=d.organization_id AND t.device_id=d.id ORDER BY t.recorded_at DESC LIMIT 1)t ON true WHERE d.organization_id=$1 AND d.active=true AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL ORDER BY d.name`,[org])
  ]);
  res.json({settings:settings.rows[0]||{map_center_lat:46.8625,map_center_lng:103.8467,map_default_zoom:5},layers:layers.rows,assets:assets.rows,workOrders:workOrders.rows,features:features.rows,vehicles:vehicles.rows,iotDevices:iotDevices.rows});
}));

router.post("/layers",managers,asyncHandler(async(req,res)=>{
  const parsed=z.object({code:z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(60),name:z.string().trim().min(2).max(150),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),icon:z.enum(["point","light","camera","building","waste","iot"]).default("point")}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Layer-ийн мэдээлэл буруу байна"});const v=parsed.data;
  const result=await getPool().query(`INSERT INTO map_layers(organization_id,code,name,color,icon,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.organization_id,v.code,v.name,v.color,v.icon,req.user.id]);
  await writeAudit(req,"map.layer_create","map_layer",result.rows[0].id,{code:v.code,name:v.name});res.status(201).json({item:result.rows[0]});
}));

router.post("/features",editors,asyncHandler(async(req,res)=>{
  const parsed=z.object({layerId:uuid,name:z.string().trim().min(2).max(200),description:z.string().trim().max(2000).default(""),latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180),status:z.enum(["active","inactive","warning","fault"]).default("active"),metadata:z.record(z.string(),z.unknown()).default({})}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Газрын зургийн тэмдэглэгээ буруу байна"});const v=parsed.data;
  const result=await getPool().query(`INSERT INTO map_features(organization_id,layer_id,name,description,latitude,longitude,status,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,[req.user.organization_id,v.layerId,v.name,v.description,v.latitude,v.longitude,v.status,JSON.stringify(v.metadata),req.user.id]);
  await writeAudit(req,"map.feature_create","map_feature",result.rows[0].id,{layerId:v.layerId,name:v.name,latitude:v.latitude,longitude:v.longitude});res.status(201).json({item:result.rows[0]});
}));

router.patch("/features/:id",editors,asyncHandler(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),parsed=z.object({name:z.string().trim().min(2).max(200).optional(),description:z.string().trim().max(2000).optional(),latitude:z.coerce.number().min(-90).max(90).optional(),longitude:z.coerce.number().min(-180).max(180).optional(),status:z.enum(["active","inactive","warning","fault"]).optional()}).refine(v=>Object.keys(v).length>0).safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Тэмдэглэгээний өөрчлөлт буруу байна"});const v=parsed.data;
  const result=await getPool().query(`UPDATE map_features SET name=COALESCE($3,name),description=COALESCE($4,description),latitude=COALESCE($5,latitude),longitude=COALESCE($6,longitude),status=COALESCE($7,status),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[req.user.organization_id,id.data,v.name,v.description,v.latitude,v.longitude,v.status]);if(!result.rowCount)return res.status(404).json({error:"Тэмдэглэгээ олдсонгүй"});await writeAudit(req,"map.feature_update","map_feature",id.data,v);res.json({item:result.rows[0]});
}));

async function updateEntityLocation(req,res,table,entityType){const id=uuid.safeParse(req.params.id),parsed=coordinateSchema.safeParse(req.body);if(!id.success||!parsed.success)return res.status(400).json({error:"Координат буруу байна"});const v=parsed.data;const result=await getPool().query(`UPDATE ${table} SET latitude=$3,longitude=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id,latitude,longitude`,[req.user.organization_id,id.data,v.latitude,v.longitude]);if(!result.rowCount)return res.status(404).json({error:"Бүртгэл олдсонгүй"});await writeAudit(req,"map.location_update",entityType,id.data,v);res.json({item:result.rows[0]});}
router.patch("/assets/:id/location",editors,asyncHandler((req,res)=>updateEntityLocation(req,res,"assets","asset")));
router.patch("/work-orders/:id/location",editors,asyncHandler((req,res)=>updateEntityLocation(req,res,"work_orders","work_order")));

router.patch("/settings",requireRoles("director"),asyncHandler(async(req,res)=>{const parsed=z.object({latitude:z.coerce.number().min(-90).max(90),longitude:z.coerce.number().min(-180).max(180),zoom:z.coerce.number().int().min(3).max(19)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Map тохиргоо буруу байна"});const v=parsed.data;await getPool().query(`UPDATE organization_settings SET map_center_lat=$2,map_center_lng=$3,map_default_zoom=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1`,[req.user.organization_id,v.latitude,v.longitude,v.zoom,req.user.id]);await writeAudit(req,"map.settings","organization",req.user.organization_id,v);res.json({ok:true});}));

module.exports=router;
