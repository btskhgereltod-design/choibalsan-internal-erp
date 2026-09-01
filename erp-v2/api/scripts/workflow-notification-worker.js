"use strict";

require("dotenv").config();
const fs=require("node:fs");
const {closePool}=require("../src/db");
const {runDeliveryCycle}=require("../src/services/workflow-notification-delivery");
const {resolveWorkflowNotificationProvider}=require("../src/services/workflow-notification-provider");

function bounded(name,fallback,minimum,maximum){
  const value=process.env[name]==null?fallback:Number(process.env[name]);
  if(!Number.isInteger(value)||value<minimum||value>maximum)throw new Error(`${name} must be ${minimum}-${maximum}`);
  return value;
}

let stopping=false;
const interval=bounded("WORKFLOW_NOTIFICATION_WORKER_INTERVAL_MS",30000,5000,60000);

async function cycle(){
  const provider=resolveWorkflowNotificationProvider();
  const result=await runDeliveryCycle({provider,
    limitPerTenant:bounded("WORKFLOW_NOTIFICATION_BATCH_SIZE",20,1,100),
    leaseSeconds:bounded("WORKFLOW_NOTIFICATION_LEASE_SECONDS",60,5,900),
    maxAttempts:bounded("WORKFLOW_NOTIFICATION_MAX_ATTEMPTS",5,1,20),
    retryBaseSeconds:bounded("WORKFLOW_NOTIFICATION_RETRY_BASE_SECONDS",60,1,86400),
  });
  fs.writeFileSync("/tmp/workflow-notification-worker-heartbeat",String(Date.now()));
  return result;
}

async function run(){
  const provider=resolveWorkflowNotificationProvider();
  console.log(`[workflow-notification-worker] provider=${provider.code} enabled=${provider.enabled} interval=${interval}ms`);
  while(!stopping){
    try{await cycle()}catch(error){console.error("[workflow-notification-worker]",{code:error.code,message:error.message})}
    await new Promise(resolve=>setTimeout(resolve,interval));
  }
  await closePool();
}

if(require.main===module){
  process.on("SIGTERM",()=>{stopping=true});
  process.on("SIGINT",()=>{stopping=true});
  run().catch(error=>{console.error(error);process.exitCode=1});
}

module.exports={cycle};
