# OVERVA Architecture

Last reviewed: 2026-09-02

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

## Choibalsan governed administration domains

The Choibalsan pilot exposes four connected but separately authoritative
administration domains under the tenant shell:

- Human Resources owns appointment cases, leave requests, employment-exit
  cases and the resulting canonical Employee lifecycle/assignment changes.
- Records owns incoming, outgoing and internal correspondence state.
- Complaints owns request, complaint and suggestion case state.
- Archive owns archive intake, location, retention, access and disposal state.

`bounded-domain-workflow.js` is the transaction coordinator for those domain
aggregates. A command locks the tenant/domain aggregate, verifies its expected
version and allowed state, updates the domain source of truth, advances the
shared workflow projection, appends transition/assignment/decision evidence,
writes attributable audit evidence, records an exact-payload idempotency
receipt, and creates notification intent. Those writes share one PostgreSQL
transaction. `workflow_cases.coordination_state` is never the authoritative HR,
correspondence, complaint or archive state.

Complaint resolution may request additional information, deliver an approved
response and optionally remain open for implementation monitoring. A
`complaint_hr_handoff` is an explicit, versioned and auditable request for HR
assessment. It remains Complaints-owned coordination evidence and never creates
or implies a disciplinary case. A later HR intake command may accept it only by
atomically creating a separately authoritative confidential discipline case;
decline or cancellation must preserve attributable evidence.

Employee transfer/rotation is a separate HR authority implemented by migration
`0092`. Its source and target placements reference canonical Assignments,
Departments and Positions; consent, proposal and decision evidence reference
canonical Documents. Only an approved, effective `implement` command ends the
current primary Assignment and creates a new active effective-dated row in the
same tenant transaction. Temporary completion restores the prior placement as
another new row, never by reopening or deleting history. Shared workflow state
coordinates review but is not placement authority.

Disciplinary case authority is implemented separately by migration `0093` and
is always restricted. Complaint handoff acceptance and new-case creation share
one tenant transaction, but the handoff remains Complaints-owned request
evidence and never becomes a finding. HR discipline owns notice, explanation,
investigation, finding, recommendation, independent decision,
acknowledgement, effective period, expiry/removal and dispute state.

Discipline list/detail, intake, investigation, recommendation, decision and
administration use distinct backend permissions. Per-case policy snapshots
carry the reviewed tenant policy and four-eyes requirement. The statutory
Article 123 clock is server-computed as the earlier applicable occurrence and
discovery deadline, including evidenced suspension periods, and preserves its
versioned calculation snapshot. Sanction expiry is one calendar year from the
server decision date; early removal requires canonical written/electronic
evidence. No tenant-specific deadline or approver is inferred from the pilot
Visio. A tenant/Employee/violation identity guard prevents duplicate
authoritative cases, while append-only events, audit, canonical Documents,
RLS, expected versions and exact-payload idempotency preserve evidence.
Discipline may not be represented as a generic Employee event or as
shared-workflow authority.

Sensitive discipline reasons remain in the restricted discipline event stream.
Shared workflow, outbox and general audit evidence receive only an opaque
command label, state/version and case identity; they do not receive the
restricted narrative.

Users without `hr.discipline.confidential.read` receive no real discipline
list, count or search facts. Canonical documents linked to a discipline case
remain hidden from document lists, version metadata, mutation and file download
unless that same confidential permission is present, even when the user can
otherwise manage documents. Restricted document classification additionally
requires `documents.restricted.read`.

Formal evidence is referenced through canonical `documents` plus append-only
`document_links`. Existing attachment arrays, legacy document entity columns,
correspondence references and archive references remain readable during the
compatibility period. New domain code does not create a second file authority.

Phase 2 domain evidence and command receipts reject update/delete at the
database. New tenant tables have active fail-closed RLS policies; application
tenant predicates, composite tenant foreign keys and server-side RBAC remain
mandatory. Existing correspondence/archive aggregate RLS stays in the staged
rollout until every pre-Phase-2 compatibility reader is audited.

Archive disposal has additional gates: a retention-eligible record, no active
legal hold, immutable item-set hash, commission decision, canonical disposal
act, explicit execution permission, and verification by a user other than the
executor. Browser UI never treats execution or verification as final before
the server response.

## Legacy migration evidence boundary

Legacy migration review is separate from both source systems and authoritative
OVERVA domains. The read-only extractor produces a checksum-bearing evidence
envelope. Staging may write only the tenant-scoped provenance registry, its
append-only decision journal and attributable audit; it has no employee,
master, attendance, document, correspondence, archive or workflow mutation
path.

The source identity is `(organization, legacy source, legacy table, legacy
id)`. Replays with identical source and payload hashes are idempotent; a changed
payload under the same identity is a conflict. Human decisions require live
backend permission, expected version and exact-payload idempotency. Current
classification is a review projection backed by an immutable decision row,
not authoritative domain state. Legacy status remains provenance evidence and
is never translated into synthetic workflow transitions, approvals or cases.

