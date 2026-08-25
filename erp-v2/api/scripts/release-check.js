"use strict";
require("dotenv").config();
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{getPool,closePool}=require("../src/db");
const migrationFiles=fs.readdirSync(path.join(__dirname,"..","migrations")).filter(name=>/^\d+_.+\.sql$/.test(name)).sort();
const expectedLatest=migrationFiles.at(-1).split("_")[0];
(async()=>{const pool=getPool(),[migrations,modules,orphans,people]=await Promise.all([
  pool.query(`SELECT count(*)::int AS count,max(version) AS latest FROM schema_migrations`),
  pool.query(`SELECT count(*)::int AS count FROM module_catalog WHERE active`),
  pool.query(`SELECT count(*)::int AS count FROM automation_events e WHERE (e.source_entity_type='work_order' AND NOT EXISTS(SELECT 1 FROM work_orders w WHERE w.organization_id=e.organization_id AND w.id::text=e.source_entity_id)) OR (e.source_entity_type='finance_import_job' AND NOT EXISTS(SELECT 1 FROM finance_import_jobs j WHERE j.organization_id=e.organization_id AND j.id::text=e.source_entity_id))`),
  pool.query(`SELECT count(*)::int AS count FROM users u WHERE u.person_type='employee' AND (u.employee_id IS NULL OR NOT EXISTS(SELECT 1 FROM employees e WHERE e.organization_id=u.organization_id AND e.id=u.employee_id))`)
]);assert.equal(migrations.rows[0].latest,expectedLatest);assert.equal(migrations.rows[0].count,migrationFiles.length);assert.ok(modules.rows[0].count>=22);assert.equal(orphans.rows[0].count,0);assert.equal(people.rows[0].count,0);
for(const path of ["/health","/","/finance.js","/executive.js","/integration-lab.js","/automation.js","/ai-director.js","/mobile.js","/developer-platform.js","/attendance.js","/attendance.css","/safety.js","/safety.css","/administration.js","/administration.css","/industry-profile.js","/industry-profile.css","/workspace-policy.js","/standard-workspace.js","/standard-workspace.css","/manifest.webmanifest","/service-worker.js"]){const response=await fetch(`http://web${path}`);assert.ok(response.ok,`${path}: ${response.status}`)}
console.log(`Release check passed: ${migrations.rows[0].count} migrations, ${modules.rows[0].count} modules, canonical employees linked, frontend shell and zero orphan test events.`);await closePool()})().catch(error=>{console.error(error);process.exitCode=1});
