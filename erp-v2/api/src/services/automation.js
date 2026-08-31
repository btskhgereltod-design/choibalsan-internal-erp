"use strict";

const {getPool}=require("../db");
const {queueWebhookEvent}=require("./webhooks");
const {recordInitialAssignment}=require("./work-order-assignment");

function valueAt(value,path){
  return String(path||"").split(".").filter(Boolean).reduce((x,k)=>x==null?undefined:x[k],value);
}

function matches(payload,conditions){
  return (conditions||[]).every(c=>{
    const a=valueAt(payload,c.field),b=c.value;
    if(c.operator==="eq")return String(a)===String(b);
    if(c.operator==="neq")return String(a)!==String(b);
    if(c.operator==="gte")return Number(a)>=Number(b);
    if(c.operator==="lte")return Number(a)<=Number(b);
    if(c.operator==="contains")return String(a??"").includes(String(b));
    return false;
  });
}

async function execute(client,org,rule,event){
  const cfg=rule.action_config||{};
  if(rule.action_type==="notification"){
    const roles=Array.isArray(cfg.roles)&&cfg.roles.length?cfg.roles:["director"];
    const users=await client.query(
      `SELECT id FROM users WHERE organization_id=$1 AND active=true AND role=ANY($2::text[])`,
      [org,roles]
    );
    for(const user of users.rows)await client.query(
      `INSERT INTO notifications(organization_id,user_id,type,title,message,entity_type,entity_id)
       VALUES($1,$2,'automation_alert',$3,$4,$5,$6)`,
      [org,user.id,String(cfg.title||rule.name).slice(0,250),
        String(cfg.message||`Automation: ${event.event_type}`).slice(0,1000),
        event.source_entity_type||"automation",event.source_entity_id||event.id]
    );
    return {notified:users.rowCount};
  }
  if(rule.action_type==="create_work_order"){
    const result=await client.query(
      `INSERT INTO work_orders(organization_id,title,description,category,priority,status,created_by)
       VALUES($1,$2,$3,$4,$5,'new',$6) RETURNING id`,
      [org,String(cfg.title||rule.name).slice(0,300),
        String(cfg.description||`Автоматаар үүссэн: ${event.event_type}`).slice(0,5000),
        String(cfg.category||"Автомат хяналт").slice(0,100),
        ["low","normal","high","emergency"].includes(cfg.priority)?cfg.priority:"normal",rule.created_by]
    );
    await client.query(
      `INSERT INTO work_order_events(organization_id,work_order_id,actor_user_id,event_type,to_status,detail)
       VALUES($1,$2,$3,'created','new',$4::jsonb)`,
      [org,result.rows[0].id,rule.created_by,JSON.stringify({
        source:"automation",automationEventId:event.id,automationRuleId:rule.id,
      })]
    );
    await recordInitialAssignment(client,{
      organizationId:org,workOrderId:result.rows[0].id,actorUserId:rule.created_by,
      assignee:null,status:"new",source:"system",reason:`Automation event ${event.id}`,
    });
    return {workOrderId:result.rows[0].id};
  }
  throw new Error("Unsupported action");
}

function automationConflict(){
  const error=new Error("Source delivery key was already used for another automation payload");
  error.code="AUTOMATION_IDEMPOTENCY_CONFLICT";
  return error;
}

async function emitAutomationEvent({
  organizationId,eventType,payload={},sourceEntityType="",sourceEntityId="",
  sourceDeliveryKey=null,
}){
  const client=await getPool().connect();
  let event,replayed=false;
  try{
    await client.query("BEGIN");
    const inserted=await client.query(
      `INSERT INTO automation_events(
         organization_id,event_type,payload,source_entity_type,source_entity_id,source_delivery_key
       ) VALUES($1,$2,$3::jsonb,$4,$5,$6)
       ON CONFLICT(organization_id,source_delivery_key)
         WHERE source_delivery_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [organizationId,eventType,JSON.stringify(payload),sourceEntityType,sourceEntityId,sourceDeliveryKey]
    );
    if(!inserted.rowCount){
      const existing=await client.query(
        `SELECT e.*,
           (e.event_type=$3 AND e.payload=$4::jsonb
             AND e.source_entity_type=$5 AND e.source_entity_id=$6) AS same_request
           FROM automation_events e
          WHERE e.organization_id=$1 AND e.source_delivery_key=$2`,
        [organizationId,sourceDeliveryKey,eventType,JSON.stringify(payload),sourceEntityType,sourceEntityId]
      );
      if(!existing.rowCount||!existing.rows[0].same_request)throw automationConflict();
      event=existing.rows[0];
      delete event.same_request;
      replayed=true;
      await client.query("COMMIT");
    }else{
      event=inserted.rows[0];
      const rules=await client.query(
        `SELECT * FROM automation_rules
          WHERE organization_id=$1 AND event_type=$2 AND active=true ORDER BY created_at`,
        [organizationId,eventType]
      );
      for(const rule of rules.rows){
        if(!matches(payload,rule.conditions)){
          await client.query(
            `INSERT INTO automation_runs(organization_id,rule_id,event_id,status,result)
             VALUES($1,$2,$3,'skipped',$4)`,
            [organizationId,rule.id,event.id,{reason:"conditions"}]
          );
          continue;
        }
        try{
          const result=await execute(client,organizationId,rule,event);
          await client.query(
            `INSERT INTO automation_runs(organization_id,rule_id,event_id,status,result)
             VALUES($1,$2,$3,'completed',$4)`,
            [organizationId,rule.id,event.id,result]
          );
        }catch(error){
          await client.query(
            `INSERT INTO automation_runs(organization_id,rule_id,event_id,status,error_message)
             VALUES($1,$2,$3,'failed',$4)`,
            [organizationId,rule.id,event.id,String(error.message).slice(0,1000)]
          );
        }
      }
      await client.query("COMMIT");
    }
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
  if(!replayed){
    await queueWebhookEvent(organizationId,eventType,{eventId:event.id,...payload})
      .catch(error=>console.error("[webhook]",error));
  }
  return replayed?{...event,replayed:true}:event;
}

module.exports={emitAutomationEvent,matches};
