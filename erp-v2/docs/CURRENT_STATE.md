# OVERVA Current State

Last updated: 2026-08-30

This document answers one question: **what exists in the repository now?** It
does not claim that every implemented foundation is complete or production-
validated at enterprise scale.

## Unreleased local work — Market guest catalog interaction

- The public Market sample catalog now has a separate responsive interaction
  layer for product detail and comparison. A guest can open a sample product,
  review capabilities, intended fit, vendor, price state, and support state,
  select up to three samples, and compare them side by side.
- Every detail and comparison surface explicitly states that the records are
  UX samples, not live listings, sale offers, orders, or vendor commitments.
  No listing, purchase, payment, supplier-contact, or transaction authority was
  added.
- The implementation is isolated in `public-site/market-catalog.js` and
  `public-site/market-catalog.css`. Desktop and 390px mobile browser checks pass
  without console errors. The public-site image definition copies both assets,
  and all 233 repository tests pass, including asset-wiring regression checks.
  A guarded local-only launcher builds the Market with an API proxy at
  `http://localhost:4174`; it creates no volume and refuses to replace an
  existing container. This work is local and not production-deployed.

## Canonical Market business-process diagram

- The canonical Guest Market Journey is stored under
  `docs/diagrams/market/guest-market-journey/`. Its editable source is
  `guest-market-journey.mmd`; `guest-market-journey.svg` is the single scalable
  review image. Small revisions overwrite those files in place. Do not create
  `v2`, `final`, `copy`, dated, or duplicate images for the same journey; Git
  history preserves earlier revisions.
- Every business-process diagram uses one implementation-status standard:
  gray = not planned, gold = planned, blue = in progress, green = implemented,
  purple = verified, red = blocked, and orange = decision required. Arrows are
  neutral flow only. Each diagram carries a compact vertical legend. Approved
  business logic without code remains gold. Revenue is identified by
  `ОРЛОГО / REVENUE` text, not by a separate status color.
- `guest-market-journey.bpmn` is the BPMN 2.0 source. A real `.vsdx` has not
  been fabricated because Microsoft Visio is not installed on this computer;
  it must be created later through Visio import and Save As.

## Next chat start

1. Run `git status`. If clean, continue from the current `main`; on another
   computer, use `git pull --ff-only origin main` first.
2. Read this file, `docs/HOME_DEVELOPMENT_SETUP.md`, and
   `docs/diagrams/market/guest-market-journey/README.md` before changing the
   Market or its process diagrams.
3. Treat `guest-market-journey.mmd` and `guest-market-journey.svg` as the one
   canonical Guest Market Journey. Update them in place and keep the compact
   seven-status legend.
4. Local Market preview uses `http://localhost:4174`. Do not infer permission
   to deploy, touch production, copy secrets, reset databases, or delete Docker
   volumes.

## Operating Baseline

- OVERVA v2 is isolated under `erp-v2`; the legacy Choibalsan ERP remains a
  separate live system and learning/import source.
- The current deployment is a Docker-based, single-host pilot served through
  Cloudflare Tunnel and Caddy, with separate public site, tenant application,
  platform administration, API, and PostgreSQL services.
- Development, staging examples, and production configuration are separated.
- PostgreSQL and uploads use persistent volumes. Scheduled verified backups,
  restore guidance, health monitoring, and restart policies exist.
- Database and internal service ports are not intended to be public.

### Production release V37 — Provider onboarding assurance

- Migration `0063` adds a recent-authentication timestamp to revocable Market
  sessions, encrypted phone contacts, keyed phone fingerprints, bcrypt-protected
  single-use OTP challenges, bounded attempts, collision risk signals, and
  attributable audit links. A verified phone is assurance evidence only; it
  grants no Customer, Provider, Market operator, Platform, or tenant authority.
- A new Provider application requires both a step-up performed within ten
  minutes and a live verified phone fact. Password identities re-enter their
  current password; Google-linked identities may reauthenticate with the exact
  linked Google issuer and subject. Existing policy-0 applications and active
  Provider memberships remain compatible.
- Phone ownership decisions are serialized by a database advisory lock over the
  blinded fingerprint. The same verified phone cannot silently create or merge
  identities; a collision creates an operator-review risk signal. Approval
  rechecks the live phone contact and verification fact before issuing Provider
  membership.
- Public V34 implements a four-step Provider onboarding dialog: account
  confirmation, phone verification, professional profile, and review state.
  The same onboarding and Provider sidebar open one OVERVA-authored
  ten-principle contractor guide covering capability honesty, scope, plain
  language, confidentiality, evidence, communication, acceptance, and
  completed-engagement-only reviews. It is static editorial guidance and adds
  no article publishing, likes, forum persistence, or reputation authority.
  SMS remains fail-closed and disabled until a real provider endpoint, token,
  sender, and fingerprint key are provisioned. Test delivery exposes OTPs only
  under `NODE_ENV=test`.
- Production preparation now mounts the SMS token and phone-fingerprint key as
  ignored Docker secrets across API, migration, and optional worker services.
  A one-time 64-character fingerprint key has been generated without disclosure,
  the SMS token remains a fail-closed placeholder, and `.env.production`
  explicitly keeps `MARKET_SMS_ENABLED=false`. All three production overlays
  pass `docker compose config --quiet` together.
- All 233 repository tests pass. A clean disposable PostgreSQL 16 run applied
  migrations `0001–0063` and passed the full Market integration flow, including
  stale-session denial, password step-up, phone OTP, duplicate application
  prevention, operator-only review/approval, audit evidence, and unchanged
  Customer/Provider authority boundaries. The disposable container was removed.
- V37 was production-deployed after verified backup
  `overva-20260829T132335Z`. Production is API V37, Public V34, Web/Admin V31,
  and schema `0063`. All seven services are healthy; local Caddy and Cloudflare
  Home/API/App/Admin/Status checks return 200, guest Provider readiness returns
  401, and external V34 assets plus the contractor guide are visible. Google
  remains enabled; phone verification truthfully reports unavailable while SMS
  remains disabled. Production has two Market identities and zero memberships,
  operator assignments, Provider applications, risk signals, or phone contacts.
  Seller/Publisher registration is a separate future capability; listings,
  proposals, payments, disputes, forum, ranking, and KYC-document backends
  remain out of scope.

