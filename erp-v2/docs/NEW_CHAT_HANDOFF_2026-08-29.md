# OVERVA New Chat Handoff — 2026-08-29

## Start here

Read, in order:

1. `erp-v2/AGENTS.md`
2. `erp-v2/docs/CURRENT_STATE.md`
3. `erp-v2/docs/DECISIONS.md`
4. the relevant section of `erp-v2/docs/ARCHITECTURE.md`
5. `erp-v2/docs/ADMIN_OPERATING_MODEL_V1.md`
6. this handoff

The legacy Choibalsan application and OVERVA are separate products and data
boundaries. Do not generalize legacy tenant behavior into OVERVA.

## Production truth

- Public Home V31 and API V35 are deployed with migration `0061`; Web/Admin
  remain V31.
- V31 provides real Platform-only RBAC: 15 permissions, seven roles, 53 mappings,
  live permission derivation, and server-side route guards.
- The existing founder admin is active, has `platform-owner` and
  `founder-operator`, and receives all 15 Platform permissions. Production
  smoke passed.
- The admin shell has four bounded contexts: Group, Platform, OVERVA Apps, and
  Market. Platform remains the only operational control plane. The public
  Market participant identity/membership slice is real, but the admin Market
  operator screen remains a truthful blueprint and grants no authority.
- OVERVA Apps is a normal first-party supplier in the future Market and must
  receive no ranking, review, fee, enforcement, or data-access privilege.
- Production now has isolated `market_*` identity, Customer/Provider
  membership, Provider-application, operator-assignment, and append-only audit
  storage plus a typed Market token. It still has no listings, proposals,
  freelance transaction workflow, forum persistence, payments, disputes, or
  Apps operator system.

## V35 Digital Storefront foundation — deployed

- D-029 fixes the commercial boundary: OVERVA sells storefront subscriptions
  and later publication/visibility services, but does not intermediate
  Customer/Provider job money.
- Migration `0061` adds versioned plans, one Provider storefront, service
  subscriptions, entitlement snapshots, transition guards, no-delete controls,
  and audit links. Active storefront publication requires an active Provider
  membership plus an active unexpired subscription.
- Public V31 adds a truthful active-storefront list and an active-Provider-only
  “Миний лангуу” manager. Plan creation and subscription/storefront transitions
  that require judgment remain operator-only API actions; expiry is a system
  transition and the admin Market screen is still a blueprint.
- All 225 tests and a clean `0001–0061` PostgreSQL/API smoke pass. V35 was
  deployed after verified backup `overva-20260829T080218Z`. Production is API
  V35 / Public V31 / Web/Admin V31 / schema `0061`; new storefront storage is
  at zero rows, all seven services are healthy, external checks pass, public
  storefront browse returns `[]`, and a guest private-storefront call returns
  `401`.
- Do not expand listing, proposal, engagement, review, payment, dispute, forum,
  or ranking backends as part of this slice. Reviews later require a completed
  engagement and its actual Customer; no guest, unrelated, or self-rating.

## V34 reviewed Provider lifecycle hardening — deployed

- Migration `0060` enforces `submitted -> under_review -> approved/rejected`;
  active/suspended remain membership states. Only a separately assigned live
  Market operator can start review and decide, each with an attributable reason.
- Concurrent Customer order intents create one membership and replay as
  idempotent `200`; concurrent Provider submissions create one open application
  and reject the duplicate. Existing membership rows are not rewritten.
- All 223 tests and a clean `0001–0060` PostgreSQL/API smoke pass. Headless Edge
  confirms a guest cannot expose Provider private navigation by editing the URL.
- V34 was deployed after verified backup `overva-20260829T061635Z`. Production
  is API V34 / Public V30 / migration `0060`; Web/Admin remain V31 and Market
  storage remains at zero rows.

## V33 action-driven Market participation — deployed

- D-028 replaces only D-027's self-service participation detail. Guests now
  have one neutral public-browse context; they are not shown Customer/Provider
  switching or private work queues.
- Starting an order after Market authentication creates Customer capacity from
  that action. Provider self-issuance is rejected and replaced by a bounded
  application containing a professional summary, skills, optional portfolio,
  and rules acceptance.
- Migration `0059` adds `market_provider_applications` plus attributable audit
  links. A separately assigned live Market operator must approve or reject with
  a reason, cannot self-review, and creates Provider membership only on
  approval.
- Public assets are cache-busted to V29. The same identity may still
  hold both active capacities and switch presentation context without gaining
  operator, Platform, tenant, founder, or system authority.
- All 222 repository tests pass. A clean disposable PostgreSQL/API smoke passed
  migrations `0001–0059`, Customer action, Provider submit/approve/reject,
  operator self-review denial, view gates, suspension/reactivation,
  cross-boundary token denial, and audit immutability. A 1440×1000 headless Edge
  render confirmed the guest state.
- V33 was deployed after verified backup `overva-20260829T060223Z`. Production
  is API V33 / Public V29 / migration `0059`; Web/Admin remain V31.

## V32 Market identity and membership — deployed

- D-027 accepts the extraction-compatible Market identity/storage/federation
  boundary. There is no person-level federation in this slice.
- One Market identity may hold Customer and Provider memberships. A selected
  participant view requires a live membership and never adds membership or
  Market operator authority.
- Market operator assignment is separately attributable. Production has zero
  active Market operators; Platform founder, tenant, and participant roles do
  not create one.
- Public V28 provides separate Market register/login, self-service participant
  memberships, live view switching, and logout. Guest preview remains
  available and does not grant authority.
- Listings, proposals, payments, disputes, forum persistence, ranking, and
  supplier verification remain out of scope and absent.

