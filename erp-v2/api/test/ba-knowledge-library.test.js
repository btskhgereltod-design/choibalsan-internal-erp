"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"../..");
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");

test("reviewed BA sources are traceable and teaching examples are excluded",()=>{
  const sql=read("api/migrations/0047_ba_knowledge_library.sql");
  assert.match(sql,/CREATE TABLE ai_knowledge_sources/);
  assert.match(sql,/CREATE TABLE ai_knowledge_unit_sources/);
  for(const lesson of ["ba-lesson-1","ba-lesson-2","ba-lesson-3","ba-lesson-4","ba-lesson-5","ba-lesson-7"])assert.match(sql,new RegExp(lesson));
  assert.match(sql,/Course exercises, fictional organizations/);
  assert.match(sql,/document instructions excluded/i);
});

test("expanded method is draft and covers process plus traceability",()=>{
  const sql=read("api/migrations/0047_ba_knowledge_library.sql");
  assert.match(sql,/overva-requirements',2/);
  assert.match(sql,/"model_current_state"/);
  assert.match(sql,/"traceabilityPath"/);
  assert.match(sql,/knowledgeIsMethodNotTenantFact/);
  assert.match(sql,/,'draft'\)/);
});

test("tenant AI loads only stage-relevant governed knowledge",()=>{
  const route=read("api/src/routes/organization-blueprints.js");
  assert.match(route,/FROM ai_method_knowledge_units/);
  assert.match(route,/stage IN\('cross_cutting',\$3\)/);
  assert.match(route,/LIMIT 8/);
  assert.match(route,/knowledgeUnits:knowledge\.rows/);
});

test("platform admin can review sources and topic coverage without local paths",()=>{
  const platform=read("api/src/routes/platform.js");
  const ui=read("web/platform.js");
  assert.match(platform,/ai_knowledge_sources/);
  assert.match(platform,/ai_method_knowledge_units/);
  assert.match(ui,/aiKnowledgeSources/);
  assert.match(ui,/aiKnowledgeCoverage/);
  assert.doesNotMatch(platform,/C:\\\\Users\\\\HYDN/);
});

test("production runtime cannot mutate the governed BA knowledge library",()=>{
  const migration=read("api/scripts/production-migrate.js");
  assert.match(migration,/REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ai_knowledge_sources,ai_method_knowledge_units,ai_knowledge_unit_sources/);
});
