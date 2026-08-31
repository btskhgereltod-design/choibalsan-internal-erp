"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const migration=fs.readFileSync(path.join(root,"migrations","0070_accounting_workspace.sql"),"utf8");
const pilotEnable=fs.readFileSync(path.join(root,"migrations","0071_enable_pilot_accounting_workspace.sql"),"utf8");
const route=fs.readFileSync(path.join(root,"src","routes","finance.js"),"utf8");
const users=fs.readFileSync(path.join(root,"src","routes","users.js"),"utf8");
const inventory=fs.readFileSync(path.join(root,"src","routes","business-modules.js"),"utf8");
const web=fs.readFileSync(path.join(root,"..","web","finance.js"),"utf8");

test("accounting records are tenant scoped and evidence events are append only",()=>{
  assert.match(migration,/CREATE TABLE finance_obligations/);
  assert.match(migration,/UNIQUE\(organization_id,direction,document_no\)/);
  assert.match(migration,/finance_obligation_events_append_only/);
  assert.match(migration,/accounting_material_review_events_append_only/);
  assert.match(migration,/REFERENCES work_order_material_requests\(organization_id,id\)/);
  assert.match(migration,/REFERENCES stock_movements\(organization_id,id\)/);
});

test("accountant and storekeeper responsibilities are separated",()=>{
  assert.match(users,/role === "storekeeper"\) codes\.push\("work-order-material-custodian", "inventory-custodian"\)/);
  assert.match(users,/role === "accountant"\) codes\.push\("finance-accountant"\)/);
  assert.doesNotMatch(inventory,/"storekeeper", "accountant"/);
  assert.match(migration,/u\.role='accountant' AND r\.code='work-order-material-custodian'/);
});

test("finance API uses permission grants and governed material reconciliation",()=>{
  assert.match(route,/requirePermissions\("finance\.read"\)/);
  assert.match(route,/requirePermissions\("finance\.manage"\)/);
  assert.match(route,/requirePermissions\("finance\.reconcile"\)/);
  assert.doesNotMatch(route,/requireRoles/);
  assert.match(route,/work_order_material_request_id=mr\.id/);
  assert.match(route,/finance\.material\.reconcile/);
});

test("accountant workspace exposes legacy concepts without copying legacy balances",()=>{
  for(const label of ["Мөнгөн журнал","Өглөг","Авлага","Материалын тулгалт","Төсөв, гүйцэтгэл","Үндсэн хөрөнгө","Тайлан"]) assert.match(web,new RegExp(label));
  assert.match(web,/Хуучин ERP-ийн бодит дүнг энд автоматаар хуулалгүй/);
  assert.match(web,/баталгаажуулалгүй хуулсангүй/);
});

test("accounting workspace is enabled only for the reviewed pilot tenant",()=>{
  assert.match(pilotEnable,/slug='choibalsan-hugjil'/);
  assert.doesNotMatch(pilotEnable,/CROSS JOIN organizations/);
});
