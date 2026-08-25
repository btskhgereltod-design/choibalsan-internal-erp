"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "01234567890123456789012345678901",
  JWT_ISSUER: "issuer",
  JWT_AUDIENCE: "audience",
  CORS_ORIGINS: "http://localhost:4100, https://erp.example.mn",
};

test("configuration parses explicit CORS origins", () => {
  const config = loadConfig(base);
  assert.deepEqual(config.corsOrigins, ["http://localhost:4100", "https://erp.example.mn"]);
});

test("configuration rejects a short JWT secret", () => {
  assert.throws(() => loadConfig({ ...base, JWT_SECRET: "short" }), /Invalid OVERVA configuration/);
});

test("production configuration rejects localhost HTTP CORS", () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: "production", CORS_ORIGINS: "http://localhost:4100" }),
    /production CORS_ORIGINS/
  );
});

test("AI stays disabled unless explicitly enabled", () => {
  const disabled = loadConfig({ ...base, OPENAI_API_KEY: "sk-test-012345678901234567890123456789" });
  assert.equal(disabled.ai.enabled, false);
  const enabled = loadConfig({ ...base, AI_ENABLED: "true", OPENAI_API_KEY: "sk-test-012345678901234567890123456789" });
  assert.equal(enabled.ai.enabled, true);
});
