"use strict";

module.exports = {
  version: "0017",
  name: "iot_recovery_state",
  module: "iot",

  async up({ run, tableExists, indexExists }) {
    if (!await tableExists("iot_recovery_state")) {
      await run(`
        CREATE TABLE iot_recovery_state (
          dev_eui           TEXT PRIMARY KEY,
          schedule_category TEXT,
          desired_action    TEXT,
          attempt_count     INTEGER NOT NULL DEFAULT 0,
          last_attempt_at   TEXT,
          last_observed_at  TEXT,
          last_error        TEXT,
          updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        )
      `);
    }

    if (!await indexExists("idx_iot_recovery_state_updated_at")) {
      await run("CREATE INDEX idx_iot_recovery_state_updated_at ON iot_recovery_state(updated_at)");
    }
  },
};
