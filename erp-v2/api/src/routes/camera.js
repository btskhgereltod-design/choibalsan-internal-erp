"use strict";

const express = require("express");
const { z } = require("zod");
const { withTenantTransaction } = require("../db");
const { authenticate, requireModule, requireWorkspace } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { payloadHash } = require("../services/workflow-coordination");
const { loadOperationalObjectActivity } = require("../services/operational-object-activity");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate, requireModule("camera-operations"), requireWorkspace("camera"));

const uuid=z.string().uuid();
const objectUpdateSchema=z.object({
  name:z.string().trim().min(1).max(200),location:z.string().trim().max(500).default(""),
  expectedVersion:z.coerce.number().int().positive()
});
const objectRetireSchema=z.object({reason:z.string().trim().min(3).max(2000),expectedVersion:z.coerce.number().int().positive()});
const incidentBatchSchema=z.object({
  idempotencyKey:z.string().uuid(),
  rows:z.array(z.object({
    rowKey:z.string().uuid(),operationalObjectId:z.string().uuid(),
    incidentType:z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/),
    affectedQuantity:z.coerce.number().int().min(1).max(1_000_000),
    reportedAt:z.iso.datetime(),note:z.string().trim().max(2000).default("")
  })).min(1).max(100)
});
const incidentCancelSchema=z.object({
  reason:z.string().trim().min(3).max(2000),
  expectedVersion:z.coerce.number().int().positive(),
  idempotencyKey:z.string().uuid()
});
const nullableNumber=(minimum,maximum)=>z.union([z.number().min(minimum).max(maximum),z.null()]);
const cameraProfileSchema=z.object({
  expectedObjectVersion:z.coerce.number().int().positive(),
  note:z.string().trim().max(2000).default(""),
  points:z.array(z.object({
    name:z.string().trim().min(1).max(200),poleReference:z.string().trim().max(200).default(""),
    latitude:nullableNumber(-90,90),longitude:nullableNumber(-180,180),locationNote:z.string().trim().max(500).default(""),
    devices:z.array(z.object({
      deviceType:z.string().trim().min(1).max(100),manufacturer:z.string().trim().max(120).default(""),
      model:z.string().trim().max(160).default(""),quantity:z.coerce.number().int().positive().max(1000),
      resolutionMp:nullableNumber(0.01,1000),lensMm:nullableNumber(0.01,10000),
      supportsPtz:z.boolean().default(false),nightVision:z.boolean().default(false),
      connectivity:z.string().trim().max(100).default(""),powerSource:z.string().trim().max(100).default(""),
      note:z.string().trim().max(1000).default("")
    })).min(1).max(50)
  }).superRefine((value,ctx)=>{
    if((value.latitude===null)!==(value.longitude===null))ctx.addIssue({code:"custom",message:"Өргөрөг, уртрагыг хамтад нь оруулна"});
  })).min(1).max(200)
});
const hasPermission=(req,permission)=>new Set(req.user.permissions||[]).has(permission)||new Set(req.user.system_roles||[]).has("owner");
const deny=(res,permission)=>res.status(403).json({error:"Insufficient permission",permission});

