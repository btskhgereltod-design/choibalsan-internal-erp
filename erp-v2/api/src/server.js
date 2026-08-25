"use strict";

require("dotenv").config();
const { createApp } = require("./app");
const { loadConfig } = require("./config");
const { closePool } = require("./db");

const config = loadConfig();
const server = createApp().listen(config.API_PORT, "0.0.0.0", () => {
  console.log(`OVERVA API listening on 0.0.0.0:${config.API_PORT}`);
});

async function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", error => {
  console.error("[unhandledRejection]", error);
  shutdown("unhandledRejection");
});
