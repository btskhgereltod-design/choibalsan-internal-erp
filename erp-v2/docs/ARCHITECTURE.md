# OVERVA Architecture

Last reviewed: 2026-08-24

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
