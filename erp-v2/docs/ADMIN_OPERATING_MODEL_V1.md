# OVERVA Admin Operating Model V1

Status: accepted control model; Platform RBAC and V31 Founder Control are
production-deployed; Apps/Market identities and backends are not implemented

Accepted: 2026-08-28

## Purpose

OVERVA administration is organized around business responsibility, not around
one person remembering every screen and every code path. Each operating boundary
has its own work queues, decisions, permissions, evidence, and audit trail.

The four administrative contexts are:

1. **Group oversight** — aggregate strategy, risk, assurance, finance, and
   separation health only;
2. **Platform operations** — tenant service, identity, runtime, infrastructure,
   security, data, billing, support, and Platform audit;
3. **OVERVA Apps vendor operations** — product discovery, build, QA, release,
   support, licensing, sales, and vendor finance;
4. **Market operator** — supplier eligibility, listing review, security,
   publishing, custom-work integrity, forum moderation, complaints, appeals,
   fees, ranking neutrality, and Market audit.

There is no universal `Group admin` role. A person who legitimately performs
more than one responsibility enters each context through a separately
attributable assignment. Context switching does not expand permissions.

## Workspaces and queues

| Context | Primary workspaces | Consequential gates |
| --- | --- | --- |
| Group | Boundary health, aggregate performance, risk, assurance, policy, consolidated finance | Independent risk and vendor-independence review before a Group attestation |
| Platform | Command center, tenant operations, identity/access, releases, runtime, reliability, backup, integration, IoT safety, billing, audit | Initiator + security + release approval + independent runtime operator |
| OVERVA Apps | Portfolio, requirements, architecture, build, data/integration, design, QA, security, release packages, implementation, support, licensing, sales, vendor finance | Product owner + QA + product security + independent release manager |
| Market | Supplier verification, listing intake, technical/security review, catalog, compatibility, licensing, fees, ranking audit, custom work, forum, complaints, investigations, disputes, appeals | Intake + independent technical review + independent security review + catalog publisher |

## Twenty-role simulation catalogs

The catalogs below are test personas, not a recommendation to hire eighty people
or create eighty production accounts. During the founder-led phase one real
person may hold multiple non-conflicting assignments. A critical approval may
not be faked by switching between virtual personas.

### Group oversight

Board chair; strategy director; portfolio analyst; enterprise risk officer;
compliance oversight; security oversight; finance consolidation; internal
auditor; legal counsel; privacy oversight; conflict-of-interest officer;
investment analyst; business-continuity lead; brand steward; people governance;
vendor-independence reviewer; policy secretary; metrics analyst; independent
assurance reviewer; read-only observer.

### Platform operations

Operations lead; tenant operations; identity administrator; access reviewer;
security approver; release approver; runtime operator; site reliability
engineer; database operator; backup/recovery operator; integration operator;
IoT safety controller; audit reviewer; privacy operator; billing operator;
support lead; quality analyst; capacity planner; incident commander; read-only
observer.

### OVERVA Apps vendor operations

Portfolio lead; product manager; business analyst; solution architect; AI
builder; low-code builder; software engineer; data engineer; integration
engineer; product designer; quality approver; product security reviewer; vendor
release manager; implementation lead; support lead; sales lead; customer
success; vendor finance; license operator; read-only observer.

### Market operator

Operator lead; supplier verifier; listing intake; technical reviewer; security
reviewer; catalog publisher; compatibility reviewer; license reviewer; fee
operator; ranking-neutrality auditor; custom-work moderator; proposal-integrity
reviewer; forum moderator; knowledge curator; complaint intake; investigator;
dispute reviewer; independent appeal reviewer; Market audit reviewer; read-only
observer.

## Explicit handoffs

Cross-boundary access is denied by default. Collaboration uses a versioned,
redacted handoff rather than raw source access.

The first implemented simulation contract is `OVERVA Apps -> Market`:

1. Apps completes QA and product-security review.
2. An independent vendor release manager packages the release.
3. Apps publishes only product code, public name, version, support policy,
   release fingerprint, and ownership badge.
4. Market listing intake accepts that snapshot.
5. Market performs its own technical and security review.
6. A separate Market publisher may publish only after both reviews pass.

Source repositories, credentials, signing secrets, customer tenant material,
private product discussions, competitor information, and operator controls do
not cross this handoff.

## Founder-led operating mode

OVERVA can be developed by one founder without pretending that one person is a
safe production approval chain:

- simulations and automated tests may exercise all eighty virtual identities;
- production receives only real, attributable people or service identities;
- low-risk reversible work can use founder approval plus automated evidence;
- security, payment, legal, Market enforcement, production release, and other
  consequential gates remain pending when an independent reviewer is required;
- the admin UI should surface queues, missing approvals, risks, and next actions
  so the founder does not need to remember the whole codebase.

## Implemented evidence

`api/test/fixtures/admin-operating-simulation.js` implements eighty isolated
virtual identities, permission checks, four-eyes cases, aggregate-only Group
visibility, append-only event evidence, and the redacted Apps-to-Market handoff.
`api/test/admin-operating-simulation.test.js` exercises both permitted journeys
and deliberate failure paths.

This is control-model evidence only. It does not create production identities,
grant cross-boundary access, or make Apps and Market operational backends.

Migration `0056_platform_admin_rbac.sql` implements the first real bounded
backend slice inside the existing Platform control plane. It adds a live-derived
Platform role/permission model, preserves existing administrators through the
`platform-owner` role, and guards organization, adoption, operations, system,
AI-governance, AI-usage, catalog-validation, and billing routes server-side.
The browser requests and displays only the Platform areas granted to the signed-
in administrator. None of these roles grants Group, OVERVA Apps, or Market
access. Platform RBAC migration `0056` is production-deployed. Role-assignment
administration remains a later, separately audited slice.

Migration `0057_founder_control.sql` implements the V31 founder-led
operating slice. It adds a Platform-only `founder-operator`, two bounded
permissions, at-most-sixty-minute tenant diagnostic grants, and append-only
grant events. The Founder Control UI distinguishes live Platform authority from
preview Market memberships, planned Apps/Market operator boundaries, and
external system/break-glass operation. Support snapshots are redacted and
read-only; they create no tenant user, tenant token, or tenant API bypass.

`scripts/recover-platform-owner.js` is the separate offline break-glass path. It
requires production migration credentials plus explicit confirmation, target,
and reason, and writes both Platform and security audit evidence. V31 is
production-deployed.
