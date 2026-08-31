# OVERVA Surface and Authority Matrix V1

Status: accepted routing and review contract

Accepted: 2026-08-31

## Purpose

OVERVA surfaces, business roles, identities, and authorization boundaries are
related but are not the same thing. Sharing a browser shell, repository,
deployment host, API process, or sign-in provider never creates cross-boundary
authority.

This matrix tells people and agents which context they are changing before they
design UI, schema, routes, permissions, or audit evidence.

## Current matrix

| Surface or context | Primary code/routing | Identity and authority | Data/audit owner | Current truth |
| --- | --- | --- | --- | --- |
| Public OVERVA / guest Market | `public-site/`, `overva.com` | Anonymous guest presentation; no membership | Public editorial/sample state; browser-local drafts where stated | Implemented public surface; catalog interaction remains sample/browser-local |
| Market participant | `/api/market/*`, Market controls in `public-site/` | Market identity plus live Customer/Provider membership; selected view adds no authority | Isolated `market_*` records and Market audit journal | Identity, sessions, Customer, reviewed Provider and storefront foundation implemented |
| Market operator | `/api/market/*` operator guards; future operator surface | Separate live operator assignment; never inherited from founder, tenant, Customer, or Provider | Market operator records and Market audit | Bounded backend assignments exist; mature operator workspaces do not |
| Tenant organization application | `web/`, `app.overva.com`, tenant API routes | Tenant user, optional employee link, live tenant roles/permissions, enabled modules and workspace policy | Organization-scoped PostgreSQL records and tenant audit | Implemented pilot Platform/runtime |
| Tenant employee master | Tenant employee/HR/structure routes | No login authority by existence alone | Tenant-owned workforce data and HR/assignment history | Implemented; login is optional and separate |
| Tenant administration | Tenant application and tenant API guards | Organization owner/administrator roles and explicit permissions | Tenant configuration and tenant audit | Implemented foundation; not Platform or Market administration |
| Platform administration | `web/platform.html`, Platform routes, `admin.overva.com` | Platform admin with live Platform-scoped RBAC | Platform control-plane tables and Platform/security audit | Implemented Platform RBAC and Founder Control |
| OVERVA Apps vendor operations | Current admin blueprint/simulation; future vendor boundary | Separately attributable vendor assignments | Vendor product, release, support, sales, licensing and finance evidence | Planned operational backend; simulation is not authority |
| Group oversight | Current admin blueprint/simulation | Aggregate-only separately assigned oversight | Attestations and aggregate boundary health, not raw operating records | Accepted model; not a shared admin or database |
| Infrastructure operation | Docker/host/backup/recovery procedures | External system/operator credentials and explicit operational procedure | Host, deployment, backup and security evidence | Separate from application authorization |

## Mandatory separations

- A tenant token is rejected by Market and Platform-admin middleware.
- A Market token is rejected by tenant and Platform-admin middleware.
- A Platform/founder role grants no Market operator, Customer, Provider, tenant,
  or infrastructure authority.
- OVERVA Apps is a vendor and cannot review, rank, publish, or enforce its own
  Market participation.
- Group ownership exposes no raw tenant, vendor, proposal, complaint,
  investigation, ranking, or operator data.
- Infrastructure recovery is not a web super-admin and cannot suppress audit.
- Shared sign-in may map identity in a future reviewed contract; it never copies
  authority.

## Surface routing rules

Before changing a surface, record:

1. the user-facing surface and hostname;
2. the authenticated identity type;
3. the data owner and authorization middleware;
4. required permissions or process-specific authority;
5. append-only evidence and privacy boundary;
6. cross-boundary handoff, if any;
7. implemented versus preview/planned state.

Public samples, disabled controls, admin simulations, and browser-local drafts
must never be described as operating backend capability.

## Agent instruction routing

The repository-level `AGENTS.md` remains the common product constitution.
Additional folder instructions should follow real code boundaries rather than
inventing directories:

- `public-site/AGENTS.md` may govern public and Market presentation truth;
- `web/AGENTS.md` may route tenant application versus Platform-admin work;
- `api/AGENTS.md` may govern tenant, Platform, Market, audit, and migration
  boundaries.

Until those files are added, this matrix and `ARCHITECTURE.md` are the canonical
surface/authority routing references. `OVERVA Apps` must not be shortened to
`App` when that could be confused with the tenant application.

