# OVERVA Current State

Last updated: 2026-08-24

This document answers one question: **what exists in the repository now?** It
does not claim that every implemented foundation is complete or production-
validated at enterprise scale.

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

## Implemented Foundations

### Platform and tenancy

- Ordered PostgreSQL migrations with transaction/advisory-lock protection.
- Organization/tenant, subscription, user, role/permission, and platform-admin
  foundations.
- Server-derived tenant identity and tenant-scoped data access patterns.
- Immutable audit foundation for critical actions.
- Public trial provisioning and platform administration portal.
- Organization settings, enabled modules, plans, billing records, and tenant
  lifecycle foundations.

### Organization, people, and governance

- Canonical organization, department, position, employee, and optional employee
  login-account separation.
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
- Smart Import foundations for structured data and organization structure.
- Organization Structure Smart Import now separates proposed action, validation,
  human review decision, and commit outcome in the PostgreSQL/API contract.
- Row correction, acceptance, reasoned exclusion, approval blocking, commit
  reconciliation, tenant isolation, and immutable audit are implemented.
- A privacy-safe dry run against a real 56-row employee workbook validated the
  parser, mapping, and validation flow without database writes. Duplicate
  employee identifiers block commit, while ambiguous dates and duplicate
  emails are routed to human review. The production API was rebuilt and
  health-checked after these normalization fixes.
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
- Choibalsan employee and lighting migration tooling with provenance controls.

## In Progress

- Customer journey evidence model for Discovery → Blueprint → Pilot → First
  Value → Go-live → Paid → Champion → Referral.
- Platform-admin adoption/funnel presentation and manual milestone controls.
- Continued normalization of imported Choibalsan operational data into general
  OVERVA domain concepts.
- Validate the Organization Structure Smart Import with additional real,
  anonymized customer files and refine mapping/quality rules from the evidence.

## Current Product Focus

1. Make organization discovery and Smart Import easier and safer.
2. Measure setup effort, abandonment, assistance, first value, and adoption.
3. Turn real pilot problems into reusable patterns without hard-coding the
   pilot's terminology into the platform.
4. Keep tenant-facing navigation role- and workspace-relevant.
5. Improve the platform-admin view of system health, adoption, AI cost, data
   quality, and operational risk.

## Known Boundaries

- An implemented foundation is not automatically mature, complete, or proven at
  large scale.
- Some module code exists before its tenant-facing workflow is fully polished.
- The current single-host deployment is a pilot architecture, not evidence of
  high-availability deployment.
- AI must not silently apply consequential configuration or operational changes.

## Do Not Rediscover as New Work

Search the repository before proposing another Smart Import, blueprint,
requirements interview, approval gate, tenant model, employee master, immutable
audit, customer journey, or AI usage-governance system. Improve the existing
capability when it serves the same purpose.

## Updating This File

Update after a material capability is implemented, removed, or changes status.
Use the labels **implemented**, **in progress**, **planned**, and **hypothesis**
carefully. Do not mark a feature complete merely because a table or screen exists.
