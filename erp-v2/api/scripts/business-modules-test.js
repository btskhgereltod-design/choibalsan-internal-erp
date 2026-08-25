"use strict";
require("dotenv").config();
const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const base="http://127.0.0.1:4100";
const ids={};
async function call(path,token,method="GET",body){const response=await fetch(base+path,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data}
async function deviceCall(apiKey,body){const response=await fetch(base+"/api/gps/ingest",{method:"POST",headers:{"content-type":"application/json","x-device-key":apiKey},body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));assert.ok(response.ok,`GPS ingest: ${response.status} ${JSON.stringify(data)}`);return data}
async function iotCall(path,apiKey,method="GET",body){const response=await fetch(base+path,{method,headers:{"content-type":"application/json","x-device-key":apiKey},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json().catch(()=>({}));assert.ok(response.ok,`IoT ${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data}
async function tenantRaw(path,token,method,body){const response=await fetch(base+path,{method,headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)});return {response,body:await response.json().catch(()=>({}))}}
async function main(){const suffix=Date.now().toString(36).toUpperCase(),pool=getPool();let token,platformToken,orgId;
 try{
  const login=await call("/api/auth/login",null,"POST",{organization:process.env.BOOTSTRAP_ORG_SLUG,identifier:process.env.BOOTSTRAP_ADMIN_EMAIL,password:process.env.BOOTSTRAP_ADMIN_PASSWORD});token=login.token;
  const org=await call("/api/organizations/current",token);orgId=org.organization.id;
  ids.department=(await call("/api/modules/structure/departments",token,"POST",{code:`T${suffix}`,name:`Тест хэлтэс ${suffix}`})).item.id;
  ids.position=(await call("/api/modules/structure/positions",token,"POST",{code:`P${suffix}`,title:"Тест албан тушаал",departmentId:ids.department,rankLevel:10})).item.id;
  const structure=await call("/api/modules/structure",token);assert.ok(structure.departments.some(x=>x.id===ids.department));
  ids.warehouse=(await call("/api/modules/inventory/warehouses",token,"POST",{code:`W${suffix}`,name:"Тест агуулах",location:"Тест"})).item.id;
  ids.item=(await call("/api/modules/inventory/items",token,"POST",{sku:`SKU${suffix}`,name:"Тест бараа",category:"Тест",unit:"ш",minimumStock:2})).item.id;
  ids.receipt=(await call("/api/modules/inventory/movements",token,"POST",{itemId:ids.item,type:"receipt",toWarehouseId:ids.warehouse,quantity:10,reference:suffix,note:"integration"})).item.id;
  ids.issue=(await call("/api/modules/inventory/movements",token,"POST",{itemId:ids.item,type:"issue",fromWarehouseId:ids.warehouse,quantity:3,reference:suffix,note:"integration"})).item.id;
  const inventory=await call("/api/modules/inventory",token);assert.equal(Number(inventory.items.find(x=>x.id===ids.item).total_quantity),7);
  ids.asset=(await call("/api/assets",token,"POST",{code:`TEST-${suffix}`,name:"Тест хөрөнгө",category:"Тест",serialNumber:null,responsibleUserId:null,acquiredAt:null,location:"",notes:"business test",metadata:{}})).item.id;
  ids.mapLayer=(await call("/api/map/layers",token,"POST",{code:`test-${suffix.toLowerCase()}`,name:"Тест map layer",color:"#7c3aed",icon:"point"})).item.id;
  ids.mapFeature=(await call("/api/map/features",token,"POST",{layerId:ids.mapLayer,name:"Тест map цэг",description:"integration",latitude:48.0726,longitude:114.5356,status:"active",metadata:{}})).item.id;
  await call(`/api/map/assets/${ids.asset}/location`,token,"PATCH",{latitude:48.073,longitude:114.536});
  const map=await call("/api/map",token);assert.ok(map.assets.some(x=>x.id===ids.asset));assert.ok(map.features.some(x=>x.id===ids.mapFeature));
  ids.vehicle=(await call("/api/gps/vehicles",token,"POST",{assetId:ids.asset,plateNumber:`T-${suffix}`,make:"Test",model:"GPS",driverUserId:null,odometerKm:100,fuelCapacityL:50})).item.id;
  const device=(await call("/api/gps/devices",token,"POST",{vehicleId:ids.vehicle,deviceUid:`IMEI-${suffix}`,provider:"integration"}));ids.gpsDevice=device.item.id;
  ids.geofence=(await call("/api/gps/geofences",token,"POST",{name:`Тест бүс ${suffix}`,latitude:48.0726,longitude:114.5356,radiusM:300,color:"#f59e0b"})).item.id;
  const now=Date.now()-10_000,position=(latitude,longitude,offset)=>({latitude,longitude,speedKph:25,heading:90,ignition:true,fuelLevelPct:75,odometerKm:101,accuracyM:5,recordedAt:new Date(now+offset).toISOString(),metadata:{test:true}});
  await deviceCall(device.apiKey,position(48.0800,114.5500,0));await deviceCall(device.apiKey,position(48.0726,114.5356,1000));await deviceCall(device.apiKey,position(48.0800,114.5500,2000));
  const fleet=await call("/api/gps/overview",token);assert.ok(fleet.vehicles.some(x=>x.id===ids.vehicle));assert.equal(fleet.events.filter(x=>x.vehicle_id===ids.vehicle).length,2);
  const history=await call(`/api/gps/vehicles/${ids.vehicle}/history`,token);assert.equal(history.items.length,3);
  const gpsMap=await call("/api/map",token);assert.ok(gpsMap.vehicles.some(x=>x.id===ids.vehicle));
  const iotDevice=await call("/api/iot/devices",token,"POST",{deviceUid:`IOT-${suffix}`,name:"Тест IoT гэрэл",deviceType:"lighting",protocol:"http",assetId:ids.asset,mapFeatureId:null,latitude:48.0726,longitude:114.5356});ids.iotDevice=iotDevice.item.id;
  await iotCall("/api/iot/ingest",iotDevice.apiKey,"POST",{state:"on",health:"normal",voltage:220,currentAmp:1.2,powerWatt:264,energyKwh:10.5,temperatureC:18,signalStrength:-70,sensors:{lux:50},recordedAt:new Date().toISOString(),firmwareVersion:"test-1",localPolicyVersion:"policy-1"});
  ids.iotCommand=(await call(`/api/iot/devices/${ids.iotDevice}/commands`,token,"POST",{action:"turn_off",payload:{reason:"integration"},priority:"manual",expiresInSeconds:900,idempotencyKey:`test-${suffix}`})).item.id;
  const queued=await iotCall("/api/iot/device/commands",iotDevice.apiKey);assert.equal(queued.items[0].id,ids.iotCommand);await iotCall(`/api/iot/device/commands/${ids.iotCommand}/ack`,iotDevice.apiKey,"POST",{success:true,result:{state:"off"},errorMessage:""});
  ids.iotDefault=(await call(`/api/iot/devices/${ids.iotDevice}/commands`,token,"POST",{action:"schedule_on",payload:{},priority:"default",expiresInSeconds:900,idempotencyKey:`default-${suffix}`})).item.id;
  ids.iotEmergency=(await call(`/api/iot/devices/${ids.iotDevice}/commands`,token,"POST",{action:"emergency_off",payload:{},priority:"emergency",expiresInSeconds:900,idempotencyKey:`emergency-${suffix}`})).item.id;
  const blocked=await tenantRaw(`/api/iot/devices/${ids.iotDevice}/commands`,token,"POST",{action:"schedule_on",payload:{},priority:"schedule",expiresInSeconds:900,idempotencyKey:`blocked-${suffix}`});assert.equal(blocked.response.status,409);
  const emergencyQueue=await iotCall("/api/iot/device/commands",iotDevice.apiKey);assert.equal(emergencyQueue.items[0].id,ids.iotEmergency);await iotCall(`/api/iot/device/commands/${ids.iotEmergency}/ack`,iotDevice.apiKey,"POST",{success:true,result:{state:"off"},errorMessage:""});
  const iot=await call("/api/iot/overview",token);assert.equal(iot.devices.find(x=>x.id===ids.iotDevice).state,"on");assert.equal(iot.commands.find(x=>x.id===ids.iotCommand).status,"acknowledged");const iotMap=await call("/api/map",token);assert.ok(iotMap.iotDevices.some(x=>x.id===ids.iotDevice));
  assert.equal(iot.commands.find(x=>x.id===ids.iotDefault).status,"superseded");assert.equal(iot.commands.find(x=>x.id===ids.iotEmergency).status,"acknowledged");
  ids.plan=(await call("/api/modules/maintenance",token,"POST",{assetId:ids.asset,title:"Тест үзлэг",instructions:"Шалгах",frequencyDays:30,nextDueDate:new Date().toISOString().slice(0,10),assignedTo:null})).item.id;
  await call(`/api/modules/maintenance/${ids.plan}/complete`,token,"POST",{note:"Амжилттай",meterReading:"100"});
  const maintenance=await call("/api/modules/maintenance",token);assert.ok(maintenance.items.find(x=>x.id===ids.plan).completion_count===1);
  ids.purchase=(await call("/api/modules/procurement",token,"POST",{title:"Тест худалдан авалт",justification:"integration",currency:"MNT",submit:true,lines:[{description:"Тест бараа",quantity:2,unit:"ш",unitPrice:1000}]})).item.id;
  await call(`/api/modules/procurement/${ids.purchase}/decision`,token,"POST",{action:"approved",note:"Тест батлав"});
  const procurement=await call("/api/modules/procurement",token);assert.equal(procurement.items.find(x=>x.id===ids.purchase).status,"approved");
  const settings=await call("/api/modules/settings",token);await call("/api/modules/settings",token,"PATCH",{name:settings.item.name,shortName:settings.item.short_name,logoUrl:settings.item.logo_url,primaryColor:settings.item.primary_color,accentColor:settings.item.accent_color,address:settings.item.address,phone:settings.item.phone,email:settings.item.email,registrationNo:settings.item.registration_no});
  const billing=await call("/api/modules/billing",token);assert.ok(Array.isArray(billing.plans));
  const pLogin=await call("/api/platform/auth/login",null,"POST",{email:process.env.BOOTSTRAP_PLATFORM_ADMIN_EMAIL,password:process.env.BOOTSTRAP_PLATFORM_ADMIN_PASSWORD});platformToken=pLogin.token;
  const overview=await call("/api/platform/billing/overview",platformToken);assert.ok(Array.isArray(overview.plans));
  const today=new Date().toISOString().slice(0,10);ids.invoice=(await call("/api/platform/billing/invoices",platformToken,"POST",{organizationId:orgId,periodStart:today,periodEnd:today,dueDate:today,amount:12345,note:`integration ${suffix}`})).item.id;
  await call(`/api/platform/billing/invoices/${ids.invoice}/payments`,platformToken,"POST",{amount:12345,reference:suffix,paymentMethod:"bank_transfer"});
  console.log("Business modules integration passed: structure, inventory, maintenance, procurement, settings, billing, COP Map, GPS/Fleet, IoT Control.");
 }finally{
  if(orgId){const c=await pool.connect();try{await c.query("BEGIN");if(ids.invoice){await c.query("DELETE FROM billing_payments WHERE invoice_id=$1",[ids.invoice]);await c.query("DELETE FROM billing_invoices WHERE id=$1",[ids.invoice]);}if(ids.purchase){await c.query("DELETE FROM purchase_approval_events WHERE request_id=$1",[ids.purchase]);await c.query("DELETE FROM purchase_request_lines WHERE request_id=$1",[ids.purchase]);await c.query("DELETE FROM purchase_requests WHERE id=$1",[ids.purchase]);}if(ids.plan){await c.query("DELETE FROM maintenance_executions WHERE plan_id=$1",[ids.plan]);await c.query("DELETE FROM maintenance_plans WHERE id=$1",[ids.plan]);}if(ids.iotDevice){await c.query("DELETE FROM iot_commands WHERE device_id=$1",[ids.iotDevice]);await c.query("DELETE FROM iot_telemetry WHERE device_id=$1",[ids.iotDevice]);await c.query("DELETE FROM iot_devices WHERE id=$1",[ids.iotDevice]);}if(ids.vehicle){await c.query("DELETE FROM geofence_events WHERE vehicle_id=$1",[ids.vehicle]);await c.query("DELETE FROM vehicle_geofence_states WHERE vehicle_id=$1",[ids.vehicle]);await c.query("DELETE FROM gps_positions WHERE vehicle_id=$1",[ids.vehicle]);}if(ids.gpsDevice)await c.query("DELETE FROM gps_devices WHERE id=$1",[ids.gpsDevice]);if(ids.vehicle)await c.query("DELETE FROM fleet_vehicles WHERE id=$1",[ids.vehicle]);if(ids.geofence)await c.query("DELETE FROM geofences WHERE id=$1",[ids.geofence]);if(ids.mapFeature)await c.query("DELETE FROM map_features WHERE id=$1",[ids.mapFeature]);if(ids.mapLayer)await c.query("DELETE FROM map_layers WHERE id=$1",[ids.mapLayer]);if(ids.asset){await c.query("DELETE FROM asset_events WHERE asset_id=$1",[ids.asset]);await c.query("DELETE FROM assets WHERE id=$1",[ids.asset]);}if(ids.item){await c.query("DELETE FROM stock_movements WHERE item_id=$1",[ids.item]);await c.query("DELETE FROM inventory_balances WHERE item_id=$1",[ids.item]);await c.query("DELETE FROM inventory_items WHERE id=$1",[ids.item]);}if(ids.warehouse)await c.query("DELETE FROM warehouses WHERE id=$1",[ids.warehouse]);if(ids.position)await c.query("DELETE FROM positions WHERE id=$1",[ids.position]);if(ids.department)await c.query("DELETE FROM departments WHERE id=$1",[ids.department]);const entityIds=Object.values(ids);if(entityIds.length)await c.query("DELETE FROM audit_logs WHERE organization_id=$1 AND entity_id=ANY($2::text[])",[orgId,entityIds]);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK").catch(()=>{});console.error("cleanup failed",e.message)}finally{c.release()}}
  await closePool();
 }
}
if(process.env.RUN_BUSINESS_INTEGRATION==="1")main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={main};