### Production release V36 — Market identity assurance

- Migration `0062` keeps one canonical Market identity while separating its
  external login credentials, revocable sessions, one-time authentication challenges,
  verification facts, and operator-reviewed risk signals. Existing password
  identities and Customer/Provider memberships are preserved; credentials and
  verification facts grant no membership, Market operator, Platform founder,
  or tenant authority.
- Market tokens now name a live database session. Logout, password reset, and
  “all devices” revocation take effect server-side without waiting for JWT
  expiry. Password recovery and email verification use short-lived, hashed,
  single-use challenges and generic account-enumeration-safe responses.
- Optional Google OIDC uses authorization code flow, PKCE, state, nonce, signed
  ID-token validation, and the stable Google issuer plus subject as the account
  key. Matching email alone never merges identities: an existing password
  identity must authenticate first and explicitly link Google. Removing the
  last login credential is rejected.
- Public V33 adds Google entry/link controls, recovery, verification, and an
  active-session view. Returning Google users now see Google as the single
  primary path; email/password stays behind an explicit alternative-action
  disclosure. Email delivery remains feature-flagged off. Google OIDC
  is enabled in production with its Client Secret mounted from an ignored
  Docker secret file; production capabilities report Google available while
  email recovery and Facebook remain unavailable.
- Possible email/external-identity collisions become privacy-safe risk signals.
  Only a live Market operator can list or review them, and an operator cannot
  review a signal involving their own identity. Review creates append-only
  evidence and changes no participant authority by itself.
- All 231 repository tests pass. A clean disposable PostgreSQL/API run applied
  migrations `0001–0062` and passed password-user regression, session-bound
  tokens, single-use recovery, old-session revocation, Customer/Provider
  lifecycle regression, operator-only risk access, and audit immutability.
  Google signature/issuer/audience/expiry/nonce/verified-email validation is
  covered with a locally signed OIDC test token. Session creation now also
  rejects an inactive identity before issuing any token.
- V36 Google activation was production-deployed after verified backup
  `overva-20260829T095542Z`. Production is API V36, Public V33, Web/Admin V31,
  and schema `0062`. Live smoke now has two active identities with different
  normalized emails: one older unused password identity and one current identity
  holding both password and Google credentials. The current identity has one
  verified Google fact and one active Google session; memberships, operator
  assignments, and risk signals remain zero. All seven services are healthy;
  Cloudflare
  Home/API/App/Admin/Status checks passed, and auth capabilities report Google
  enabled with email recovery and Facebook disabled. Google authorization
  preflight verified the Client ID, callback, state, nonce, and PKCE-S256 without
  exposing the authorization URL or secret. The first live callback exposed a
  missing outbound overlay (`EAI_AGAIN`); production API was reattached to the
  existing `ai-egress` network after explicit approval, and Google DNS/TLS probes
  then passed. Deployed API image is
  `sha256:28077c52aaa0917726a3edc66df0b00719ce255db536243f5fdea3ff5f382edf`;
  Public image is
  `sha256:52853b71e7f77be948c9e35b49a4fb59e943e7c5c75ef35faa3b089ad674ece7`.

### Production release V35 — Digital Storefront foundation

- Migration `0061` adds versioned storefront plans, one Provider-owned digital
  storefront per Market identity, service subscriptions, entitlement snapshots,
  lifecycle guards, no-delete protection, and append-only audit links. These
  records represent access to OVERVA's storefront service only; they do not
  represent customer/provider work payments, commission, escrow, settlement,
  payout, refund, or dispute authority.
- Only an active reviewed Provider can create or edit their storefront. Creating
  the same storefront and requesting the same open subscription are idempotent.
  Only a live Market operator can publish a plan, activate a subscription, or
  suspend/reactivate a storefront. Suspending Provider membership also hides its
  storefront; membership reactivation alone does not republish it.
- Public V31 renders only active storefronts backed by an active Provider
  membership and an unexpired active subscription. The private Provider view
  supports profile editing and plan requests without exposing it to guests.
- All 225 repository tests pass, and a clean disposable PostgreSQL run applied
  `0001–0061` and passed the complete Market identity/storefront smoke.
- V35 was production-deployed after verified backup
  `overva-20260829T080218Z`. Production is API V35, Public V31, Web/Admin V31,
  and schema `0061`; the four new storefront tables remain at zero rows. All
  seven services are healthy, external Home/API/App/Admin/Status checks pass,
  public storefront browse returns an empty collection, and the private
  storefront endpoint rejects a guest with `401`. Deployed API image is
  `sha256:923752a931ea076db93cb33cddd7fd6489184a4a7ab0d7202c90c5f6b0fadfa8`;
  Public image is
  `sha256:93aaa1e0267133545fb2f5c34b9024cff20317fbad16237aa12f8b8b80e08e29`.

### Production release V34 — complete reviewed Provider lifecycle

- Migration `0060` enforces `submitted -> under_review -> approved/rejected`
  for Provider applications at the database boundary. Active/suspended remain
  separate membership states. A live Market operator must explicitly start
  review with a reason before deciding an application, and self-review remains
  forbidden.
- Customer capacity creation is idempotent: concurrent order intents produce
  one Customer membership and return `201` plus an idempotent `200` replay.
  Concurrent Provider submissions produce one open application and reject the
  duplicate with `MARKET_PROVIDER_APPLICATION_OPEN`.
- Submitted, review-started, approved, rejected, membership activation, and
  suspension transitions create attributable append-only Market evidence.
  Participant, tenant, and Platform tokens cannot call operator transitions.
  Guest private-role URLs remain in the neutral guest presentation.
- All 223 repository tests pass. A clean PostgreSQL/API integration run applied
  `0001–0060` and passed concurrent Customer/Provider requests, operator-only
  lifecycle transitions, both decisions, suspension/reactivation, state guards,
  boundary denial, and audit immutability. Headless Edge confirmed a guest
  cannot expose Provider private navigation through a hand-written URL.