router.post("/incidents/batch",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-incidents.report"))return deny(res,"operational-incidents.report");
  const parsed=incidentBatchSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Камерын гэмтлийн багц буруу байна",issues:parsed.error.issues});
  const org=req.user.organization_id,value=parsed.data;
  if(new Set(value.rows.map(row=>row.rowKey)).size!==value.rows.length){
    return res.status(400).json({error:"Нэг багцад rowKey давхардаж болохгүй",code:"DUPLICATE_ROW_KEY"});
  }
  if(new Set(value.rows.map(row=>`${row.operationalObjectId}:${row.incidentType}`)).size!==value.rows.length){
    return res.status(400).json({error:"Нэг объектын ижил төрлийн гэмтлийг багцад давхардуулж болохгүй",code:"DUPLICATE_INCIDENT_TARGET"});
  }
  if(value.rows.some(row=>new Date(row.reportedAt).getTime()>Date.now()+5*60*1000)){
    return res.status(400).json({error:"Ирээдүйн огноогоор гэмтэл бүртгэхгүй",code:"FUTURE_REPORTED_AT"});
  }
  const commandHash=payloadHash(value);
  const outcome=await withTenantTransaction(org,async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${org}:camera-incident-batch:${value.idempotencyKey}`]);
    const receipt=(await client.query(`SELECT actor_user_id,payload_sha256,result
      FROM operational_incident_command_receipts
      WHERE organization_id=$1 AND command_type='report_camera_batch' AND idempotency_key=$2`,[org,value.idempotencyKey])).rows[0];
    if(receipt){
      if(receipt.actor_user_id!==req.user.id||String(receipt.payload_sha256).trim()!==commandHash){
        return {status:409,body:{error:"IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"}};
      }
      return {status:200,body:{...receipt.result,replayed:true}};
    }
    const objectIds=[...new Set(value.rows.map(row=>row.operationalObjectId))];
    const typeCodes=[...new Set(value.rows.map(row=>row.incidentType))];
    const objects=await client.query(`SELECT object_row.id,object_row.code,object_row.name,
        object_row.location,object_row.status,
        CASE WHEN specification.id IS NOT NULL THEN COALESCE(devices.camera_count,0)
          WHEN object_row.metadata->>'cameraCount' ~ '^[0-9]+$' THEN (object_row.metadata->>'cameraCount')::int
        END camera_capacity,
        (specification.id IS NOT NULL OR object_row.metadata->>'cameraCount' ~ '^[0-9]+$') camera_capacity_known
      FROM operational_objects object_row
      LEFT JOIN operational_object_specifications specification
        ON specification.organization_id=object_row.organization_id
        AND specification.id=object_row.current_specification_id AND specification.profile_kind='camera'
      LEFT JOIN LATERAL(SELECT sum(device.quantity)::int camera_count
        FROM operational_object_camera_devices device
        WHERE device.organization_id=object_row.organization_id AND device.specification_id=specification.id) devices ON true
      WHERE object_row.organization_id=$1 AND object_row.domain='camera' AND object_row.id=ANY($2::uuid[])`,[org,objectIds]);
    const types=await client.query(`SELECT code,name,quantity_unit FROM organization_operational_incident_types
      WHERE organization_id=$1 AND domain='camera' AND active=true AND code=ANY($2::text[])`,[org,typeCodes]);
    if(objects.rowCount!==objectIds.length)return {status:409,body:{error:"Сонгосон объект олдсонгүй эсвэл камерын объект биш",code:"INVALID_CAMERA_OBJECT"}};
    if(objects.rows.some(object=>object.status==='retired'))return {status:409,body:{error:"Ашиглалтаас гарсан объект дээр шинэ гэмтэл бүртгэхгүй",code:"RETIRED_CAMERA_OBJECT"}};
    if(types.rowCount!==typeCodes.length)return {status:409,body:{error:"Идэвхтэй reference төрөл олдсонгүй",code:"INVALID_INCIDENT_TYPE"}};
    const objectsById=new Map(objects.rows.map(object=>[object.id,object]));
    const typesByCode=new Map(types.rows.map(type=>[type.code,type]));
    const existingOpen=await client.query(`SELECT incident.operational_object_id,
        COALESCE(NULLIF(incident.detail->>'quantityUnit',''),type.quantity_unit,'камер') quantity_unit,
        sum(GREATEST(0,incident.affected_quantity-incident.resolved_quantity))::bigint open_quantity
      FROM operational_incidents incident
      LEFT JOIN organization_operational_incident_types type
        ON type.organization_id=incident.organization_id AND type.domain=incident.domain AND type.code=incident.incident_type
      WHERE incident.organization_id=$1 AND incident.domain='camera'
        AND incident.operational_object_id=ANY($2::uuid[]) AND incident.status IN('open','in_progress')
      GROUP BY incident.operational_object_id,
        COALESCE(NULLIF(incident.detail->>'quantityUnit',''),type.quantity_unit,'камер')`,[org,objectIds]);
    const reservedByObjectUnit=new Map(existingOpen.rows.map(item=>[
      `${item.operational_object_id}:${item.quantity_unit}`,Number(item.open_quantity)
    ]));
    for(const row of value.rows){
      const object=objectsById.get(row.operationalObjectId),type=typesByCode.get(row.incidentType),unit=type.quantity_unit;
      const capacity=unit==='камер'?Number(object.camera_capacity):null;
      const capacityKnown=unit==='камер'&&object.camera_capacity_known;
      const key=`${object.id}:${unit}`,openQuantity=reservedByObjectUnit.get(key)||0;
      if(capacityKnown&&openQuantity+row.affectedQuantity>capacity){
        return {status:409,body:{error:"Гэмтлийн тоо объектын бүртгэлтэй нийт камерын тооноос хэтэрлээ",
          code:"INCIDENT_QUANTITY_EXCEEDS_OBJECT_CAPACITY",operationalObjectId:object.id,quantityUnit:unit,
          referenceQuantity:capacity,openQuantity,requestedQuantity:row.affectedQuantity}};
      }
      reservedByObjectUnit.set(key,openQuantity+row.affectedQuantity);
    }
    const items=[];
    for(const row of value.rows){
      const object=objectsById.get(row.operationalObjectId),type=typesByCode.get(row.incidentType);
      const detail={captureSurface:"camera_fault_sheet",rowKey:row.rowKey,quantityUnit:type.quantity_unit,
        referencePrecision:"aggregate_object",reportedNote:row.note};
      const incident=(await client.query(`INSERT INTO operational_incidents(
          organization_id,domain,operational_object_id,incident_type,title,location,
          affected_quantity,resolved_quantity,status,reported_at,reported_by,detail,version)
        VALUES($1,'camera',$2,$3,$4,$5,$6,0,'open',$7,$8,$9::jsonb,1)
        RETURNING id,operational_object_id,incident_type,title,affected_quantity,resolved_quantity,status,reported_at,version`,
      [org,object.id,type.code,`${type.name} — ${object.name}`,object.location||"",row.affectedQuantity,
        row.reportedAt,req.user.id,JSON.stringify(detail)])).rows[0];
      await client.query(`INSERT INTO operational_incident_events(
          organization_id,incident_id,actor_user_id,event_type,quantity,note,detail,incident_version,request_id)
        VALUES($1,$2,$3,'reported',$4,$5,$6::jsonb,1,$7)`,[org,incident.id,req.user.id,
        row.affectedQuantity,row.note,JSON.stringify({rowKey:row.rowKey,incidentType:type.code,quantityUnit:type.quantity_unit}),value.idempotencyKey]);
      await writeAudit(req,"operational_incident.report","operational_incident",incident.id,
        {domain:"camera",operationalObjectId:object.id,incidentType:type.code,affectedQuantity:row.affectedQuantity,
          quantityUnit:type.quantity_unit,idempotencyKey:value.idempotencyKey,rowKey:row.rowKey},client);
      items.push({...incident,rowKey:row.rowKey,quantityUnit:type.quantity_unit});
    }
    const result={items,idempotencyKey:value.idempotencyKey};
    await client.query(`INSERT INTO operational_incident_command_receipts(
        organization_id,command_type,idempotency_key,payload_sha256,actor_user_id,result)
      VALUES($1,'report_camera_batch',$2,$3,$4,$5::jsonb)`,[org,value.idempotencyKey,commandHash,req.user.id,JSON.stringify(result)]);
    return {status:201,body:{...result,replayed:false}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/incidents/:id/cancel",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-incidents.cancel"))return deny(res,"operational-incidents.cancel");
  const incidentId=uuid.safeParse(req.params.id),parsed=incidentCancelSchema.safeParse(req.body);
  if(!incidentId.success||!parsed.success)return res.status(400).json({error:"Цуцлах хүсэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,value=parsed.data,commandType=`cancel_camera_incident:${incidentId.data}`,
    commandHash=payloadHash(value);
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
      FROM operational_incidents WHERE organization_id=$1 AND id=$2 AND domain='camera' FOR UPDATE`,[org,incidentId.data])).rows[0];
    if(!incident)return {status:404,body:{error:"Камерын гэмтлийн бүртгэл олдсонгүй"}};
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
      {domain:"camera",previousStatus:incident.status,reason:value.reason,previousVersion:Number(incident.version),version:Number(updated.version),idempotencyKey:value.idempotencyKey},client);
    const result={item:updated};
    await client.query(`INSERT INTO operational_incident_command_receipts(
      organization_id,command_type,idempotency_key,payload_sha256,actor_user_id,result)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[org,commandType,value.idempotencyKey,commandHash,req.user.id,JSON.stringify(result)]);
    return {status:200,body:{...result,replayed:false}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.get("/objects/:id/dossier", asyncHandler(async (req, res) => {
  if(!hasPermission(req,"operational-objects.read"))return deny(res,"operational-objects.read");
  const id = uuid.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid camera object" });
  const org = req.user.organization_id;
  const payload=await withTenantTransaction(org,async client=>{
  const object = await client.query(`SELECT o.*,parent.name parent_name,
    spec.version_no specification_version,spec.pole_count specification_pole_count,
    COALESCE((o.metadata->>'cameraCount')::int,0) legacy_camera_count
    FROM operational_objects o LEFT JOIN operational_objects parent
      ON parent.organization_id=o.organization_id AND parent.id=o.parent_object_id
    LEFT JOIN operational_object_specifications spec
      ON spec.organization_id=o.organization_id AND spec.id=o.current_specification_id AND spec.profile_kind='camera'
    WHERE o.organization_id=$1 AND o.id=$2 AND o.domain='camera'`, [org, id.data]);
  if (!object.rowCount) return null;
  const [components,events,children,points,devices] = await Promise.all([
    client.query(`SELECT c.*,a.code asset_code,a.name asset_name,a.category asset_category,a.status asset_status
      FROM operational_object_components c JOIN assets a ON a.organization_id=c.organization_id AND a.id=c.asset_id
      WHERE c.organization_id=$1 AND c.operational_object_id=$2 ORDER BY c.removed_at NULLS FIRST,c.created_at DESC`, [org, id.data]),
    client.query(`SELECT e.*,u.full_name actor_name FROM operational_object_events e
      LEFT JOIN users u ON u.organization_id=e.organization_id AND u.id=e.actor_user_id
      WHERE e.organization_id=$1 AND e.operational_object_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 200`, [org, id.data]),
    client.query(`SELECT id,code,name,object_type,status FROM operational_objects
      WHERE organization_id=$1 AND parent_object_id=$2 ORDER BY name`, [org, id.data]),
    client.query(`SELECT point.* FROM operational_object_camera_points point
      JOIN operational_objects object_row ON object_row.organization_id=point.organization_id
        AND object_row.current_specification_id=point.specification_id
      WHERE object_row.organization_id=$1 AND object_row.id=$2 ORDER BY point.sequence_no`,[org,id.data]),
    client.query(`SELECT device.* FROM operational_object_camera_devices device
      JOIN operational_objects object_row ON object_row.organization_id=device.organization_id
        AND object_row.current_specification_id=device.specification_id
      WHERE object_row.organization_id=$1 AND object_row.id=$2 ORDER BY device.camera_point_id,device.sequence_no`,[org,id.data]),
  ]);
  const activity=await loadOperationalObjectActivity(client,{organizationId:org,objectId:id.data,user:req.user});
  return {item:object.rows[0],components:components.rows,events:events.rows,children:children.rows,
    cameraPoints:points.rows,cameraDevices:devices.rows,assetOptions:[],media:[],activity,capabilities:{
      canManageComponents:false,canCreateNote:false,
      canUpdate:hasPermission(req,"operational-objects.update"),
      canRetire:hasPermission(req,"operational-objects.retire"),canManageMedia:false}};
  });
  if(!payload)return res.status(404).json({error:"Camera object not found"});
  res.json(payload);
}));

router.patch("/objects/:id",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.update"))return deny(res,"operational-objects.update");
  const id=uuid.safeParse(req.params.id),parsed=objectUpdateSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Камерын объектын мэдээлэл буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const current=(await client.query(`SELECT id,name,location,status,version FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='camera' FOR UPDATE`,[org,id.data])).rows[0];
    if(!current)return {status:404,body:{error:"Camera object not found"}};
    if(current.status==='retired')return {status:409,body:{error:"Архивласан объектыг засах боломжгүй",code:"OBJECT_RETIRED"}};
    if(Number(current.version)!==v.expectedVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(current.version)}};
    const updated=(await client.query(`UPDATE operational_objects SET name=$3,location=$4,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data,v.name,v.location])).rows[0];
    const before={name:current.name,location:current.location},after={name:updated.name,location:updated.location};
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'updated','Камерын объектын үндсэн мэдээлэл шинэчлэв',$4::jsonb)`,
    [org,id.data,req.user.id,JSON.stringify({before,after,previousVersion:Number(current.version),version:Number(updated.version)})]);
    await writeAudit(req,"operational_object.update","operational_object",id.data,{before,after,previousVersion:Number(current.version),version:Number(updated.version)},client);
    return {status:200,body:{item:updated}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/objects/:id/specifications",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.update"))return deny(res,"operational-objects.update");
  const id=uuid.safeParse(req.params.id),parsed=cameraProfileSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Камерын техникийн үзүүлэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const object=(await client.query(`SELECT id,status,version,current_specification_id FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='camera' FOR UPDATE`,[org,id.data])).rows[0];
    if(!object)return {status:404,body:{error:"Camera object not found"}};
    if(object.status==='retired')return {status:409,body:{error:"Архивласан объектын үзүүлэлтийг засах боломжгүй",code:"OBJECT_RETIRED"}};
    if(Number(object.version)!==v.expectedObjectVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(object.version)}};
    const versionNo=Number((await client.query(`SELECT COALESCE(max(version_no),0)+1 value FROM operational_object_specifications
      WHERE organization_id=$1 AND operational_object_id=$2`,[org,id.data])).rows[0].value);
    const specification=(await client.query(`INSERT INTO operational_object_specifications(
      organization_id,operational_object_id,version_no,pole_count,note,created_by,profile_kind)
      VALUES($1,$2,$3,$4,$5,$6,'camera') RETURNING *`,[org,id.data,versionNo,v.points.length,v.note,req.user.id])).rows[0];
    const points=[],devices=[];
    for(const [pointIndex,point] of v.points.entries()){
      const insertedPoint=(await client.query(`INSERT INTO operational_object_camera_points(
        organization_id,specification_id,sequence_no,name,pole_reference,latitude,longitude,location_note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[org,specification.id,pointIndex+1,point.name,
        point.poleReference,point.latitude,point.longitude,point.locationNote])).rows[0];
      points.push(insertedPoint);
      for(const [deviceIndex,device] of point.devices.entries()){
        devices.push((await client.query(`INSERT INTO operational_object_camera_devices(
          organization_id,specification_id,camera_point_id,sequence_no,device_type,manufacturer,model,quantity,
          resolution_mp,lens_mm,supports_ptz,night_vision,connectivity,power_source,note)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[org,specification.id,
          insertedPoint.id,deviceIndex+1,device.deviceType,device.manufacturer,device.model,device.quantity,
          device.resolutionMp,device.lensMm,device.supportsPtz,device.nightVision,device.connectivity,device.powerSource,device.note])).rows[0]);
      }
    }
    const updated=(await client.query(`UPDATE operational_objects SET current_specification_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data,specification.id])).rows[0];
    const totalCameras=devices.reduce((sum,item)=>sum+Number(item.quantity),0);
    const detail={specificationId:specification.id,specificationVersion:versionNo,previousSpecificationId:object.current_specification_id,
      poleCount:points.length,totalCameras,deviceGroupCount:devices.length,previousObjectVersion:Number(object.version),objectVersion:Number(updated.version)};
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'specification_changed',$4,$5::jsonb)`,[org,id.data,req.user.id,v.note,JSON.stringify(detail)]);
    await writeAudit(req,"operational_object.camera_specification.create","operational_object",id.data,detail,client);
    return {status:201,body:{item:updated,specification,cameraPoints:points,cameraDevices:devices}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/objects/:id/retire",asyncHandler(async(req,res)=>{
  if(!hasPermission(req,"operational-objects.retire"))return deny(res,"operational-objects.retire");
  const id=uuid.safeParse(req.params.id),parsed=objectRetireSchema.safeParse(req.body);
  if(!id.success||!parsed.success)return res.status(400).json({error:"Архивлах хүсэлт буруу байна",issues:parsed.error?.issues});
  const org=req.user.organization_id,v=parsed.data;
  const outcome=await withTenantTransaction(org,async client=>{
    const current=(await client.query(`SELECT id,code,name,status,version FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='camera' FOR UPDATE`,[org,id.data])).rows[0];
    if(!current)return {status:404,body:{error:"Camera object not found"}};
    if(current.status==='retired')return {status:409,body:{error:"Объект аль хэдийн архивлагдсан байна",code:"OBJECT_RETIRED"}};
    if(Number(current.version)!==v.expectedVersion)return {status:409,body:{error:"Объект өөр хэрэглэгчээр шинэчлэгдсэн байна. Дахин ачаална уу.",code:"VERSION_CONFLICT",currentVersion:Number(current.version)}};
    const blockers=(await client.query(`SELECT
      (SELECT count(*)::int FROM operational_objects child WHERE child.organization_id=$1 AND child.parent_object_id=$2 AND child.status<>'retired') active_children,
      (SELECT count(*)::int FROM operational_object_components component WHERE component.organization_id=$1 AND component.operational_object_id=$2 AND component.removed_at IS NULL) active_components,
      (SELECT count(*)::int FROM operational_incidents incident WHERE incident.organization_id=$1 AND incident.operational_object_id=$2 AND incident.status IN('open','in_progress') AND incident.affected_quantity>incident.resolved_quantity) active_incidents,
      (SELECT count(*)::int FROM work_orders work WHERE work.organization_id=$1 AND work.operational_object_id=$2 AND work.status NOT IN('completed','cancelled')) active_work`,[org,id.data])).rows[0];
    if(Object.values(blockers).some(Number))return {status:409,body:{error:"Объектод идэвхтэй холбоос эсвэл ажиллагааны бүртгэл байна.",code:"OBJECT_RETIRE_BLOCKED",blockers}};
    const retired=(await client.query(`UPDATE operational_objects SET status='retired',version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,[org,id.data])).rows[0];
    const detail={reason:v.reason,previousStatus:current.status,previousVersion:Number(current.version),version:Number(retired.version)};
    await client.query(`INSERT INTO operational_object_events(organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'retired',$4,$5::jsonb)`,[org,id.data,req.user.id,v.reason,JSON.stringify(detail)]);
    await writeAudit(req,"operational_object.retire","operational_object",id.data,detail,client);
    return {status:200,body:{item:retired}};
  });
  res.status(outcome.status).json(outcome.body);
}));

