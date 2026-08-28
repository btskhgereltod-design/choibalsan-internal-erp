"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {analyzeOrganizationEvidence}=require("../src/services/organization-evidence");

const catalog=[
  {code:"core-finance",name:"Санхүү ба бүртгэл",signals:["finance","accounting"],recommended_modules:["finance"]},
  {code:"inventory-procurement",name:"Агуулах ба худалдан авалт",signals:["inventory","warehouse","procurement"],recommended_modules:["inventory"]},
  {code:"technology",name:"Мэдээллийн технологи",signals:["it","devices","digital"],recommended_modules:[]}
];

test("organization evidence produces traceable capability proposals",()=>{
  const result=analyzeOrganizationEvidence({
    content:"Агуулахын барааны үлдэгдлийг Excel системд гараар бүртгэдэг. Санхүүгийн орлого зарлагыг өдөр бүр хянана.",
    catalog,activeModules:["finance","inventory"]
  });
  const inventory=result.find(item=>item.capabilityCode==="inventory-procurement");
  const finance=result.find(item=>item.capabilityCode==="core-finance");
  assert.equal(inventory.proposedDisposition,"integrate");
  assert.match(inventory.evidenceExcerpt,/Excel/);
  assert.equal(inventory.findingKind,"current_system");
  assert.equal(finance.proposedDisposition,"native");
  assert.ok(finance.confidence>=.69&&finance.confidence<=.92);
});

test("unsubstantiated capabilities are not proposed",()=>{
  const result=analyzeOrganizationEvidence({content:"Манай байгууллагын ерөнхий танилцуулга энд байна.",catalog,activeModules:["finance"]});
  assert.deepEqual(result,[]);
});

test("evidence, findings, proposals and reviews are tenant scoped and append-only",()=>{
  const root=path.join(__dirname,".."),sql=fs.readFileSync(path.join(root,"migrations/0053_organization_evidence_capability_map.sql"),"utf8");
  const route=fs.readFileSync(path.join(root,"src/routes/organization-blueprints.js"),"utf8");
  const production=fs.readFileSync(path.join(root,"scripts/production-migrate.js"),"utf8");
  for(const table of ["organization_evidence_sources","organization_evidence_findings","organization_capability_proposals","organization_capability_reviews"]){
    assert.match(sql,new RegExp(`CREATE TABLE ${table}`));
    assert.match(sql,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql,/organization_capability_reviews_append_only/);
  assert.match(sql,/decision IN\('accepted','corrected','rejected'\)/);
  assert.match(route,/WHERE organization_id=\$1 AND id=\$2/);
  assert.match(route,/organization\.evidence_analyzed/);
  assert.match(route,/organization\.capability_review/);
  assert.doesNotMatch(route,/capability-proposals[\s\S]*UPDATE (departments|positions|organization_modules)/);
  assert.match(production,/organization_evidence_sources,organization_evidence_findings,organization_capability_proposals,organization_capability_reviews/);
});
