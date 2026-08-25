"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PRIORITY_ORDER, priorityLevel, canIssuePriority } = require("../src/services/iot-priority");

test("IoT priority is Emergency > Manual > Weather > Schedule > Default", () => {
  assert.deepEqual(PRIORITY_ORDER, ["emergency", "manual", "weather", "schedule", "default"]);
  assert.deepEqual(PRIORITY_ORDER.map(priorityLevel), [100, 80, 60, 40, 20]);
});

test("emergency commands require elevated operational authority", () => {
  assert.equal(canIssuePriority("director", "emergency"), true);
  assert.equal(canIssuePriority("chief_engineer", "emergency"), true);
  assert.equal(canIssuePriority("engineer", "emergency"), false);
  assert.equal(canIssuePriority("engineer", "manual"), true);
  assert.equal(canIssuePriority("worker", "manual"), false);
});
