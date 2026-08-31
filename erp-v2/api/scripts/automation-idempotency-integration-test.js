"use strict";

if(process.env.RUN_AUTOMATION_IDEMPOTENCY_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config();
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool}=require("../src/db");
  const {emitAutomationEvent}=require("../src/services/automation");

  async function main(){
    const pool=getPool();
    const databaseName=(await pool.query("SELECT current_database() AS name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)){
      throw new Error("Automation idempotency integration requires a disposable overva_test_* or overva_rehearsal_* database");
    }
    const suffix=randomUUID().slice(0,8);
    const client=await pool.connect();
    let organizationId,ruleId;
    try{
      await client.query("BEGIN");
      organizationId=(await client.query(
        "INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",
        [`Automation test ${suffix}`,`automation-test-${suffix}`]
      )).rows[0].id;
      const employeeId=(await client.query(
        "INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,'Automation owner','director') RETURNING id",
        [organizationId]
      )).rows[0].id;
      const userId=(await client.query(
        `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,employee_id)
         VALUES($1,$2,$3,'integration-only','Automation owner','director',$4) RETURNING id`,
        [organizationId,`automation-${suffix}@test.invalid`,`automation-${suffix}`,employeeId]
      )).rows[0].id;
      ruleId=(await client.query(
        `INSERT INTO automation_rules(
           organization_id,name,event_type,conditions,action_type,action_config,created_by
         ) VALUES($1,'Create one work order','manual.integration','[]'::jsonb,'create_work_order',$2::jsonb,$3)
         RETURNING id`,
        [organizationId,JSON.stringify({title:"Idempotent automation work"}),userId]
      )).rows[0].id;
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK").catch(()=>{});
      throw error;
    }finally{
      client.release();
    }

    const sourceDeliveryKey=`integration:${randomUUID()}`;
    const request={organizationId,eventType:"manual.integration",payload:{value:1},
      sourceEntityType:"integration_test",sourceEntityId:"delivery-1",sourceDeliveryKey};
    const first=await emitAutomationEvent(request);
    const replay=await emitAutomationEvent(request);
    assert.equal(replay.id,first.id);
    assert.equal(replay.replayed,true);
    await assert.rejects(
      emitAutomationEvent({...request,payload:{value:2}}),
      error=>error.code==="AUTOMATION_IDEMPOTENCY_CONFLICT"
    );
    const evidence=await pool.query(
      `SELECT
         (SELECT count(*)::int FROM automation_events WHERE organization_id=$1 AND source_delivery_key=$2) events,
         (SELECT count(*)::int FROM automation_runs WHERE organization_id=$1 AND rule_id=$3) runs,
         (SELECT count(*)::int FROM work_orders WHERE organization_id=$1 AND title='Idempotent automation work') work_orders,
         (SELECT count(*)::int FROM work_order_events e JOIN work_orders w
            ON w.organization_id=e.organization_id AND w.id=e.work_order_id
           WHERE w.organization_id=$1 AND w.title='Idempotent automation work'
             AND e.event_type='assigned' AND e.assignment_history_version=1
             AND e.assignment_operation='initial') initial_assignments`,
      [organizationId,sourceDeliveryKey,ruleId]
    );
    assert.deepEqual(evidence.rows[0],{events:1,runs:1,work_orders:1,initial_assignments:1});
    console.log("Automation idempotency integration passed: one delivery, one run, one Work Order, one initial assignment; conflicting payload rejected.");
    await closePool();
  }

  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1;});
}
