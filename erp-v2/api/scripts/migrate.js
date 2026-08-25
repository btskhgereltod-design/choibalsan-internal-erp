"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getPool, closePool } = require("../src/db");

async function migrate() {
  const pool = getPool();
  const client = await pool.connect();
  try {
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
    const files = fs.readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
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
          throw new Error(`Applied migration changed: ${file}`);
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

module.exports = { migrate };
