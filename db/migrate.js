"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Чойбалсан хөгжил ERP — Migration runner
//
// USAGE (library):
//   const { runMigrations } = require("./db/migrate");
//   await runMigrations({ run, all, get });   // call from server.js initDb()
//
// USAGE (CLI):
//   node db/migrate.js --baseline   mark 0001-0016 as applied, no SQL executed
//   node db/migrate.js --status     show applied migrations
//   node db/migrate.js              run pending migrations (0017+)
//
// HOW TO ADD A NEW MIGRATION:
//   1. Create db/migrations/NNNN_module_name.js (NNNN ≥ 0017)
//   2. Export { version, name, module, async up(helpers) }
//   3. Use helpers.columnExists / tableExists / indexExists — no .catch() needed
//   4. markApplied is called automatically only if up() resolves without error
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");
const fs   = require("fs");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Baseline: server.js-д бичигдсэн 0001–0016 migration-ийн тэмдэглэл.
// Эдгээр нь production DB дээр аль хэдийн бэлэн байгаа тул дахин ажиллахгүй —
// зөвхөн schema_migrations table-д "applied" гэж бүртгэгдэнэ.
const BASELINE_VERSIONS = [
  { version: "0001", name: "core_users",   module: "core"         },
  { version: "0002", name: "operations",   module: "operations"   },
  { version: "0003", name: "safety",       module: "safety"       },
  { version: "0004", name: "vehicles",     module: "vehicles"     },
  { version: "0005", name: "plans",        module: "plans"        },
  { version: "0006", name: "finance",      module: "finance"      },
  { version: "0007", name: "warehouse",    module: "warehouse"    },
  { version: "0008", name: "assets",       module: "assets"       },
  { version: "0009", name: "documents",    module: "documents"    },
  { version: "0010", name: "hr_extended",  module: "hr"           },
  { version: "0011", name: "org_settings", module: "org"          },
  { version: "0012", name: "streetlights", module: "streetlights" },
  { version: "0013", name: "meters",       module: "meters"       },
  { version: "0014", name: "iot",          module: "iot"          },
  { version: "0015", name: "ai_assistant", module: "ai"           },
  { version: "0016", name: "chat_reports", module: "chat"         },
];

// ── schema_migrations table ───────────────────────────────────────────────────

async function ensureMigrationsTable(run) {
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      version    TEXT    NOT NULL UNIQUE,
      name       TEXT    NOT NULL,
      module     TEXT    NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
}

async function getApplied(all) {
  const rows = await all("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(rows.map(r => r.version));
}

// Called only after migration.up() resolves without error.
async function markApplied(run, migration) {
  await run(
    "INSERT OR IGNORE INTO schema_migrations (version, name, module) VALUES (?,?,?)",
    [migration.version, migration.name, migration.module]
  );
}

// ── Schema helpers (passed into each migration's up() function) ───────────────
// Table names are always developer-supplied constants — never user input.

async function tableExists(get, tableName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return !!row;
}

// PRAGMA table_info does not accept bound parameters in sqlite3; table name
// must be interpolated. Only call with developer-controlled string literals.
async function columnExists(all, tableName, columnName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return rows.some(r => r.name === columnName);
}

async function indexExists(get, indexName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
    [indexName]
  );
  return !!row;
}

// ── Load migration files from db/migrations/ ─────────────────────────────────

function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{4}_.*\.js$/.test(f))
    .sort()
    .map(f => {
      // eslint-disable-next-line import/no-dynamic-require
      const m = require(path.join(MIGRATIONS_DIR, f));
      if (!m.version || !m.name || !m.module || typeof m.up !== "function") {
        throw new Error(`[migrate] Invalid migration file: ${f} — missing version/name/module/up`);
      }
      return m;
    });
}

// ── Main runner ───────────────────────────────────────────────────────────────
// Import and call from server.js initDb() once server.js migration block
// is ready to be removed. Until then this is a no-op (all files are 0017+
// which don't exist yet, so the loop never executes).