- V34 was production-deployed after verified backup
  `overva-20260829T061635Z`. Production is API V34, Public V30, Web/Admin V31,
  and schema `0060`; it remains at zero Market identities, memberships,
  applications, operators, and events. All seven services, local Caddy, external
  Home/API, Market `401`, and Public V30 assets passed. Deployed API image is
  `sha256:50165a48b14af0be442f7186f18c76820959ded82eb4a6fcb5009e4771067188`;
  Public image is
  `sha256:0f8f65450bd9ebc43d087d463ab3585ef47c81d0626969f1b36b427c1f092719`.

### Production release V33 — action-driven Market participation

- Migration `0059` adds isolated Provider applications and links their
  attributable lifecycle to the append-only Market audit journal. API V33,
  Public V29, and schema `0059` are production-deployed; Web/Admin remain V31.
- Public V29 starts every unauthenticated visitor in one neutral guest browse
  context. Customer/Provider role switching, private navigation, and work queues
  are not shown to guests. Ordering prompts Market authentication and then
  creates Customer capacity from the order intent.
- Provider self-issuance is blocked. A registered identity submits a profile,
  skills, optional portfolio URL, and rules acceptance. Only a separately
  assigned live Market operator can approve or reject it with a reason; an
  operator cannot review their own application. Approval creates the active
  Provider membership, rejection does not.
- One identity can still hold both active capacities and switch views without
  gaining authority. Platform founder, tenant, Market operator, and participant
  boundaries remain separate. Listing, proposal, payment, dispute, forum,
  ranking, and transaction backends remain absent.
- All 222 repository tests pass. A clean disposable PostgreSQL run applied
  `0001–0059` and passed Customer order intent, Provider submission,
  approve/reject, self-review denial, view authorization,
  suspension/reactivation, cross-token denial, and immutable Market evidence.
  A 1440×1000 headless Edge render confirmed the neutral guest UI.
- V33 was production-deployed after verified backup
  `overva-20260829T060223Z`. Production remains at zero Market identities,
  memberships, Provider applications, active operators, and audit events. API
  image `sha256:a750213878a4380bcfb7267258526669299f6a135a2e07240b4b033cf308004d`
  and Public image
  `sha256:54f2546b9a472b6b871a2a57eaef5b805148e5e70149a51057d5142bf71a16e9`
  are deployed. All seven services are healthy; local Caddy and external Public
  V29, API, Market-auth boundary, tenant app, admin redirect, and status checks
  passed.

### Production release V30 — Platform admin RBAC

- V30 is production-deployed. Migration `0056` adds 13 Platform-only
  permissions, six bounded roles, 36 role-permission mappings, and attributable
  role assignments. Every previously active Platform administrator was
  backfilled with `platform-owner`; production verified one active admin and
  one active owner assignment.
- Platform authentication derives live roles and permissions on every request.
  All organization, adoption, operations, system, AI knowledge/usage, module
  validation, and billing routes enforce scoped Platform permissions
  server-side. Platform RBAC grants no Group, OVERVA Apps, or Market authority.
- The production admin shell presents Group, Platform, OVERVA Apps, and Market
  as separate contexts. Only Platform has a real backend. Group, Apps, and
  Market are truthful responsibility blueprints; they do not claim shared
  identity, storage, accounts, listings, proposals, forum, payments, or
  operator APIs.
- Pre-deployment backup `overva-20260829T023027Z` passed SHA-256, PostgreSQL
  archive-list, and uploads-archive verification. The full 207-test suite,
  migration counts `13|6|36`, existing-admin owner/permission smoke, all seven
  service health checks, Caddy loopback, and public admin/API/status/home/app
  checks passed on 2026-08-29. Public V27 was not recreated by this release.

### Production release V31 — Founder Control

- Migration `0057` adds two Platform-only permissions, one
  `founder-operator` role, short-lived tenant support grants, and append-only
  support-access events. A fresh database contains 15 Platform permissions,
  seven roles, and 53 role-permission mappings; bootstrap gives the first
  founder two role assignments and 15 effective permissions.
- Founder Control truthfully labels live Platform authority, preview Market
  customer/provider memberships, planned Apps and Market operator boundaries,
  external system operation, and offline break-glass recovery.
- Support access requires a 12+ character reason, one to three allowed scopes,
  and a 5–60 minute lifetime. Only the issuer can read or revoke it. The
  snapshot is aggregate/read-only and cannot create a tenant identity, bypass
  tenant APIs, mutate tenant data, or suppress audit evidence.
- `recover-platform-owner.js` requires production-only migration authority,
  explicit confirmation, a target email, and a 20+ character reason. It
  restores only Platform owner/founder assignments and writes Platform plus
  security audit evidence.
- The 213-test suite and a disposable PostgreSQL/API integration flow pass:
  migrations `0001–0057`, founder bootstrap, grant issue, scoped snapshot,
  revoke, subsequent denial, and immutable event evidence. A separate forced
  founder-lockout test also passed recovery plus dual-audit verification.
- V31 was production-deployed after verified backup
  `overva-20260829T031638Z`. Production reports schema `0057`, catalog counts
  `15|7|53`, two active founder role assignments, and 15 effective permissions.
  Founder Control boundary smoke, all seven service health checks, local Caddy,
  and external V12 admin/API/status/home/app checks passed. Public V27 was not
  recreated.

### Production release V32 — Market identity and membership

- Migration `0058` and `/api/market/*` implement the first bounded Market
  identity slice in production. At that release API was V32, Public Home was
  V28, and production schema was `0058`; V33 above supersedes its participant
  activation and guest-presentation behavior.
- Market login identity, participant memberships, operator assignments, token
  context, routes, and append-only audit evidence use isolated `market_*`
  records with no tenant-user, organization, employee, Platform-admin, or
  Platform-role links. Person-level federation is not implemented.
- One identity may hold zero, one, or both active `customer` and `provider`
  memberships. The selected view is allowed only by a live active membership
  and changes presentation context without adding membership, operator role, or
  any other authority.
- Participant membership is self-service and does not claim supplier
  verification. Suspension/reactivation is guarded by a separately attributable
  live Market operator assignment and reason; no founder, Platform, tenant, or
  participant role silently creates that assignment.
- The public Market shell retains unauthenticated Customer/Provider preview.
  A real Market session can register/login, add either or both memberships,
  switch only among its active memberships, and log out. Listings, proposals,
  payments, disputes, forum persistence, ranking, and supplier verification are
  still absent. The cache-busted V28 public assets and the bounded Market route
  are production-deployed through the existing Cloudflare/Caddy edge.