router.get("/workspace", asyncHandler(async (req, res) => {
  const organizationId = req.user.organization_id;
  const enabled = new Set(req.user.enabled_modules || []);
  if (!enabled.has("assets") || !enabled.has("work-orders")) {
    return res.status(403).json({ error: "Камерын ажлын талбарт хөрөнгө болон ажлын урсгалын эрх шаардлагатай." });
  }

  const [capability, objects, incidentTypes, incidents, workOrders, snapshots] = await withTenantTransaction(organizationId,client=>Promise.all([
    client.query(`SELECT EXISTS(
      SELECT 1 FROM organization_work_types
      WHERE organization_id=$1 AND active=true
        AND code IN ('camera-inspection','camera-repair','camera-maintenance','camera-network-repair','network-repair')
      UNION ALL
      SELECT 1 FROM operational_objects WHERE organization_id=$1 AND domain='camera'
    ) available`, [organizationId]),
    client.query(`SELECT object_row.id,object_row.code,object_row.name,object_row.object_type,object_row.domain,
      object_row.status,object_row.location,object_row.metadata,object_row.updated_at,
      NULLIF(btrim(object_row.metadata->>'subCategory'),'') object_category,
      legacy_source.source_group_code,legacy_source.source_condition,legacy_source.source_status,
      specification.version_no specification_version,specification.pole_count,
      COALESCE(points.point_count,0)::int camera_point_count,
      COALESCE(points.gps_point_count,0)::int gps_point_count,
      CASE WHEN specification.id IS NOT NULL THEN COALESCE(devices.camera_count,0)
        ELSE COALESCE((object_row.metadata->>'cameraCount')::int,0) END camera_count,
      COALESCE(open_incidents.open_incident_count,0)::int open_incident_count,
      COALESCE(open_incidents.affected_camera_count,0)::int affected_camera_count,
      COALESCE(open_work.open_work_count,0)::int open_work_count,
      CASE WHEN specification.id IS NOT NULL THEN 'canonical' ELSE 'legacy_candidate' END classification_state
      FROM operational_objects object_row
      LEFT JOIN operational_object_specifications specification
        ON specification.organization_id=object_row.organization_id
        AND specification.id=object_row.current_specification_id AND specification.profile_kind='camera'
      LEFT JOIN LATERAL(SELECT sum(device.quantity)::int camera_count
        FROM operational_object_camera_devices device
        WHERE device.organization_id=object_row.organization_id AND device.specification_id=specification.id) devices ON true
      LEFT JOIN LATERAL(SELECT count(*)::int point_count,
          count(*) FILTER (WHERE point.latitude IS NOT NULL AND point.longitude IS NOT NULL)::int gps_point_count
        FROM operational_object_camera_points point
        WHERE point.organization_id=object_row.organization_id AND point.specification_id=specification.id) points ON true
      LEFT JOIN LATERAL(SELECT
          NULLIF(btrim(record.source_snapshot->>'bag_no'),'') source_group_code,
          NULLIF(btrim(record.source_snapshot->>'condition'),'') source_condition,
          NULLIF(btrim(record.source_snapshot->>'status'),'') source_status
        FROM source_import_records record
        WHERE record.organization_id=object_row.organization_id
          AND record.source_table='camera_assets' AND record.target_type='operational_object'
          AND record.target_id=object_row.id::text
        ORDER BY record.imported_at DESC LIMIT 1) legacy_source ON true
      LEFT JOIN LATERAL(SELECT count(*)::int open_incident_count,
          COALESCE(sum(GREATEST(incident.affected_quantity-incident.resolved_quantity,0))
            FILTER (WHERE COALESCE(incident.detail->>'quantityUnit','камер')='камер'),0)::int affected_camera_count
        FROM operational_incidents incident
        WHERE incident.organization_id=object_row.organization_id
          AND incident.operational_object_id=object_row.id AND incident.domain='camera'
          AND incident.status IN('open','in_progress')
          AND incident.affected_quantity>incident.resolved_quantity) open_incidents ON true
      LEFT JOIN LATERAL(SELECT count(*)::int open_work_count
        FROM work_orders work
        LEFT JOIN organization_work_types work_type
          ON work_type.organization_id=work.organization_id AND work_type.id=work.work_type_id
        WHERE work.organization_id=object_row.organization_id
          AND work.operational_object_id=object_row.id
          AND work.status NOT IN('completed','cancelled')
          AND (work_type.code IN ('camera-inspection','camera-repair','camera-maintenance','camera-network-repair','network-repair')
            OR work.category LIKE 'camera.%')) open_work ON true
      WHERE object_row.organization_id=$1 AND object_row.domain='camera' AND object_row.status<>'retired'
      ORDER BY object_row.name LIMIT 1000`, [organizationId]),
    client.query(`SELECT code,name,quantity_unit,sort_order
      FROM organization_operational_incident_types
      WHERE organization_id=$1 AND domain='camera' AND active=true
      ORDER BY sort_order,name`,[organizationId]),
    client.query(`SELECT i.*,o.code asset_code,o.name asset_name,
      NULLIF(btrim(o.metadata->>'subCategory'),'') object_category,
      legacy_source.source_group_code,legacy_source.source_condition
      FROM operational_incidents i
      LEFT JOIN operational_objects o
        ON o.organization_id=i.organization_id AND o.id=i.operational_object_id
      LEFT JOIN LATERAL(SELECT
          NULLIF(btrim(record.source_snapshot->>'bag_no'),'') source_group_code,
          NULLIF(btrim(record.source_snapshot->>'condition'),'') source_condition
        FROM source_import_records record
        WHERE record.organization_id=o.organization_id
          AND record.source_table='camera_assets' AND record.target_type='operational_object'
          AND record.target_id=o.id::text
        ORDER BY record.imported_at DESC LIMIT 1) legacy_source ON true
      WHERE i.organization_id=$1 AND i.domain='camera'
      ORDER BY i.reported_at DESC LIMIT 500`, [organizationId]),
    client.query(`SELECT w.id,w.operational_object_id,w.title,w.status,w.priority,w.workflow_stage,w.due_at,w.created_at,
      o.code asset_code,o.name asset_name,
      NULLIF(btrim(o.metadata->>'subCategory'),'') object_category,
      legacy_source.source_group_code,legacy_source.source_condition,
      u.full_name assigned_name,d.name department_name,
      COALESCE(m.item_count,0)::int measurement_item_count,
      COALESCE(m.planned,0) planned_quantity,COALESCE(m.completed,0) completed_quantity,
      COALESCE(m.unresolved,0) unresolved_quantity,COALESCE(m.deferred,0) deferred_quantity,
      COALESCE(m.exception_pending,0)::int exception_pending
      FROM work_orders w
      LEFT JOIN operational_objects o ON o.organization_id=w.organization_id AND o.id=w.operational_object_id
      LEFT JOIN users u ON u.organization_id=w.organization_id AND u.id=w.assigned_to
      LEFT JOIN departments d ON d.organization_id=w.organization_id AND d.id=w.department_id
      LEFT JOIN organization_work_types wt ON wt.organization_id=w.organization_id AND wt.id=w.work_type_id
      LEFT JOIN LATERAL(SELECT
          NULLIF(btrim(record.source_snapshot->>'bag_no'),'') source_group_code,
          NULLIF(btrim(record.source_snapshot->>'condition'),'') source_condition
        FROM source_import_records record
        WHERE record.organization_id=o.organization_id
          AND record.source_table='camera_assets' AND record.target_type='operational_object'
          AND record.target_id=o.id::text
        ORDER BY record.imported_at DESC LIMIT 1) legacy_source ON true
      LEFT JOIN LATERAL (
        SELECT count(*) item_count,sum(planned_quantity) planned,sum(completed_quantity) completed,
          sum(unresolved_quantity) unresolved,sum(deferred_quantity) deferred,
          count(*) FILTER (WHERE exception_status='requested') exception_pending
        FROM work_order_scope_items si
        WHERE si.organization_id=w.organization_id AND si.work_order_id=w.id
      ) m ON true
      WHERE w.organization_id=$1
        AND (wt.code IN ('camera-inspection','camera-repair','camera-maintenance','camera-network-repair','network-repair') OR w.category LIKE 'camera.%')
      ORDER BY w.created_at DESC LIMIT 500`, [organizationId]),
    client.query(`SELECT snapshot_date,metrics FROM operational_domain_snapshots
      WHERE organization_id=$1 AND domain='camera' ORDER BY snapshot_date DESC LIMIT 120`, [organizationId]),
  ]));

  const assetRows = objects.rows;
  const incidentRows = incidents.rows;
  const orderRows = workOrders.rows;
  const affectedDevices=incidentRows.filter((item)=>["open","in_progress"].includes(item.status))
    .reduce((total,item)=>total+Math.max(0,Number(item.affected_quantity||0)-Number(item.resolved_quantity||0)),0);
  const totalDevices=assetRows.reduce((total,item)=>total+Number(item.camera_count||0),0);
  res.json({
    available: Boolean(capability.rows[0]?.available),
    summary: {
      locations: assetRows.length,
      devices: totalDevices,
      activeDevices: Math.max(0,totalDevices-affectedDevices),
      openIncidents: incidentRows.filter((item) => ["open", "in_progress"].includes(item.status)).length,
      affectedDevices,
      openWork: orderRows.filter((item) => !["completed", "cancelled"].includes(item.status)).length,
      completedWork: orderRows.filter((item) => item.status === "completed").length,
    },
    incidentTypes: incidentTypes.rows,
    assets: assetRows,
    incidents: incidentRows,
    workOrders: orderRows,
    snapshots: snapshots.rows,
    capabilities:{
      canReportIncidents:hasPermission(req,"operational-incidents.report"),
      canCancelIncidents:hasPermission(req,"operational-incidents.cancel")
    },
  });
}));

module.exports = router;