async function runMigrations({ run, all, get }) {
  await ensureMigrationsTable(run);
  const applied = await getApplied(all);
  const files   = loadMigrationFiles();

  const helpers = {
    run,
    all,
    get,
    tableExists:  (table)        => tableExists(get, table),
    columnExists: (table, col)   => columnExists(all, table, col),
    indexExists:  (index)        => indexExists(get, index),
  };

  let count = 0;
  for (const migration of files) {
    if (applied.has(migration.version)) continue;

    console.log(`[migrate] Running ${migration.version}_${migration.name} ...`);
    await migration.up(helpers);          // error here → propagates → server won't start
    await markApplied(run, migration);    // only reached if up() succeeded
    console.log(`[migrate] Applied  ${migration.version}_${migration.name}`);
    count++;
  }

  if (count > 0) {
    console.log(`[migrate] ${count} migration(s) applied.`);
  }
}

// ── Baseline command ──────────────────────────────────────────────────────────
// Run ONCE on the existing production database BEFORE deploying the new runner.
// Marks 0001–0016 as applied without executing any SQL.
// After this, only migrations 0017+ will ever be executed by runMigrations().

async function runBaseline({ run, all }) {
  await ensureMigrationsTable(run);
  const applied = await getApplied(all);

  let inserted = 0;
  let skipped  = 0;
  for (const m of BASELINE_VERSIONS) {
    if (applied.has(m.version)) {
      console.log(`[baseline] ${m.version} ${m.name} — already marked, skipping`);
      skipped++;
      continue;
    }
    await markApplied(run, m);
    console.log(`[baseline] Marked  ${m.version} ${m.name}`);
    inserted++;
  }

  console.log(`\n[baseline] Done. inserted=${inserted} skipped=${skipped}`);
  console.log("[baseline] Production DB is now baseline-tracked. Deploy new migrations from 0017 onwards.");
}

module.exports = { runMigrations, runBaseline, ensureMigrationsTable };

// ── CLI entry point ───────────────────────────────────────────────────────────
// node db/migrate.js [--baseline | --status]

if (require.main === module) {
  const sqlite3 = require("sqlite3").verbose();
  const DB_PATH = path.join(__dirname, "..", "data", "app.db");

  const dbConn = new sqlite3.Database(DB_PATH, err => {
    if (err) {
      console.error("[migrate] Cannot open database:", err.message);
      process.exit(1);
    }
  });

  // Same promise wrappers as db.js so the same helpers work in both contexts.
  const cliRun = (sql, params = []) => new Promise((resolve, reject) =>
    dbConn.run(sql, params, function(err) {
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes });
    })
  );
  const cliAll = (sql, params = []) => new Promise((resolve, reject) =>
    dbConn.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
  );
  const cliGet = (sql, params = []) => new Promise((resolve, reject) =>
    dbConn.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );

  const cliHelpers = { run: cliRun, all: cliAll, get: cliGet };
  const args = process.argv.slice(2);

  async function main() {
    if (args.includes("--baseline")) {
      await runBaseline(cliHelpers);

    } else if (args.includes("--status")) {
      await ensureMigrationsTable(cliRun);
      const rows = await cliAll(
        "SELECT version, name, module, applied_at FROM schema_migrations ORDER BY version"
      );
      if (!rows.length) {
        console.log("[status] No migrations recorded. Run --baseline first on existing DB.");
        return;
      }
      console.log(`[status] ${rows.length} migration(s) applied:\n`);
      rows.forEach(r =>
        console.log(`  ${r.version}  ${r.module.padEnd(14)} ${r.name.padEnd(22)} ${r.applied_at}`)
      );

    } else {
      await runMigrations(cliHelpers);
    }
  }

  main()
    .catch(err => {
      console.error("[migrate] Fatal:", err.message);
      process.exit(1);
    })
    .finally(() => dbConn.close());
}
