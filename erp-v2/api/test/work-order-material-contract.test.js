"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");

test("migration keeps material request, issue, and evidence distinct",()=>{
  const sql=fs.readFileSync(path.join(root,"migrations/0065_work_order_material_trace.sql"),"utf8");
  assert.match(sql,/CREATE TABLE work_order_material_requests/);
  assert.match(sql,/CREATE TABLE work_order_material_events/);
  assert.match(sql,/work_order_material_events_append_only/);
  assert.match(sql,/stock_movements_tenant_idempotency_idx/);
  assert.match(sql,/work_order_material_request_id/);
  for(const permission of ["work-orders.material.request","work-orders.material.approve","work-orders.material.issue","work-orders.material.consume"]){
    assert.match(sql,new RegExp(permission.replaceAll(".","\\.")));
  }
});

test("issue endpoint locks balance and decrements only after approval",()=>{
  const source=fs.readFileSync(path.join(root,"src/routes/work-orders.js"),"utf8");
  const issue=source.slice(source.indexOf('router.post("/:id/materials/:materialId/issue"'),source.indexOf('router.post("/:id/materials/:materialId/consume"'));
  assert.match(issue,/idempotency_key=\$2 FOR UPDATE/);
  assert.match(issue,/inventory_balances[\s\S]+FOR UPDATE/);
  assert.match(issue,/canTransitionMaterial\(current\.status,"issued"\)/);
  assert.match(issue,/quantity=quantity-\$4/);
  assert.match(issue,/INSUFFICIENT_STOCK/);
  assert.match(issue,/current\.status==="issued"[\s\S]+concurrentReplay/);
  assert.doesNotMatch(issue,/purchase_requests|procurement/);
});

test("material APIs and queries retain server-derived tenant scope",()=>{
  const work=fs.readFileSync(path.join(root,"src/routes/work-orders.js"),"utf8");
  const inventory=fs.readFileSync(path.join(root,"src/routes/business-modules.js"),"utf8");
  assert.match(work,/WHERE organization_id=\$1 AND work_order_id=\$2 AND id=\$3 FOR UPDATE/);
  assert.match(inventory,/mr\.organization_id=\$1 AND mr\.status='approved'/);
  assert.doesNotMatch(work,/req\.body\.organizationId|req\.body\.organization_id/);
});

test("clean bootstrap uses canonical tenant provisioning",()=>{
  const bootstrap=fs.readFileSync(path.join(root,"scripts/bootstrap.js"),"utf8");
  assert.match(bootstrap,/require\("\.\.\/src\/services\/tenant-provisioning"\)/);
  assert.match(bootstrap,/provisionTenant\(client,/);
  assert.doesNotMatch(bootstrap,/INSERT INTO organizations/);
});
