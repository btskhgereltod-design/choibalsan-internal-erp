# OVERVA Architecture

Last reviewed: 2026-08-29

This is a current map and a stable default, not a permanent restriction. For
production operations, see `../PRODUCTION_DEPLOYMENT.md`. For data rules, see
`DATA_GOVERNANCE.md`.

## System Context

```text
Customer / employee browsers
          |
          v
Cloudflare DNS, proxy and Tunnel
          |
          v
Caddy routing and TLS boundary
   |          |           |
public site  tenant web  platform admin
                         |
                         v
                    Express API
                         |
                         v
                    PostgreSQL
```

Internal PostgreSQL, migration, backup, monitoring, and worker services are not
public application endpoints.

## Current Code Boundaries

- `public-site/` — public `overva.com` experience and trial entry.
- `web/` — tenant application and platform-admin browser assets.
- `api/src/routes/` — HTTP boundaries grouped by domain capability.
- `api/src/services/` — reusable application/domain services.
- `api/migrations/` — ordered source of truth for PostgreSQL schema evolution.
- `ops/` — backup, restore, tunnel, startup, and operational scripts.
- `docs/` — governed product, architecture, data, AI, and delivery knowledge.

## Domain Routing

- `overva.com`, `www.overva.com` — public product site.
- `app.overva.com` — tenant application.
- `api.overva.com` — public API boundary.
- `admin.overva.com` — provider/platform administration.
- Additional auth, IoT, map, and status hostnames remain separable routing
  boundaries when their deployment requires it.

## Accepted Platform and Market Boundary

OVERVA Group is not a runtime or authorization boundary. It has three peer
operating roles: Platform, OVERVA Apps vendor, and Market operator.

`app.overva.com` is the governed organization Platform, App Factory, review, and
runtime boundary. The future multi-supplier Market is a separate product,
authorization, data, administration, and commercial boundary; `market.overva.com`
is the intended hostname but is not yet a deployed production application.

`OVERVA Apps` may sell Platform-produced apps and bid for freelance work only as
a normal Market supplier. Market operator access must not expose competing
supplier proposals, private discussions, ranking controls, complaints, or
enforcement data to `OVERVA Apps`. Shared sign-in may use scoped federation but
must not merge Market profiles with tenant employees, roles, private evidence,
builder projects, runtime data, or tenant audit journals.

The full accepted separation and equal-participation contract is
`MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md`; the canonical Group hierarchy is
`OVERVA_GROUP_OPERATING_MODEL_V1.md`.

Administrative work follows the same boundary. Group consumes aggregates and
attestations; Platform, OVERVA Apps, and Market keep separately attributable
roles, queues, approvals, and audit evidence. Cross-boundary collaboration uses
explicit redacted handoffs rather than raw source access. The accepted control
model is `ADMIN_OPERATING_MODEL_V1.md`.

The existing Platform control plane derives active role and permission arrays
from `platform_admin_role_assignments` on every authenticated request. Route
guards enforce Platform-only organization, adoption, operations, system,
AI-governance, usage, validation, and billing permissions. This live lookup
allows revocation without waiting for an access token to expire. It is not an
identity federation or a permission bridge to Group, OVERVA Apps, or Market.

Founder-led operation is layered on this Platform boundary rather than added as
a universal application super-admin. `founder-operator` is Platform-scoped.
Tenant support requires an attributable grant with a reason, explicit
diagnostic/configuration/audit scope, and a maximum sixty-minute lifetime. The
grant exposes only a redacted read-only snapshot through Platform routes; it
does not mint a tenant user/token, enter ordinary tenant APIs, or permit tenant
mutation. Its issue, snapshot read, expiry denial, and revocation are recorded
in an append-only event journal. Host deployment/migration/restore and offline
break-glass recovery remain external operational authorities. Market customer,
provider, and operator identities remain outside this Platform authorization
model.

The local Market identity slice is an extraction-compatible boundary in the
current single-host deployment. `market_identities`, `market_memberships`,
`market_provider_applications`, `market_operator_assignments`, and
`market_audit_events` have no foreign keys to tenant organizations/users or
Platform administrators. `/api/market/*` accepts only an explicitly typed
Market token and derives active memberships plus the separate operator
assignment from PostgreSQL on every request. Tenant and Platform middleware
reject that token; the Market middleware rejects tenant and Platform tokens.

Public browse is a neutral `guest` presentation, not a participant membership.
Starting an order may create the self-issued active `customer` capacity. A
Provider application grants no capacity: only a live Market operator other than
the applicant can move it through `submitted -> under_review` and then approve
or reject it with attributable reasons. The database rejects lifecycle skips;
approval creates an active `provider` membership and rejection creates none.
Customer membership creation is idempotent under concurrent order intents, and
the database permits only one open Provider application per identity.
`customer` / `provider` view selection is
authorized by an active participant membership and changes no authority.

