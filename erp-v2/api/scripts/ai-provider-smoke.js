"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");
const { askBuilderAi } = require("../src/services/openai-builder");

(async () => {
  const config = loadConfig();
  assert.equal(config.ai.enabled, true, "OPENAI_API_KEY secret is not connected");
  const catalog = {
    templates: [{ code:"general",name:"Ерөнхий байгууллага",description:"Ерөнхий эхлэх загвар",maturity:"verified",version:1 }],
    templateModules: [], templateAssets: [], templateWorkTypes: [],
    modules: [{ code:"structure",name:"Байгууллагын бүтэц",description:"Алба, албан тушаал",category:"core",core:true }],
  };
  const reply = await askBuilderAi({ config, catalog, messages:[{role:"user",content:"Энэ бол холболтын шалгалт. ERP төлөвлөгөө гаргалгүй, зорилгыг тодруулах нэг асуулт асуу."}] });
  assert.ok(reply.message);
  assert.equal(reply.proposal, null);
  console.log(`OVERVA BA AI provider smoke passed: model=${reply.model}, stage=${reply.stage}, proposal=false, response=${Boolean(reply.providerResponseId)}`);
})().catch(error => {
  console.error(`OVERVA BA AI provider smoke failed: ${error.code || error.name}: ${error.message}`);
  process.exitCode = 1;
});
