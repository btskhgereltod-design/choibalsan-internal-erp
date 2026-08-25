"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { riskBand, nextReference } = require("../src/services/safety");

test("safety risk matrix maps likelihood times severity to standard bands", () => {
  assert.equal(riskBand(1), "low");
  assert.equal(riskBand(5), "medium");
  assert.equal(riskBand(10), "high");
  assert.equal(riskBand(17), "critical");
  assert.equal(riskBand(25), "critical");
});

test("safety references are stable and tenant sequence friendly", () => {
  assert.equal(nextReference("RSK", 12, new Date("2026-08-20T00:00:00Z")), "RSK-2026-00012");
});
