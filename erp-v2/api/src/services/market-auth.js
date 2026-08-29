"use strict";

const crypto = require("node:crypto");
const { getPool } = require("../db");
const { loadConfig } = require("../config");
const { signMarketToken } = require("../security/token");
const { subjectHash, writeMarketAudit } = require("./market-identity");

const SESSION_HOURS = 8;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function encryptSecret(value) {
  const key = crypto.createHash("sha256").update(loadConfig().JWT_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(item => item.toString("base64url")).join(".");
}

function decryptSecret(value) {
  const [iv, tag, ciphertext] = String(value).split(".").map(item => Buffer.from(item, "base64url"));
  const key = crypto.createHash("sha256").update(loadConfig().JWT_SECRET).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function createMarketSession({ client = getPool(), identityId, authMethod, req }) {
  const identity = await client.query(
    "SELECT id FROM market_identities WHERE id=$1 AND active=true FOR UPDATE",
    [identityId]
  );
  if (!identity.rowCount) {
    throw Object.assign(new Error("Market identity is inactive"), { code: "MARKET_IDENTITY_INACTIVE" });
  }
  const userAgent = String(req?.headers?.["user-agent"] || "");
  const result = await client.query(
    `INSERT INTO market_sessions
       (market_identity_id,auth_method,user_agent_hash,ip_address,expires_at)
     VALUES($1,$2,$3,$4,now()+$5*interval '1 hour') RETURNING id,expires_at`,
    [identityId, authMethod, userAgent ? subjectHash(userAgent) : null, req?.ip || null, SESSION_HOURS]
  );
  const session = result.rows[0];
  await writeMarketAudit({
    client, marketIdentityId: identityId, marketSessionId: session.id,
    actorType: "market_identity", actorIdentityId: identityId,
    eventType: "market.auth.session.created", outcome: "success",
    detail: { authMethod, expiresAt: session.expires_at }, ipAddress: req?.ip || null,
  });
  return { session, token: signMarketToken(identityId, session.id) };
}

async function revokeMarketSessions({ client = getPool(), identityId, sessionId = null, reason, req }) {
  const result = await client.query(
    `UPDATE market_sessions SET revoked_at=now(),revocation_reason=$3
      WHERE market_identity_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id=$2)
      RETURNING id`,
    [identityId, sessionId, reason]
  );
  for (const session of result.rows) {
    await writeMarketAudit({
      client, marketIdentityId: identityId, marketSessionId: session.id,
      actorType: "market_identity", actorIdentityId: identityId,
      eventType: "market.auth.session.revoked", outcome: "success",
      detail: { reason }, ipAddress: req?.ip || null,
    });
  }
  return result.rowCount;
}

async function createAuthChallenge({ client = getPool(), identityId = null, purpose, email = null,
  secret = null, detail = {}, lifetimeMinutes = 20, req }) {
  if (identityId) {
    await client.query("SELECT id FROM market_identities WHERE id=$1 FOR UPDATE", [identityId]);
    await client.query(
      `UPDATE market_auth_challenges SET consumed_at=now()
        WHERE market_identity_id=$1 AND purpose=$2 AND consumed_at IS NULL`,
      [identityId, purpose]
    );
  }
  const token = randomToken();
  const result = await client.query(
    `INSERT INTO market_auth_challenges
       (market_identity_id,purpose,token_hash,email_snapshot,secret_ciphertext,detail,requested_ip,expires_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now()+$8*interval '1 minute') RETURNING id,expires_at`,
    [identityId, purpose, tokenHash(token), email?.trim().toLowerCase() || null,
      secret ? encryptSecret(secret) : null, JSON.stringify(detail), req?.ip || null, lifetimeMinutes]
  );
  return { token, ...result.rows[0] };
}

async function consumeAuthChallenge({ client = getPool(), token, purpose }) {
  const result = await client.query(
    `UPDATE market_auth_challenges SET consumed_at=now()
      WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now()
      RETURNING *`,
    [tokenHash(token), purpose]
  );
  return result.rows[0] || null;
}

async function deliverMarketEmail({ to, template, link }) {
  const config = loadConfig().marketAuth;
  if (!config.email.enabled) return false;
  const response = await fetch(config.email.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.email.token}` },
    body: JSON.stringify({ from: config.email.from, to, template, variables: { link } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("MARKET_EMAIL_DELIVERY_FAILED");
  return true;
}

module.exports = {
  consumeAuthChallenge,
  createAuthChallenge,
  createMarketSession,
  decryptSecret,
  encryptSecret,
  deliverMarketEmail,
  randomToken,
  revokeMarketSessions,
  tokenHash,
};
