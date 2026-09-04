"use strict";

const express=require("express");
const multer=require("multer");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {z}=require("zod");
const {getPool,withTenantTransaction}=require("../db");
const {authenticate,requireModule}=require("../middleware/auth");
const {writeAudit}=require("../services/audit");
const {payloadHash}=require("../services/workflow-coordination");
const {loadOperationalObjectActivity}=require("../services/operational-object-activity");
const {asyncHandler}=require("../utils/async-handler");
const router=express.Router();

async function runSequentially(tasks){
  const results=[];
  for(const task of tasks)results.push(await task());
  return results;
}

router.use(authenticate,requireModule("lighting-operations"));

const objectId=z.string().uuid();
const componentSchema=z.object({assetId:z.string().uuid(),componentRole:z.string().trim().min(1).max(100),
  quantity:z.coerce.number().positive().max(1_000_000_000),unit:z.string().trim().min(1).max(30),
  installedAt:z.iso.date().nullable().optional(),note:z.string().trim().max(1000).default("")});
const noteSchema=z.object({note:z.string().trim().min(1).max(5000)});
const objectUpdateSchema=z.object({
  name:z.string().trim().min(1).max(200),
  location:z.string().trim().max(500).default(""),
  linearLengthM:z.union([z.number().min(0).max(1_000_000_000),z.null()]),
  expectedVersion:z.coerce.number().int().positive()
});
const objectRetireSchema=z.object({
  reason:z.string().trim().min(3).max(2000),
  expectedVersion:z.coerce.number().int().positive()
});
const nullableUuid=z.union([z.string().uuid(),z.null()]);
const technicalProfileSchema=z.object({
  expectedObjectVersion:z.coerce.number().int().positive(),
  poleCount:z.coerce.number().int().min(0).max(1_000_000),
  linearLengthM:z.union([z.number().min(0).max(1_000_000_000),z.null()]),
  note:z.string().trim().max(2000).default(""),
  lampGroups:z.array(z.object({
    lampType:z.string().trim().max(80).default(""),
    wattageW:z.coerce.number().positive().max(100_000),
    headCount:z.coerce.number().int().positive().max(1_000_000)
  })).max(30),
  supplyPoints:z.array(z.object({
    name:z.string().trim().min(1).max(200),
    panelAssetId:nullableUuid.optional().default(null),
    panelReference:z.string().trim().max(200).default(""),
    meterAssetId:nullableUuid.optional().default(null),
    meterNumber:z.string().trim().max(200).default(""),
    latitude:z.union([z.number().min(-90).max(90),z.null()]),
    longitude:z.union([z.number().min(-180).max(180),z.null()]),
    locationNote:z.string().trim().max(500).default("")
  }).superRefine((value,ctx)=>{
    if((value.latitude===null)!==(value.longitude===null))ctx.addIssue({code:"custom",message:"Өргөрөг, уртрагыг хамтад нь оруулна"});
  })).max(50)
}).superRefine((value,ctx)=>{
  const keys=value.lampGroups.map(item=>`${item.lampType.toLowerCase()}:${item.wattageW}`);
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:"custom",path:["lampGroups"],message:"Ижил төрөл, чадлын толгойн мөр давхардаж болохгүй"});
});
const incidentBatchSchema=z.object({
  idempotencyKey:z.string().uuid(),
  rows:z.array(z.object({
    rowKey:z.string().uuid(),
    operationalObjectId:z.string().uuid().nullable().optional(),
    assetId:z.string().uuid().nullable().optional(),
    incidentType:z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
    affectedQuantity:z.coerce.number().int().min(1).max(1_000_000),
    reportedAt:z.iso.datetime(),
    note:z.string().trim().max(2000).default("")
  }).superRefine((row,ctx)=>{
    if(Boolean(row.operationalObjectId)===Boolean(row.assetId))ctx.addIssue({code:"custom",message:"Нэг мөр яг нэг объект эсвэл хөрөнгийг заана"});
  })).min(1).max(100)
});
const incidentCancelSchema=z.object({
  reason:z.string().trim().min(3).max(2000),
  expectedVersion:z.coerce.number().int().positive(),
  idempotencyKey:z.string().uuid()
});
const hasPermission=(req,permission)=>new Set(req.user.permissions||[]).has(permission)||new Set(req.user.system_roles||[]).has("owner");
const deny=(res,permission)=>res.status(403).json({error:"Insufficient permission",permission});
const documentUploadDirectory=path.resolve(process.env.DOCUMENT_UPLOAD_DIR||process.env.UPLOAD_DIR||"/app/uploads/documents");
fs.mkdirSync(documentUploadDirectory,{recursive:true});
const mediaUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:1,fields:0,parts:2},
  fileFilter:(_req,file,done)=>new Set(["image/jpeg","image/png","image/webp"]).has(file.mimetype)?done(null,true):done(new Error("UNSUPPORTED_IMAGE_TYPE"))});
function uploadObjectMedia(req,res,next){mediaUpload.single("file")(req,res,error=>{
  if(!error)return next();
  if(error.code==="LIMIT_FILE_SIZE")return res.status(413).json({error:"Зургийн хэмжээ 15 MB-аас их байна"});
  return res.status(400).json({error:error.message==="UNSUPPORTED_IMAGE_TYPE"?"Зөвхөн JPG, PNG, WEBP зураг оруулна":"Зураг upload хийхэд алдаа гарлаа"});
})}

const legacyLightingClassificationSql=`CASE
  WHEN o.source_table='sl_points' AND (
    COALESCE(NULLIF(o.metadata->>'legacyCode',''),NULLIF(source.source_snapshot->>'code','')) LIKE 'ГТ-%'
    OR COALESCE(o.metadata->>'notes','')='Гудамжны гэрэлтүүлэг'
    OR EXISTS(SELECT 1 FROM operational_incidents marker
      WHERE marker.organization_id=o.organization_id AND marker.operational_object_id=o.id
        AND marker.incident_type='Авто замын гэрэл')
  ) THEN 'road-lighting'
  WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN(
    'Гэр хороолол','Гэр хорооллын гэрэл','??? ????????'
  ) THEN 'ger-area-lighting'
  WHEN o.source_table='sl_ger_inventory' AND source.source_snapshot->>'category' IN(
    'Цамхаг','Цамхагийн гэрэл','??????'
  ) THEN 'tower-lighting'
END`;
const legacyInventoryTotalSql=`CASE
  WHEN source.source_snapshot->>'total_count' ~ '^[0-9]+$'
  THEN (source.source_snapshot->>'total_count')::int
END`;

