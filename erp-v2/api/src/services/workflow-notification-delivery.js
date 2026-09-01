"use strict";

const {getPool,requireOrganizationId,withTenantTransaction}=require("../db");
const {validateProvider,resolveWorkflowNotificationProvider}=require("./workflow-notification-provider");

class NotificationDeliveryError extends Error{
  constructor(code,status=409){super(code);this.name="NotificationDeliveryError";this.code=code;this.status=status}
}

function boundedInteger(value,fallback,minimum,maximum){
  const number=value==null?fallback:Number(value);
  if(!Number.isInteger(number)||number<minimum||number>maximum)throw new NotificationDeliveryError("INVALID_DELIVERY_BOUND",400);
  return number;
}

function retryDelaySeconds(attempt,baseSeconds=60){
  return Math.min(86400,boundedInteger(baseSeconds,60,1,86400)*2**Math.max(0,Number(attempt)-1));
}

function safeMetadata(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const serialized=JSON.stringify(value);
  return serialized.length<=8000?value:{truncated:true};
}

async function appendEvent(client,row,eventType,providerCode,detail={}){
  await client.query(
    `INSERT INTO workflow_notification_delivery_events(
       organization_id,outbox_id,attempt_no,event_type,lease_token,provider_code,correlation_id,
       response_code,provider_message_id,error_code,error_message,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [row.organization_id,row.outbox_id,Number(row.attempt_count),eventType,row.lease_token,providerCode,
      row.correlation_id||null,String(detail.responseCode||"").slice(0,120),
      String(detail.providerMessageId||"").slice(0,240),String(detail.errorCode||"").slice(0,120),
      String(detail.errorMessage||"").slice(0,1000),JSON.stringify(safeMetadata(detail.metadata))]
  );
}

async function claimDueDeliveries({organizationId,providerCode,limit=20,leaseSeconds=60,client=null}){
  const org=requireOrganizationId(organizationId);
  const provider=String(providerCode||"").trim();
  if(!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(provider))throw new NotificationDeliveryError("INVALID_NOTIFICATION_PROVIDER",400);
  const boundedLimit=boundedInteger(limit,20,1,100),boundedLease=boundedInteger(leaseSeconds,60,5,900);
  return withTenantTransaction(org,async tx=>{
    const expired=await tx.query(
      `WITH candidates AS (
         SELECT organization_id,outbox_id FROM workflow_notification_delivery_state
          WHERE organization_id=$1 AND status='processing' AND lease_expires_at<=now()
          ORDER BY lease_expires_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE workflow_notification_delivery_state state
          SET status='retry_scheduled',next_attempt_at=now(),lease_token=NULL,lease_expires_at=NULL,
              last_error_code='LEASE_EXPIRED',updated_at=now()
         FROM candidates
        WHERE state.organization_id=candidates.organization_id AND state.outbox_id=candidates.outbox_id
       RETURNING state.organization_id,state.outbox_id,state.attempt_count,
                 candidates.outbox_id AS candidate_id`,
      [org,boundedLimit]
    );
    for(const state of expired.rows){
      const outbox=(await tx.query(
        "SELECT correlation_id FROM workflow_notification_outbox WHERE organization_id=$1 AND id=$2",
        [org,state.outbox_id]
      )).rows[0];
      // The expired token is read from the immutable claimed event so recovery
      // remains attributable even though the mutable lease projection is clear.
      const prior=(await tx.query(
        `SELECT lease_token FROM workflow_notification_delivery_events
          WHERE organization_id=$1 AND outbox_id=$2 AND attempt_no=$3 AND event_type='claimed'
          ORDER BY id DESC LIMIT 1`,[org,state.outbox_id,state.attempt_count]
      )).rows[0];
      if(prior)await appendEvent(tx,{...state,lease_token:prior.lease_token,correlation_id:outbox?.correlation_id},"lease_expired",provider,{errorCode:"LEASE_EXPIRED"});
    }
    const claimed=await tx.query(
      `WITH due AS (
         SELECT organization_id,outbox_id FROM workflow_notification_delivery_state
          WHERE organization_id=$1 AND status IN('pending','retry_scheduled') AND next_attempt_at<=now()
          ORDER BY next_attempt_at,outbox_id FOR UPDATE SKIP LOCKED LIMIT $2
       ), updated AS (
         UPDATE workflow_notification_delivery_state state
            SET status='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),
                lease_expires_at=now()+($3::text||' seconds')::interval,last_error_code='',updated_at=now()
           FROM due
          WHERE state.organization_id=due.organization_id AND state.outbox_id=due.outbox_id
         RETURNING state.*
       )
       SELECT updated.*,outbox.case_id,outbox.event_type,outbox.recipient_user_id,outbox.payload,
              outbox.correlation_id,outbox.request_id,outbox.created_at AS intent_created_at
         FROM updated JOIN workflow_notification_outbox outbox
           ON outbox.organization_id=updated.organization_id AND outbox.id=updated.outbox_id
        ORDER BY updated.next_attempt_at,updated.outbox_id`,
      [org,boundedLimit,boundedLease]
    );
    for(const row of claimed.rows)await appendEvent(tx,row,"claimed",provider);
    return claimed.rows;
  },{client});
}

async function completeDelivery({organizationId,outboxId,leaseToken,providerCode,outcome,
  responseCode="",providerMessageId="",errorCode="",errorMessage="",metadata={},
  maxAttempts=5,retryBaseSeconds=60,client=null}){
  const org=requireOrganizationId(organizationId),provider=String(providerCode||"").trim();
  if(!["delivered","failed"].includes(outcome))throw new NotificationDeliveryError("INVALID_DELIVERY_OUTCOME",400);
  const maximum=boundedInteger(maxAttempts,5,1,20),base=boundedInteger(retryBaseSeconds,60,1,86400);
  return withTenantTransaction(org,async tx=>{
    const found=await tx.query(
      `SELECT state.*,outbox.correlation_id FROM workflow_notification_delivery_state state
        JOIN workflow_notification_outbox outbox
          ON outbox.organization_id=state.organization_id AND outbox.id=state.outbox_id
       WHERE state.organization_id=$1 AND state.outbox_id=$2 FOR UPDATE`,[org,outboxId]
    );
    if(!found.rowCount)throw new NotificationDeliveryError("DELIVERY_NOT_FOUND",404);
    const row=found.rows[0];
    if(row.status==="delivered")return {status:"delivered",replayed:true,attemptCount:Number(row.attempt_count)};
    if(row.status!=="processing"||String(row.lease_token)!==String(leaseToken))throw new NotificationDeliveryError("DELIVERY_LEASE_CONFLICT");
    const detail={responseCode,providerMessageId,errorCode,errorMessage,metadata};
    if(outcome==="delivered"){
      await tx.query(
        `UPDATE workflow_notification_delivery_state SET status='delivered',delivered_at=now(),
           lease_token=NULL,lease_expires_at=NULL,last_error_code='',updated_at=now()
         WHERE organization_id=$1 AND outbox_id=$2`,[org,outboxId]
      );
      await appendEvent(tx,row,"delivered",provider,detail);
      return {status:"delivered",replayed:false,attemptCount:Number(row.attempt_count)};
    }
    const terminal=Number(row.attempt_count)>=maximum,status=terminal?"dead_letter":"retry_scheduled";
    const delay=retryDelaySeconds(row.attempt_count,base);
    await tx.query(
      `UPDATE workflow_notification_delivery_state
          SET status=$3,next_attempt_at=CASE WHEN $3='dead_letter' THEN next_attempt_at
               ELSE now()+($4::text||' seconds')::interval END,
              lease_token=NULL,lease_expires_at=NULL,last_error_code=$5,updated_at=now()
        WHERE organization_id=$1 AND outbox_id=$2`,
      [org,outboxId,status,delay,String(errorCode||"PROVIDER_ERROR").slice(0,120)]
    );
    await appendEvent(tx,row,status,provider,detail);
    return {status,replayed:false,attemptCount:Number(row.attempt_count),retryAfterSeconds:terminal?null:delay};
  },{client});
}

async function processClaim(claim,provider,options={}){
  const adapter=validateProvider(provider);
  try{
    const response=await adapter.deliver({
      idempotencyKey:String(claim.outbox_id),correlationId:claim.correlation_id,
      requestId:claim.request_id,eventType:claim.event_type,recipientUserId:claim.recipient_user_id,
      payload:claim.payload,intentCreatedAt:claim.intent_created_at,organizationId:claim.organization_id,
    });
    return completeDelivery({organizationId:claim.organization_id,outboxId:claim.outbox_id,
      leaseToken:claim.lease_token,providerCode:adapter.code,outcome:"delivered",
      responseCode:response?.responseCode,providerMessageId:response?.providerMessageId,
      metadata:response?.metadata,maxAttempts:options.maxAttempts,retryBaseSeconds:options.retryBaseSeconds});
  }catch(error){
    return completeDelivery({organizationId:claim.organization_id,outboxId:claim.outbox_id,
      leaseToken:claim.lease_token,providerCode:adapter.code,outcome:"failed",
      errorCode:error.code||"PROVIDER_ERROR",errorMessage:error.message,
      metadata:error.metadata,maxAttempts:options.maxAttempts,retryBaseSeconds:options.retryBaseSeconds});
  }
}

async function runDeliveryCycle({provider=resolveWorkflowNotificationProvider(),limitPerTenant=20,
  leaseSeconds=60,maxAttempts=5,retryBaseSeconds=60}={}){
  const adapter=validateProvider(provider);
  if(adapter.enabled===false)return {provider:adapter.code,disabled:true,claimed:0,delivered:0,failed:0};
  const organizations=await getPool().query("SELECT id FROM organizations WHERE status='active' ORDER BY id");
  const summary={provider:adapter.code,disabled:false,claimed:0,delivered:0,failed:0};
  for(const organization of organizations.rows){
    const claims=await claimDueDeliveries({organizationId:organization.id,providerCode:adapter.code,
      limit:limitPerTenant,leaseSeconds});
    summary.claimed+=claims.length;
    for(const claim of claims){
      const result=await processClaim(claim,adapter,{maxAttempts,retryBaseSeconds});
      if(result.status==="delivered")summary.delivered+=1;else summary.failed+=1;
    }
  }
  return summary;
}

module.exports={NotificationDeliveryError,retryDelaySeconds,claimDueDeliveries,completeDelivery,processClaim,runDeliveryCycle};
