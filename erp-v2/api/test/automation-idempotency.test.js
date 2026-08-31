"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const apiRoot=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(apiRoot,file),"utf8");

test("automation delivery identity is tenant-scoped, stable, and additive",()=>{
  const migration=read("migrations/0080_automation_delivery_idempotency.sql");
  const service=read("src/services/automation.js");
  assert.match(migration,/ADD COLUMN source_delivery_key TEXT/);
  assert.match(migration,/UNIQUE INDEX automation_events_source_delivery_uidx/);
  assert.match(migration,/automation_runs_rule_event_unique/);
  assert.doesNotMatch(migration,/UPDATE automation_events/);
  assert.match(service,/ON CONFLICT\(organization_id,source_delivery_key\)/);
  assert.match(service,/same_request/);
  assert.match(service,/AUTOMATION_IDEMPOTENCY_CONFLICT/);
  assert.match(service,/if\(!replayed\)/);
});

test("all consequential automation producers supply a stable delivery key",()=>{
  const workOrders=read("src/routes/work-orders.js");
  const finance=read("src/routes/finance.js");
  const iot=read("src/routes/iot.js");
  assert.match(workOrders,/sourceDeliveryKey:`work-order\.created:/);
  assert.match(finance,/sourceDeliveryKey: `finance-import\.completed:/);
  assert.match(iot,/sourceDeliveryKey:`iot-telemetry:/);
});
