"use strict";

const { Pool } = require("pg");
const { loadConfig } = require("./config");

let pool;

function getPool() {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", error => console.error("[postgres pool]", error));
  }
  return pool;
}

async function closePool() {
  if (pool) await pool.end();
  pool = undefined;
}

module.exports = { getPool, closePool };

