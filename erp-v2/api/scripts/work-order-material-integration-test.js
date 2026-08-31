"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");
const base=process.env.MATERIAL_TEST_BASE_URL||"http://127.0.0.1:4199";

async function raw(path,token,method="GET",body){
  const response=await fetch(base+path,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {response,body:await response.json().catch(()=>({}))};
}
async function call(path,token,method="GET",body){
  const result=await raw(path,token,method,body);
  assert.ok(result.response.ok,`${method} ${path}: ${result.response.status} ${JSON.stringify(result.body)}`);
  return result.body;
}

async function main(){
  const pool=getPool();
  try{
    const database=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database,/material_test/,"Material integration must use a disposable material_test database");
    await pool.query(`INSERT INTO organization_modules(organization_id,module_code,enabled)
      SELECT o.id,m.code,true FROM organizations o CROSS JOIN module_catalog m
      WHERE o.slug=$1 AND m.code IN('work-orders','inventory')
      ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now()`,[process.env.BOOTSTRAP_ORG_SLUG]);

    const login=await call("/api/auth/login",null,"POST",{organization:process.env.BOOTSTRAP_ORG_SLUG,identifier:process.env.BOOTSTRAP_ADMIN_EMAIL,password:process.env.BOOTSTRAP_ADMIN_PASSWORD});
    const token=login.token,suffix=Date.now().toString(36).toUpperCase();
    const warehouse=(await call("/api/modules/inventory/warehouses",token,"POST",{code:`WM${suffix}`,name:"Материалын тест агуулах",location:"disposable"})).item;
    const item=(await call("/api/modules/inventory/items",token,"POST",{sku:`WM-${suffix}`,name:"Материалын тест бараа",category:"Тест",unit:"ш",minimumStock:0})).item;
    await call("/api/modules/inventory/movements",token,"POST",{itemId:item.id,type:"receipt",toWarehouseId:warehouse.id,quantity:10,reference:suffix,note:"material integration"});
    const work=(await call("/api/work-orders",token,"POST",{title:`Материалын урсгал ${suffix}`,description:"disposable integration",category:"maintenance",priority:"normal"})).item;

    const requestKey=crypto.randomUUID();
    const requestPayload={inventoryItemId:item.id,quantity:4,reason:"Засварт хэрэглэх",idempotencyKey:requestKey};
    const material=(await call(`/api/work-orders/${work.id}/materials`,token,"POST",requestPayload)).item;
    const requestReplay=await call(`/api/work-orders/${work.id}/materials`,token,"POST",requestPayload);
    assert.equal(requestReplay.replayed,true);
    await call(`/api/work-orders/${work.id}/materials/${material.id}/decision`,token,"POST",{decision:"approved",approvedQuantity:4,note:"Тест баталгаа"});

    const insufficient=await raw(`/api/work-orders/${work.id}/materials/${material.id}/issue`,token,"POST",{warehouseId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID()});
    assert.equal(insufficient.response.status,409);
    assert.equal(insufficient.body.code,"INSUFFICIENT_STOCK");

    const issueKey=crypto.randomUUID();
    const issued=await call(`/api/work-orders/${work.id}/materials/${material.id}/issue`,token,"POST",{warehouseId:warehouse.id,idempotencyKey:issueKey});
    const issueReplay=await call(`/api/work-orders/${work.id}/materials/${material.id}/issue`,token,"POST",{warehouseId:warehouse.id,idempotencyKey:issueKey});
    assert.equal(issueReplay.replayed,true);
    assert.equal(issueReplay.item.id,issued.movement.id);

    const inventory=await call("/api/modules/inventory",token);
    assert.equal(Number(inventory.items.find(value=>value.id===item.id).total_quantity),6);
    assert.equal(inventory.movements.filter(value=>value.work_order_material_request_id===material.id).length,1);
    await call(`/api/work-orders/${work.id}/materials/${material.id}/consume`,token,"POST",{});
    const history=await call(`/api/work-orders/${work.id}/history`,token);
    assert.equal(history.materials.find(value=>value.id===material.id).status,"consumed");
    const evidence=await pool.query("SELECT action FROM work_order_material_events WHERE organization_id=$1 AND material_request_id=$2 ORDER BY id",[work.organization_id,material.id]);
    assert.deepEqual(evidence.rows.map(value=>value.action),["requested","approved","issued","consumed"]);
    console.log("Work-order material integration passed: request, replay, approval, insufficient-stock fail-safe, single issue, consumption, evidence.");
  }finally{await closePool()}
}

if(process.env.RUN_WORK_ORDER_MATERIAL_INTEGRATION==="1")main().catch(error=>{console.error(error);process.exitCode=1});
module.exports={main};
