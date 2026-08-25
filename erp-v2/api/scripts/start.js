"use strict";

require("dotenv").config();
const { migrate } = require("./migrate");
const { bootstrap } = require("./bootstrap");

async function start() {
  await migrate();
  await bootstrap();
  require("../src/server");
}

start().catch(error => {
  console.error("[startup failed]", error);
  process.exit(1);
});