- D-027 records the accepted identity/storage/federation contract. All 221
  repository tests pass. A disposable PostgreSQL/API flow applied migrations
  `0001`–`0058`, exercised zero/one/both memberships, both view switches,
  tenant/Platform token denial, participant/operator denial, operator
  suspension/reactivation, and append-only audit protection. A 1440x1000 local
  headless Edge render also passed.
- V32 was production-deployed after verified backup
  `overva-20260829T034814Z`. Production reports schema `0058`; the initial
  Market state remains zero identities, zero memberships, zero active operator
  assignments, and zero Market audit events. No test identity or operator was
  left in production. The runtime role can insert Market evidence but cannot
  update, delete, or truncate it.
- API image
  `sha256:dadac6b8c740509851343d80e145505eb0fd81ca49f6c6dd8555ecfa81eb592e`
  and Public image
  `sha256:6dd118b9ba3bce827820993f3e547505846d860072131971319ca0c06096a6c0`
  are deployed. All seven services are healthy; local Caddy and external
  Market auth routing, Public V28 CSS/JS, API health, and tenant-app health
  passed. The external unauthenticated Market identity check returns the
  expected HTTP 401 boundary response.

## Implemented Foundations

### Platform and tenancy

- Ordered PostgreSQL migrations with transaction/advisory-lock protection.
- Organization/tenant, subscription, user, role/permission, and platform-admin
  foundations.
- Server-derived tenant identity and tenant-scoped data access patterns.
- Immutable audit foundation for critical actions.
- Public trial provisioning and platform administration portal.
- `overva.com` now opens as a production-deployed, full-screen Mongolian studio
  with three primary regions: a deliberately minimal sidebar, a persistent
  conversation stream, and a live product preview. The desktop document does
  not scroll; chat and preview own their overflow independently. Enter submits
  an intent, the browser-local deterministic advisor streams back its
  interpretation and asks for confirmation, and the preview builds a concrete
  import, structure, work-flow, or discovery view. Confirmed paths preselect
  relevant trial modules. The v5 boundary keeps every explanation, question,
  and confirmation in the conversation region; the preview contains only an
  interactive product surface with its own tabs, selectable cards/steps, file
  input, and test actions. Preview actions update only preview state and never
  add chat narration or mutate canonical organization data. In v6 the entry
  choices are input-oriented rather than module-oriented: describe the
  organization, provide a file/Excel workbook, show an image/diagram, or
  explain current systems. A material chooser accepts spreadsheet, document,
  PDF, Visio, text, and image formats up to 10 MB; CSV structure and image
  preview stay browser-local. An UTF-8-BOM CSV organization-intake template is
  publicly downloadable and opens in Excel. The preview exposes Structure,
  Work Flow, Systems, and Product views. This public interaction does not claim
  to perform provider-backed content analysis and does not upload selected
  files or store free text. In v7 the save dialog summarizes already established
  context and asks only for workspace name, email, and password. Organization
  code, owner identity, and the inferred module set are generated internally
  for the unchanged provisioning API contract. A guest path allows students
  and exploratory visitors to continue testing the browser-local preview
  without creating a tenant. In v8 a dedicated browser-local conversation-
  memory core keeps evidence, discussion, hypotheses, confirmed understanding,
  plans, execution/verification, and checkpoint state distinct. Preview actions
  remain test activity and cannot promote a hypothesis or represent canonical
  execution. A returning visitor explicitly chooses whether to resume, while
  Mongolian and Latin-Mongol memory questions can retrieve the relevant layer.
  `CONVERSATION_MEMORY_CONTRACT_V1.md` and decision D-013 define the accepted
  promotion rules and future tenant-scoped context-package boundary. In v9 a
  separate seven-stage delivery lifecycle covers Understand → Build → Team
  Preview → Scope → Commercial Agreement → Deployment → Live Operation. The
  preview shows its current stage, next gate, and missing requirements. Saving
  updates only a browser-local named checkpoint: the public studio no longer
  calls `/api/public/trials`, asks for email/password, creates a tenant/user, or
  links directly into `app.overva.com`. Scope, offer/contract, hosting, security,
  data migration, acceptance, operational ownership, and backup readiness remain
  explicit gates. `PRODUCT_DELIVERY_COMMERCIAL_CONTRACT_V1.md` and decision
  D-014 define the accepted boundary; this lifecycle remains separate from
  post-tenant organization growth events. Public HTML, cache-busted v9 assets,
  container/domain health, lifecycle/save boundaries, and the full 176-test
  suite were production-verified on 2026-08-26. In v10 the sidebar renders the
  named workspace, current `x/7` stage, completed/current/locked journey steps,
  the next unmet gate, and only working contextual tools for conversation,
  materials, preview, confirmed decisions, and preview-test history. A locked
  stage explains its requirements in conversation without changing preview.
  Cache-busted v10 assets, container/domain health, sidebar markup/handlers, and
  the continued absence of public trial provisioning were production-verified
  on 2026-08-26.
- Organization settings, enabled modules, plans, billing records, and tenant
  lifecycle foundations.

### Organization, people, and governance

- Canonical organization, department, position, employee, and optional employee
  login-account separation.
- Tenant-scoped job-definition-to-workspace access is implemented. An active
  employee assignment resolves through position and job definition to the
  relevant workspace codes; employee master data, login identity, and workspace
  access remain separate concerns.
- Tenant navigation combines enabled-module, permission, and job-workspace
  policy. The dashboard remains the common entry point, while operational
  workspaces appear only when the tenant has enabled them and the signed-in
  person's assigned job allows them.
- A source-owned, repeatable pilot configuration profile maps the current
  Choibalsan jobs to relevant workspaces without hard-coding that organization's
  structure as the OVERVA default. Camera access is included for the evidenced
  director, chief engineer, network engineer, and safety responsibilities.
- The current Choibalsan pilot profile applies 34 workspace mappings across
  eight job definitions. It includes HR/attendance/report access for the human
  resources job and safety/work-flow/lighting access for the HSE job; these are
  ready for real-role user acceptance testing without granting blanket platform
  or tenant-admin access.
- Employee master data, extended HR profile, contracts, attendance, leave,
  skills/training/performance, recruitment/onboarding/offboarding foundations.
