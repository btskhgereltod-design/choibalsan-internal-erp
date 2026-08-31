"use strict";

const path = require("node:path");
const sqlite3 = require("../../../node_modules/sqlite3");

const dbPath = path.resolve(__dirname, "../../../data/app.db");
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const all = (sql) => new Promise((resolve, reject) => db.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));

async function main() {
  const [materials, movements, cash, payables, receivables, fixedAssets] = await Promise.all([
    all("SELECT * FROM wh_materials ORDER BY id"),
    all("SELECT * FROM wh_transactions ORDER BY id"),
    all("SELECT * FROM cash_journal ORDER BY id"),
    all("SELECT * FROM accounts_payable ORDER BY id"),
    all("SELECT * FROM accounts_receivable ORDER BY id"),
    all("SELECT * FROM fixed_assets_ledger ORDER BY id"),
  ]);
  const payload = JSON.stringify({
    format: "overva.legacy-finance-inventory.v1",
    sourceSystem: "choibalsan-legacy-erp",
    materials,
    movements,
    cash,
    payables,
    receivables,
    fixedAssets,
  });
  process.stdout.write(process.argv.includes("--base64") ? Buffer.from(payload, "utf8").toString("base64") : payload);
}

main().then(() => db.close()).catch((error) => {
  console.error(error.message);
  db.close();
  process.exitCode = 1;
});
