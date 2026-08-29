"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_SECRET: "01234567890123456789012345678901",
  JWT_ISSUER: "overva-test",
  JWT_AUDIENCE: "overva-test-web",
});

const apiRoot = path.join(__dirname, "..");
const repoRoot = path.join(apiRoot, "..");
const readApi = file => fs.readFileSync(path.join(apiRoot, file), "utf8");
const readRepo = file => fs.readFileSync(path.join(repoRoot, file), "utf8");
const { signAccessToken, signPlatformToken, signMarketToken, verifyAccessToken } = require("../src/security/token");
const { activeMembershipTypes, canSelectParticipantView } = require("../src/services/market-identity");

test("Market token is an explicit third authentication kind", () => {
  const identityId = "5c696cb4-c34b-4c5b-b059-c24e9a3c2962";
  assert.equal(verifyAccessToken(signMarketToken(identityId)).kind, "market");
  assert.equal(verifyAccessToken(signMarketToken(identityId)).sub, identityId);
  assert.equal(verifyAccessToken(signPlatformToken(identityId)).kind, "platform");
  assert.equal(verifyAccessToken(signAccessToken(identityId)).kind, undefined);
});

test("one Market identity can have both participant memberships while inactive memberships grant no view", () => {
  const memberships = [
    { membership_type: "customer", status: "active" },
    { membership_type: "provider", status: "active" },
  ];
  assert.deepEqual(activeMembershipTypes(memberships), ["customer", "provider"]);
  assert.equal(canSelectParticipantView(memberships, "customer"), true);
  assert.equal(canSelectParticipantView(memberships, "provider"), true);
  assert.equal(canSelectParticipantView([{ membership_type: "provider", status: "suspended" }], "provider"), false);
  assert.equal(canSelectParticipantView(memberships, "market-operator"), false);
});

test("migration creates separate Market identity, membership, operator, and append-only audit boundaries", () => {
  const migration = readApi("migrations/0058_market_identity_memberships.sql");
  assert.match(migration, /CREATE TABLE market_identities/);
  assert.match(migration, /CREATE TABLE market_memberships/);
  assert.match(migration, /membership_type IN \('customer','provider'\)/);
  assert.match(migration, /CREATE TABLE market_operator_assignments/);
  assert.match(migration, /role_code='market-operator'/);
  assert.match(migration, /CREATE TABLE market_audit_events/);
  assert.match(migration, /market_audit_events_append_only/);
  assert.match(migration, /market_operator_assignment_audit/);
  assert.match(migration, /market_operator_assignments_no_delete/);
  assert.doesNotMatch(migration, /REFERENCES (users|platform_admins|organizations)/i);
  assert.doesNotMatch(migration, /INSERT INTO market_operator_assignments/i);
});

test("Market middleware derives operator authority live and tenant auth rejects every typed token", () => {
  const middleware = readApi("src/middleware/auth.js");
  assert.match(middleware, /payload\.kind !== "market"/);
  assert.match(middleware, /loadMarketIdentity\(payload\.sub\)/);
  assert.match(middleware, /operator_roles\?\.includes\("market-operator"\)/);
  assert.match(middleware, /if \(payload\.kind\) return res\.status\(401\)/);
});

test("Market API enforces live membership switching and separately guarded operator transitions", () => {
  const route = readApi("src/routes/market.js");
  assert.match(route, /membership\.membership_type=\$2 AND membership\.status='active'/);
  assert.match(route, /code: "MARKET_MEMBERSHIP_REQUIRED"/);
  assert.match(route, /authorityChanged: false/);
  assert.match(route, /router\.post\("\/operator\/memberships\/:id\/suspend", authenticateMarket, requireMarketOperator/);
  assert.match(route, /router\.post\("\/operator\/memberships\/:id\/activate", authenticateMarket, requireMarketOperator/);
  assert.match(route, /supplierVerified: false/);
  assert.doesNotMatch(route, /listing|proposal|payment|dispute|forum/i);
});

test("public routing exposes only the bounded Market identity API, not a Market operator host", () => {
  const app = readApi("src/app.js");
  const caddy = readRepo("Caddyfile");
  assert.match(app, /app\.use\("\/api\/market", require\("\.\/routes\/market"\)\)/);
  assert.match(caddy, /\/api\/market\/\*/);
  assert.doesNotMatch(caddy, /market\.overva\.com/);
});

test("public V28 wires real Market identity membership switching while retaining truthful previews", () => {
  const html = readRepo("public-site/index.html");
  const client = readRepo("public-site/site.js");
  assert.match(html, /site\.js\?v=28/);
  assert.match(html, /id="marketAuthDialog"/);
  assert.match(html, /data-add-market-membership="customer"/);
  assert.match(html, /data-add-market-membership="provider"/);
  assert.match(html, /Байгууллагын Platform-д нэвтрэх/);
  assert.match(client, /fetch\(`\/api\/market\$\{path\}`/);
  assert.match(client, /marketApi\("\/view"/);
  assert.match(client, /marketIdentity\.active_memberships/);
  assert.match(client, /if \(!marketIdentity\) \{\s*showMarketRole\(view\)/);
  assert.doesNotMatch(client, /marketOperator\s*=|operatorAuthority\s*=/);
});
