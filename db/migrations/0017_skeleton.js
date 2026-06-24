"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON — Copy this file to write a new migration.
//
// Naming: NNNN_module_description.js   (NNNN starts at 0017)
// Rules:
//   - No .catch(() => {}) — use helpers instead (tableExists, columnExists, indexExists)
//   - markApplied is automatic: up() must throw on failure so the server refuses to start
//   - Each up() must be idempotent: safe to run twice if markApplied somehow failed
//   - Never modify or delete a migration that has been applied to production
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  version: "0017",
  name:    "skeleton",
  module:  "example",          // matches the logical module (core, streetlights, …)

  /**
   * @param {{ run, all, get, tableExists, columnExists, indexExists }} helpers
   *
   * helpers.run(sql, params)              — INSERT / ALTER / CREATE (rejects on error)
   * helpers.all(sql, params)              — SELECT returning array
   * helpers.get(sql, params)              — SELECT returning single row
   * helpers.tableExists(tableName)        — resolves true/false
   * helpers.columnExists(table, column)   — resolves true/false
   * helpers.indexExists(indexName)        — resolves true/false
   */
  async up({ run, tableExists, columnExists, indexExists }) {
    // ── CREATE TABLE (idempotent via tableExists) ─────────────────────────────
    if (!await tableExists("example_records")) {
      await run(`
        CREATE TABLE example_records (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          label      TEXT    NOT NULL,
          created_by INTEGER,
          created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `);
    }

    // ── ADD COLUMN (idempotent via columnExists) ──────────────────────────────
    if (!await columnExists("users", "example_flag")) {
      await run("ALTER TABLE users ADD COLUMN example_flag INTEGER DEFAULT 0");
    }

    // ── CREATE INDEX (idempotent via indexExists) ─────────────────────────────
    if (!await indexExists("idx_example_records_label")) {
      await run("CREATE INDEX idx_example_records_label ON example_records(label)");
    }
  },
};