- Organization blueprint interview and approval flow.
- Existing organizations use a non-destructive structure update/addition mode;
  their current departments, positions, employee count, and evidenced work
  needs are summarized before any new blueprint proposal is generated.
- Industry/work-pattern configuration without making one pilot universal.
- Data lifecycle, data ownership, metadata, quality-rule, integration-contract,
  and issue-learning foundations.

### AI-assisted onboarding

- Governed BA knowledge library and versioned OVERVA Requirements Method.
- Guided organization discovery and AI-assisted blueprint foundation.
- An evidence-backed Organization Discovery slice is implemented locally in
  the existing Organization Blueprint workspace. Tenant-private pasted text,
  interview notes, document excerpts, and system inventories are stored with a
  SHA-256 provenance hash; deterministic analysis creates separate AS-IS
  findings and `Native` / `Integrate` / `Later` capability proposals.
- Evidence sources, findings, proposals, and human review decisions are
  append-only and tenant-scoped. Accept/correct/reject decisions are audited;
  neither analysis nor review applies modules, structure, or master data.
- Migration `0053` and the related API/UI are deployed. Generic workbook
  Dataset Discovery extends the same safe onboarding path in migration
  `0054`: it classifies sheets as source/master/derived/report/instruction,
  profiles columns and quality findings without retaining raw cell values, and
  proposes target-domain readiness without exposing a canonical commit path.
- A real 7-sheet sales/delivery workbook was processed locally: 1 source, 1
  master, 1 derived, 3 report, and 1 instruction sheet were identified; 43
  profile findings and 5 missing target contracts correctly blocked commit.
  Migrations `0053`-`0054`, runtime grants, service health, and the public web/API
  path were production-verified on 2026-08-26. The combined slices pass the full
  173-test local suite.
- Smart Import foundations for structured data and organization structure.
- Organization Structure Smart Import now separates proposed action, validation,
  human review decision, and commit outcome in the PostgreSQL/API contract.
- Row correction, acceptance, reasoned exclusion, approval blocking, commit
  reconciliation, tenant isolation, and immutable audit are implemented.
- A privacy-safe dry run against a real 15-sheet company workbook validated the
  employee parser, mapping, and validation flow without database writes. Smart
  Import selects `Employee_Master` instead of assuming the first worksheet and
  normalizes compatible third-party SpreadsheetML namespace/table/merge
  metadata. Of 58 employee rows, 56 were ready and 2 duplicate identifiers
  correctly blocked commit. The production API/parser hash, compatibility path,
  worksheet selection, public health endpoint, and cache-busted web asset were
  verified on 2026-08-26.
- Customer-journey evidence and Smart Import review migrations `0049` and `0050`
  are applied to the current production database; the API and web containers
  were rebuilt and verified after deployment.
- The Hercules Import Review v4 export was audited as a UX reference. Its mock
  rows, local state, Convex schema, routes, auth assumptions, and backend were not
  imported into OVERVA.
- The production organization-structure workspace now presents the existing
  tenant-scoped PostgreSQL structure through a six-stage hub: units, job
  definitions, positions, reporting relationships, employee assignments, and
  validation/approval readiness. The hub derives duplicate, incomplete,
  unassigned, over-capacity, and reporting-cycle warnings without duplicating
  the existing structure editor or Smart Import workflow. Hercules supplied UX
  reference only; OVERVA remains the system of record.
- Proposed mapping/configuration is separated from approved application.
- AI usage governance and audit foundations.

### Operational capabilities

- Assets, work orders, attachments, work history, and approval workflow.
- Inventory, procurement, finance import, documents/records/archive, reports,
  attendance, HR operations, and safety foundations.
- Map, GPS/fleet, IoT telemetry/commands, maintenance, field PWA, automation,
  integrations, API keys/webhooks, executive view, and AI director foundations.
- OVERVA Connect V1 now has a read-only canonical business-event envelope
  validator on the existing tenant-scoped integration-contract boundary. It
  checks event and schema versions, provenance, subject, correlation, time, and
  domain payload; returns a deterministic SHA-256 fingerprint; rejects client-
  supplied tenant selection and unknown envelope fields; and neither retains
  the payload nor mutates canonical data. `OVERVA_CONNECT_CONTRACT_V1.md` and
  decision D-016 define the boundary. The full local suite passes 181 tests.
  No real multi-system delivery, connector
  certification, marketplace, or national standard is claimed by this slice.
- Public workspace v12 is production-deployed. It
  adds a distinct OVERVA Home above the existing Workspace Studio. Home searches
  and renders browser-local workspace cards with current/next lifecycle context,
  starts separate work from text, file/data, image/diagram, or system context,
  and opens the seven-stage Studio only after a workspace is selected. Existing
  stable workspace IDs, governed memory, preview, lifecycle, and no-provisioning
  boundaries are preserved. `PUBLIC_PORTFOLIO_HOME_CONTRACT_V1.md` and decision
  D-017 define this two-level navigation boundary. Before deployment, backup
  `overva-20260827T023907Z` passed checksum, PostgreSQL archive-list, and uploads
  archive verification. The 181-test local suite, production Docker build,
  container health, Caddy loopback, external v12 HTML/CSS/JS assets,
  `status.overva.com` health, no-provisioning boundary, and 1440x1000 production
  headless Edge render were verified on 2026-08-27.
- Public workspace v13 is production-deployed. The Workspace Studio sidebar now
  exposes an explicit `Миний ажлууд` return control instead of relying on users
  to infer that the OVERVA logo returns Home. It preserves the selected
  workspace and its checkpoint, while the workspace selector and `Шинэ ажил`
  retain their separate switch/create responsibilities. Desktop shows the full
  label; narrow and mobile layouts retain a compact return icon. Backup
  `overva-20260827T024651Z`, 181 tests, Docker builds, production v13 HTML/CSS/JS
  markers, external health, and all service health checks passed on 2026-08-27.
- Public workspace v14 is production-deployed. The portfolio Home no longer
  repeats the same screen as `Нүүр` and `Бүх ажлын өрөө`, and it no longer
  presents `Холболтын ажил` as global navigation that silently creates a new
  workspace. The Home sidebar now has one action, `Шинэ ажил`; systems work
  starts deliberately from the central `Одоогийн системээ холбох` prompt.
  Existing browser-local checkpoints are preserved. Backup
  `overva-20260827T025646Z`, 181 tests, Docker builds, production v14 markers,
  public health, and all service health checks passed on 2026-08-27.
