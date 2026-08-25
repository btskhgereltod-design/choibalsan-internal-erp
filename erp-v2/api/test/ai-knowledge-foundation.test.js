"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname,"../..");
const read = relative => fs.readFileSync(path.join(root,relative),"utf8");

test("requirements theory is versioned and examples are not promoted as shared truth", () => {
  const sql=read("api/migrations/0046_ai_requirements_knowledge.sql");
  assert.match(sql,/CREATE TABLE ai_method_versions/);
  assert.match(sql,/status TEXT NOT NULL DEFAULT 'draft'/);
  assert.match(sql,/humanApprovalRequired/);
  assert.match(sql,/exercises and example company data excluded/);
});

test("tenant interview evidence and recommendation decisions are append-only", () => {
  const sql=read("api/migrations/0046_ai_requirements_knowledge.sql");
  const grants=read("api/scripts/production-migrate.js");
  assert.match(sql,/ai_interview_answers_immutable/);
  assert.match(sql,/ai_recommendation_feedback_immutable/);
  assert.match(grants,/ai_interview_answers,ai_recommendation_feedback/);
});

test("shared knowledge review exposes aggregates and never raw tenant evidence", () => {
  const platform=read("api/src/routes/platform.js");
  assert.match(platform,/rawTenantEvidenceExposed:false/);
  assert.match(platform,/sharedKnowledgeRequiresAnonymization:true/);
  assert.match(platform,/Anonymization must be verified before approval/);
});

test("production AI key is a Docker secret and tenant answers require confirmation", () => {
  const compose=read("docker-compose.production.yml");
  const tenantUi=read("web/organization-blueprint.js");
  assert.match(compose,/OPENAI_API_KEY_FILE: \/run\/secrets\/openai_api_key/);
  assert.match(compose,/file: \.\/secrets\/openai_api_key/);
  assert.match(tenantUi,/data-blueprint-answer-confirm/);
  assert.match(tenantUi,/data-blueprint-answer-correct/);
});
