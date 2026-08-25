"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPlan } = require("../src/services/builder-engine");

const catalog = {
  modules: [
    { code: "core-work", core: true, active: true },
    { code: "structure", core: true, active: true },
    { code: "assets", core: false, active: true },
    { code: "work-orders", core: false, active: true },
    { code: "maintenance", core: false, active: true },
    { code: "map", core: false, active: true },
    { code: "fleet", core: false, active: true },
    { code: "iot", core: false, active: true },
  ],
  templates: [
    { code: "general", active: true, maturity: "verified" },
    { code: "municipal-infrastructure", active: true, maturity: "pilot" },
    { code: "old", active: true, maturity: "deprecated" },
  ],
  rules: [
    { code: "maintenance-needs-assets", rule_type: "dependency", subject_type: "module", subject_code: "maintenance", effect: { requiresModules: ["assets"] }, message: "needs assets", priority: 10, active: true },
    { code: "fleet-recommends-map", rule_type: "recommendation", subject_type: "module", subject_code: "fleet", effect: { recommendsModules: ["map"] }, message: "use map", priority: 50, active: true },
    { code: "iot-approval", rule_type: "requires_approval", subject_type: "module", subject_code: "iot", effect: { approval: "overva-platform" }, message: "approval needed", priority: 5, active: true },
  ],
};

test("Builder always includes core and adds deterministic dependencies", () => {
  const plan = buildPlan({ moduleCodes: ["maintenance"], profileCode: "general" }, catalog);
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.configuration.enabledModules, ["assets", "core-work", "maintenance", "structure"]);
  assert.deepEqual(plan.warnings, ["needs assets"]);
});

test("Builder does not activate approval-only module", () => {
  const plan = buildPlan({ moduleCodes: ["iot"], profileCode: "general" }, catalog);
  assert.equal(plan.valid, true);
  assert.equal(plan.configuration.enabledModules.includes("iot"), false);
  assert.deepEqual(plan.requiresApproval, [{ moduleCode: "iot", message: "approval needed" }]);
});

test("Builder preserves an already approved sensitive module", () => {
  const plan = buildPlan({ moduleCodes: [], currentEnabledModules: ["iot"], profileCode: "general" }, catalog);
  assert.equal(plan.configuration.enabledModules.includes("iot"), true);
  assert.deepEqual(plan.requiresApproval, []);
});

test("Builder reports recommendations without silently adding them", () => {
  const plan = buildPlan({ moduleCodes: ["fleet"], profileCode: "general" }, catalog);
  assert.equal(plan.configuration.enabledModules.includes("map"), false);
  assert.equal(plan.recommendations[0].recommendedModules[0], "map");
});

test("Builder rejects unknown modules and deprecated templates", () => {
  assert.equal(buildPlan({ moduleCodes: ["made-up"], profileCode: "general" }, catalog).valid, false);
  assert.equal(buildPlan({ moduleCodes: [], profileCode: "old" }, catalog).valid, false);
});

test("Pilot template is clearly marked in the plan", () => {
  const plan = buildPlan({ moduleCodes: [], profileCode: "municipal-infrastructure" }, catalog);
  assert.match(plan.warnings[0], /pilot/);
});
