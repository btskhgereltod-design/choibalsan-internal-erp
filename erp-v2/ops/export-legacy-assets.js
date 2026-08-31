"use strict";

const path = require("node:path");
const sqlite3 = require(path.resolve(__dirname, "../../node_modules/sqlite3")).verbose();

const databasePath = process.env.LEGACY_DB_PATH || path.resolve(__dirname, "../../data/app.db");
const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);

db.all("SELECT * FROM assets ORDER BY id", (error, assets) => {
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    const payload = JSON.stringify({
      format: "overva.legacy-assets.v1",
      sourceSystem: "choibalsan-legacy-demo",
      assets,
    });
    process.stdout.write(process.argv.includes("--base64") ? Buffer.from(payload, "utf8").toString("base64") : payload);
  }
  db.close();
});
