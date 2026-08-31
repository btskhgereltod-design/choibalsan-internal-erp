"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),migration=fs.readFileSync(path.join(root,"migrations","0072_storekeeper_workspace_permissions.sql"),"utf8"),route=fs.readFileSync(path.join(root,"src","routes","business-modules.js"),"utf8"),users=fs.readFileSync(path.join(root,"src","routes","users.js"),"utf8"),web=fs.readFileSync(path.join(root,"..","web","business-modules.js"),"utf8"),shell=fs.readFileSync(path.join(root,"..","web","index.html"),"utf8");

test("storekeeper workspace uses live permissions instead of a legacy title",()=>{
  assert.match(migration,/inventory-custodian/);
  assert.match(migration,/inventory-observer/);
  assert.match(migration,/inventory\.read/);
  assert.match(route,/requirePermissions\("inventory\.manage"\)/);
  assert.match(route,/requireModule\("inventory"\), requirePermissions\("inventory\.read"\)/);
  assert.match(route,/reference:text\(120\),note:text\(1000\)/);
  assert.match(users,/"work-order-material-custodian", "inventory-custodian"/);
});

test("storekeeper UI preserves familiar tasks over connected OVERVA records",()=>{
  assert.match(shell,/Няравын ажлын талбар/);
  for(const label of ["Самбар","Орлого","Зарлага, олголт","Үлдэгдэл","Захиалга","Тайлан"])assert.match(web,new RegExp(label));
  assert.match(web,/ажлын захиалга болон нягтлангийн тулгалттай автоматаар холбогдоно/);
  assert.match(web,/Худалдан авалтын хүсэлт үүсгэж, батлах–захиалах–хүлээн авах урсгалаар явна/);
  assert.match(web,/data-open-procurement/);
});

test("ad-hoc issue is presented as an evidenced exception",()=>{
  assert.match(web,/Тусгай зарлага/);
  assert.match(web,/баримтын дугаар, тайлбартай ашиглана/);
  assert.match(web,/name="reference" required/);
  assert.match(web,/name="note" required/);
});