- OVERVA Connect OAuth accounts V1 are production-deployed. A public catalog
  and authenticated tenant Connect view
  expose Google Drive, Google Sheets, and GitHub as explicit read-only
  providers. OAuth state is one-time and tenant/user-bound; provider tokens are
  AES-256-GCM encrypted; owner/administrator permission, connect/reconnect,
  live read-only resource checks, disconnect token clearing, and append-only
  audit evidence are implemented. Missing OAuth registrations appear as
  unavailable instead of simulated success. Migration `0055`, v15 public Home,
  authenticated Connect assets, external catalog/API health, and a 1440x1000
  headless production render are verified. Google/GitHub OAuth registrations,
  deployment secrets, and live provider consent remain to be configured and
  verified before any provider can report `available=true`.
- Choibalsan employee and lighting migration tooling with provenance controls.
- The camera operations workspace is deployed and production-verified for the
  Choibalsan pilot. Migration `0052` enables the module and four camera work
  types; authenticated API data is tenant-scoped, camera workspace access is
  enforced server-side, and organization-owner oversight is preserved.
- The camera release passed a verified pre-deployment database/uploads backup,
  164 automated tests, production migration and health checks, a 21-account
  allow/deny authorization matrix, public static/API checks, and headless browser
  checks for authorized navigation/render plus unauthorized hiding.
- Public workspace v16 exposes `Холболтууд` directly inside Workspace Studio.
  It opens the same public Google Drive, Google Sheets, and GitHub catalog
  without creating or replacing a workspace. The former Home prompt is now
  labelled `Системийн зураглал гаргах`, making its discovery-work purpose
  distinct from real OAuth account authorization.
- Public workspace v17 is production-deployed with the organization-first entry
  question `Байгууллагынхаа ямар ажлыг цахимжуулах хэрэгтэй байна?`. Home now
  explains four reviewable outcomes—problem definition, confirmed requirement,
  first preview, and next step—before showing implementation options. External
  connectors are presented as optional information sources, and the developer
  network is labelled as a forming concierge pilot rather than an operating
  automated marketplace. Empty Home submission is blocked instead of creating
  a blank workspace. Generic Excel or warehouse language now starts governed
  problem discovery rather than being misclassified as employee Smart Import.
  The internal seven delivery gates remain unchanged.
- Public workspace V18 request-intake slice is production-deployed. Home now
  combines the accepted organization-first question with an educational board
  of four clearly labelled `Жишиг хүсэлт` patterns and a structured request
  form for work type, business area, required capabilities, problem, desired
  outcome, budget context, period, and intended visibility. AI completeness
  review is optional rather than a mandatory entry conversation. Submission
  stores an unpublished browser-local draft and hands a standardized package to
  a separate governed workspace for human review. It does not publish demand,
  expose it to developers, collect proposals, rank vendors, accept payment, or
  form a contract. JavaScript syntax, all 187 tests, production health, live V18
  assets, and a headless Edge reference-request -> prefilled form -> unpublished
  draft -> Workspace handoff were verified on 2026-08-27.
- Public workspace V20 material-aware request intake is production-deployed.
  The Home `Файл, өгөгдөл` and `Зураг, схем` actions no longer create a blank
  workspace and send the person into the legacy Studio material flow. They keep
  the person on Home, open the structured request form after selection, and
  show the selected material's name, type, size, and browser-local privacy
  boundary. Only confirmed form submission creates the unpublished request
  draft and linked workspace. The draft and checkpoint retain metadata only;
  file content is not uploaded or written to local storage. JavaScript syntax,
  all 191 tests, a production image build, local file/image E2E, verified backup
  `overva-20260827T071944Z`, external health/assets, and live production
  file/image E2E passed on 2026-08-27.
- Public workspace V21 market-board Home is production-deployed.
  Home now leads with a compact, readable request list instead of a large
  chat-first prompt. Its primary navigation is `Бүх хүсэлт`, `Миний хүсэлт`,
  `Миний ажил`, and `Дүрэм`, with one explicit `Хүсэлт гаргах` action, search,
  bounded categories, and four row-based reference requests. The reference
  rows are visibly labelled `ЖИШИГ` and `Бодит захиалга биш`; they do not claim
  live demand, proposals, payments, contracts, ratings, or arbitration.
  `Миний хүсэлт` renders the existing separate browser-local draft registry,
  `Миний ажил` renders existing workspace checkpoints, and the Rules view
  explains both the intended request-to-production sequence and current
  capability boundary. Structured request intake, optional AI review, material
  metadata handling, unpublished draft creation, and the governed Workspace
  Studio remain unchanged. JavaScript syntax, all 191 tests, production-image
  build, and desktop Edge navigation/category/dialog E2E passed. Verified
  pre-deployment backup `overva-20260827T074109Z`, production service health,
  external V21 HTML/JS/CSS, status health, and loopback origin checks passed on
  2026-08-27.

- Public workspace V22 role-separated Market shell is production-deployed.
  A visible `Захиалагч` / `Гүйцэтгэгч` switch now separates customer requests
  and projects from provider opportunities, proposals, delivery jobs, and
  execution rules. `Миний ажил` is renamed `Миний төслүүд` and explicitly means
  customer workspaces. Provider views truthfully show empty concierge-pilot
  states rather than fabricated proposals or jobs. The test-only Market model
  now requires provider delivery evidence before customer acceptance and allows
  one verified review per party only after closed production outcome. At that
  release D-020 and `MARKETPLACE_OPERATING_MODEL_V1.md` defined the delivery
  control boundary; D-023 now supersedes its mandatory-control interpretation.
  This does not add production Market identity, publication,
  proposal, payment, escrow, or review persistence. JavaScript syntax, all 191
  tests, the production image build, verified backup
  `overva-20260827T081501Z`, production service health, and external V22
  HTML/JS/CSS checks passed on 2026-08-27.

