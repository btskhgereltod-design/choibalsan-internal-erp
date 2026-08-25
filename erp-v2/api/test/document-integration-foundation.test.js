"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const root=path.join(__dirname,".."),read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("document foundation is versioned, tenant scoped and append-only",()=>{
  const sql=read("migrations/0035_document_and_integration_foundation.sql"),route=read("src/routes/documents.js");
  assert.match(sql,/CREATE TABLE documents/);assert.match(sql,/CREATE TABLE document_versions/);assert.match(sql,/content_sha256 CHAR\(64\)/);
  assert.match(sql,/UNIQUE\(organization_id,document_id,version_no\)/);assert.match(sql,/document_versions_append_only/);assert.match(sql,/document_lifecycle_events_append_only/);
  assert.match(route,/requirePermissions\("documents\.manage"\)/);assert.match(route,/createHash\("sha256"\)/);assert.match(route,/dispositionRequestId/);
  assert.doesNotMatch(route,/router\.delete/);assert.doesNotMatch(route,/UPDATE document_versions/);
});

test("integration contracts define mapping, retry, idempotency and dead letter controls",()=>{
  const sql=read("migrations/0035_document_and_integration_foundation.sql"),route=read("src/routes/integrations.js"),worker=read("scripts/webhook-worker.js");
  assert.match(sql,/CREATE TABLE integration_contracts/);assert.match(sql,/CREATE TABLE integration_field_mappings/);assert.match(sql,/CREATE TABLE integration_executions/);
  assert.match(sql,/idempotency_strategy/);assert.match(sql,/retry_backoff_seconds/);assert.match(sql,/dead_letter/);assert.match(sql,/integration_execution_events_append_only/);
  assert.match(route,/payloadStored:false/);assert.match(route,/idempotentReplay/);assert.match(route,/requirePermissions\("integrations\.manage"\)/);
  assert.match(worker,/attempts<max_attempts/);
});

test("webhook retry uses exponential backoff and terminal dead-letter state",()=>{
  const {retryDelaySeconds,nextFailureStatus}=require("../src/services/webhooks");
  assert.equal(retryDelaySeconds({retry_backoff_seconds:60,attempts:0}),60);
  assert.equal(retryDelaySeconds({retry_backoff_seconds:60,attempts:3}),480);
  assert.equal(retryDelaySeconds({retry_backoff_seconds:86400,attempts:3}),86400);
  assert.equal(nextFailureStatus({attempts:3,max_attempts:5}),"failed");
  assert.equal(nextFailureStatus({attempts:4,max_attempts:5}),"dead_letter");
});

test("production runtime cannot mutate immutable document or integration evidence",()=>{
  const production=read("scripts/production-migrate.js");
  assert.match(production,/document_versions,document_lifecycle_events,integration_execution_events/);
});

test("platform admin sees aggregate health but not document content or integration payloads",()=>{
  const platform=read("src/routes/platform.js"),ui=read("../web/platform.js");
  assert.match(platform,/documents_without_version/);assert.match(platform,/dead_letter_executions/);
  assert.match(ui,/Интеграц \/ dead-letter/);assert.match(ui,/Баримт \/ хувилбаргүй/);
  assert.doesNotMatch(platform,/SELECT .*storage_key/);assert.doesNotMatch(platform,/SELECT .*payload FROM integration_executions/);
});
