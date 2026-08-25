"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { trialSchema, trialModuleCodes, reservedSlugs } = require("../src/routes/public");

const validTrial = {
  organizationName: "Example Service LLC",
  organizationCode: "example-service",
  fullName: "Trial Owner",
  email: "owner@example.invalid",
  username: "owner",
  password: "A-long-password-2026",
  modules: ["assets", "work-orders", "inventory"],
  acceptedTerms: true,
  website: "",
};

test("public trial accepts only the approved module catalog", () => {
  assert.equal(trialSchema.safeParse(validTrial).success, true);
  assert.equal(trialSchema.safeParse({ ...validTrial, modules: ["iot"] }).success, false);
  assert.equal(trialModuleCodes.includes("iot"), false);
});

test("public trial requires a strong password and explicit terms", () => {
  assert.equal(trialSchema.safeParse({ ...validTrial, password: "short" }).success, false);
  assert.equal(trialSchema.safeParse({ ...validTrial, acceptedTerms: false }).success, false);
});

test("public trial honeypot rejects automated form fills", () => {
  assert.equal(trialSchema.safeParse({ ...validTrial, website: "https://spam.invalid" }).success, false);
});

test("infrastructure and generic test slugs stay reserved", () => {
  for (const slug of ["admin", "api", "app", "demo", "test"]) assert.equal(reservedSlugs.has(slug), true);
});
