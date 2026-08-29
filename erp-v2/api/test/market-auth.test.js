"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "01234567890123456789012345678901",
  JWT_ISSUER: "overva-test",
  JWT_AUDIENCE: "overva-test-web",
  MARKET_GOOGLE_OIDC_ENABLED: "true",
  MARKET_GOOGLE_OIDC_CLIENT_ID: "market-google-client-id",
  MARKET_GOOGLE_OIDC_CLIENT_SECRET: "market-google-client-secret",
  MARKET_GOOGLE_OIDC_CALLBACK_URL: "https://api.example.test/api/market/auth/google/callback",
  MARKET_PHONE_FINGERPRINT_KEY: "market-phone-test-fingerprint-key-2026",
});

const { decryptSecret, encryptSecret, randomToken, tokenHash } = require("../src/services/market-auth");
const { normalizePhone, phoneFingerprint, phoneParts } = require("../src/services/market-phone");

test("Market auth challenge tokens are high-entropy and stored by one-way hash", () => {
  const token = randomToken();
  assert.ok(token.length >= 43);
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token), tokenHash(token));
});

test("Market OIDC challenge secrets use authenticated encryption", () => {
  const value = JSON.stringify({ verifier: randomToken(), nonce: randomToken() });
  const encrypted = encryptSecret(value);
  assert.notEqual(encrypted, value);
  assert.equal(decryptSecret(encrypted), value);
  const parts = encrypted.split(".");
  parts[2] = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => decryptSecret(parts.join(".")));
});

test("Market phone normalization and keyed fingerprint are deterministic without exposing the phone", () => {
  const phone = normalizePhone("9911-2233");
  assert.equal(phone, "+97699112233");
  assert.deepEqual(phoneParts(phone), { countryCode: "+976", lastFour: "2233" });
  assert.match(phoneFingerprint(phone), /^[a-f0-9]{64}$/);
  assert.notEqual(phoneFingerprint(phone), phone);
  assert.equal(phoneFingerprint(phone), phoneFingerprint(phone));
  assert.throws(() => normalizePhone("123"), /Valid international phone/);
});

test("Market Google OIDC verifies signature, issuer, audience, expiry, nonce, and verified email", async() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" });
  publicJwk.kid = "market-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issue = overrides => {
    const header = encode({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" });
    const payload = encode({
      iss: "https://accounts.google.com", aud: process.env.MARKET_GOOGLE_OIDC_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 300, nonce: "expected-nonce", sub: "google-subject-123",
      email: "Person@Example.Test", email_verified: true, name: "Test Person", ...overrides,
    });
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
    return `${header}.${payload}.${signature}`;
  };
  const originalFetch = global.fetch;
  global.fetch = async() => new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=60" },
  });
  try {
    const { verifyIdToken } = require("../src/services/market-google-oidc");
    const verified = await verifyIdToken(issue({}), "expected-nonce");
    assert.equal(verified.subject, "google-subject-123");
    assert.equal(verified.email, "person@example.test");
    await assert.rejects(verifyIdToken(issue({ nonce: "wrong" }), "expected-nonce"), /verification failed/);
    await assert.rejects(verifyIdToken(issue({ aud: "wrong-client" }), "expected-nonce"), /verification failed/);
    await assert.rejects(verifyIdToken(issue({ email_verified: false }), "expected-nonce"), /verification failed/);
  } finally { global.fetch = originalFetch; }
});
