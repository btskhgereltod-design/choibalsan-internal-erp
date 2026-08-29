"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const docsRoot = path.join(__dirname, "..", "..", "docs");

test("Market, Platform, and OVERVA Apps remain separate governed roles", () => {
  const contract = fs.readFileSync(path.join(docsRoot, "MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md"), "utf8");
  const groupModel = fs.readFileSync(path.join(docsRoot, "OVERVA_GROUP_OPERATING_MODEL_V1.md"), "utf8");
  const decisions = fs.readFileSync(path.join(docsRoot, "DECISIONS.md"), "utf8");
  const architecture = fs.readFileSync(path.join(docsRoot, "ARCHITECTURE.md"), "utf8");
  const currentState = fs.readFileSync(path.join(docsRoot, "CURRENT_STATE.md"), "utf8");

  assert.match(decisions, /D-023 — Separate the Platform, Market operator, and OVERVA Apps vendor arm/);
  assert.match(decisions, /D-024 — OVERVA Group has three peer operating roles/);
  assert.match(groupModel, /three peer operating roles/);
  assert.match(groupModel, /OVERVA Group[\s\S]*not a shared tenant/);
  assert.match(groupModel, /OVERVA Apps is a vendor, not a Platform administrator and not a Market operator/);
  assert.match(groupModel, /Product market:[\s\S]*apps, modules, connectors, templates, and AI agents/);
  assert.match(groupModel, /Market governance:[\s\S]*dispute resolution/);
  assert.match(contract, /It is a Market participant, not the Market\s+operator/);
  assert.match(contract, /ranking benefit/);
  assert.match(contract, /without first completing Platform discovery/);
  assert.match(contract, /separate storage and\s+authorization boundaries/);
  assert.match(contract, /must never receive:[\s\S]*unpublished competitor listings or proposals/);
  assert.match(architecture, /market\.overva\.com[\s\S]*not yet a deployed production application/);
  assert.match(currentState, /not a claim that a separate[\s\S]*Market backend/);
});
