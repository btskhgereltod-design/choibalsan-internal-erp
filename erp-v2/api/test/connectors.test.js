"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  provider, publicCatalog, encryptToken, decryptToken, authorizationUrl,
} = require("../src/services/connectors");

function config(overrides = {}) {
  return {
    connectors: {
      callbackBaseUrl: "https://api.overva.test",
      appUrl: "https://app.overva.test",
      encryptionKey: "test-only-connector-key-that-is-at-least-32-characters",
      providers: {
        google: { clientId: "google-client-id", clientSecret: "google-client-secret" },
        github: { clientId: "github-client-id", clientSecret: "github-client-secret" },
      },
      ...overrides,
    },
  };
}

test("connector catalog starts with three explicit read-only providers", () => {
  const items = publicCatalog(config());
  assert.deepEqual(items.map(item => item.code), ["google-drive", "google-sheets", "github"]);
  assert.equal(items.every(item => item.available), true);
  assert.equal(items.some(item => item.capability.startsWith("read_only")), true);
  assert.equal(provider("unknown"), null);
});

test("catalog remains visible but unavailable when provider secrets are absent", () => {
  const items = publicCatalog(config({ encryptionKey: null }));
  assert.equal(items.length, 3);
  assert.equal(items.every(item => item.available === false), true);
});

test("connector tokens are authenticated-encrypted and tampering is rejected", () => {
  const secret = config().connectors.encryptionKey;
  const value = { access_token: "private-token", refresh_token: "private-refresh", expires_in: 3600 };
  const encrypted = encryptToken(value, secret);
  assert.equal(encrypted.includes("private-token"), false);
  assert.deepEqual(decryptToken(encrypted, secret), value);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => decryptToken(tampered, secret));
});

test("OAuth authorization URLs use provider callback and least-privilege scopes", () => {
  const google = new URL(authorizationUrl(provider("google-sheets"), config(), "state-value"));
  assert.equal(google.origin, "https://accounts.google.com");
  assert.equal(google.searchParams.get("redirect_uri"), "https://api.overva.test/api/connectors/oauth/google-sheets/callback");
  assert.match(google.searchParams.get("scope"), /spreadsheets\.readonly/);
  assert.doesNotMatch(google.searchParams.get("scope"), /spreadsheets(?!\.readonly)/);

  const github = new URL(authorizationUrl(provider("github"), config(), "state-value"));
  assert.equal(github.searchParams.get("scope"), "read:user");
});

test("connector routes never return token ciphertext and scope tenant queries", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/routes/connectors.js"), "utf8");
  assert.match(source, /WHERE organization_id=\$1/);
  assert.match(source, /requirePermissions\("connectors\.manage"\)/);
  assert.doesNotMatch(source, /res\.json\([^\n]*token_ciphertext/);
  assert.match(source, /token_ciphertext=''/);
});

test("public Home exposes a real catalog route instead of creating a workspace", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../public-site/index.html"), "utf8");
  const browser = fs.readFileSync(path.join(__dirname, "../../public-site/site.js"), "utf8");
  const publicRoute = fs.readFileSync(path.join(__dirname, "../src/routes/public.js"), "utf8");
  assert.match(html, /id="homeConnectorsButton"/);
  assert.match(html, /id="workspaceConnectorsButton"/);
  assert.match(html, /id="publicConnectorGrid"/);
  assert.match(browser, /fetch\("\/api\/public\/connectors"/);
  assert.match(browser, /workspaceConnectorsButton/);
  assert.match(browser, /https:\/\/app\.overva\.com\/\?view=connectors/);
  assert.doesNotMatch(browser, /homeConnectorsButton[^\n]+beginWorkspaceFromHome/);
  assert.match(publicRoute, /router\.get\("\/connectors"/);
});
