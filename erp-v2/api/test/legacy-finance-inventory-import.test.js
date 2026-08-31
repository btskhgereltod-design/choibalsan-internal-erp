"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "migrations", "0073_legacy_finance_inventory_import.sql"), "utf8");
const exporter = fs.readFileSync(path.join(root, "scripts", "export-legacy-finance-inventory.js"), "utf8");
const importer = fs.readFileSync(path.join(root, "scripts", "import-legacy-finance-inventory.js"), "utf8");
const financeRoute = fs.readFileSync(path.join(root, "src", "routes", "finance.js"), "utf8");
const financeUi = fs.readFileSync(path.join(root, "..", "web", "finance.js"), "utf8");
const inventoryUi = fs.readFileSync(path.join(root, "..", "web", "business-modules.js"), "utf8");

test("legacy source is opened read-only and apply is explicitly guarded", () => {
  assert.match(exporter, /sqlite3\.OPEN_READONLY/);
  assert.match(importer, /ALLOW_LEGACY_FINANCE_INVENTORY_IMPORT/);
  assert.match(importer, /slug !== "choibalsan-hugjil"/);
  assert.match(importer, /if \(dryRun\) await client\.query\("ROLLBACK"\)/);
  assert.match(importer, /--refresh-imported-balances/);
  assert.doesNotMatch(importer, /DELETE FROM|TRUNCATE/i);
});

test("all imported domains retain immutable source provenance and reconcile row counts", () => {
  for (const table of ["wh_materials", "wh_transactions", "cash_journal", "accounts_payable", "accounts_receivable", "fixed_assets_ledger"]) {
    assert.match(importer, new RegExp(table));
  }
  assert.match(importer, /source_import_records/);
  assert.match(importer, /Import reconciliation failed/);
  assert.match(importer, /ON CONFLICT\(organization_id,warehouse_id,item_id\)/);
});

test("accounting fixed assets remain separate from operational objects", () => {
  assert.match(migration, /CREATE TABLE accounting_fixed_assets/);
  assert.doesNotMatch(importer, /INSERT INTO (assets|operational_objects)/);
  assert.match(financeRoute, /FROM accounting_fixed_assets/);
  assert.match(financeUi, /Үлдэгдэл өртөг/);
});

test("storekeeper sees quantity, cost, and inventory value", () => {
  assert.match(migration, /ADD COLUMN unit_cost/);
  assert.match(inventoryUi, /Нэгж өртөг/);
  assert.match(inventoryUi, /Үлдэгдлийн дүн/);
});