## V31 Founder Control — deployed

- D-026 accepts layered founder authority without a universal application
  super-admin.
- Migration `0057`, Founder Control API/UI, short-lived support grants,
  redacted snapshots, append-only support events, and offline break-glass owner
  recovery are production-deployed.
- Production result: `0057`, 15 permissions, seven roles, 53 mappings, two
  founder assignments, and 15 effective permissions.
- Tests: 213 passed. Disposable API flow passed issue → snapshot → revoke →
  denied-after-revoke with immutable evidence.
- Forced founder lockout and offline recovery passed with both Platform and
  security audit evidence.
- Production Founder Control returned 200 with seven truthful contexts and
  boundary flags denying tenant bypass, Market outcome override, and audit
  mutation. External V12 assets passed.

## Deployment evidence and rollback

- Verified backup: `erp-v2/backups-production/overva-20260829T060223Z`.
- Current API image:
  `sha256:a750213878a4380bcfb7267258526669299f6a135a2e07240b4b033cf308004d`.
- Current Public image:
  `sha256:54f2546b9a472b6b871a2a57eaef5b805148e5e70149a51057d5142bf71a16e9`.
- Current Web image:
  `sha256:5c2ad3eec659945c60d51ae39bf3d596b0f55736b0bd88bcc17217abed83e737`.
- Previous API image:
  `sha256:dadac6b8c740509851343d80e145505eb0fd81ca49f6c6dd8555ecfa81eb592e`.
- Previous Public image:
  `sha256:6dd118b9ba3bce827820993f3e547505846d860072131971319ca0c06096a6c0`.
- Migration `0059` is additive. The V32 application does not use Provider
  application records, so a schema restore is not needed for an application-
  only rollback, but any live
  restore still requires an approved outage and full database/uploads restore.
- Every Compose command that may recreate Caddy must use both
  `docker-compose.production.yml` and `docker-compose.cloudflare.yml`.

## Verified state

- Tests: 222 passed, 0 failed.
- Production DB: latest migration `0059`; Platform counts remain `15|7|53` and
  active founder assignments/effective permissions remain `2|15`.
- Production Market zero-state is `0` identities, `0` memberships, `0` Provider
  applications, `0` active operators, and `0` audit events. Runtime can insert
  audit evidence but cannot update, delete, or truncate it.
- Production reverified `15|7|53`, two active founder assignments, and 15
  effective permissions after `0059`; V33 changes no Platform authority.
- All seven production services healthy.
- External Public V29 CSS/JS, API, public Home, tenant app, admin redirect, and
  status health passed. `/api/market/auth/me` returns the expected
  unauthenticated HTTP 401 through both local Caddy and the Cloudflare edge.
- Windows AC/DC sleep and hibernate are `Never`; keep-awake PID 1276 had a
  current heartbeat. This does not protect against power loss or forced reboot.

## Working-tree caution

V27–V32 is committed as `514983b`. The deployed V33–V34 changes are
uncommitted.
`OVERVA.code-workspace` is a separate user workspace file and must not be
included unless explicitly requested. Restricted-path Git status may falsely
show deletions under `.tmp/pdfreader` and `erp-v2/.tools/pdfreader`; escalated
Git inspection confirmed they are not real working-tree changes. Do not restore,
delete, stage, or include them. Inspect status before editing and preserve all
unrelated work.

## Recommended next bounded step

Choose the next Market vertical slice explicitly, provision no Market operator
merely from founder or Platform authority, and do not bundle listings,
proposals, payments, disputes, or forum work into one release.

### V32 acceptance evidence

1. Define a Market identity boundary separate from Platform administration and
   tenant organization identity; reuse a person-level login only through an
   explicit reviewed federation/link contract, never by sharing authority.
2. One Market participant can hold zero, one, or both `customer` and `provider`
   memberships. Switching view changes presentation/work queue only and never
   grants Market operator permission.
3. Market operator membership is a separate assignment and audit boundary. The
   founder's Platform roles do not silently create it.
4. Membership issue, activation, suspension, and view-switch behavior have
   server-side allow/deny tests, tenant/Platform cross-boundary tests, and
   attributable append-only evidence where consequential.
5. UI must distinguish real functionality from preview. Do not claim listings,
   proposals, payments, disputes, forum, or supplier verification before their
   backends exist.
6. `CURRENT_STATE.md`, D-027, architecture, and this handoff record the accepted
   and deployed boundary. Future deployment still requires an explicit request.

## Copy into the new chat

> OVERVA ажлыг үргэлжлүүлье. Эхлээд `erp-v2/AGENTS.md`,
> `erp-v2/docs/CURRENT_STATE.md`, `erp-v2/docs/DECISIONS.md`,
> `erp-v2/docs/ARCHITECTURE.md`, дараа нь
> `erp-v2/docs/NEW_CHAT_HANDOFF_2026-08-29.md`-ийг бүрэн унш. Production Public
> V29, API V33, Web/Admin V31, migration 0059 дээр байгаа. Market identity,
> action-driven Customer capacity болон reviewed Provider application slice
> deployed; production-д Market identity/provider application/operator
> одоогоор 0. View солих нь зөвхөн active membership-д тулгуурлаж эрх нэмэхгүй,
> Market operator болон Platform founder/tenant эрх
> тусдаа хэвээр. Дараагийн Market slice-ийг эхлээд тусад нь bounded design хий;
> listings, proposals, payments, disputes, forum backend-уудыг нэг дор бүү
> өргөжүүл. Өмнөх болон хамааралгүй working-tree өөрчлөлтүүдийг хадгал. Deploy-г
> зөвхөн би тусад нь хүсвэл хий.
