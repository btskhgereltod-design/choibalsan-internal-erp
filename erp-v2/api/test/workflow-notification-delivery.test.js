"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {retryDelaySeconds}=require("../src/services/workflow-notification-delivery");
const {disabledProvider,validateProvider}=require("../src/services/workflow-notification-provider");

test("outbox intent, mutable projection and append-only delivery evidence stay separate",()=>{
  const sql=read("migrations/0084_workflow_notification_delivery.sql");
  assert.match(sql,/CREATE TABLE workflow_notification_delivery_state/);
  assert.match(sql,/CREATE TABLE workflow_notification_delivery_events/);
  assert.match(sql,/workflow_notification_delivery_events_append_only/);
  assert.match(sql,/AFTER INSERT ON workflow_notification_outbox/);
  assert.doesNotMatch(sql,/UPDATE workflow_notification_outbox|DELETE FROM workflow_notification_outbox/);
});

test("delivery uses lease-safe claims, crash recovery, bounded retry and terminal dead-letter",()=>{
  const service=read("src/services/workflow-notification-delivery.js");
  assert.match(service,/FOR UPDATE SKIP LOCKED/);
  assert.match(service,/LEASE_EXPIRED/);
  assert.match(service,/DELIVERY_LEASE_CONFLICT/);
  assert.match(service,/dead_letter/);
  assert.equal(retryDelaySeconds(1,60),60);
  assert.equal(retryDelaySeconds(4,60),480);
  assert.equal(retryDelaySeconds(30,86400),86400);
});

test("no provider is safe-disabled and enabled adapters must promise idempotency",()=>{
  const disabled=disabledProvider();
  assert.equal(disabled.enabled,false);
  assert.throws(()=>validateProvider({code:"unsafe",enabled:true,supportsIdempotency:false,deliver(){}}),/NOTIFICATION_PROVIDER_IDEMPOTENCY_REQUIRED/);
  assert.equal(validateProvider({code:"safe",enabled:true,supportsIdempotency:true,deliver(){}}).code,"safe");
});

test("runtime cannot mutate delivery evidence or delete the delivery projection",()=>{
  const production=read("scripts/production-migrate.js");
  assert.match(production,/workflow_notification_delivery_events/);
  assert.match(production,/REVOKE DELETE,TRUNCATE ON workflow_notification_delivery_state/);
});
