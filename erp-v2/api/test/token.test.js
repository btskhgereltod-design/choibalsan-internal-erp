"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "01234567890123456789012345678901",
  JWT_ISSUER: "overva-test",
  JWT_AUDIENCE: "overva-test-web",
});

const { signAccessToken, verifyAccessToken } = require("../src/security/token");

test("access token carries only the user subject, not caller-controlled tenant identity", () => {
  const token = signAccessToken("1a9b11e8-ea8a-46fb-89ab-1c1c4e8bf1da");
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "1a9b11e8-ea8a-46fb-89ab-1c1c4e8bf1da");
  assert.equal(payload.organization_id, undefined);
  assert.equal(payload.role, undefined);
});
