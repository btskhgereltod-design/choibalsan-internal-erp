"use strict";

require("dotenv").config();
const assert=require("node:assert/strict");
const {getPool,closePool}=require("../src/db");
const {signAccessToken}=require("../src/security/token");

(async()=>{
  const pilotSlug=process.env.SMOKE_ORG_SLUG||process.env.BOOTSTRAP_ORG_SLUG;
  assert.ok(pilotSlug,"SMOKE_ORG_SLUG or BOOTSTRAP_ORG_SLUG is required");
  const user=await getPool().query(`SELECT u.id FROM users u JOIN organizations o ON o.id=u.organization_id WHERE o.slug=$1 AND u.active=true ORDER BY CASE WHEN u.role='director' THEN 0 ELSE 1 END,u.created_at LIMIT 1`,[pilotSlug]);
  assert.ok(user.rowCount,"Pilot tenant user is required");
  const response=await fetch("http://127.0.0.1:4100/api/safety/overview",{headers:{authorization:`Bearer ${signAccessToken(user.rows[0].id)}`}});
  assert.equal(response.status,200,"Safety overview must be enabled for the pilot tenant");
  const body=await response.json();
  assert.ok(body.summary&&Array.isArray(body.risks)&&Array.isArray(body.incidents)&&Array.isArray(body.briefings));
  console.log(`Safety smoke passed: ${body.risks.length} risks, ${body.incidents.length} incidents, ${body.briefings.length} briefings.`);
  await closePool();
})().catch(async error=>{console.error(error);await closePool().catch(()=>{});process.exitCode=1});
