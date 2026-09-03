"use strict";

// Read-only extractor. It emits the malformed legacy coordinates unchanged;
// normalization and validation are owned by the tenant API staging endpoint.
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();

const databasePath = process.env.LEGACY_FIBER_DB
  || path.resolve(__dirname, "..", "..", "..", "data", "app.db");
const coreColors = {
  4: "#16a34a", 6: "#0284c7", 8: "#2563eb", 12: "#ea580c",
  24: "#7c3aed", 48: "#c026d3", 96: "#475569",
};

const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
const all = (sql, parameters = []) => new Promise((resolve, reject) => {
  db.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows));
});

async function run() {
  const rows = await all(`SELECT id,name,core_count,color,length_m,geojson
    FROM fiber_routes ORDER BY id`);
  const candidates = rows.map(row => {
    const parsed = JSON.parse(row.geojson || "{}");
    const coordinates = parsed?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error(`Legacy fiber route ${row.id} has no usable LineString`);
    }
    const coreCount = Number(row.core_count || String(row.name || "").match(/(4|6|8|12|24|48|96)\s*core/i)?.[1]);
    if (!coreColors[coreCount]) throw new Error(`Legacy fiber route ${row.id} has unsupported core count`);
    return {
      sourceKey: String(row.id),
      name: String(row.name || `Legacy трасс ${row.id}`).trim(),
      coreCount,
      color: /^#[0-9a-f]{6}$/i.test(String(row.color || "")) ? row.color : coreColors[coreCount],
      sourceLengthM: Number(row.length_m || 0),
      rawCoordinates: coordinates.map(pair => [Number(pair[0]), Number(pair[1])]),
    };
  });
  process.stdout.write(JSON.stringify({
    sourceSystem: "choibalsan-legacy-erp",
    sourceReference: "legacy:data/app.db:fiber_routes",
    longitudeOffset: 5726520,
    candidates,
  }));
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => db.close());
