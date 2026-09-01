"use strict";

if(process.env.RUN_WORKFLOW_DELIVERY_INTEGRATION!=="1"){
  module.exports={};
}else{
  require("dotenv").config();
  const assert=require("node:assert/strict");
  const {randomUUID}=require("node:crypto");
  const {getPool,closePool}=require("../src/db");
  const {createWorkflowCase,addWorkflowComment}=require("../src/services/workflow-coordination");
  const {disabledProvider}=require("../src/services/workflow-notification-provider");
  const {claimDueDeliveries,completeDelivery,processClaim,runDeliveryCycle}=require("../src/services/workflow-notification-delivery");

  async function main(){
    const pool=getPool(),databaseName=(await pool.query("SELECT current_database() name")).rows[0].name;
    if(!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName))throw new Error("Workflow delivery integration requires a disposable database");
    const suffix=randomUUID().slice(0,8);
    const client=await pool.connect();let organizationId,userId;
    try{
      await client.query("BEGIN");
      organizationId=(await client.query("INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id",[`Delivery ${suffix}`,`delivery-${suffix}`])).rows[0].id;
      userId=(await client.query(`INSERT INTO users(organization_id,email,username,password_hash,full_name,role) VALUES($1,$2,$3,'test','Delivery owner','director') RETURNING id`,[organizationId,`delivery-${suffix}@test.invalid`,`delivery-${suffix}`])).rows[0].id;
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error}finally{client.release()}
    const req={user:{id:userId,organization_id:organizationId,permissions:["workflow.coordinate"]},ip:"127.0.0.1"};
    const created=await createWorkflowCase({req,workflowType:"delivery",subjectType:"fixture",subjectId:suffix,initialState:"open",idempotencyKey:"delivery-create"});
    const firstIntent=(await pool.query("SELECT * FROM workflow_notification_outbox WHERE organization_id=$1 AND case_id=$2 ORDER BY created_at,id LIMIT 1",[organizationId,created.case.id])).rows[0];
    assert.ok(firstIntent.correlation_id);assert.equal(firstIntent.request_id,"delivery-create");
    const disabled=await runDeliveryCycle({provider:disabledProvider()});
    assert.equal(disabled.disabled,true);
    assert.equal((await pool.query("SELECT status FROM workflow_notification_delivery_state WHERE organization_id=$1 AND outbox_id=$2",[organizationId,firstIntent.id])).rows[0].status,"pending");

    const sideEffects=new Map();let invocations=0;
    const provider={code:"integration",enabled:true,supportsIdempotency:true,async deliver(message){
      invocations+=1;
      if(!sideEffects.has(message.idempotencyKey))sideEffects.set(message.idempotencyKey,{providerMessageId:`msg-${sideEffects.size+1}`,responseCode:"202",metadata:{accepted:true}});
      return sideEffects.get(message.idempotencyKey);
    }};
    const firstCycle=await runDeliveryCycle({provider,limitPerTenant:5,leaseSeconds:5,maxAttempts:3,retryBaseSeconds:1});
    assert.ok(firstCycle.claimed>=1);
    assert.equal(firstCycle.delivered,firstCycle.claimed);
    assert.equal(firstCycle.failed,0);
    assert.equal((await pool.query("SELECT status FROM workflow_notification_delivery_state WHERE organization_id=$1 AND outbox_id=$2",[organizationId,firstIntent.id])).rows[0].status,"delivered");
    const deliveredInvocations=invocations,deliveredSideEffects=sideEffects.size;
    const secondCycle=await runDeliveryCycle({provider,limitPerTenant:5,leaseSeconds:5,maxAttempts:3,retryBaseSeconds:1});
    assert.equal(secondCycle.claimed,0);assert.equal(invocations,deliveredInvocations);assert.equal(sideEffects.size,deliveredSideEffects);

    await addWorkflowComment({req,caseId:created.case.id,expectedVersion:0,comment:"crash recovery",idempotencyKey:"delivery-comment-crash"});
    const crashClaim=(await claimDueDeliveries({organizationId,providerCode:provider.code,limit:1,leaseSeconds:5}))[0];
    assert.ok(crashClaim);
    await provider.deliver({idempotencyKey:String(crashClaim.outbox_id)}); // provider accepted, process crashed before DB completion
    await pool.query("UPDATE workflow_notification_delivery_state SET lease_expires_at=now()-interval '1 second' WHERE organization_id=$1 AND outbox_id=$2",[organizationId,crashClaim.outbox_id]);
    const recovered=(await claimDueDeliveries({organizationId,providerCode:provider.code,limit:1,leaseSeconds:5}))[0];
    assert.equal(recovered.outbox_id,crashClaim.outbox_id);assert.equal(Number(recovered.attempt_count),2);
    const recoveredResult=await processClaim(recovered,provider,{maxAttempts:3,retryBaseSeconds:1});
    assert.equal(recoveredResult.status,"delivered");
    assert.equal(sideEffects.size,deliveredSideEffects+1,"provider idempotency identity prevents duplicate side effects");

    await addWorkflowComment({req,caseId:created.case.id,expectedVersion:1,comment:"dead letter",idempotencyKey:"delivery-comment-fail"});
    const failingProvider={code:"integration_fail",enabled:true,supportsIdempotency:true,async deliver(){const error=new Error("unavailable");error.code="PROVIDER_UNAVAILABLE";throw error}};
    const failedFirst=(await claimDueDeliveries({organizationId,providerCode:failingProvider.code,limit:1,leaseSeconds:5}))[0];
    const retry=await processClaim(failedFirst,failingProvider,{maxAttempts:2,retryBaseSeconds:1});
    assert.equal(retry.status,"retry_scheduled");assert.equal(retry.retryAfterSeconds,1);
    await pool.query("UPDATE workflow_notification_delivery_state SET next_attempt_at=now() WHERE organization_id=$1 AND outbox_id=$2",[organizationId,failedFirst.outbox_id]);
    const failedSecond=(await claimDueDeliveries({organizationId,providerCode:failingProvider.code,limit:1,leaseSeconds:5}))[0];
    const dead=await processClaim(failedSecond,failingProvider,{maxAttempts:2,retryBaseSeconds:1});
    assert.equal(dead.status,"dead_letter");
    assert.equal((await claimDueDeliveries({organizationId,providerCode:failingProvider.code,limit:5,leaseSeconds:5})).length,0);

    const evidence=await pool.query(
      `SELECT
        (SELECT count(*)::int FROM workflow_notification_outbox WHERE organization_id=$1) intents,
        (SELECT count(*)::int FROM workflow_notification_delivery_state WHERE organization_id=$1) states,
        (SELECT count(*)::int FROM workflow_notification_delivery_state WHERE organization_id=$1 AND status='delivered') delivered,
        (SELECT count(*)::int FROM workflow_notification_delivery_state WHERE organization_id=$1 AND status='dead_letter') dead_letter,
        (SELECT count(*)::int FROM workflow_notification_delivery_events WHERE organization_id=$1 AND event_type='lease_expired') lease_expired,
        (SELECT count(*)::int FROM workflow_notification_delivery_events WHERE organization_id=$1 AND event_type='retry_scheduled') retries`,[organizationId]
    );
    assert.deepEqual(evidence.rows[0],{intents:3,states:3,delivered:2,dead_letter:1,lease_expired:1,retries:1});
    await assert.rejects(pool.query("UPDATE workflow_notification_delivery_events SET error_code='tampered' WHERE organization_id=$1",[organizationId]));
    await assert.rejects(pool.query("DELETE FROM workflow_notification_outbox WHERE organization_id=$1",[organizationId]));
    const replay=await completeDelivery({organizationId,outboxId:firstIntent.id,leaseToken:randomUUID(),providerCode:provider.code,outcome:"delivered"});
    assert.equal(replay.replayed,true);
    console.log("Workflow notification delivery integration passed: disabled safety, idempotent delivery, leases, crash recovery, bounded retry, dead-letter and immutable evidence verified.");
    await closePool();
  }

  main().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
}