- Public workspace V22.2 customer-language refinement is production-deployed. Existing
  public workspace cards remain non-destructively preserved but now identify
  themselves as test projects stored only on the current device. Customer
  request, project, privacy, attachment, and Rules copy no longer depends on
  unexplained browser-local, workspace, specification, proposal, escrow, or
  production-capability jargon. The customer Rules path now visibly covers
  request, confirmed requirement, proposal, selection, agreement, execution,
  acceptance, operational launch, and review while continuing to state that
  real proposals, payments, automatic contracts, and dispute resolution are
  not yet live. JavaScript syntax and all 191 automated tests passed. Verified
  backup `overva-20260827T084207Z`, production service health, external V22.2
  assets, the full customer flow marker, and status health passed on 2026-08-27.

- Public workspace V23 is production-deployed. It separates pre-award requests
  from post-agreement projects: saving creates only an unpublished request draft,
  optional OVERVA review creates a separately labelled refinement room, and
  `My Projects` remains reserved for work after provider selection and bilateral
  agreement. Existing device-local checkpoints remain recoverable without being
  presented as real projects.
- Public workspace V24 is production-deployed. Joint Clarification is an optional
  provider-proposed collaboration path after selection, never a mandatory AI,
  preview, or fixed lifecycle gate. Customer and provider primary navigation no
  longer promotes legacy trial rooms or rules, while existing local records remain
  recoverable. No provider, proposal, agreement, payment, or review backend is
  claimed by this release.
- Public workspace V25 requirement artifact is production-deployed. A customer
  can explicitly confirm the current
  request revision and download a UTF-8, versioned requirement artifact. The
  confirmation remains browser-local and records its time and source revision;
  it does not publish the request, send it to a provider, or create a project.
  JavaScript syntax, the focused 12-test public flow, the full 192-test suite,
  production image build, verified backup `overva-20260828T092432Z`, all service
  health checks, Cloudflare loopback, and external V25 assets passed on
  2026-08-28.
- D-023 and `MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md` now establish the
  accepted target boundary between the governed Platform/App Factory,
  supplier-neutral Market operator, and equal-participating `OVERVA Apps` vendor
  arm. This is product and architecture direction, not a claim that a separate
  Market backend, real product commerce, freelance proposals, forum, payments,
  or neutral ranking is already implemented.

## In Progress

- Design V26 public information architecture around peer `Products`,
  `Freelance`, and `Community` paths while truthfully distinguishing examples
  from real inventory and commerce.
- Define separate Market identity, data, administration, ranking, commercial,
  and audit boundaries before implementing real multi-supplier records. Do not
  reuse Platform tenant tables as Market aggregates.
- Pilot-test V25 requirement artifacts and a bounded set of real third-party and
  `OVERVA Apps` products/orders under equal supplier rules. Measure customer
  choice, requirement accuracy, proposal confidentiality, and operator
  neutrality before automating ranking or payment.
- Validate the first `inventory.goods-received` event contract with at least
  two real source/target systems, including authorization, idempotency, retry,
  reconciliation, rollback, and operational ownership evidence.
- Persist attributable scope, commercial agreement, deployment choice, and
  operations-readiness records behind the production-deployed v10 public
  lifecycle before tenant provisioning is reconnected.
- Pilot-test public workspace v12 with real returning and first-time visitors.
  It includes the v11 browser-local
  multi-workspace registry, non-destructive legacy checkpoint migration,
  same-workspace/new-workspace decisions, and preliminary Latin-Mongol profile,
  now routed through the separate Home and Workspace Studio surfaces.
- Pilot UAT for the production-deployed evidence-backed capability-map, Dataset
  Discovery, and employee Smart Import slices; real-file profiling and automated
  regression/deployment checks are complete.
- Extend the public guided-start pattern into an authenticated, role-aware
  tenant setup guide with progress, impact preview, and explicit approval; do
  not turn routine employee work into a permanent chat-first interface.
- Customer journey evidence model for Discovery → Blueprint → Pilot → First
  Value → Go-live → Paid → Champion → Referral.
- Platform-admin adoption/funnel presentation and manual milestone controls.
- User-acceptance validation of job-relevant navigation with pilot users,
  including checks for both missing and excessive workspace visibility.
- Human pilot validation of camera terminology and day-to-day workflow value;
  automated camera deployment and authorization verification are complete.
- Continued normalization of imported Choibalsan operational data into general
  OVERVA domain concepts.
- Validate the Organization Structure Smart Import with additional real,
  anonymized customer files and refine mapping/quality rules from the evidence.

## Current Product Focus

1. Make the separate Products, Freelance, and Community Market paths clear to a
   first-time visitor without forcing Platform discovery.
2. Prove supplier-neutral Market operation with bounded real inventory and
   assisted orders before automating ranking, payment, or mass onboarding.
3. Make organization discovery and Smart Import easier and safer.
4. Measure setup effort, abandonment, assistance, first value, and adoption.
5. Turn real pilot problems into reusable patterns without hard-coding the
   pilot's terminology into the platform.
6. Keep tenant-facing navigation role- and workspace-relevant.
7. Improve the platform-admin view of system health, adoption, AI cost, data
   quality, and operational risk.
8. Test the Creator Studio / Client Review / Runtime hypothesis with real
   self-builders, professional implementers, and business reviewers.

## Known Boundaries

- An implemented foundation is not automatically mature, complete, or proven at
  large scale.
- Some module code exists before its tenant-facing workflow is fully polished.
- The current single-host deployment is a pilot architecture, not evidence of
  high-availability deployment.
- AI must not silently apply consequential configuration or operational changes.
- The ecosystem North Star and market-entry strategy are accepted, but a mature
  marketplace, automated matching, contracting, escrow, pricing intelligence,
  vendor certification, and cross-organization commerce are not implemented or
  proven current capabilities.
- A test-only in-memory marketplace boundary simulator now covers five isolated
  customer organizations, ten isolated developer organizations, five request
  journeys, proposals, scoped conversations, bilateral agreement, pilot,
  acceptance, production, and closure. This is architecture evidence only; it
  creates no production identities or orders and does not make the marketplace
  an implemented capability. The boundary audit is recorded in
  `docs/MARKETPLACE_BOUNDARY_AND_DEMO_AUDIT_V1.md`.