The additive Digital Storefront foundation extends that isolated boundary with
`market_storefront_plans`, `market_storefronts`,
`market_storefront_subscriptions`, and `market_storefront_entitlements`. An
active reviewed Provider owns at most one storefront. Public reads require an
active Provider membership, active storefront, and active unexpired service
subscription. Plan terms and entitlements are snapshotted at subscription
request time; operator-only activation creates dated grants, and lifecycle
transitions create Market audit evidence. These subscriptions sell access to
OVERVA's storefront service only and create no authority over Customer/Provider
job money.

The identity-assurance layer keeps the compatible password hash on the
canonical `market_identities` row while storing external login proofs,
revocable `market_sessions`, hashed
single-use `market_auth_challenges`, attributable verification facts, and risk
signals separately. JWTs contain only Market identity and session identifiers;
middleware requires the session to remain active and derives memberships and
operator assignments live. Authentication methods never carry those grants.
Google OIDC uses authorization code plus PKCE/state/nonce and binds by issuer
and subject. An email collision requires authenticated explicit linking and is
never silently merged. Recovery revokes all prior sessions. Email delivery and
Google integrations are disabled unless complete provider configuration is
present. Tenant and Platform person-level federation, listing, proposal,
engagement, review, transaction payment, dispute, forum, and ranking backends
are not implemented in this slice.

Provider onboarding adds an assurance gate without changing those boundaries.
The current Market session records its most recent strong authentication.
Password re-entry or reauthentication by the exact linked Google subject may
refresh that timestamp for ten minutes. Phone contacts are encrypted, while a
keyed fingerprint supports collision checks without using plaintext as an
index. OTP challenges are bcrypt-protected, short-lived, single-use, bounded by
attempt and request limits, and linked to append-only audit evidence. Database
advisory locking serializes decisions for the same fingerprint.

A new Provider application snapshots assurance policy version, phone
verification, and step-up time. Submission and operator approval both require
live assurance evidence; the latter still creates membership only through the
existing reviewed four-eyes lifecycle. Existing policy-0 records remain
compatible. Phone/step-up proof grants no membership or operator authority, and
future Seller/Publisher capability remains separate from Provider membership.

## Tenant and Identity Model

- Organization is the tenant boundary.
- Tenant identity comes from authenticated server-side context, not a client-
  supplied `organization_id`.
- Employee is canonical organizational master data.
- A person may be an employee without having a login account; employee to user
  account is therefore optional.
- Roles and permissions describe system access, not employment position.
- Choibalsan-specific departments, positions, and workflows are tenant data.

## Connected Organization Domain Model

OVERVA uses five conceptual layers when extending tenant operation:

```text
Master Data
-> Organization
-> Responsibility and Authority
-> Process and Transactions
-> Measurement and Optimization
```

This ordering prevents module-local duplication and clarifies who acted on
which authoritative resource under which authority and evidence. It does not
create one universal table, person identity, workflow engine, event payload, or
cross-boundary database. Small versioned domain schemas and the accepted
Platform/Market/Apps/administration separations remain in force.

Employee, login identity, job definition, position, assignment, responsibility,
system role, permission, workspace access, and process authority are separate.
Current RBAC and job-workspace policy implement part of this model; legacy fixed
job-role checks remain compatibility debt to migrate incrementally without
expanding authority. `CONNECTED_ORGANIZATION_DOMAIN_MODEL_V1.md` defines the
model, and `SURFACE_AUTHORITY_MATRIX_V1.md` routes each product surface to its
identity, data, authorization, and audit owner.

## Data and Audit Model

- PostgreSQL is the current transactional system of record.
- Tenant business records use organization-scoped relationships and server-side
  authorization; stronger RLS coverage may be introduced incrementally.
- Critical state changes create attributable append-only audit evidence.
- Imports preserve source/provenance and use validation plus approval before
  consequential application.
- Files and documents have metadata, lifecycle, retention, and access concerns;
  they are not treated as anonymous uploads.

## AI and Configuration Flow

```text
Customer evidence / import / conversation
                  |
                  v
          AI-assisted proposal
                  |
                  v
       deterministic validation
                  |
                  v
       authorized human approval
                  |
                  v
       transactional application
                  |
                  v
        audit + outcome evidence
```

AI may help discover, classify, map, explain, and recommend. It does not bypass
tenant authorization, validation, approval, audit, or rollback planning.

## IoT Safety Boundary

Command precedence is Emergency > Manual > Weather > Schedule > Default at UI,
API, server, gateway/edge, and device layers. Loss of cloud connectivity must
leave approved local rules, last valid configuration, and fail-safe behavior
available locally.

## Changing a Stable Default

A materially better design is welcome. Before replacing a stable default,
describe the benefit, affected compatibility/data, migration path, rollback
path, and verification plan. Update this map after the change is proven.
