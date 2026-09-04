"use strict";

if(process.env.RUN_WORK_PRODUCTION_GO_INTEGRATION!=="1"){
  console.log("Set RUN_WORK_PRODUCTION_GO_INTEGRATION=1 to run");
  process.exit(0);
}

require("dotenv").config();
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const {getPool,closePool}=require("../src/db");
const {createApp}=require("../src/app");
const {signAccessToken}=require("../src/security/token");
const {provisionTenant}=require("../src/services/tenant-provisioning");

async function request(base,path,token,method="GET",body){
  const response=await fetch(`${base}${path}`,{method,headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json().catch(()=>({}))};
}

async function main(){
  const pool=getPool(),client=await pool.connect(),suffix=crypto.randomUUID().slice(0,8);
  let tenant,foreignTenant,department,workType,responsible,executor,foreignEmployee;
  try{
    const database=(await client.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database,/^overva_(test|rehearsal)_[a-z0-9_]+$/i,"Disposable rehearsal database required");
    await client.query("BEGIN");
    tenant=await provisionTenant(client,{slug:`work-go-${suffix}`,name:`Work Go ${suffix}`,adminName:"Work Go Owner",adminEmail:`owner-${suffix}@example.invalid`,adminUsername:`owner-${suffix}`,adminPassword:`Rehearsal-${suffix}-Strong-Password`,planCode:"pilot",trialDays:1,enabledModules:["work-orders"]});
    foreignTenant=await provisionTenant(client,{slug:`work-go-foreign-${suffix}`,name:`Foreign ${suffix}`,adminName:"Foreign Owner",adminEmail:`foreign-${suffix}@example.invalid`,adminUsername:`foreign-${suffix}`,adminPassword:`Rehearsal-Foreign-${suffix}-Password`,planCode:"pilot",trialDays:1,enabledModules:["work-orders"]});
    department=(await client.query("INSERT INTO departments(organization_id,code,name) VALUES($1,$2,$3) RETURNING id",[tenant.organization.id,`ELEC-${suffix}`,"Rehearsal electrical team"])).rows[0];
    responsible=(await client.query("INSERT INTO employees(organization_id,full_name,job_role,department_id) VALUES($1,$2,'electric',$3) RETURNING id",[tenant.organization.id,"Responsible Engineer",department.id])).rows[0];
    executor=(await client.query("INSERT INTO employees(organization_id,full_name,job_role,department_id) VALUES($1,$2,'worker',$3) RETURNING id",[tenant.organization.id,"Executing Worker",department.id])).rows[0];
    foreignEmployee=(await client.query("INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,$2,'worker') RETURNING id",[foreignTenant.organization.id,"Foreign Worker"])).rows[0];
    workType=(await client.query("INSERT INTO organization_work_types(organization_id,code,name,category,operational_stream) VALUES($1,$2,$3,'maintenance','core_service') RETURNING id",[tenant.organization.id,`repair-${suffix}`,"Rehearsal repair"])).rows[0];
    await client.query("INSERT INTO organization_work_type_routes(organization_id,work_type_id,organization_unit_id) VALUES($1,$2,$3)",[tenant.organization.id,workType.id,department.id]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}

  const server=createApp().listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
  const base=`http://127.0.0.1:${server.address().port}`,token=signAccessToken(tenant.owner.id);
  try{
    const crossTenant=await request(base,"/api/work-orders",token,"POST",{workTypeId:workType.id,title:"Cross tenant must fail",category:"maintenance",priority:"normal",operationalStream:"core_service",responsibleEmployeeId:foreignEmployee.id,executorEmployeeIds:[]});
    assert.equal(crossTenant.status,400);

    const created=await request(base,"/api/work-orders",token,"POST",{workTypeId:workType.id,title:"Production Go measured work",description:"Rehearsal",category:"maintenance",priority:"normal",operationalStream:"core_service",responsibleEmployeeId:responsible.id,executorEmployeeIds:[executor.id]});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const workId=created.body.item.id;
    let history=await request(base,`/api/work-orders/${workId}/history`,token);
    assert.equal(history.status,200);
    assert.deepEqual(history.body.participants.map(item=>item.participant_role),["responsible","executor"]);

    const scope=await request(base,`/api/work-orders/${workId}/scope-items`,token,"POST",{itemCode:"fault-heads",description:"Damaged heads",unit:"head",plannedQuantity:5,weight:1});
    assert.equal(scope.status,201,JSON.stringify(scope.body));
    const scopeId=scope.body.item.id;
    const progress=await request(base,`/api/work-orders/${workId}/scope-items/${scopeId}`,token,"PATCH",{completedQuantity:3,unresolvedQuantity:2,deferredQuantity:0,exceptionReason:"Material unavailable",requestException:true});
    assert.equal(progress.status,200,JSON.stringify(progress.body));

    const invalidEnd=await request(base,`/api/work-orders/${workId}/scope-items/${scopeId}/exception`,token,"POST",{decision:"accepted",note:"Invalid final close",disposition:{type:"accepted_end",reasonCode:"material_shortage",reason:"Material unavailable",idempotencyKey:crypto.randomUUID()}});
    assert.equal(invalidEnd.status,400);

    const idempotencyKey=crypto.randomUUID(),decision={decision:"accepted",note:"Return remaining work to the board",disposition:{type:"follow_up",reasonCode:"material_shortage",reason:"Material unavailable; continue when replenished",dueAt:new Date(Date.now()+86400000).toISOString(),assignedTo:null,idempotencyKey}};
    const followUp=await request(base,`/api/work-orders/${workId}/scope-items/${scopeId}/exception`,token,"POST",decision);
    assert.equal(followUp.status,200,JSON.stringify(followUp.body));
    assert.ok(followUp.body.followUpWorkOrder?.id);
    const replay=await request(base,`/api/work-orders/${workId}/scope-items/${scopeId}/exception`,token,"POST",decision);
    assert.equal(replay.status,200);
    assert.equal(replay.body.replayed,true);

    history=await request(base,`/api/work-orders/${workId}/history`,token);
    assert.equal(history.body.scopeDispositions.length,1);
    assert.equal(history.body.scopeDispositions[0].follow_up_work_order_id,followUp.body.followUpWorkOrder.id);
    const child=await request(base,`/api/work-orders/${followUp.body.followUpWorkOrder.id}/history`,token);
    assert.equal(child.status,200);
    assert.equal(child.body.scopeItems.length,1);
    assert.equal(Number(child.body.scopeItems[0].planned_quantity),2);
    assert.deepEqual(child.body.participants.map(item=>item.participant_role),["responsible","executor"]);
    assert.equal(child.body.scopeDispositions[0].source_work_order_id,workId);
    console.log(JSON.stringify({ok:true,crossTenantEmployeeBlocked:true,participants:2,measuredScope:true,invalidFinalCloseBlocked:true,followUpCreated:true,idempotentReplay:true,inheritedParticipants:2}));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await closePool();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1});
