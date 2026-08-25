"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("governance catalog separates master, reference and transaction data",()=>{
  const sql=read("migrations/0036_governance_catalog_and_quality.sql");
  assert.match(sql,/data_kind IN \('master','reference','transaction'\)/);
  assert.match(sql,/CREATE TABLE data_dictionary_elements/);
  assert.match(sql,/critical_data_element BOOLEAN/);
  assert.match(sql,/CREATE TABLE data_lineage_edges/);
  assert.match(sql,/CREATE TABLE kpi_catalog/);
});

test("data quality evidence is measurable, tenant scoped and append-only",()=>{
  const sql=read("migrations/0036_governance_catalog_and_quality.sql"),production=read("scripts/production-migrate.js");
  assert.match(sql,/CREATE TABLE data_quality_measurements/);
  assert.match(sql,/records_checked BIGINT/);
  assert.match(sql,/pass_percent NUMERIC/);
  assert.match(sql,/outcome IN \('pass','warning','fail'\)/);
  assert.match(sql,/data_quality_measurements_append_only/);
  assert.match(sql,/data_quality_measurements_tenant_policy/);
  assert.match(production,/data_quality_measurements/);
});

test("platform admin receives definitions and aggregate readiness only",()=>{
  const route=read("src/routes/platform.js"),ui=read("../web/platform.js");
  assert.match(route,/dictionary_elements/);
  assert.match(route,/kpi_templates/);
  assert.match(route,/quality_failures/);
  assert.match(ui,/OVERVA стандарт өгөгдлийн сан/);
  assert.match(ui,/Data Dictionary \/ CDE/);
  assert.doesNotMatch(route,/SELECT .*evidence FROM data_quality_measurements/);
  assert.doesNotMatch(route,/SELECT .*business_name FROM data_dictionary_elements/);
});