router.post("/incidents/batch",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-incidents.report"))return deny(res,"operational-incidents.report");
  const parsed=incidentBatchSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Гэмтлийн багц буруу байна",issues:parsed.error.issues});
  const org=req.user.organization_id,value=parsed.data;
  if(new Set(value.rows.map(row=>row.rowKey)).size!==value.rows.length){
    return res.status(400).json({error:"Нэг багцад rowKey давхардаж болохгүй",code:"DUPLICATE_ROW_KEY"});
  }
  if(new Set(value.rows.map(row=>`${row.operationalObjectId||row.assetId}:${row.incidentType}`)).size!==value.rows.length){
    return res.status(400).json({error:"Нэг объектын ижил төрлийн гэмтлийг багцад давхардуулж болохгүй",code:"DUPLICATE_INCIDENT_TARGET"});
  }
  if(value.rows.some(row=>new Date(row.reportedAt).getTime()>Date.now()+5*60*1000)){
    return res.status(400).json({error:"Ирээдүйн огноогоор гэмтэл бүртгэхгүй",code:"FUTURE_REPORTED_AT"});
  }
  const commandHash=payloadHash(value);
  const outcome=await withTenantTransaction(org,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:lighting-incident-batch:${value.idempotencyKey}`]);
    const receipt=(await client.query(`SELECT actor_user_id,payload_sha256,result
      FROM operational_incident_command_receipts
      WHERE organization_id=$1 AND command_type='report_batch' AND idempotency_key=$2`,[org,value.idempotencyKey])).rows[0];
    if(receipt){
      if(receipt.actor_user_id!==req.user.id||String(receipt.payload_sha256).trim()!==commandHash){
        return {status:409,body:{error:"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"}};
      }
      return {status:200,body:{...receipt.result,replayed:true}};
    }
    const objectIds=[...new Set(value.rows.map(row=>row.operationalObjectId).filter(Boolean))];
    const assetIds=[...new Set(value.rows.map(row=>row.assetId).filter(Boolean))];
    const typeCodes=[...new Set(value.rows.map(row=>row.incidentType))];
    const objects=await client.query(`SELECT o.id,o.code,o.name,o.location,o.status,classified.code AS service_area_code,
        CASE WHEN spec.id IS NOT NULL THEN spec.pole_count
          WHEN classified.code='tower-lighting' THEN 1
          WHEN classified.code='ger-area-lighting' THEN ${legacyInventoryTotalSql}
          ELSE COALESCE(
            CASE WHEN source.source_snapshot->>'lamp_count' ~ '^[0-9]+$' THEN (source.source_snapshot->>'lamp_count')::int END,
            CASE WHEN o.metadata->>'poleCount' ~ '^[0-9]+$' THEN (o.metadata->>'poleCount')::int END,
            CASE WHEN o.metadata->>'lampCount' ~ '^[0-9]+$' THEN (o.metadata->>'lampCount')::int END) END AS pole_capacity,
        (spec.id IS NOT NULL OR classified.code='tower-lighting'
          OR (classified.code='ger-area-lighting' AND ${legacyInventoryTotalSql} IS NOT NULL)
          OR source.source_snapshot->>'lamp_count' ~ '^[0-9]+$'
          OR o.metadata->>'poleCount' ~ '^[0-9]+$' OR o.metadata->>'lampCount' ~ '^[0-9]+$') AS pole_capacity_known,
        CASE WHEN spec.id IS NOT NULL THEN COALESCE(lamps.total_heads,0)
          WHEN classified.code IN('ger-area-lighting','tower-lighting') THEN ${legacyInventoryTotalSql}
          ELSE COALESCE(
            CASE WHEN source.source_snapshot->>'total_heads' ~ '^[0-9]+$' THEN (source.source_snapshot->>'total_heads')::int END,
            CASE WHEN o.metadata->>'totalHeadCount' ~ '^[0-9]+$' THEN (o.metadata->>'totalHeadCount')::int END,
            CASE WHEN o.metadata->>'headCount' ~ '^[0-9]+$' THEN (o.metadata->>'headCount')::int END) END AS head_capacity,
        (spec.id IS NOT NULL
          OR (classified.code IN('ger-area-lighting','tower-lighting') AND ${legacyInventoryTotalSql} IS NOT NULL)
          OR source.source_snapshot->>'total_heads' ~ '^[0-9]+$'
          OR o.metadata->>'totalHeadCount' ~ '^[0-9]+$' OR o.metadata->>'headCount' ~ '^[0-9]+$') AS head_capacity_known
        FROM operational_objects o
        LEFT JOIN source_import_records source
          ON source.organization_id=o.organization_id AND source.source_system=o.source_system
          AND source.source_table=o.source_table AND source.source_id=o.source_id
        LEFT JOIN operational_object_specifications spec
          ON spec.organization_id=o.organization_id AND spec.id=o.current_specification_id
        LEFT JOIN LATERAL(SELECT sum(group_row.head_count)::int total_heads
          FROM operational_object_lamp_groups group_row
          WHERE group_row.organization_id=o.organization_id AND group_row.specification_id=spec.id) lamps ON true
        LEFT JOIN LATERAL(SELECT ${legacyLightingClassificationSql} AS code) classified ON true
        WHERE o.organization_id=$1 AND o.domain='lighting' AND o.id=ANY($2::uuid[])`,[org,objectIds]);
    const assets=await client.query(`SELECT a.id,a.code,a.name,a.location,a.status,a.allocatable_quantity,
        a.allocation_unit,'traffic-signal'::text AS service_area_code
      FROM assets a
      WHERE a.organization_id=$1 AND a.id=ANY($2::uuid[]) AND a.category='Гэрлэн дохио'
        AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'`,[org,assetIds]);
    const types=await client.query(`SELECT code,name,quantity_unit FROM organization_operational_incident_types
      WHERE organization_id=$1 AND domain='lighting' AND active=true AND code=ANY($2::text[])`,[org,typeCodes]);
    if(objects.rowCount!==objectIds.length)return {status:409,body:{error:"Сонгосон объект олдсонгүй эсвэл гэрэлтүүлгийн объект биш",code:"INVALID_LIGHTING_OBJECT"}};
    if(assets.rowCount!==assetIds.length)return {status:409,body:{error:"Сонгосон хөрөнгө олдсонгүй эсвэл гэрлэн дохио биш",code:"INVALID_TRAFFIC_SIGNAL_ASSET"}};
    if(objects.rows.some(object=>object.status==='retired'))return {status:409,body:{error:"Ашиглалтаас гарсан объект дээр шинэ гэмтэл бүртгэхгүй",code:"RETIRED_LIGHTING_OBJECT"}};
    if(assets.rows.some(asset=>asset.status==='retired'))return {status:409,body:{error:"Ашиглалтаас гарсан гэрлэн дохион дээр шинэ гэмтэл бүртгэхгүй",code:"RETIRED_TRAFFIC_SIGNAL_ASSET"}};
    if(types.rowCount!==typeCodes.length)return {status:409,body:{error:"Идэвхтэй reference төрөл олдсонгүй",code:"INVALID_INCIDENT_TYPE"}};
    const objectsById=new Map(objects.rows.map(object=>[object.id,object]));
    const assetsById=new Map(assets.rows.map(asset=>[asset.id,asset]));
    const typesByCode=new Map(types.rows.map(type=>[type.code,type]));
    const existingOpen=await client.query(`SELECT i.operational_object_id,i.asset_id,
        COALESCE(NULLIF(i.detail->>'quantityUnit',''),type.quantity_unit,'толгой') quantity_unit,
        sum(GREATEST(0,i.affected_quantity-i.resolved_quantity))::bigint open_quantity
      FROM operational_incidents i
      LEFT JOIN organization_operational_incident_types type
        ON type.organization_id=i.organization_id AND type.domain=i.domain AND type.code=i.incident_type
      WHERE i.organization_id=$1 AND i.domain='lighting'
        AND (i.operational_object_id=ANY($2::uuid[]) OR i.asset_id=ANY($3::uuid[]))
        AND i.status IN('open','in_progress')
      GROUP BY i.operational_object_id,i.asset_id,COALESCE(NULLIF(i.detail->>'quantityUnit',''),type.quantity_unit,'толгой')`,[org,objectIds,assetIds]);
    const reservedByObjectUnit=new Map(existingOpen.rows.map(item=>[
      `${item.operational_object_id||item.asset_id}:${item.quantity_unit}`,Number(item.open_quantity)
    ]));
    for(const row of value.rows){
      const target=objectsById.get(row.operationalObjectId)||assetsById.get(row.assetId),type=typesByCode.get(row.incidentType),unit=type.quantity_unit;
      const fixedAsset=Boolean(row.assetId);
      const capacity=fixedAsset&&target.allocation_unit===unit?Number(target.allocatable_quantity):unit==='толгой'?Number(target.head_capacity):unit==='шон'?Number(target.pole_capacity):null;
      const capacityKnown=fixedAsset?target.allocation_unit===unit&&target.allocatable_quantity!==null:unit==='толгой'?target.head_capacity_known:unit==='шон'?target.pole_capacity_known:false;
      const key=`${target.id}:${unit}`,openQuantity=reservedByObjectUnit.get(key)||0;
      if(capacityKnown&&openQuantity+row.affectedQuantity>capacity){
        return {status:409,body:{error:"Гэмтлийн тоо объектын бүртгэлтэй нийт хэмжээнээс хэтэрлээ",
          code:"INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY",operationalObjectId:row.operationalObjectId||null,assetId:row.assetId||null,quantityUnit:unit,
          referenceQuantity:capacity,openQuantity,requestedQuantity:row.affectedQuantity}};
      }
      reservedByObjectUnit.set(key,openQuantity+row.affectedQuantity);
    }
    const areaCodes=[...new Set([...objects.rows,...assets.rows].map(object=>object.service_area_code).filter(Boolean))];
    const areas=areaCodes.length?await client.query(`SELECT id,code FROM organization_work_service_areas
      WHERE organization_id=$1 AND domain='lighting' AND active=true AND code=ANY($2::text[])`,[org,areaCodes]):{rows:[]};
    const areasByCode=new Map(areas.rows.map(area=>[area.code,area.id]));
    const items=[];
    for(const row of value.rows){
      const object=objectsById.get(row.operationalObjectId)||assetsById.get(row.assetId),type=typesByCode.get(row.incidentType);
      const detail={captureSurface:"lighting_fault_sheet",rowKey:row.rowKey,quantityUnit:type.quantity_unit,
        referencePrecision:row.assetId?"fixed_asset":"aggregate_object",reportedNote:row.note};
      const inserted=await client.query(`INSERT INTO operational_incidents(
        organization_id,domain,operational_object_id,asset_id,service_area_id,incident_type,title,location,
        affected_quantity,resolved_quantity,status,reported_at,reported_by,detail,version)
        VALUES($1,'lighting',$2,$3,$4,$5,$6,$7,$8,0,'open',$9,$10,$11::jsonb,1)
        RETURNING id,operational_object_id,asset_id,incident_type,title,affected_quantity,resolved_quantity,status,reported_at,version`,
      [org,row.operationalObjectId||null,row.assetId||null,areasByCode.get(object.service_area_code)||null,type.code,`${type.name} — ${object.name}`,
        object.location||"",row.affectedQuantity,row.reportedAt,req.user.id,JSON.stringify(detail)]);
      const incident=inserted.rows[0];
      await client.query(`INSERT INTO operational_incident_events(
        organization_id,incident_id,actor_user_id,event_type,quantity,note,detail,incident_version,request_id)
        VALUES($1,$2,$3,'reported',$4,$5,$6::jsonb,1,$7)`,[org,incident.id,req.user.id,row.affectedQuantity,row.note,
        JSON.stringify({rowKey:row.rowKey,incidentType:type.code,quantityUnit:type.quantity_unit}),value.idempotencyKey]);
      await writeAudit(req,"operational_incident.report","operational_incident",incident.id,
        {operationalObjectId:row.operationalObjectId||null,assetId:row.assetId||null,incidentType:type.code,affectedQuantity:row.affectedQuantity,
          quantityUnit:type.quantity_unit,idempotencyKey:value.idempotencyKey,rowKey:row.rowKey},client);
      items.push({...incident,rowKey:row.rowKey,quantityUnit:type.quantity_unit});
    }
    const result={items,idempotencyKey:value.idempotencyKey};
    await client.query(`INSERT INTO operational_incident_command_receipts(
      organization_id,command_type,idempotency_key,payload_sha256,actor_user_id,result)
      VALUES($1,'report_batch',$2,$3,$4,$5::jsonb)`,[org,value.idempotencyKey,commandHash,req.user.id,JSON.stringify(result)]);
    return {status:201,body:{...result,replayed:false}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/incidents/:id/cancel",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-incidents.cancel"))return deny(res,"operational-incidents.cancel");
  const incidentId=objectId.safeParse(req.params.id),parsed=incidentCancelSchema.safeParse(req.body);
  if(!incidentId.success||!parsed.success)return res.status(400).json({error:"Цуцлах хүсэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,value=parsed.data,commandType=`cancel_lighting_incident:${incidentId.data}`;
  const commandHash=payloadHash(value);
  const outcome=await withTenantTransaction(org,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:${commandType}`]);
    const receipt=(await client.query(`SELECT actor_user_id,payload_sha256,result
      FROM operational_incident_command_receipts
      WHERE organization_id=$1 AND command_type=$2 AND idempotency_key=$3`,[org,commandType,value.idempotencyKey])).rows[0];
    if(receipt){
      if(receipt.actor_user_id!==req.user.id||String(receipt.payload_sha256).trim()!==commandHash){
        return {status:409,body:{error:"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"}};
      }
      return {status:200,body:{...receipt.result,replayed:true}};
    }
    const incident=(await client.query(`SELECT id,status,version,affected_quantity,resolved_quantity,title
      FROM operational_incidents WHERE organization_id=$1 AND id=$2 AND domain='lighting' FOR UPDATE`,[org,incidentId.data])).rows[0];
    if(!incident)return {status:404,body:{error:"Гэмтлийн бүртгэл олдсонгүй"}};
    if(!['open','in_progress'].includes(incident.status))return {status:409,body:{error:"Зөвхөн нээлттэй гэмтлийн бүртгэлийг хүчингүй болгож болно",code:"INCIDENT_NOT_CANCELLABLE"}};
    if(Number(incident.version)!==value.expectedVersion)return {status:409,body:{error:"Гэмтлийн бүртгэл өөрчлөгдсөн байна. Дахин ачаалж шалгана уу",code:"INCIDENT_VERSION_CONFLICT",currentVersion:Number(incident.version)}};
    const linked=await client.query(`SELECT work.id,work.title,work.status
      FROM operational_incident_work_orders link
      JOIN work_orders work ON work.organization_id=link.organization_id AND work.id=link.work_order_id
      WHERE link.organization_id=$1 AND link.incident_id=$2 LIMIT 1`,[org,incident.id]);
    if(linked.rowCount)return {status:409,body:{error:"Энэ гэмтэл ажилтай холбогдсон тул эндээс хүчингүй болгохгүй. Холбогдсон ажлын түүхээс шалгана уу",code:"INCIDENT_HAS_LINKED_WORK",workOrder:linked.rows[0]}};
    const updated=(await client.query(`UPDATE operational_incidents SET status='cancelled',version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING id,status,version,updated_at`,[org,incident.id])).rows[0];
    const unresolved=Math.max(0,Number(incident.affected_quantity)-Number(incident.resolved_quantity));
    await client.query(`INSERT INTO operational_incident_events(
      organization_id,incident_id,actor_user_id,event_type,quantity,note,detail,incident_version,request_id)
      VALUES($1,$2,$3,'cancelled',$4,$5,$6::jsonb,$7,$8)`,[org,incident.id,req.user.id,unresolved,value.reason,
      JSON.stringify({previousStatus:incident.status,reason:value.reason}),updated.version,value.idempotencyKey]);
    await writeAudit(req,"operational_incident.cancel","operational_incident",incident.id,
      {previousStatus:incident.status,reason:value.reason,previousVersion:Number(incident.version),version:Number(updated.version),idempotencyKey:value.idempotencyKey},client);
    const result={item:updated};
    await client.query(`INSERT INTO operational_incident_command_receipts(
      organization_id,command_type,idempotency_key,payload_sha256,actor_user_id,result)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[org,commandType,value.idempotencyKey,commandHash,req.user.id,JSON.stringify(result)]);
    return {status:200,body:{...result,replayed:false}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.get("/objects/:id/dossier",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.read"))return deny(res,"operational-objects.read");
  const id=objectId.safeParse(req.params.id);if(!id.success)return res.status(400).json({error:"Invalid operational object"});
  const org=req.user.organization_id;
  const payload=await withTenantTransaction(org,async client=>{
  const object=await client.query(`SELECT o.*,
    COALESCE(NULLIF(o.metadata->>'legacyCode',''),o.code) AS display_code,
    parent.name parent_name,spec.version_no specification_version,spec.pole_count specification_pole_count,
    CASE WHEN classified.code='tower-lighting' THEN '1'
      WHEN classified.code='ger-area-lighting' THEN source.source_snapshot->>'total_count'
      ELSE COALESCE(source.source_snapshot->>'lamp_count',o.metadata->>'poleCount',o.metadata->>'lampCount') END legacy_pole_count,
    CASE WHEN classified.code IN('ger-area-lighting','tower-lighting') THEN source.source_snapshot->>'total_count'
      ELSE COALESCE(source.source_snapshot->>'total_heads',o.metadata->>'totalHeadCount',o.metadata->>'headCount') END legacy_total_head_count,
    CASE WHEN classified.code='tower-lighting' THEN source.source_snapshot->>'total_count'
      WHEN classified.code='ger-area-lighting' AND ${legacyInventoryTotalSql} IS NOT NULL THEN '1'
      ELSE COALESCE(source.source_snapshot->>'head_count',o.metadata->>'headCountPerPole') END legacy_head_count_per_pole,
    COALESCE(NULLIF(o.metadata->>'lightType',''),source.source_snapshot->>'light_type') legacy_light_type
    FROM operational_objects o LEFT JOIN operational_objects parent
      ON parent.organization_id=o.organization_id AND parent.id=o.parent_object_id
    LEFT JOIN operational_object_specifications spec
      ON spec.organization_id=o.organization_id AND spec.id=o.current_specification_id
    LEFT JOIN source_import_records source ON source.organization_id=o.organization_id
      AND source.source_system=o.source_system AND source.source_table=o.source_table AND source.source_id=o.source_id
    LEFT JOIN LATERAL(SELECT ${legacyLightingClassificationSql} AS code) classified ON true
    WHERE o.organization_id=$1 AND o.id=$2 AND o.domain='lighting'`,[org,id.data]);
  if(!object.rowCount)return null;
  const [components,events,children,assetOptions,lampGroups,supplyPoints,media]=await runSequentially([
    ()=>client.query(`SELECT c.*,a.code asset_code,a.name asset_name,a.category asset_category,a.status asset_status,
      u.full_name assigned_by_name FROM operational_object_components c
      JOIN assets a ON a.organization_id=c.organization_id AND a.id=c.asset_id
      LEFT JOIN LATERAL(SELECT actor_user_id FROM operational_object_events e
        WHERE e.organization_id=c.organization_id AND e.operational_object_id=c.operational_object_id
          AND e.event_type='component_assigned' AND e.detail->>'componentId'=c.id::text ORDER BY e.id LIMIT 1) source ON true
      LEFT JOIN users u ON u.organization_id=c.organization_id AND u.id=source.actor_user_id
      WHERE c.organization_id=$1 AND c.operational_object_id=$2
      ORDER BY c.removed_at NULLS FIRST,c.created_at DESC`,[org,id.data]),
    ()=>client.query(`SELECT e.*,u.full_name actor_name FROM operational_object_events e
      LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
      WHERE e.organization_id=$1 AND e.operational_object_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,[org,id.data]),
    ()=>client.query(`SELECT id,code,name,object_type,status FROM operational_objects
      WHERE organization_id=$1 AND parent_object_id=$2 ORDER BY name`,[org,id.data]),
    ()=>client.query(`SELECT a.id,a.code,a.name,a.category,a.status,a.location,a.allocatable_quantity,a.allocation_unit,
      COALESCE(allocated.quantity,0) allocated_quantity,a.allocatable_quantity-COALESCE(allocated.quantity,0) available_quantity
      FROM assets a LEFT JOIN LATERAL(SELECT sum(c.quantity) quantity FROM operational_object_components c
        WHERE c.organization_id=a.organization_id AND c.asset_id=a.id AND c.removed_at IS NULL) allocated ON true
      WHERE a.organization_id=$1 AND a.status<>'retired' AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'
      ORDER BY a.name LIMIT 1000`,[org]),
    ()=>client.query(`SELECT group_row.* FROM operational_object_lamp_groups group_row
      JOIN operational_objects object_row ON object_row.organization_id=group_row.organization_id
        AND object_row.current_specification_id=group_row.specification_id
      WHERE object_row.organization_id=$1 AND object_row.id=$2 ORDER BY group_row.wattage_w DESC,group_row.lamp_type`,[org,id.data]),
    ()=>client.query(`SELECT point.*,panel.code panel_asset_code,panel.name panel_asset_name,
      meter.code meter_asset_code,meter.name meter_asset_name
      FROM operational_object_supply_points point
      JOIN operational_objects object_row ON object_row.organization_id=point.organization_id
        AND object_row.current_specification_id=point.specification_id
      LEFT JOIN assets panel ON panel.organization_id=point.organization_id AND panel.id=point.panel_asset_id
      LEFT JOIN assets meter ON meter.organization_id=point.organization_id AND meter.id=point.meter_asset_id
      WHERE object_row.organization_id=$1 AND object_row.id=$2 ORDER BY point.sequence_no`,[org,id.data]),
    ()=>client.query(`SELECT document.id,document.title,document.document_type,document.status,link.relation_type,
      version.id version_id,version.original_name,version.mime_type,version.size_bytes,version.created_at
      FROM document_links link JOIN documents document
        ON document.organization_id=link.organization_id AND document.id=link.document_id
      LEFT JOIN document_versions version
        ON version.organization_id=document.organization_id AND version.id=document.current_version_id
      WHERE link.organization_id=$1 AND link.entity_type='operational_object' AND link.entity_id=$2::text
        AND link.relation_type IN('location_scheme','site_photo')
      ORDER BY link.recorded_at DESC`,[org,id.data]),
  ]);
  const activity=await loadOperationalObjectActivity(client,{organizationId:org,objectId:id.data,user:req.user});
  return {item:object.rows[0],components:components.rows,
    events:events.rows,children:children.rows,assetOptions:assetOptions.rows,
    lampGroups:lampGroups.rows,supplyPoints:supplyPoints.rows,media:media.rows,activity,capabilities:{
      canManageComponents:hasPermission(req,"operational-objects.components.manage"),
      canCreateNote:hasPermission(req,"operational-objects.notes.create"),
      canUpdate:hasPermission(req,"operational-objects.update"),
      canRetire:hasPermission(req,"operational-objects.retire"),
      canManageMedia:hasPermission(req,"operational-objects.media.manage")}};
  });
  if(!payload)return res.status(404).json({error:"Operational object not found"});
  res.json(payload);
}));

router.patch("/objects/:id",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.update"))return deny(res,"operational-objects.update");
  const id=objectId.safeParse(req.params.id),parsed=objectUpdateSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Объектын үндсэн мэдээлэл буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const current=(await client.query(`SELECT id,code,name,location,linear_length_m,status,version
      FROM operational_objects WHERE organization_id=$1 AND id=$2 AND domain='lighting' FOR UPDATE`,[org,id.data])).rows[0];
    if(!current)return {status:404,body:{error:"Operational object not found"}};
    if(current.status==='retired')return {status:409,body:{error:"Архивласан объектыг засах боломжгүй",code:"OBJECT_RETIRED"}};
    if(Number(current.version)!==v.expectedVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Мэдээллээ дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(current.version)}};
    const updated=(await client.query(`UPDATE operational_objects SET
      name=$3,location=$4,linear_length_m=$5,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data,v.name,v.location,v.linearLengthM])).rows[0];
    const before={name:current.name,location:current.location,linearLengthM:current.linear_length_m};
    const after={name:updated.name,location:updated.location,linearLengthM:updated.linear_length_m};
    await client.query(`INSERT INTO operational_object_events(
      organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'updated','Объектын үндсэн мэдээлэл шинэчлэв',$4::jsonb)`,
    [org,id.data,req.user.id,JSON.stringify({before,after,previousVersion:Number(current.version),version:Number(updated.version)})]);
    await writeAudit(req,"operational_object.update","operational_object",id.data,
      {before,after,previousVersion:Number(current.version),version:Number(updated.version)},client);
    return {status:200,body:{item:updated}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/objects/:id/specifications",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.update"))return deny(res,"operational-objects.update");
  const id=objectId.safeParse(req.params.id),parsed=technicalProfileSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Техникийн үзүүлэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const object=(await client.query(`SELECT id,status,version,current_specification_id FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='lighting' FOR UPDATE`,[org,id.data])).rows[0];
    if(!object)return {status:404,body:{error:"Operational object not found"}};
    if(object.status==='retired')return {status:409,body:{error:"Архивласан объектын үзүүлэлтийг засах боломжгүй",code:"OBJECT_RETIRED"}};
    if(Number(object.version)!==v.expectedObjectVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(object.version)}};
    const referencedAssets=[...new Set(v.supplyPoints.flatMap(point=>[point.panelAssetId,point.meterAssetId]).filter(Boolean))];
    if(referencedAssets.length){
      const linked=await client.query(`SELECT DISTINCT asset_id FROM operational_object_components
        WHERE organization_id=$1 AND operational_object_id=$2 AND removed_at IS NULL AND asset_id=ANY($3::uuid[])`,[org,id.data,referencedAssets]);
      if(linked.rowCount!==referencedAssets.length)return {status:409,body:{error:"Щит эсвэл тоолуурын хөрөнгийг эхлээд объектын бүрэлдэхүүнээр холбоно уу.",code:"SUPPLY_ASSET_NOT_ALLOCATED"}};
    }
    const versionNo=Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 value
      FROM operational_object_specifications WHERE organization_id=$1 AND operational_object_id=$2`,[org,id.data])).rows[0].value);
    const specification=(await client.query(`INSERT INTO operational_object_specifications(
      organization_id,operational_object_id,version_no,pole_count,note,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[org,id.data,versionNo,v.poleCount,v.note,req.user.id])).rows[0];
    const lamps=[];
    for(const group of v.lampGroups){
      lamps.push((await client.query(`INSERT INTO operational_object_lamp_groups(
        organization_id,specification_id,lamp_type,wattage_w,head_count)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[org,specification.id,group.lampType,group.wattageW,group.headCount])).rows[0]);
    }
    const points=[];
    for(const [index,point] of v.supplyPoints.entries()){
      points.push((await client.query(`INSERT INTO operational_object_supply_points(
        organization_id,specification_id,sequence_no,name,panel_asset_id,panel_reference,
        meter_asset_id,meter_number,latitude,longitude,location_note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[org,specification.id,index+1,point.name,
        point.panelAssetId,point.panelReference,point.meterAssetId,point.meterNumber,point.latitude,point.longitude,point.locationNote])).rows[0]);
    }
    const updated=(await client.query(`UPDATE operational_objects SET current_specification_id=$3,
      linear_length_m=$4,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [org,id.data,specification.id,v.linearLengthM])).rows[0];
    const totalHeads=lamps.reduce((sum,item)=>sum+Number(item.head_count),0);
    const detail={specificationId:specification.id,specificationVersion:versionNo,previousSpecificationId:object.current_specification_id,
      poleCount:v.poleCount,totalHeads,lampGroupCount:lamps.length,supplyPointCount:points.length,
      previousObjectVersion:Number(object.version),objectVersion:Number(updated.version)};
    await client.query(`INSERT INTO operational_object_events(
      organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'specification_changed',$4,$5::jsonb)`,[org,id.data,req.user.id,v.note,JSON.stringify(detail)]);
    await writeAudit(req,"operational_object.specification.create","operational_object",id.data,detail,client);
    return {status:201,body:{item:updated,specification,lampGroups:lamps,supplyPoints:points}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/objects/:id/media/:role",uploadObjectMedia,asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.media.manage")){
    if(req.file)delete req.file.buffer;
    return deny(res,"operational-objects.media.manage");
  }
  const id=objectId.safeParse(req.params.id),role=z.enum(["location_scheme","site_photo"]).safeParse(req.params.role);
  if(!id.success||!role.success||!req.file)return res.status(400).json({error:"Зураг эсвэл төрөл буруу байна"});
  const org=req.user.organization_id,storageKey=crypto.randomUUID(),filePath=path.join(documentUploadDirectory,storageKey);
  const hash=crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  await fs.promises.writeFile(filePath,req.file.buffer,{flag:"wx"});
  try{
    const outcome=await withTenantTransaction(org,async client=>{
      const object=(await client.query(`SELECT id,code,name,status FROM operational_objects
        WHERE organization_id=$1 AND id=$2 AND domain='lighting' FOR UPDATE`,[org,id.data])).rows[0];
      if(!object)return {status:404,body:{error:"Operational object not found"}};
      if(object.status==='retired')return {status:409,body:{error:"Архивласан объектод зураг нэмэх боломжгүй",code:"OBJECT_RETIRED"}};
      const documentId=crypto.randomUUID(),versionId=crypto.randomUUID(),label=role.data==="location_scheme"?"Байршлын схем":"Ерөнхий фото";
      const documentNo=`OBJ-${role.data==='location_scheme'?'SCHEME':'PHOTO'}-${crypto.randomUUID()}`;
      const title=`${label} — ${object.name}`;
      const document=(await client.query(`INSERT INTO documents(
        id,organization_id,document_no,title,document_type,status,classification_code,retention_class,
        linked_entity_type,linked_entity_id,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,'active','internal','operational_object_life','operational_object',$6,$7,$7) RETURNING *`,
      [documentId,org,documentNo,title,`operational_object_${role.data}`,id.data,req.user.id])).rows[0];
      const version=(await client.query(`INSERT INTO document_versions(
        id,organization_id,document_id,version_no,original_name,storage_key,mime_type,size_bytes,content_sha256,created_by)
        VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9) RETURNING id,version_no,original_name,mime_type,size_bytes,content_sha256,created_at`,
      [versionId,org,documentId,path.basename(req.file.originalname).slice(0,255),storageKey,req.file.mimetype,req.file.size,hash,req.user.id])).rows[0];
      await client.query(`UPDATE documents SET current_version_id=$3 WHERE organization_id=$1 AND id=$2`,[org,documentId,versionId]);
      await client.query(`INSERT INTO document_links(
        organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by)
        VALUES($1,$2,'operational_object',$3,$4,'domain',$5)`,[org,documentId,id.data,role.data,req.user.id]);
      await client.query(`INSERT INTO document_lifecycle_events(
        organization_id,document_id,version_id,action,to_status,actor_user_id,evidence)
        VALUES($1,$2,$3,'created','active',$4,$5::jsonb)`,[org,documentId,versionId,req.user.id,JSON.stringify({role:role.data,sha256:hash,size:req.file.size})]);
      await client.query(`INSERT INTO operational_object_events(
        organization_id,operational_object_id,actor_user_id,event_type,note,detail)
        VALUES($1,$2,$3,'media_added',$4,$5::jsonb)`,[org,id.data,req.user.id,label,JSON.stringify({documentId,versionId,role:role.data,sha256:hash})]);
      await writeAudit(req,"operational_object.media.add","operational_object",id.data,
        {documentId,versionId,role:role.data,mimeType:req.file.mimetype,size:req.file.size,sha256:hash},client);
      return {status:201,body:{item:{...document,version_id:version.id,original_name:version.original_name,mime_type:version.mime_type,size_bytes:version.size_bytes}}};
    });
    if(outcome.status>=400)await fs.promises.unlink(filePath).catch(()=>{});
    res.status(outcome.status).json(outcome.body);
  }catch(error){await fs.promises.unlink(filePath).catch(()=>{});throw error}
}));

router.get("/objects/:id/media/:documentId/file",asyncHandler(async(req,res,next)=>{
  if(!hasPermission(req,"operational-objects.read"))return deny(res,"operational-objects.read");
  const id=objectId.safeParse(req.params.id),documentId=objectId.safeParse(req.params.documentId);
  if(!id.success||!documentId.success)return res.status(400).json({error:"Invalid object media"});
  const result=await withTenantTransaction(req.user.organization_id,client=>client.query(`SELECT version.original_name,version.storage_key,version.mime_type
    FROM document_links link JOIN documents document
      ON document.organization_id=link.organization_id AND document.id=link.document_id
    JOIN document_versions version
      ON version.organization_id=document.organization_id AND version.id=document.current_version_id
    WHERE link.organization_id=$1 AND link.document_id=$2 AND link.entity_type='operational_object'
      AND link.entity_id=$3::text AND link.relation_type IN('location_scheme','site_photo')`,
  [req.user.organization_id,documentId.data,id.data]));
  if(!result.rowCount)return res.status(404).json({error:"Объектын зураг олдсонгүй"});
  const item=result.rows[0];res.type(item.mime_type);res.download(path.join(documentUploadDirectory,item.storage_key),item.original_name,{dotfiles:"deny"},error=>{if(error&&!res.headersSent)next(error)});
}));

router.post("/objects/:id/retire",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.retire"))return deny(res,"operational-objects.retire");
  const id=objectId.safeParse(req.params.id),parsed=objectRetireSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Архивлах хүсэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const current=(await client.query(`SELECT id,code,name,status,version FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='lighting' FOR UPDATE`,[org,id.data])).rows[0];
    if(!current)return {status:404,body:{error:"Operational object not found"}};
    if(current.status==='retired')return {status:409,body:{error:"Объект аль хэдийн архивлагдсан байна",code:"OBJECT_RETIRED"}};
    if(Number(current.version)!==v.expectedVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Мэдээллээ дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(current.version)}};
    const blockers=(await client.query(`SELECT
      (SELECT count(*)::int FROM operational_objects child
        WHERE child.organization_id=$1 AND child.parent_object_id=$2 AND child.status<>'retired') active_children,
      (SELECT count(*)::int FROM operational_object_components component
        WHERE component.organization_id=$1 AND component.operational_object_id=$2 AND component.removed_at IS NULL) active_components,
      (SELECT count(*)::int FROM operational_incidents incident
        WHERE incident.organization_id=$1 AND incident.operational_object_id=$2
          AND incident.status IN('open','in_progress') AND incident.affected_quantity>incident.resolved_quantity) active_incidents,
      (SELECT count(*)::int FROM work_orders work
        WHERE work.organization_id=$1 AND work.operational_object_id=$2
          AND work.status NOT IN('completed','cancelled')) active_work`,[org,id.data])).rows[0];
    if(Object.values(blockers).some(Number))return {status:409,body:{
      error:"Объектод идэвхтэй холбоос эсвэл ажиллагааны бүртгэл байна. Эхлээд тэдгээрийг дуусгана уу.",
      code:"OBJECT_RETIRE_BLOCKED",blockers}};
    const retired=(await client.query(`UPDATE operational_objects SET status='retired',version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data])).rows[0];
    await client.query(`INSERT INTO operational_object_events(
      organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'retired',$4,$5::jsonb)`,[org,id.data,req.user.id,v.reason,
      JSON.stringify({previousStatus:current.status,status:'retired',previousVersion:Number(current.version),version:Number(retired.version)})]);
    await writeAudit(req,"operational_object.retire","operational_object",id.data,
      {reason:v.reason,previousStatus:current.status,previousVersion:Number(current.version),version:Number(retired.version)},client);
    return {status:200,body:{item:retired}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/objects/:id/components",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.components.manage"))return deny(res,"operational-objects.components.manage");
  const id=objectId.safeParse(req.params.id),parsed=componentSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid component allocation",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data,client=await getPool().connect();
  try{await client.query("BEGIN");
    const object=(await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND domain='lighting' AND status<>'retired' FOR UPDATE",[org,id.data])).rows[0];
    const asset=(await client.query("SELECT id,code,name,status,allocatable_quantity,allocation_unit FROM assets WHERE organization_id=$1 AND id=$2 AND status<>'retired' FOR UPDATE",[org,v.assetId])).rows[0];
    if(!object||!asset){await client.query("ROLLBACK");return res.status(404).json({error:"Object or asset not found"});}
    const allocated=Number((await client.query(`SELECT COALESCE(sum(quantity),0) total FROM operational_object_components
      WHERE organization_id=$1 AND asset_id=$2 AND removed_at IS NULL`,[org,v.assetId])).rows[0].total);
    const available=Number(asset.allocatable_quantity)-allocated;
    if(v.unit!==asset.allocation_unit){await client.query("ROLLBACK");return res.status(409).json({error:`Энэ хөрөнгийг зөвхөн ${asset.allocation_unit} нэгжээр онооно`});}
    if(v.quantity>available){await client.query("ROLLBACK");return res.status(409).json({error:`Оноож болох үлдэгдэл ${available} ${asset.allocation_unit}`});}
    const inserted=await client.query(`INSERT INTO operational_object_components(
      organization_id,operational_object_id,asset_id,component_role,quantity,unit,installed_at,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,[org,id.data,v.assetId,v.componentRole,v.quantity,v.unit,
      v.installedAt||null,JSON.stringify({allocationNote:v.note})]);
    const component=inserted.rows[0];
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'component_assigned',$4,$5::jsonb)`,[org,id.data,req.user.id,v.note,JSON.stringify({
      componentId:component.id,assetId:asset.id,assetCode:asset.code,assetName:asset.name,
      componentRole:v.componentRole,quantity:v.quantity,unit:v.unit,installedAt:v.installedAt||null})]);
    await writeAudit(req,"operational_object.component.assign","operational_object",id.data,{componentId:component.id,assetId:asset.id,quantity:v.quantity,unit:v.unit},client);
    await client.query("COMMIT");res.status(201).json({item:component});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/objects/:id/components/:componentId/remove",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.components.manage"))return deny(res,"operational-objects.components.manage");
  const id=objectId.safeParse(req.params.id),componentId=objectId.safeParse(req.params.componentId),parsed=noteSchema.safeParse(req.body);
  if(!id.success||!componentId.success||!parsed.success)return res.status(400).json({error:"Invalid component removal"});
  const org=req.user.organization_id,client=await getPool().connect();
  try{await client.query("BEGIN");
    const removed=await client.query(`UPDATE operational_object_components SET removed_at=current_date
      WHERE organization_id=$1 AND operational_object_id=$2 AND id=$3 AND removed_at IS NULL RETURNING *`,[org,id.data,componentId.data]);
    if(!removed.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Active component not found"});}
    const component=removed.rows[0];
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'component_removed',$4,$5::jsonb)`,[org,id.data,req.user.id,parsed.data.note,JSON.stringify({
      componentId:component.id,assetId:component.asset_id,removedAt:component.removed_at})]);
    await writeAudit(req,"operational_object.component.remove","operational_object",id.data,{componentId:component.id,assetId:component.asset_id},client);
    await client.query("COMMIT");res.json({item:component});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.post("/objects/:id/notes",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.notes.create"))return deny(res,"operational-objects.notes.create");
  const id=objectId.safeParse(req.params.id),parsed=noteSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Invalid dossier note"});
  const client=await getPool().connect();try{await client.query("BEGIN");
    const exists=await client.query("SELECT id FROM operational_objects WHERE organization_id=$1 AND id=$2 AND domain='lighting'",[req.user.organization_id,id.data]);
    if(!exists.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Operational object not found"});}
    const event=await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note)
      VALUES($1,$2,$3,'note',$4) RETURNING *`,[req.user.organization_id,id.data,req.user.id,parsed.data.note]);
    await writeAudit(req,"operational_object.note.create","operational_object",id.data,{},client);await client.query("COMMIT");res.status(201).json({item:event.rows[0]});
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
}));

