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

- Public Home V28 and API V32 are deployed with migration `0058`; Web/Admin
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
  membership, operator-assignment, and append-only audit storage plus a typed
  Market token. It still has no listings, proposals, freelance transaction
  workflow, forum persistence, payments, disputes, or Apps operator system.

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

- Verified backup: `erp-v2/backups-production/overva-20260829T034814Z`.
- Current API image:
  `sha256:dadac6b8c740509851343d80e145505eb0fd81ca49f6c6dd8555ecfa81eb592e`.
- Current Public image:
  `sha256:6dd118b9ba3bce827820993f3e547505846d860072131971319ca0c06096a6c0`.
- Current Web image:
  `sha256:5c2ad3eec659945c60d51ae39bf3d596b0f55736b0bd88bcc17217abed83e737`.
- Previous API image:
  `sha256:3a007b5dbf115b5f0ae15861006b5d9143da62c26f63126296e52391393f050a`.
- Previous Web image:
  `sha256:2cc9a2a972fee7bc946935a0b28fde22c2af24cc60a3ce19c3d1214609310a96`.
- Migration `0058` is additive. The pre-V32 application does not use the new
  `market_*` tables, so a schema restore is not needed for an application-only
  rollback, but any live
  restore still requires an approved outage and full database/uploads restore.
- Every Compose command that may recreate Caddy must use both
  `docker-compose.production.yml` and `docker-compose.cloudflare.yml`.

## Verified state

- Tests: 221 passed, 0 failed.
- Production DB: latest migration `0058`; Platform counts remain `15|7|53` and
  active founder assignments/effective permissions remain `2|15`.
- Production Market zero-state is `0` identities, `0` memberships, `0` active
  operators, and `0` audit events. Runtime can insert audit evidence but cannot
  update, delete, or truncate it.
- The V31 existing-admin smoke passed at schema `0057`; V32 leaves its
  owner/founder roles and 15 live permissions unchanged.
- All seven production services healthy.
- External Public V28 CSS/JS, API, public Home, and tenant app health returned
  HTTP 200. `/api/market/auth/me` returns the expected unauthenticated HTTP 401
  through both local Caddy and the Cloudflare edge.
- Windows AC/DC sleep and hibernate are `Never`; keep-awake PID 1276 had a
  current heartbeat. This does not protect against power loss or forced reboot.

## Working-tree caution

The V27–V32 implementation and documents are still uncommitted. There are also
pre-existing unrelated deletions under `.tmp/pdfreader` and
`erp-v2/.tools/pdfreader`; do not restore, delete, stage, or include them unless
the user explicitly asks. Inspect `git status --short` before editing and
preserve all unrelated work.

## Recommended next bounded step

Choose and design the next Market vertical slice explicitly before coding. Keep
the now-live Market identity/membership boundary fixed, provision no Market
operator merely from founder or Platform authority, and do not bundle listings,
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
> V28, API V32, Web/Admin V31, migration 0058 дээр байгаа. Market identity болон
> Customer/Provider membership-ийн эхний bounded slice deployed; production-д
> Market identity/operator одоогоор 0. View солих нь зөвхөн active membership-д
> тулгуурлаж эрх нэмэхгүй, Market operator болон Platform founder/tenant эрх
> тусдаа хэвээр. Дараагийн Market slice-ийг эхлээд тусад нь bounded design хий;
> listings, proposals, payments, disputes, forum backend-уудыг нэг дор бүү
> өргөжүүл. Өмнөх болон хамааралгүй working-tree өөрчлөлтүүдийг хадгал. Deploy-г
> зөвхөн би тусад нь хүсвэл хий.