Schema `0089` adds a deterministic coordination layer over that evidence. A
review group owns no domain state: it records a category, immutable source
membership, signals, recommendation, confidence and any external-evidence
gate. Group decisions and tenant-scoped batch-command receipts are append-only;
the current group status is a versioned projection tied to an exact decision
and actor. Selected batch commands lock groups and member provenance in stable
order, require expected versions and exact-payload UUID idempotency, and commit
atomically. Approval changes only migration classification/review projections;
it never invokes an import.

Attendance is grouped by legacy Employee/date. Latest and superseded rows are
candidates, not facts; final approval or legacy-only disposition is blocked
until separately governed production reconciliation evidence is verified. File
hash equality is a duplicate signal rather than a logical merge identity, and
legacy correspondence is not inferred to be a complaint.

An existing target is validated inside the authorization tenant. Employee
matching uses the retained legacy identifier. Derived organization masters are
corroborated through those identified employees and their active primary
assignments; display names alone cannot merge records. `IMPORT_NEW` means only
eligible for a separately approved importer.

Schema `0090` adds that bounded adapter for approved high-confidence order and
correspondence groups. Dry-run is the default and has no write path. Commit is
separately permissioned and environment-gated, executes in one tenant
transaction, stores immutable run/source-target/event evidence, uses canonical
`documents`, `document_versions` and `document_links`, and creates only the
0086 correspondence baseline. Stable mappings make source reruns no-op/replay;
number collisions, missing stable assignees and checksum drift fail closed.
Legacy status stays provenance metadata, and the adapter never creates
historical correspondence events, workflow cases, approvals or HR state. A
successful import may set `imported_at` once only through a matching append-only
import event. No HTTP import endpoint exists.

The SQLite source adapter is packaged outside the request-serving API runtime.
It runs only as the non-root, no-port, one-shot `legacy-canonical-importer`
service behind an opt-in Compose profile. The main API dependency and image do
not contain SQLite or its native build chain. The importer has its own locked
runtime, mounts the approved immutable database and attachment snapshot
read-only, and retains the same default-dry-run, explicit commit flag and
environment gate. This packaging boundary changes no schema, approval,
provenance, checksum or source-to-target rule.

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

Work Order material handling is one connected transaction trace over existing
inventory master data, not a second inventory system. Request, approval,
warehouse issue, and consumption confirmation are distinct tenant-scoped states
with attributable append-only evidence. Only warehouse issue may mutate an
inventory balance; it locks the approved request and warehouse balance in one
transaction, records a linked stock movement, and uses a tenant-scoped
idempotency key so a retry cannot decrement stock twice. Insufficient stock
leaves both request and balance unchanged and does not fabricate procurement.

Work Order assignment has two compatible representations with different
purposes. `work_orders.assigned_to` is the current tenant User snapshot used by
existing authorization, operational boards, and clients. Version-1 `assigned`
records in `work_order_events` are the canonical append-only timeline for an
initial state, assignment, reassignment, or unassignment. They preserve typed
same-tenant User references and the Employee link observed at the event time.
Snapshot change, history, and audit are committed atomically; retries may use a
tenant/work-order idempotency key and an unchanged assignee is a no-op. Reusing
that key with a different target, reason, source, or actor is a conflict, never
a replay. User and Employee evidence must be the same tenant-owned pair, not
merely two independently valid same-tenant identifiers. Events
without a history version are legacy evidence and never authorize a fabricated
backfill. Historical reporting returns their assignment state as unknown.
The journal rejects row mutation, runtime update/delete/truncate privileges are
revoked, and its parent relation uses delete restriction rather than cascade.

Assignment enforcement deploys in two phases. The schema-first phase accepts
unversioned events from a previous application image as explicitly non-
canonical transition evidence, allowing safe application rollback. A later
activation migration may reject unversioned assignment writes only after every
writer is version-1 capable and the old image is retired. Migration and full
integration tests that create immutable evidence run only against disposable
`overva_test_*` or `overva_rehearsal_*` databases.

Automation sources may supply a stable tenant-scoped delivery key. Repeating
the same key and exact payload returns the original event without rerunning
rules, creating another Work Order, or queuing another webhook. Reusing the key
with different event identity or payload is an explicit conflict. Each rule may
run at most once for one automation event; existing events are not backfilled
with synthetic keys.

An accounting Asset remains organization master data. A functional street,
line, facility, zone, or system is an Operational Object and may reference
multiple Assets through dated, quantified component allocations. Allocation
does not move, clone, or retire the Asset master record. Ending an allocation
sets its removal date; it does not delete history. The Operational Object
dossier presents its hierarchy, active and historical components, incidents,
Work Orders, and attributable append-only notes/events as one operational view.
This supports divisible components such as cable as well as discrete equipment,
without inferring physical quantities from lamp counts or other legacy fields.
Each Asset master declares its allocatable quantity and unit. Allocation locks
that Asset row, totals all active tenant-scoped object allocations, enforces the
same unit, and rejects any request above the remaining quantity. Reducing the
master quantity below an already allocated amount or changing its unit while
active allocations exist is also rejected.

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
