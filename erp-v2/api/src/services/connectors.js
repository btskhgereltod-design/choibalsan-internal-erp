"use strict";

const crypto = require("node:crypto");

const PROVIDERS = Object.freeze({
  "google-drive": Object.freeze({
    code: "google-drive",
    name: "Google Drive",
    category: "Файл ба өгөгдөл",
    description: "Drive дахь сонгосон файл, хавтасны мэдээллийг уншина.",
    capability: "read_only",
    oauthFamily: "google",
    scopes: Object.freeze([
      "openid", "email", "profile",
      "https://www.googleapis.com/auth/drive.readonly",
    ]),
  }),
  "google-sheets": Object.freeze({
    code: "google-sheets",
    name: "Google Sheets",
    category: "Файл ба өгөгдөл",
    description: "Google хүснэгтийн бүтэц, муж болон утгыг зөвхөн уншина.",
    capability: "read_only",
    oauthFamily: "google",
    scopes: Object.freeze([
      "openid", "email", "profile",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ]),
  }),
  github: Object.freeze({
    code: "github",
    name: "GitHub",
    category: "Хөгжүүлэлт",
    description: "Хэрэглэгчийн таних мэдээлэл болон нийтэд нээлттэй repository-г уншина.",
    capability: "read_only_public",
    oauthFamily: "github",
    scopes: Object.freeze(["read:user"]),
  }),
});

function provider(code) {
  return PROVIDERS[String(code || "").toLowerCase()] || null;
}

function providerConfigured(item, config) {
  if (!item || !config?.connectors?.callbackBaseUrl || !config.connectors.encryptionKey) return false;
  const credentials = config.connectors.providers[item.oauthFamily];
  return Boolean(credentials?.clientId && credentials?.clientSecret);
}

function publicCatalog(config) {
  return Object.values(PROVIDERS).map(item => ({
    code: item.code,
    name: item.name,
    category: item.category,
    description: item.description,
    capability: item.capability,
    scopes: [...item.scopes],
    available: providerConfigured(item, config),
  }));
}

function encryptionKey(secret) {
  if (!secret || String(secret).length < 32) throw new Error("Connector encryption key is not configured");
  return crypto.createHash("sha256").update(String(secret), "utf8").digest();
}

function encryptToken(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptToken(value, secret) {
  const [version, iv, tag, ciphertext, extra] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error("Invalid encrypted connector token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function callbackUrl(item, config) {
  return `${config.connectors.callbackBaseUrl}/api/connectors/oauth/${encodeURIComponent(item.code)}/callback`;
}

function authorizationUrl(item, config, state) {
  if (!providerConfigured(item, config)) throw new Error("Энэ холболтын OAuth тохиргоо хараахан бэлэн болоогүй байна");
  const credentials = config.connectors.providers[item.oauthFamily];
  if (item.oauthFamily === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: credentials.clientId,
      redirect_uri: callbackUrl(item, config),
      response_type: "code",
      scope: item.scopes.join(" "),
      state,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
    });
    return url.toString();
  }
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl(item, config),
    scope: item.scopes.join(" "),
    state,
  });
  return url.toString();
}

async function fetchJson(url, options, label) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${label} (${response.status})`);
    error.code = "CONNECTOR_PROVIDER_ERROR";
    throw error;
  }
  return body;
}

async function exchangeAuthorizationCode(item, config, code) {
  const credentials = config.connectors.providers[item.oauthFamily];
  if (item.oauthFamily === "google") {
    return fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: callbackUrl(item, config),
        grant_type: "authorization_code",
      }),
    }, "Google OAuth token exchange failed");
  }
  return fetchJson("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "OVERVA-Connect/1.0" },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: callbackUrl(item, config),
    }),
  }, "GitHub OAuth token exchange failed");
}

async function externalIdentity(item, token) {
  const headers = { authorization: `Bearer ${token.access_token}` };
  if (item.oauthFamily === "google") {
    const profile = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", { headers }, "Google profile lookup failed");
    return { id: String(profile.sub), name: String(profile.email || profile.name || profile.sub) };
  }
  headers.accept = "application/vnd.github+json";
  headers["x-github-api-version"] = "2022-11-28";
  headers["user-agent"] = "OVERVA-Connect/1.0";
  const profile = await fetchJson("https://api.github.com/user", { headers }, "GitHub profile lookup failed");
  return { id: String(profile.id), name: String(profile.login || profile.name || profile.id) };
}

function grantedScopes(item, token) {
  const raw = token.scope || token.scopes;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string" && raw.trim()) return raw.split(/[ ,]+/).filter(Boolean);
  return [...item.scopes];
}

function tokenExpiry(token) {
  const seconds = Number(token.expires_in || 0);
  return seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

async function listResources(item, token) {
  const headers = { authorization: `Bearer ${token.access_token}` };
  if (item.code === "google-drive") {
    const query = new URLSearchParams({ pageSize: "25", orderBy: "modifiedTime desc", q: "trashed = false", fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))" });
    const body = await fetchJson(`https://www.googleapis.com/drive/v3/files?${query}`, { headers }, "Google Drive list failed");
    return (body.files || []).map(file => ({ id: file.id, name: file.name, type: file.mimeType, updatedAt: file.modifiedTime, url: file.webViewLink || null }));
  }
  if (item.code === "google-sheets") {
    const query = new URLSearchParams({ pageSize: "25", orderBy: "modifiedTime desc", q: "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" });
    const body = await fetchJson(`https://www.googleapis.com/drive/v3/files?${query}`, { headers }, "Google Sheets list failed");
    return (body.files || []).map(file => ({ id: file.id, name: file.name, type: "spreadsheet", updatedAt: file.modifiedTime, url: file.webViewLink || null }));
  }
  headers.accept = "application/vnd.github+json";
  headers["x-github-api-version"] = "2022-11-28";
  headers["user-agent"] = "OVERVA-Connect/1.0";
  const body = await fetchJson("https://api.github.com/user/repos?per_page=25&sort=updated&visibility=public", { headers }, "GitHub repository list failed");
  return body.map(repo => ({ id: String(repo.id), name: repo.full_name, type: "repository", updatedAt: repo.updated_at, url: repo.html_url }));
}

module.exports = {
  PROVIDERS, provider, providerConfigured, publicCatalog,
  encryptToken, decryptToken, authorizationUrl, exchangeAuthorizationCode,
  externalIdentity, grantedScopes, tokenExpiry, listResources,
};
