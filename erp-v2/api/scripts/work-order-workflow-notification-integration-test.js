"use strict";

if (process.env.RUN_WORK_ORDER_WORKFLOW_NOTIFICATION_INTEGRATION !== "1") {
  module.exports = {};
} else {
  require("dotenv").config();
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {createApp}=require("../src/app");
  const {getPool,closePool}=require("../src/db");
  const {signAccessToken}=require("../src/security/token");
  const {provisionTenant}=require("../src/services/tenant-provisioning");

  async function main(){
    const pool=getPool();
    const databaseName=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)){
      throw new Error("Work Order workflow notification integration requires a disposable database");
    }
    const suffix=randomUUID().slice(0,8);
    const client=await pool.connect();
    let fixture;
    try{
      await client.query("BEGIN");
      fixture=await provisionTenant(client,{
        slug:`workflow-notification-${suffix}`,name:`Workflow notification ${suffix}`,
        adminName:"Workflow creator",adminEmail:`creator-${suffix}@test.invalid`,
        adminUsername:`creator-${suffix}`,adminPassword:`Disposable-${suffix}-Pass!`,
        enabledModules:["work-orders"],trialDays:1,
      });
      const reviewer=(await client.query(`INSERT INTO users(
          organization_id,email,username,password_hash,full_name,role
        ) VALUES($1,$2,$3,'integration-only','Safety reviewer','safety') RETURNING id`,[
        fixture.organization.id,`reviewer-${suffix}@test.invalid`,`reviewer-${suffix}`,
      ])).rows[0];
      await client.query(`INSERT INTO user_roles(organization_id,user_id,role_id)
        SELECT $1,$2,id FROM organization_roles
        WHERE organization_id=$1 AND code='work-order-safety-reviewer'`,[
        fixture.organization.id,reviewer.id,
      ]);
      const policy=(await client.query(`INSERT INTO organization_workflow_policies(
          organization_id,code,name,config
        ) VALUES($1,'notification-regression','Notification regression',
          '{"startSafetyPermission":"work-orders.workflow.safety"}'::jsonb) RETURNING id`,[
        fixture.organization.id,
      ])).rows[0];
      const workType=(await client.query(`INSERT INTO organization_work_types(
          organization_id,code,name,category
        ) VALUES($1,'notification-regression','Notification regression','test') RETURNING id`,[
        fixture.organization.id,
      ])).rows[0];
      await client.query(`INSERT INTO organization_work_type_routes(
          organization_id,work_type_id,workflow_policy_id
        ) VALUES($1,$2,$3)`,[fixture.organization.id,workType.id,policy.id]);
      await client.query("COMMIT");
      fixture={...fixture,reviewer,workType};
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      throw error;
    }finally{client.release()}

    const server=createApp().listen(0,"127.0.0.1");
    await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject)});
    try{
      const {port}=server.address();
      const response=await fetch(`http://127.0.0.1:${port}/api/work-orders`,{
        method:"POST",
        headers:{"content-type":"application/json",authorization:`Bearer ${signAccessToken(fixture.owner.id)}`},
        body:JSON.stringify({
          workTypeId:fixture.workType.id,title:"Workflow notification regression",
          description:"Disposable integration evidence",category:"test",priority:"normal",
        }),
      });
      const body=await response.json();
      assert.equal(response.status,201,JSON.stringify(body));
      const notification=await pool.query(`SELECT type,entity_id FROM notifications
        WHERE organization_id=$1 AND user_id=$2 AND entity_id=$3`,[
        fixture.organization.id,fixture.reviewer.id,body.item.id,
      ]);
      assert.deepEqual(notification.rows,[{type:"work_order_workflow",entity_id:body.item.id}]);
      await pool.query(`INSERT INTO notifications(
        organization_id,user_id,type,title,message,entity_id
      ) VALUES($1,$2,'work_order_returned','Return regression','', $3)`,[
        fixture.organization.id,fixture.reviewer.id,body.item.id,
      ]);
      console.log("Work Order workflow notification integration passed: creation returned 201 and both workflow notification types satisfy the database constraint.");
    }finally{
      await new Promise(resolve=>server.close(resolve));
      await closePool();
    }
  }

  main().catch(async error=>{
    console.error(error);
    await closePool().catch(()=>{});
    process.exitCode=1;
  });
}
