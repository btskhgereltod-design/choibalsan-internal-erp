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

test("Market recovery, Google login, and SMS verification remain fail-closed", () => {
  const disabled = loadConfig(base);
  assert.equal(disabled.marketAuth.email.enabled, false);
  assert.equal(disabled.marketAuth.google.enabled, false);
  assert.equal(disabled.marketAuth.sms.enabled, false);
  assert.throws(
    () => loadConfig({ ...base, MARKET_EMAIL_ENABLED: "true" }),
    /enabled Market email requires endpoint, token, and sender/
  );
  assert.throws(
    () => loadConfig({ ...base, MARKET_GOOGLE_OIDC_ENABLED: "true" }),
    /enabled Market Google OIDC requires client and callback configuration/
  );
  assert.throws(
    () => loadConfig({ ...base, MARKET_SMS_ENABLED: "true" }),
    /enabled Market SMS requires endpoint, token, sender, and phone fingerprint key/
  );
  assert.throws(
    () => loadConfig({
      ...base,
      MARKET_SMS_ENABLED: "true",
      MARKET_SMS_ENDPOINT: "https://sms.example.test/send",
      MARKET_SMS_TOKEN: "__MARKET_SMS_TOKEN_NOT_CONFIGURED__",
      MARKET_SMS_SENDER: "OVERVA",
      MARKET_PHONE_FINGERPRINT_KEY: "__MARKET_PHONE_FINGERPRINT_KEY_NOT_CONFIGURED__",
    }),
    /enabled Market SMS requires endpoint, token, sender, and phone fingerprint key/
  );
  const sms = loadConfig({
    ...base,
    MARKET_SMS_ENABLED: "true",
    MARKET_SMS_ENDPOINT: "https://sms.example.test/send",
    MARKET_SMS_TOKEN: "sms-test-token",
    MARKET_SMS_SENDER: "OVERVA",
    MARKET_PHONE_FINGERPRINT_KEY: "market-phone-test-fingerprint-key-2026",
  });
  assert.equal(sms.marketAuth.sms.enabled, true);
});
