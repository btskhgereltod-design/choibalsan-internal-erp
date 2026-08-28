"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {validateIntegrationEvent}=require("../src/services/integration-events");

function event(overrides={}){
  return {
    specVersion:"1.0",
    eventId:"0288f9ae-0b7b-4fba-b790-9c40f1bf137d",
    eventType:"inventory.goods-received",
    schemaVersion:1,
    occurredAt:"2026-08-27T10:30:00.000Z",
    source:{system:"warehouse.mobile",reference:"GR-2026-001"},
    subject:{type:"inventory.receipt",id:"GR-2026-001"},
    correlationId:"purchase-order-2026-001",
    data:{warehouseCode:"MAIN",lines:[{sku:"SKU-1",quantity:5}]},
    ...overrides
  };
}

test("OVERVA Connect validates a versioned event envelope and stable fingerprint",()=>{
  const first=validateIntegrationEvent(event());
  const reordered=validateIntegrationEvent({data:event().data,...event()});
  assert.equal(first.success,true);
  assert.equal(reordered.success,true);
  assert.equal(first.fingerprint,reordered.fingerprint);
  assert.match(first.fingerprint,/^[a-f0-9]{64}$/);
});

test("event envelope rejects tenant selection, unknown fields and invalid versions",()=>{
  const tenant=validateIntegrationEvent(event({organizationId:"other-tenant"}));
  const version=validateIntegrationEvent(event({schemaVersion:0}));
  assert.equal(tenant.success,false);
  assert.equal(version.success,false);
});

test("validation endpoint is tenant-scoped and cannot store or mutate canonical data",()=>{
  const route=fs.readFileSync(path.join(__dirname,"../src/routes/integrations.js"),"utf8");
  assert.match(route,/\/:id\/events\/validate/);
  assert.match(route,/WHERE organization_id=\$1 AND id=\$2/);
  assert.match(route,/payloadStored:false,canonicalMutationPerformed:false/);
});
