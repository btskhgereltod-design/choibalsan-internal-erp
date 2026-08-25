# OVERVA data management foundation

## Canonical organization and people model

OVERVA keeps the existing `departments` table name for API compatibility, but
the table is the canonical **organization unit** master. A tenant can therefore
model a branch, division, department, section, team, site, store, project or
facility without changing the application schema.

The canonical relationship is:

`organization -> organization unit -> position -> employee assignment`

- `jobs` stores reusable work/profession definitions.
- `positions` stores approved headcount in an organization unit and references
  one job.
- `employees` stores the employment identity.
- `employee_assignments` stores effective-dated placement, position and
  reporting-line history.
- `users` is an optional login account for an employee.
- organization job titles and access roles are separate. A director title does
  not automatically grant the tenant `owner` system role.

Legacy `employees.department_id`, `position_id` and `manager_employee_id`
columns remain synchronized while old clients migrate to the assignment model.

## Data management layers

- **Reference data:** `reference_sets` and `reference_values` define controlled
  classifications such as unit type, assignment type and data classification.
- **Master data:** organizations, organization units, jobs, positions,
  employees and assignments have tenant keys, uniqueness rules and validity
  periods.
- **Metadata:** `data_catalog_assets` describes core data products, ownership,
  classification and personal-data status.
- **Governance:** `organization_data_stewards` records tenant data ownership.
- **Quality:** `data_quality_rules` records reusable completeness, uniqueness,
  validity, consistency, timeliness and integrity controls.
- **Audit:** critical application actions continue to use the append-only audit
  journal.

## Data lifecycle controls

Migration `0033` adds a safe first production phase for end-to-end data
lifecycle management:

- `data_lifecycle_policies` stores tenant-specific archive and retention
  metadata for catalog assets.
- `organization_data_stewards` assigns an accountable employee to each data
  domain.
- `data_legal_holds` blocks disposition approval for a whole catalog asset or
  one record key.
- `data_disposition_requests` records archive, anonymize and delete requests
  with an explicit decision.
- `data_lifecycle_events` is an append-only evidence journal for every policy,
  steward, hold and disposition decision.

Approval is mandatory for every disposition policy. Approval records a
decision only: this phase intentionally has no automatic hard-delete executor.
The immutable audit asset cannot be assigned a destructive policy or submitted
for disposition. A later execution service must use per-domain handlers,
re-check legal holds and retention, remain idempotent, and write completion
evidence before it can be enabled.

The tenant primary administrator manages these controls from **Settings → Data
management**. DMBOK knowledge areas are design and control lenses, not separate
sidebar modules.

Migration `0034` adds tenant-specific data architecture controls without
allowing tenants to change the physical database schema. For every catalog
asset an organization can identify the authoritative system, permitted update
direction, history strategy, criticality, availability class, archive tier and
RPO/RTO targets. Critical assets require both recovery targets. Every change
writes both the tenant audit log and the append-only lifecycle evidence log.

`app.overva.com` remains the tenant control surface. `admin.overva.com` shows
only cross-tenant coverage and risk counts: configured controls and policies,
steward coverage, active holds, pending disposition requests, and backup
freshness. It deliberately does not expose employee or business-record detail.

## Tenant isolation and RLS rollout

Every tenant-owned relationship uses `organization_id` and composite foreign
keys where cross-tenant references would be dangerous. API queries must also
scope reads and writes by the authenticated `organization_id`.

Migration `0032` creates PostgreSQL row-level security policies, but deliberately
does not enable them yet. Enabling them before all routes use a transaction-local
tenant context would interrupt the production service or risk connection-pool
context leakage.

Before enabling RLS:

1. Run every authenticated request in one database transaction.
2. After authentication, execute
   `SELECT set_config('app.organization_id', $1, true)` using the authenticated
   tenant UUID. The final `true` makes the setting transaction-local.
3. Reject tenant routes without a valid tenant UUID before database access.
4. Convert background jobs to explicit per-tenant transactions.
5. Run cross-tenant negative integration tests with two organizations.
6. Enable and force RLS one table at a time, beginning with assignments and HR
   data, while monitoring errors and audit events.

Never use a session-level `SET app.organization_id` with pooled connections.

## Analytics rule

Operational tables remain the source of truth. A future warehouse/read model
must be populated from controlled application events or repeatable ETL and must
not replace master data. Dashboards are downstream consumers of governed data,
not the data foundation itself.
