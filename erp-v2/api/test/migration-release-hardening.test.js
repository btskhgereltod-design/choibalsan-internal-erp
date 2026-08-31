"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const apiRoot=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(apiRoot,file),"utf8");

test("migration runner bounds lock and statement waits",()=>{
  const runner=read("scripts/migrate.js");
  assert.match(runner,/MIGRATION_LOCK_TIMEOUT_MS/);
  assert.match(runner,/MIGRATION_STATEMENT_TIMEOUT_MS/);
  assert.match(runner,/set_config\('lock_timeout'/);
  assert.match(runner,/set_config\('statement_timeout'/);
});

test("targeted migration rehearsal is restricted to disposable databases",()=>{
  const runner=read("scripts/migrate.js");
  const integration=read("scripts/integration-test.js");
  assert.match(runner,/MIGRATION_REHEARSAL_MODE/);
  assert.match(runner,/overva_\(test\|rehearsal\)_/);
  assert.match(integration,/append-only evidence cannot be hard-deleted/);
  assert.doesNotMatch(integration,/DELETE FROM work_orders/);
});