router.get("/workspace",asyncHandler(async(req,res)=>{
  const org=req.user.organization_id;
  const enabled=new Set(req.user.enabled_modules||[]);
  if(!enabled.has("assets")||!enabled.has("work-orders"))return res.status(403).json({error:"Гэрэлтүүлгийн ажлын талбарт хөрөнгө ба ажлын урсгал шаардлагатай"});
  const result=await withTenantTransaction(org,async client=>{
    const capability=await client.query(`SELECT EXISTS(
      SELECT 1 FROM organization_work_types WHERE organization_id=$1 AND active=true AND code IN ('lighting-inspection','lighting-repair','traffic-signal-repair')
      UNION ALL SELECT 1 FROM operational_objects WHERE organization_id=$1 AND domain='lighting'
    ) available`,[org]);
    const serviceAreas=await client.query(`SELECT id,domain,code,name,icon,sort_order
      FROM organization_work_service_areas
      WHERE organization_id=$1 AND domain='lighting' AND active=true
      ORDER BY sort_order,name`,[org]);
    const incidentTypes=await client.query(`SELECT code,name,quantity_unit,sort_order
      FROM organization_operational_incident_types
      WHERE organization_id=$1 AND domain='lighting' AND active=true
      ORDER BY sort_order,name`,[org]);
    const objects=await client.query(`SELECT o.id,o.code,o.name,o.object_type,o.domain,o.status,o.location,o.linear_length_m,o.metadata,o.updated_at,
      COALESCE(NULLIF(o.metadata->>'legacyCode',''),NULLIF(source.source_snapshot->>'code',''),o.code) AS display_code,
      CASE WHEN spec.id IS NOT NULL THEN spec.pole_count::text
        WHEN classified.code='tower-lighting' THEN '1'
        WHEN classified.code='ger-area-lighting' THEN source.source_snapshot->>'total_count'
        ELSE COALESCE(source.source_snapshot->>'lamp_count',o.metadata->>'poleCount',o.metadata->>'lampCount') END AS pole_count,
      CASE WHEN spec.id IS NOT NULL THEN COALESCE(lamps.total_heads,0)::text
        WHEN classified.code IN('ger-area-lighting','tower-lighting') THEN source.source_snapshot->>'total_count'
        ELSE COALESCE(source.source_snapshot->>'total_heads',o.metadata->>'totalHeadCount',o.metadata->>'headCount') END AS head_count,
      CASE WHEN spec.id IS NOT NULL THEN CASE WHEN spec.pole_count>0 THEN round(COALESCE(lamps.total_heads,0)::numeric/spec.pole_count,2)::text END
        WHEN classified.code='tower-lighting' THEN source.source_snapshot->>'total_count'
        WHEN classified.code='ger-area-lighting' AND ${legacyInventoryTotalSql} IS NOT NULL THEN '1'
        ELSE COALESCE(source.source_snapshot->>'head_count',o.metadata->>'headCountPerPole') END AS head_count_per_pole,
      COALESCE(source.source_snapshot->>'needs_poles',o.metadata->>'replacementPoleCount') AS replacement_pole_count,
      COALESCE(lamps.light_types,NULLIF(o.metadata->>'lightType',''),source.source_snapshot->>'light_type') AS light_type,
      CASE
        WHEN spec.id IS NOT NULL THEN 'canonical'
        WHEN o.source_table='sl_points' AND classified.code='road-lighting' THEN 'legacy_candidate'
        WHEN o.source_table='sl_points' THEN 'unclassified'
        WHEN o.source_system IS NULL THEN 'canonical'
        ELSE 'legacy_candidate'
      END AS classification_state,
      area.id AS service_area_id,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM operational_objects o
      LEFT JOIN source_import_records source
        ON source.organization_id=o.organization_id AND source.source_system=o.source_system
        AND source.source_table=o.source_table AND source.source_id=o.source_id
      LEFT JOIN operational_object_specifications spec
        ON spec.organization_id=o.organization_id AND spec.id=o.current_specification_id
      LEFT JOIN LATERAL(SELECT sum(group_row.head_count)::int total_heads,
        string_agg(concat_ws(' ',NULLIF(group_row.lamp_type,''),group_row.wattage_w||'W'),', ' ORDER BY group_row.wattage_w DESC) light_types
        FROM operational_object_lamp_groups group_row
        WHERE group_row.organization_id=o.organization_id AND group_row.specification_id=spec.id) lamps ON true
      LEFT JOIN LATERAL(SELECT ${legacyLightingClassificationSql} AS code) classified ON true
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=o.organization_id AND area.domain='lighting'
        AND area.code=classified.code AND area.active=true
      WHERE o.organization_id=$1 AND o.domain='lighting' AND o.status<>'retired'
        -- Legacy GD rows are compatibility copies of the canonical traffic-signal assets
        -- returned below. Keep them for provenance, but never double-list or count them.
        AND NOT (o.source_table='sl_points' AND (
          COALESCE(NULLIF(o.metadata->>'legacyCode',''),NULLIF(source.source_snapshot->>'code',''),'') LIKE chr(1043)||chr(1044)||'-%'
          OR COALESCE(o.metadata->>'notes','')='Гэрлэн дохио'))
      ORDER BY o.name LIMIT 1000`,[org]);
    const fixedAssets=await client.query(`SELECT a.id,a.code,a.name,a.category,a.status,a.location,a.metadata,a.allocatable_quantity,a.allocation_unit,
      area.id AS service_area_id,area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM assets a
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=a.organization_id AND area.domain='lighting' AND area.active=true
        AND area.code=CASE a.category WHEN 'Гэрлэн дохио' THEN 'traffic-signal' END
      WHERE a.organization_id=$1 AND a.category='Гэрлэн дохио'
        AND a.status<>'retired' AND COALESCE(a.metadata->>'excludedFromAssetMaster','false')<>'true'
      ORDER BY a.name LIMIT 1000`,[org]);
    const incidents=await client.query(`SELECT i.*,COALESCE(o.code,a.code) asset_code,COALESCE(o.name,a.name) asset_name,
      area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon
      FROM operational_incidents i
      LEFT JOIN operational_objects o ON o.organization_id=i.organization_id AND o.id=i.operational_object_id
      LEFT JOIN assets a ON a.organization_id=i.organization_id AND a.id=i.asset_id
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=i.organization_id AND area.id=i.service_area_id AND area.active=true
      WHERE i.organization_id=$1 AND i.domain='lighting' ORDER BY i.reported_at DESC LIMIT 500`,[org]);
    const work=await client.query(`SELECT w.id,w.title,w.status,w.priority,w.workflow_stage,w.due_at,w.created_at,w.service_area_id,
      o.code asset_code,o.name asset_name,u.full_name assigned_name,d.name department_name,
      area.code AS service_area_code,area.name AS service_area_name,area.icon AS service_area_icon,
      COALESCE(m.item_count,0)::int measurement_item_count,
      COALESCE(m.planned,0) planned_quantity,COALESCE(m.completed,0) completed_quantity,
      COALESCE(m.unresolved,0) unresolved_quantity,COALESCE(m.deferred,0) deferred_quantity,
      COALESCE(m.exception_pending,0)::int exception_pending
      FROM work_orders w
      LEFT JOIN operational_objects o ON o.organization_id=w.organization_id AND o.id=w.operational_object_id
      LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
      LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
      LEFT JOIN organization_work_service_areas area
        ON area.organization_id=w.organization_id AND area.id=w.service_area_id AND area.active=true
      LEFT JOIN LATERAL(SELECT count(*) item_count,sum(planned_quantity) planned,
        sum(completed_quantity) completed,sum(unresolved_quantity) unresolved,sum(deferred_quantity) deferred,
        count(*) FILTER(WHERE exception_status='requested') exception_pending
        FROM work_order_scope_items si WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id) m ON true
      WHERE w.organization_id=$1 AND (wt.code IN ('lighting-inspection','lighting-repair','traffic-signal-repair') OR w.category LIKE 'lighting.%')
      ORDER BY w.created_at DESC LIMIT 500`,[org]);
    const items=objects.rows,equipment=fixedAssets.rows,issues=incidents.rows,orders=work.rows;
    return {available:Boolean(capability.rows[0]?.available),summary:{
      operationalRecords:items.length,fixedEquipment:equipment.length,
      openIncidents:issues.filter(x=>['open','in_progress'].includes(x.status)).length,
      affectedLights:issues.filter(x=>['open','in_progress'].includes(x.status)).reduce((n,x)=>n+Number(x.affected_quantity)-Number(x.resolved_quantity),0),
      openWork:orders.filter(x=>!['completed','cancelled'].includes(x.status)).length,
      completedWork:orders.filter(x=>x.status==='completed').length
    },serviceAreas:serviceAreas.rows,incidentTypes:incidentTypes.rows,assets:items,fixedAssets:equipment,incidents:issues,workOrders:orders,
      capabilities:{
        canReportIncidents:hasPermission(req,"operational-incidents.report"),
        canCorrectIncidents:hasPermission(req,"operational-incidents.correct"),
        canCancelIncidents:hasPermission(req,"operational-incidents.cancel")
      }};
  });
  res.json(result);
}));

module.exports=router;
