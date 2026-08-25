"use strict";

const PRIORITY_LEVELS = Object.freeze({
  emergency: 100,
  manual: 80,
  weather: 60,
  schedule: 40,
  default: 20,
});

const PRIORITY_ORDER = Object.freeze(Object.keys(PRIORITY_LEVELS));

function priorityLevel(priority) {
  const level = PRIORITY_LEVELS[priority];
  if (!level) throw new Error(`Unknown IoT priority: ${priority}`);
  return level;
}

function canIssuePriority(role, priority) {
  if (priority === "emergency") return ["director", "chief_engineer"].includes(role);
  return ["director", "chief_engineer", "engineer", "electric", "camera_engineer"].includes(role);
}

module.exports = { PRIORITY_LEVELS, PRIORITY_ORDER, priorityLevel, canIssuePriority };
