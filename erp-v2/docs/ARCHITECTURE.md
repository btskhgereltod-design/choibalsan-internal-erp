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
authorized by an active participant membership and changes no authority. No
person-level federation, listing, proposal, payment, dispute, or forum backend
is implemented in this slice.

## Tenant and Identity Model

- Organization is the tenant boundary.
- Tenant identity comes from authenticated server-side context, not a client-
  supplied `organization_id`.
- Employee is canonical organizational master data.
- A person may be an employee without having a login account; employee to user
  account is therefore optional.
- Roles and permissions describe system access, not employment position.
- Choibalsan-specific departments, positions, and workflows are tenant data.

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
