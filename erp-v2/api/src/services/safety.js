"use strict";

function riskBand(score) {
  const value = Number(score);
  if (value >= 17) return "critical";
  if (value >= 10) return "high";
  if (value >= 5) return "medium";
  return "low";
}

function nextReference(prefix, sequence, date = new Date()) {
  const year = date.getUTCFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5,"0")}`;
}

module.exports = { riskBand, nextReference };
