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

test("migration 0059 makes provider capability application-driven and attributable", () => {
  const migration = readApi("migrations/0059_market_action_driven_participation.sql");
  assert.match(migration, /CREATE TABLE market_provider_applications/);
  assert.match(migration, /status IN \('submitted','under_review','approved','rejected'\)/);
  assert.match(migration, /CREATE UNIQUE INDEX market_provider_applications_open_idx/);
  assert.match(migration, /decided_by_identity_id UUID REFERENCES market_identities/);
  assert.match(migration, /provider_application_id UUID/);
  assert.match(migration, /Submission grants no provider membership/);
  assert.doesNotMatch(migration, /REFERENCES (users|platform_admins|organizations)/i);
  assert.doesNotMatch(migration, /(?:UPDATE|DELETE FROM|DROP TABLE) market_memberships/i);
});

test("migration 0060 enforces the complete reviewed application lifecycle", () => {
  const migration = readApi("migrations/0060_market_provider_application_lifecycle.sql");
  assert.match(migration, /OLD\.status = 'submitted' AND NEW\.status = 'under_review'/);
  assert.match(migration, /OLD\.status = 'under_review' AND NEW\.status IN \('approved','rejected'\)/);
  assert.match(migration, /market_provider_application_transition_guard/);
});

test("migration 0061 adds storefront service access without transaction settlement", () => {
  const migration = readApi("migrations/0061_market_storefront_foundation.sql");
  assert.match(migration, /CREATE TABLE market_storefront_plans/);
  assert.match(migration, /CREATE TABLE market_storefronts/);
  assert.match(migration, /CREATE TABLE market_storefront_subscriptions/);
  assert.match(migration, /CREATE TABLE market_storefront_entitlements/);
  assert.match(migration, /market_storefront_subscriptions_open_idx/);
  assert.match(migration, /market_storefront_subscriptions_no_delete/);
  assert.match(migration, /market_storefronts_transition_guard/);
  assert.match(migration, /market_storefront_subscriptions_transition_guard/);
  assert.match(migration, /OLD\.status='pending' AND NEW\.status IN \('active','cancelled'\)/);
  assert.match(migration, /not buyer\/provider transaction payments/);
  assert.doesNotMatch(migration, /CREATE TABLE market_(listings|proposals|payments|disputes)/i);
});

test("storefront API separates public browse, Provider ownership, and operator transitions", () => {
  const route = readApi("src/routes/market-storefront.js");
  assert.match(route, /router\.get\("\/storefronts"/);
  assert.match(route, /router\.post\("\/storefront", authenticateMarket/);
  assert.match(route, /membership\.membership_type='provider' AND membership\.status='active'/);
  assert.match(route, /router\.post\("\/operator\/storefront-plans", authenticateMarket, requireMarketOperator/);
  assert.match(route, /router\.post\("\/operator\/storefront-subscriptions\/:id\/activate", authenticateMarket, requireMarketOperator/);
  assert.match(route, /MARKET_STOREFRONT_SUBSCRIPTION_OPEN/);
  assert.match(route, /market\.storefront\.subscription\.activated/);
  assert.doesNotMatch(route, /escrow|payout|commission|settlement/i);
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
  assert.match(route, /code: "MARKET_PROVIDER_APPLICATION_REQUIRED"/);
  assert.match(route, /router\.post\("\/provider-applications", authenticateMarket/);
  assert.match(route, /router\.post\("\/operator\/provider-applications\/:id\/start-review", authenticateMarket, requireMarketOperator/);
  assert.match(route, /router\.post\("\/operator\/provider-applications\/:id\/approve", authenticateMarket, requireMarketOperator/);
  assert.match(route, /router\.post\("\/operator\/provider-applications\/:id\/reject", authenticateMarket, requireMarketOperator/);
  assert.match(route, /code: "MARKET_PROVIDER_SELF_REVIEW_DENIED"/);
  assert.match(route, /market\.membership\.issue\.idempotent/);
  assert.match(route, /market\.provider\.application\.review_started/);
  assert.match(route, /issued_by_kind,membership_type|membership_type,status,issued_by_kind/);
  assert.doesNotMatch(route, /listing|proposal|payment|dispute|forum/i);
});

test("public routing exposes only the bounded Market identity API, not a Market operator host", () => {
  const app = readApi("src/app.js");
  const caddy = readRepo("Caddyfile");
  assert.match(app, /app\.use\("\/api\/market", require\("\.\/routes\/market"\)\)/);
  assert.match(caddy, /\/api\/market\/\*/);
  assert.doesNotMatch(caddy, /market\.overva\.com/);
});

test("public V31 keeps guests neutral and gates participant and storefront actions", () => {
  const html = readRepo("public-site/index.html");
  const client = readRepo("public-site/site.js");
  assert.match(html, /site\.js\?v=31/);
  assert.match(html, /id="marketAuthDialog"/);
  assert.match(html, /class="market-role-switch[^"]* hidden"/);
  assert.match(html, /data-market-participation-action="customer"/);
  assert.match(html, /data-market-participation-action="provider"/);
  assert.match(html, /id="providerApplicationDialog"/);
  assert.match(html, /data-market-panel="storefront"/);
  assert.match(html, /id="marketStorefrontGrid"/);
  assert.match(html, /захиалагч, гүйцэтгэгчийн ажлын төлбөр биш/);
  assert.match(html, /Зочин нээлттэй ажлын бүтэц/);
  assert.match(html, /Байгууллагын Platform-д нэвтрэх/);
  assert.doesNotMatch(html, /data-add-market-membership=/);
  assert.match(client, /fetch\(`\/api\/market\$\{path\}`/);
  assert.match(client, /marketApi\("\/view"/);
  assert.match(client, /marketApi\("\/provider-applications"/);
  assert.match(client, /marketApi\("\/storefront\/subscriptions"/);
  assert.match(client, /function loadPublicStorefronts\(\)/);
  assert.match(client, /function showGuestMarket\(\)/);
  assert.match(client, /marketIdentity\.active_memberships/);
  assert.match(client, /pendingMarketAction = "customer"/);
  assert.doesNotMatch(client, /if \(!marketIdentity\) \{\s*showMarketRole\(view\)/);
  assert.doesNotMatch(client, /initialParams[\s\S]{0,400}showMarketView/);
  assert.doesNotMatch(client, /data-add-market-membership/);
  assert.doesNotMatch(client, /marketOperator\s*=|operatorAuthority\s*=/);
});
