"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"../scripts/import-legacy-assets.js"),"utf8");
const exporter=fs.readFileSync(path.join(__dirname,"../../ops/export-legacy-assets.js"),"utf8");

test("legacy asset import is tenant scoped, idempotent, and provenance preserving",()=>{
  assert.match(source,/organization_id=\$1 AND source_system=\$2 AND source_table='assets' AND source_id=\$3/);
  assert.match(source,/INSERT INTO assets\(/);
  assert.match(source,/INSERT INTO source_import_records\(/);
  assert.match(source,/INSERT INTO asset_events/);
  assert.match(source,/if\(dryRun\)await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(source,/purchase_price|current_value|book_value|password_hash/);
});

test("legacy asset export is read only and excludes credentials",()=>{
  assert.match(exporter,/sqlite3\.OPEN_READONLY/);
  assert.match(exporter,/SELECT \* FROM assets ORDER BY id/);
  assert.doesNotMatch(exporter,/password_hash|passwordHash/);
});
