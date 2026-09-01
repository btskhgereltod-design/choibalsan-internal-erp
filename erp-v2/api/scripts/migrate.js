"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getPool, closePool } = require("../src/db");

// The first local 0079 artifact was applied before the release copy was
// corrected and hashed. Keep that applied checksum as evidence; 0081 performs
// an explicit, idempotent schema reconciliation. No other checksum drift is
// accepted here.
const RECONCILED_LEGACY_MIGRATIONS = new Map([
  [
    "0079:0079_work_order_assignment_write_guard.sql",
    new Set(["5c67374512217eec036f8f2d46830d3635863e07e95ea0a3c75fd10d66357d33"]),
  ],
]);

function isReconciledLegacyMigration({ version, filename, appliedChecksum }) {
  return RECONCILED_LEGACY_MIGRATIONS
    .get(`${version}:${filename}`)
    ?.has(String(appliedChecksum || "").trim()) === true;
}

function boundedMilliseconds(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum} milliseconds`);
  }
  return value;
}

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();
  const lockTimeoutMs = boundedMilliseconds("MIGRATION_LOCK_TIMEOUT_MS", 15_000, 1_000, 120_000);
  const statementTimeoutMs = boundedMilliseconds("MIGRATION_STATEMENT_TIMEOUT_MS", 300_000, 10_000, 1_800_000);
  try {
    await client.query("SELECT set_config('lock_timeout',$1,false)", [`${lockTimeoutMs}ms`]);
    await client.query("SELECT set_config('statement_timeout',$1,false)", [`${statementTimeoutMs}ms`]);
    await client.query("SELECT pg_advisory_lock($1)", [9042026]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT,
      checksum CHAR(64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename TEXT");
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum CHAR(64)");
    const directory = path.join(__dirname, "..", "migrations");
    let files = fs.readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
    const rehearsalTarget = String(process.env.MIGRATION_REHEARSAL_TARGET_VERSION || "").trim();
    if (rehearsalTarget) {
      if (process.env.MIGRATION_REHEARSAL_MODE !== "1" || !/^\d{4}$/.test(rehearsalTarget)) {
        throw new Error("MIGRATION_REHEARSAL_TARGET_VERSION requires MIGRATION_REHEARSAL_MODE=1 and a four-digit version");
      }
      const databaseName = (await client.query("SELECT current_database() AS name")).rows[0].name;
      if (!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)) {
        throw new Error("Targeted migration is allowed only on an overva_test_* or overva_rehearsal_* database");
      }
      files = files.filter(file => file.split("_")[0] <= rehearsalTarget);
      console.log(`[migration rehearsal] target=${rehearsalTarget} database=${databaseName}`);
    }
    const versions = files.map(file => file.split("_")[0]);
    const duplicateVersions = versions.filter((version, index) => versions.indexOf(version) !== index);
    if (duplicateVersions.length) {
      throw new Error(`Duplicate migration versions: ${[...new Set(duplicateVersions)].join(", ")}`);
    }
    for (const file of files) {
      const version = file.split("_")[0];
      const sql = fs.readFileSync(path.join(directory, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const exists = await client.query(
        "SELECT filename,checksum FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (exists.rowCount) {
        const applied = exists.rows[0];
        // Older releases briefly had two different files with version 0026.
        // A legacy marker records that ambiguity without pretending we know
        // which file checksum was applied. Later idempotent migrations repair
        // and verify the required schema explicitly.
        if (applied.filename?.startsWith("legacy:")) continue;
        if (applied.filename && applied.filename !== file) {
          throw new Error(`Migration ${version} was applied as ${applied.filename}, not ${file}`);
        }
        if (applied.checksum && applied.checksum.trim() !== checksum) {
          if (!isReconciledLegacyMigration({
            version,
            filename:file,
            appliedChecksum:applied.checksum,
          })) {
            throw new Error(`Applied migration changed: ${file}`);
          }
          console.warn(`[migration reconciliation] preserving known legacy checksum for ${file}; 0081 verifies and repairs the schema`);
          continue;
        }
        if (!applied.filename || !applied.checksum) {
          await client.query(
            "UPDATE schema_migrations SET filename=$2,checksum=$3 WHERE version=$1",
            [version, file, checksum]
          );
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('lock_timeout',$1,true)", [`${lockTimeoutMs}ms`]);
        await client.query("SELECT set_config('statement_timeout',$1,true)", [`${statementTimeoutMs}ms`]);
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version,filename,checksum) VALUES ($1,$2,$3)",
          [version, file, checksum]
        );
        await client.query("COMMIT");
        console.log(`[migration] applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [9042026]).catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  migrate().then(closePool).catch(error => {
    console.error("[migration failed]", error);
    process.exitCode = 1;
  });
}

module.exports = { migrate, isReconciledLegacyMigration };