- Public Home V26 is production-deployed.
  Its default area is `Маркет`, followed by `Форум` and `Захиалгат ажил`.
  Market places clearly labelled OVERVA Apps
  samples beside other supplier samples without operator privilege. Forum and
  product commerce remain honest preview surfaces: there are no live posts,
  accounts, prices, purchases, supplier onboarding, or server-backed catalog
  records. The existing request/provider shell now lives only under the custom
  work area. Deployment used verified pre-deployment backup
  `overva-20260828T101326Z` and recreated only `public-site` with the Cloudflare
  overlay. All seven production services remained healthy; external Home, V26
  JavaScript/CSS, status health, Caddy loopback, three-area navigation, equal
  supplier labels, and the sample-truth marker were verified successfully.
- Public Home V27 is production-deployed. It applies D-024
  terminology: the custom-work area is `Захиалгат ажил ба үйлчилгээ`; Product
  Market uses Apps, Modules, Connectors, Templates, and AI Agents; and a
  non-operational Market Governance note explains equal supplier rules. The
  added cards, rules, and controls remain samples or disabled previews.
  Deployment used verified pre-deployment backup
  `overva-20260828T122110Z` and recreated only `public-site` with the Cloudflare
  overlay. All seven services remained healthy. External V27 HTML/JS/CSS,
  custom-work/service label, five product categories, governance note,
  sample-truth boundary, status health, and Caddy loopback were verified.
- D-024 and `OVERVA_GROUP_OPERATING_MODEL_V1.md` now define OVERVA Group as an
  ownership umbrella with three peer operating roles: Platform, OVERVA Apps,
  and Market. Group membership is not a tenant, database, authorization, or
  permission boundary. Legal-entity separation is not claimed as implemented.
- Admin shell V30, Founder Control V31, and the bounded Market participant
  identity slice V32 are production-deployed. The existing
  authenticated Platform admin remains the only operational control plane. One
  web application now provides a context switcher for Group overview, Platform,
  OVERVA Apps, and Market Operator. Group and Apps remain boundary blueprints;
  the admin Market context still grants no operator access. V32 adds only the
  separately typed public Market identity/membership API and isolated
  `market_*` storage. The Platform token grants no Apps or Market access, no
  Platform/founder role creates a Market operator assignment, and no universal
  super-admin role was introduced. V29
  adds business-responsibility workspace blueprints for Group, Apps, and Market,
  labels the twenty-role simulations truthfully, uses cache-busted responsive
  assets. V30 adds migration `0056` with 13 Platform-only permissions and six
  bounded roles. Current assignments are resolved server-side on every request;
  every Platform control and billing route has an explicit permission guard;
  existing administrators are backfilled as `platform-owner`; and the browser
  fetches, displays, and mutates only granted Platform areas. The complete
  207-test suite, a clean `0001–0056` disposable PostgreSQL rehearsal, and
  production-equivalent `overva-api:v30-admin-rbac-local` and
  `overva-web:v30-admin-rbac-local` builds passed. V31 then adds the bounded
  founder role, short-lived read-only support access, immutable lifecycle
  evidence, and offline audited owner recovery described above.
- D-025 and `ADMIN_OPERATING_MODEL_V1.md` define bounded workspaces for Group
  oversight, Platform operations, OVERVA Apps vendor operations, and Market
  operation. A test-only admin control simulation now creates twenty isolated
  virtual roles per context (eighty total), verifies cross-context denial,
  four-eyes Platform/App/Market/Group gates, aggregate-only Group visibility,
  append-only event evidence, and a redacted Apps-to-Market release handoff.
  This simulation creates no production identities and does not make the Apps
  or Market transaction/operator workspaces operational.
- Public workspace V25 is production-deployed.
- `My Requests` stores request drafts, their review state, and (in V25)
  an explicit human-confirmed requirement revision. `My Projects` remains empty
  until provider selection and bilateral agreement. A saved or confirmed
  request never creates a project or opens Studio automatically.
- Legacy browser-local request/workspace links migrate non-destructively into
  optional review-room links. Existing local checkpoints remain recoverable as
  earlier experiments rather than customer projects.
- Workspace/request preview data remains browser-local. Server-side Market
  identity and Customer membership exist; production also has the reviewed
  Provider-application path. Publication, proposals, provider selection,
  agreements, payment, production delivery control, and verified reviews are
  still absent.
- Market and Platform are accepted as separate future data and authorization
  boundaries. `OVERVA Apps` is a normal supplier; operator-only and
  competitor-private data must be inaccessible to it.
- Public workspace V24 is production-deployed. It removes `Trial Rooms` and the
  provider rules page from primary navigation, while preserving legacy
  checkpoints behind secondary help. Customer and provider Home copy is now
  role-specific; provider sample
  rows are explicitly separated from the truthful no-live-work state. Provider
  proposals and delivery empty states use plain Mongolian and lead back to the
  next relevant action instead of exposing backend terminology.
- V24 introduces the accepted D-022 interaction boundary: after provider
  selection, the provider may propose an optional `Joint Clarification`; the
  customer may accept it or proceed directly to agreement. The clarification
  surface is intended for inviting relevant customer participants and mapping
  real workflow, actors, information, decisions, and acceptance outcomes. It is
  not a coding room, project, or required gate. No server-side invitation,
  proposal, selection, agreement, or clarification persistence is claimed by
  this public-shell correction.
- V24 passed JavaScript syntax, the focused 11-test public flow, all 191
  repository tests, a production-equivalent image build, and local visual
  review. Verified pre-deployment backup `overva-20260827T114821Z` contains the
  database dump, uploads archive, metadata, and valid checksums/archive lists.
  Only production `public-site` was recreated with the Cloudflare overlay; all
  services remained healthy. Caddy loopback, external Home, V24 JavaScript/CSS,
  and status health returned HTTP 200. Production HTML exposed the V24 assets,
  optional clarification, provider delivery flow, and corrected three-item
  primary navigation for each role.

## Do Not Rediscover as New Work

Search the repository before proposing another Smart Import, blueprint,
requirements interview, approval gate, tenant model, employee master, immutable
audit, customer journey, or AI usage-governance system. Improve the existing
capability when it serves the same purpose.

## Updating This File

Update after a material capability is implemented, removed, or changes status.
Use the labels **implemented**, **in progress**, **planned**, and **hypothesis**
carefully. Do not mark a feature complete merely because a table or screen exists.
