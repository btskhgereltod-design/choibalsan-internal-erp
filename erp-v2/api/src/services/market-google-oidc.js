"use strict";

const crypto = require("node:crypto");
const { loadConfig } = require("../config");

const ISSUER = "https://accounts.google.com";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
let jwksCache = { expiresAt: 0, keys: [] };

function googleConfig() {
  const config = loadConfig().marketAuth.google;
  if (!config.enabled) throw Object.assign(new Error("Market Google login is unavailable"), { status: 503 });
  return config;
}

function codeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function authorizationUrl({ state, nonce, verifier, reauthenticate = false }) {
  const config = googleConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
    prompt: reauthenticate ? "login" : "select_account",
    ...(reauthenticate ? { max_age: "0" } : {}),
  });
  return `${AUTHORIZATION_ENDPOINT}?${params}`;
}

async function exchangeCode(code, verifier) {
  const config = googleConfig();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: config.clientId,
      client_secret: config.clientSecret, redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) throw new Error("Google authorization code exchange failed");
  return data.id_token;
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function googleKeys() {
  if (jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(JWKS_ENDPOINT, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const data = await response.json();
  const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: data.keys || [], expiresAt: Date.now() + Math.min(maxAge, 86400) * 1000 };
  return jwksCache.keys;
}

async function verifyIdToken(idToken, expectedNonce) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("Invalid Google ID token");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Google ID token");
  const key = (await googleKeys()).find(item => item.kid === header.kid && item.kty === "RSA");
  if (!key) throw new Error("Google signing key unavailable");
  const valid = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    crypto.createPublicKey({ key, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url")
  );
  const config = googleConfig();
  const audienceValid = Array.isArray(payload.aud) ? payload.aud.includes(config.clientId) : payload.aud === config.clientId;
  if (!valid || ![ISSUER, "accounts.google.com"].includes(payload.iss) || !audienceValid
    || Number(payload.exp || 0) * 1000 <= Date.now() || payload.nonce !== expectedNonce
    || !payload.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Google ID token verification failed");
  }
  return {
    issuer: ISSUER,
    subject: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    emailVerified: true,
    displayName: String(payload.name || payload.email.split("@")[0]).trim().slice(0, 120),
  };
}

module.exports = { authorizationUrl, exchangeCode, verifyIdToken };
