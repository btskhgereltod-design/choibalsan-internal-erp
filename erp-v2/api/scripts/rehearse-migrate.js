"use strict";

const fs = require("node:fs");

const databaseName = String(process.env.REHEARSAL_DATABASE_NAME || "").trim();
if (process.env.MIGRATION_REHEARSAL_MODE !== "1"
  || !/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)) {
  throw new Error("A disposable overva_test_* or overva_rehearsal_* database is required");
}

const sourceFile = process.env.DATABASE_URL_FILE;
if (!sourceFile) throw new Error("DATABASE_URL_FILE is required");
const databaseUrl = new URL(fs.readFileSync(sourceFile, "utf8").trim());
databaseUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = databaseUrl.toString();
delete process.env.DATABASE_URL_FILE;

if (process.env.REHEARSAL_REFRESH_RUNTIME_GRANTS === "1") {
  require("./production-migrate");
} else {
  const { migrate } = require("./migrate");
  const { closePool } = require("../src/db");
  migrate().then(closePool).catch(error => {
    console.error("[migration rehearsal failed]", error);
    process.exitCode = 1;
  });
}
