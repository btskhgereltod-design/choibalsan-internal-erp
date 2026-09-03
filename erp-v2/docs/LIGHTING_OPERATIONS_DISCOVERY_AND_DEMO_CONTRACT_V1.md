# Lighting Operations Discovery and Demo Contract V1

Status: **draft for user and engineer review; not production authority**

Prepared: 2026-09-03

## Purpose

This contract turns the useful working behavior of the legacy lighting ERP into
a safe OVERVA demo without copying its ambiguous data model or destructive
history behavior.

The pilot journey in scope is:

```text
Lighting object registry
-> fault observation and repair work
-> approved switching schedule
-> monthly meter observation
-> supplier electricity invoice reconciliation
-> authorized payment evidence
```

The demo must remain one projection over canonical tenant data. It must not
create a second lighting work engine, second fixed-asset master, or a special
Choibalsan authorization shortcut.

## Release boundary

- Production remains on implementation commit `d2f947c`, rollout record
  `d677644`, and schema `0098`.
- This discovery performed no production database query, migration, business-
  data write, service restart, or deployment.
- Legacy SQLite `data/app.db` was opened with `sqlite3.OPEN_READONLY` only.
- Demo implementation does not authorize production deployment.
- Production promotion requires an explicit later request, reviewed migration,
  production-clone rehearsal, backup, rollback proof, authorization matrix,
  tenant-isolation checks, audit checks, and full regression verification.

## Product and authority constraints

This work inherits the accepted OVERVA boundaries:

1. Organization is the tenant boundary and tenant identity is server-derived.
2. An accounting Asset and a functional Operational Object remain different
   truths.
3. An operational incident records an observed condition; a Work Order owns
   assignment, execution, HSE and management acceptance.
4. Workspace visibility never grants write or approval authority.
5. Consequential commands require explicit permission, validation,
   attributable append-only evidence and appropriate human review.
6. IoT command priority remains Emergency > Manual > Weather > Schedule >
   Default at every control layer, including offline operation.
7. Choibalsan names and workflows are tenant configuration and pilot evidence,
   not universal OVERVA defaults.

## Repository demo slice implemented after discovery

The source-controlled slice is implemented on the isolated local demo but is
not migrated or deployed to production:

- the lighting tab and section are explicitly named **Гэрэлтүүлгийн объектын
  бүртгэл**;
- known legacy road-object codes (`ГТ-*`) are projected as 36 road-lighting
  candidates; 69 unresolved `sl_points` rows remain visible in an explicit
  unclassified review queue, while 12 `ГД-*` compatibility copies are retained
  as provenance but excluded in favor of the 12 canonical traffic-signal
  Assets;
- cards separate object/equipment records, open fault rows, affected units and
  active Work Orders; the generic label "issue" is not used as a substitute
  for any of those grains;
- object rows expose pole, head and replacement-pole source quantities without
  creating synthetic Asset allocations;
- `lamp_count`, `head_count` and `total_heads` remain distinct source facts for
  `sl_points`; `sl_ger_inventory.total_count` is category-sensitive source
  evidence: one tower row is one mast with `total_count` heads, while a ger-area
  row follows the legacy one-head-per-pole convention;
- the wide fault sheet supports local drafts, clear, density, zoom, sticky
  identity and one atomic batch submission;
- migration `0099` adds tenant incident-type reference data, explicit
  permissions, incident versions and append-only exact-payload receipts;
- the runtime report API derives tenant/actor server-side, validates the
  lighting object and active reference type, and writes the incident, event,
  audit and receipt in one tenant transaction;
- linked Work Order state changes advance the incident version. Accepted Work
  Order completion is still the ordinary resolution authority.

Correction, cancellation, richer duplicate/capacity validation, object-master
review commands, schedules, readings and invoices remain later slices. The
repository suite passes `450/450`. A clean `0001` through `0103` disposable
migration, no-op rerun and authenticated two-tenant API rehearsal passed. The
accepted test row produced exactly one incident, append-only event, idempotency
receipt and audit row; exact replay created nothing new, changed-payload replay
conflicted, and a cross-tenant object reference was rejected. The disposable
database was removed; no production migration or business-data write occurred.

## Verified implementation state

### Implemented

- One tenant-scoped `operational_objects` master supports hierarchy, type,
  domain, location, status, source identity and metadata.
- `operational_object_components` links dated, quantified portions of canonical
  fixed assets to functional objects without moving or cloning the asset.
- The object dossier already projects components, incidents, Work Orders,
  child objects and append-only notes/events.
- Canonical `operational_incidents` and append-only incident events preserve
  affected and resolved quantities.
- Incident-to-Work-Order coordination is explicit. Accepted Work Order closure
  may resolve a linked incident without inventing a second work record.
- The lighting workspace is server-filtered to the authenticated organization
  and `domain='lighting'`.

### Partial

- The current lighting object list is read-only. Reviewed `ГТ-*` rows are
  presented as road-corridor candidates, but final canonical approval and the
  81-row unclassified review workflow are not implemented.
- The object dossier can allocate assets and add notes, but it cannot maintain
  canonical object identity/hierarchy or report/update incidents.
- The wide sheet can report new incidents in an audited idempotent batch;
  correction and cancellation commands remain planned.
- Imported pole/head counts remain legacy metadata, not reviewed object
  structure or component allocations.

### Planned by this contract

- A domain-specific **Гэрэлтүүлгийн объектын бүртгэл** surface over the existing
  canonical object authority.
- An engineer-oriented wide fault sheet and the object dossier as two views of
  the same incident records.
- Reviewed lighting object types, component roles, fault types and units as
  tenant-owned reference data.
- Governed schedule, meter-reading, supplier-invoice and reconciliation
  authorities.

### Not currently implemented

- Canonical lighting switching schedules.
- Canonical energy meter/measurement-point master and installation history.
- Canonical monthly meter observations.
- Canonical supplier electricity invoices, reconciliation decisions and payment
  evidence for tenant operations.

## Legacy implementation map

| Legacy source | Observed purpose | Useful behavior to retain | Defect not to copy |
| --- | --- | --- | --- |
| `sl_points` | Mixed lighting point, street and billing-oriented records | Fast list, code/name search and totals | One table carries several meanings; object UI shows only one code family |
| `sl_ger_inventory` | Ger-area and tower location inventory | Familiar location list and quantity summary | `total_count` means heads on one mast for tower rows, but poles/heads under a one-to-one convention for ger-area rows; a generic import corrupts the grain |
| `assets` | Fixed equipment including panels and traffic signals | Equipment passport and files | Some operational groups were also stored as assets |
| `sl_faults` | Current aggregate fault state by location | Direct quantity entry in the object list | Current mutable quantity can overwrite the meaning of earlier evidence |
| `sl_fault_repairs` | Incremental repaired-head entries | Simple repair history and remaining quantity | Repair is not governed by canonical Work Order/HSE acceptance |
| `asset_events` | Work/repair rows and dossier history | Object-linked work history | A second work authority with editable progress and role checks |
| `light_schedule_logs` | Effective category-level on/off history | Timeline, seasonal comparison and recommended-time display | Scope is a free category string; update/delete rewrites or removes history; no approval/application evidence |
| `meter_points` | Meter registry parsed from supplier PDFs | Bulk review, ownership classification and draft candidates | Invoice import may create master candidates automatically; meter is not effectively installed against an object/feed point |
| `sl_monthly_readings` | Manually entered monthly readings | Wide monthly entry and basic anomaly warning | Current snapshot has zero rows; updates overwrite a period row and negative use is silently clamped to zero |
| `sl_bills` | First monthly bill summary model | Expected-vs-invoice comparison | Competes with the later invoice model and has weak workflow semantics |
| `electricity_bill_raw_rows` | Raw supplier PDF lines | Raw evidence retained for review | Rows can become orphaned when a parent is deleted with SQLite foreign keys not enforcing the expected cascade |
| `electricity_bill_points` | Normalized supplier invoice lines/readings | Day/night normalization and meter-level review | Supplier invoice observations are treated as if they were the only meter-reading truth |
| `electricity_bill_checks` | Import reconciliation warnings | Explicit new-meter, owner, transfer and usage-variance findings | Findings are mutable flags and many historical child rows are orphaned |
| `electricity_bill_imports` | Later supplier invoice header/payment model | Preview-before-confirm and period uniqueness | Confirm trusts client-returned normalized rows/checks; delete removes authority and payment is only a mutable status update |

## Read-only legacy evidence snapshot

The following results describe the local legacy snapshot on 2026-09-03. They
are discovery evidence, not approved migration totals.

### Object and fault evidence

- `sl_points`: 117 rows.
- The legacy road-object screen filters to code prefix `ГТ-*`: 36 rows, 1,747
  poles, 2,582 heads and 43 replacement poles. These exactly explain the user-
  visible road summary.
- Of the other 81 `sl_points` rows, 12 `ГД-*` intersection rows duplicate the
  12 separately imported canonical traffic-signal Assets. They remain immutable
  provenance but are not listed or counted as lighting objects. The remaining
  69 `ГЧ`, `НЭ`, `ЯЗ` and `НГ` rows cannot be classified safely from prefix
  alone and remain visibly unclassified.
- `sl_ger_inventory`: 191 ger-area rows and 143 tower rows.
- `sl_faults`: 212 rows; 204 are currently open under the three reviewed
  lighting categories. Several open/closed rows have no valid canonical
  location link or damaged category text.
- The road category contains 36 rows labelled open by the legacy system, but 11
  have zero remaining damage. The operational projection therefore exposes 25
  non-zero fault rows, 24 linked affected objects and 338 currently affected
  units. The source's 36-row status count is a separate grain from the
  independently verified 36 `ГТ-*` road objects and must not be labelled as 36
  active issues.
- `sl_fault_repairs`: 9 rows.
- `sl_inspections`: 22 rows.
- No `sl_points` or `sl_ger_inventory` row currently has a meter link or an
  asset link in this snapshot.

Consequences:

- The existing OVERVA projection of 117 road records is an imported-row count,
  not an approved road-object master count.
- The 36 `ГТ-*` rows may be presented as reviewed legacy road-object candidates
  in demo.
- UI labels must keep **object count**, **open fault-row count**, **affected-unit
  quantity**, and **active Work Order count** explicit; equality between two
  totals must never be treated as evidence that they are the same entity.
- The remaining 81 rows must stay in an explicit **Ангилал тодорхойгүй** review
  queue until source evidence or a human reviewer classifies them.
- No migration may infer physical fixed assets or meter installations from the
  legacy count fields.

### Schedule evidence

- `light_schedule_logs`: 19 rows covering road, ger-area and tower categories.
- Four category/effective-date combinations have duplicate rows.
- The current resolver selects the latest row whose `valid_from` is on or before
  the requested date.
- A schedule is not linked to a feed point, circuit, object, gateway, device or
  application acknowledgement.
- Schedule rows can be updated and deleted even though the UI calls them
  history.

Consequences:

- Legacy schedule rows are provenance and review candidates only.
- A category string cannot authorize or prove a field switching command.
- Duplicate effective rows must fail migration review rather than being ordered
  arbitrarily by row ID.

### Meter and billing evidence

- `meter_points`: 331 rows; 250 active, of which 241 are verified as ours, 5
  verified as transferred, 13 verified unknown and 4 unverified unknown.
- `sl_monthly_readings`: 0 rows.
- `sl_bills`: 4 rows.
- `electricity_bill_imports`: 7 current parent rows for 2026-01 through
  2026-07.
- `electricity_bill_points`: 2,356 rows under 11 historical import IDs; 1,020
  rows under five missing parent IDs.
- `electricity_bill_raw_rows`: 3,705 rows; 1,055 rows are orphaned.
- `electricity_bill_checks`: 1,870 rows; 1,215 rows are orphaned.
- Current parent ID 20 has no normalized child rows, while deleted parent IDs
  14-18 retain children.

Consequences:

- The newer supplier-invoice model contains useful raw evidence but is not a
  reliable canonical parent-child history as-is.
- The zero-row manual reading model and invoice-derived reading model are two
  competing truths and must not both be imported as authoritative readings.
- Parent existence, checksum, invoice period, meter matching and child totals
  require reconciliation before any canonical write.

## Canonical lighting object model

### Core hierarchy

The demo reuses `operational_objects` and permits these tenant-configured
lighting classes:

```text
lighting_system / service territory
└── corridor_or_location_group
    ├── feed_point
    │   └── feeder_or_circuit
    │       ├── segment
    │       └── pole (optional until individually surveyed)
    └── other governed child object
```

This is a configurable hierarchy, not a requirement to create all levels for
every organization.

### Granularity rule

- A street/corridor with 200 poles may be one operational object when current
  work is managed as aggregate quantities.
- A pole becomes a child operational object when it has a stable identifier and
  needs its own GPS, components, incidents, work history or dossier.
- Missing exact pole identity does not block reporting a real fault. The
  incident targets the known corridor/feed/segment and records the affected
  quantity plus an explicit location-precision status.
- A later survey may relate the incident to a precise child object through an
  attributable correction; it never rewrites the original observation.

### Component rule

- Serialized/accounted equipment remains an Asset and is allocated to an
  Operational Object through the existing dated component relation.
- Quantity-managed items such as a cable lot may be allocated in metres only
  when the Asset master declares matching allocatable quantity and unit.
- Pole count, head count and wattage combinations are reviewed object
  composition facts. Legacy totals are not automatically converted into Asset
  quantities.
- A pole with one 150 W and one 50 W luminaire is represented as two component
  roles/specifications or two installed component records, not one ambiguous
  `head_count=2` fact when detailed evidence exists.

### Tenant-owned reference data

The canonical core stores stable codes while each organization owns labels and
allowed values for:

- lighting object type;
- component role;
- quantity unit;
- luminaire technology and rated power;
- fault/observation type;
- location precision;
- meter register type;
- reconciliation finding type.

Reference catalogs must be constrained and versioned. This is not an EAV or
free-form universal schema.

## Two surfaces, one fault authority

### Surface A — Гэрэлтүүлгийн объектын бүртгэл

This is the lighting-domain master list, not a global generic object menu.

Required behavior:

- lighting-area filter and canonical object-type filter;
- fixed code/name/location columns;
- verified object counts, component counts and data-completeness indicators;
- expandable rows for composition without opening the full dossier;
- object dossier link;
- explicit **Ангилал тодорхойгүй** review queue;
- no camera, building or unrelated-domain objects in this surface.

### Surface B — Гэмтэл бүртгэлийн дэлгэмэл sheet

This preserves the legacy engineer-friendly interaction without preserving its
mutable truth model.

Required behavior:

- sticky object code/name columns and sticky header;
- horizontal and vertical scrolling;
- compact/comfortable density and zoom controls;
- expandable composition/location columns;
- search and filters by service area, object type, fault state and precision;
- keyboard navigation, Enter-to-next-row and multi-row paste;
- local draft row add/remove;
- whole-batch validation before commit;
- per-row error and duplicate warning;
- visible dirty/saving/saved state;
- one batch receipt and stable per-row idempotency keys;
- a saved row links directly to the object dossier and incident history.

Add/remove semantics:

- Removing an unsaved draft row is local and leaves no business record.
- A submitted incident is never hard-deleted.
- A wrong submitted row uses an explicit `cancel` or `correct` command with
  reason, expected version and append-only event/audit evidence.
- Entering zero never silently means resolved or cancelled.
- `affected_quantity`, `resolved_quantity` and derived remaining quantity stay
  separate.
- Accepted Work Order completion remains the normal repair-resolution authority.

## Object dossier

The existing dossier is extended rather than replaced. It should project:

- canonical identity, type, hierarchy, location and status;
- composition and dated Asset allocations;
- feed points, circuits, meters and current approved schedule assignments;
- open incidents and complete incident history;
- linked Work Orders, measured outcomes, HSE and acceptance evidence;
- documents, photos, drawings and canonical links;
- meter-reading and invoice-reconciliation history where authorized;
- append-only object notes, corrections and component events.

The dossier is for investigation and history. Routine fault capture must not
force an engineer to open every dossier individually.

## Incident command contract

The demo requires a small runtime service over existing
`operational_incidents`; the browser must not write tables directly.

Proposed commands:

- `report`: create one observed condition.
- `add_observation`: append a later measured affected quantity or note without
  pretending work was performed.
- `correct_reference`: attach a more precise object/component after review while
  preserving the original reference.
- `cancel`: invalidate an erroneous report with a mandatory reason.
- `resolve_without_work`: exceptional authorized resolution with reason and
  evidence; ordinary repair remains Work Order completion.

Every command requires:

- server-derived organization and actor;
- explicit capability permission;
- domain and same-tenant object validation;
- expected version for existing records;
- exact-payload idempotency key;
- non-negative quantities and component-compatible unit;
- append-only incident event;
- attributable tenant audit;
- one database transaction.

## Governed schedule model

Schedule truth must be separate from IoT command/application truth.

Proposed aggregates:

1. `lighting_schedule_plans`
   - tenant, name, timezone, target scope, effective interval, version;
   - `draft -> review -> approved -> active -> superseded/cancelled`;
   - rationale, calculation/source and immutable approval snapshot.
2. `lighting_schedule_windows`
   - plan/version, applicable days or date range, on/off local time;
   - optional seasonal/holiday exception with explicit precedence.
3. `lighting_schedule_assignments`
   - approved plan/version to same-tenant feed point/control group.
4. `lighting_schedule_application_events`
   - requested, gateway accepted/rejected, device acknowledged, superseded;
   - applied checksum/version, actor/source and time.

Rules:

- Editing a draft is allowed; an approved version is immutable and superseded by
  a new version.
- Schedule approval does not bypass IoT priority or prove device application.
- A schedule cannot target a free category label alone.
- Connectivity loss continues the last approved safe local configuration.
- Legacy astronomical recommendations remain calculations/proposals, not
  automatic commands.

## Canonical meter and reading model

### Meter and measurement point

- A measurement point is the stable operational/accounting location being
  measured and links to a feed point or other operational object.
- A physical meter may be an Asset when accounting policy requires it.
- Effective-dated installation records connect a meter serial to one
  measurement point. Replacement ends the prior installation; it does not
  rewrite history.
- Ownership/responsibility changes are effective-dated evidence, not one mutable
  label inferred from the latest invoice.

### Reading batch and observation

- One batch records period, source (`field`, `supplier_invoice`, `device`,
  `approved_import`), document/checksum, actor and review state.
- Each observation records measurement point, installed meter/register,
  observed time, value, unit, multiplier and source row.
- Accepted observations are immutable. Corrections append a superseding
  observation and reason.
- Consumption is derived only after previous/current register continuity,
  multiplier, replacement and rollover rules validate.
- A negative difference fails validation unless an explicit rollover or meter-
  replacement event explains it. It is never silently clamped to zero.
- Day, night, capacity and future registers are separate typed observations.
- Duplicate period/register observations fail closed or enter a review queue.

## Canonical supplier invoice and reconciliation model

The tenant electricity bill is not OVERVA SaaS billing. It needs a separate
tenant energy-cost authority.

Proposed aggregates:

1. Supplier invoice header linked to a canonical Document/version and checksum.
2. Immutable raw imported rows preserving supplier evidence.
3. Reviewed normalized lines linked to measurement point and register where a
   confident match exists.
4. Reconciliation findings with open/resolved/accepted-exception states.
5. Approval decision separate from import and review.
6. Payment evidence separate from invoice approval, with reference, amount,
   currency, date, actor and supporting document.

Rules:

- Upload/parse produces preview only.
- The server recomputes normalization, totals and checks on commit; it does not
  trust normalized rows/checks returned by the browser.
- An unknown meter becomes a quarantined match candidate, not an active master
  record automatically.
- Parent/child counts, supplier period, invoice identity, checksums and totals
  reconcile before approval.
- Payment cannot be recorded by the same permission that merely uploads or
  reviews a bill unless tenant policy explicitly grants both capabilities.
- Approved/paid invoices cannot be hard-deleted; void/correction preserves all
  evidence.

## Proposed permission separation

Final codes require implementation review, but the authority dimensions must
remain separate:

| Capability | Minimum separation |
| --- | --- |
| View lighting objects/dossiers | reuse `operational-objects.read` plus workspace relevance |
| Maintain object identity/hierarchy | new explicit operational-object master permission |
| Allocate/remove fixed-asset components | reuse `operational-objects.components.manage` |
| Add dossier note | reuse `operational-objects.notes.create` |
| Report fault/observation | new incident-report permission |
| Correct/cancel incident | separate incident-correction permission |
| Convert incident to work | existing Work Order create/triage authority |
| Claim/execute/complete work | existing Work Order assignment/progress permissions and HSE route |
| Accept completed work | existing independent management acceptance authority |
| Draft schedule | schedule-draft permission |
| Approve schedule | separate schedule-approval authority |
| Apply/control schedule | IoT command authority constrained to Schedule priority |
| Maintain meter master/installation | meter-master permission |
| Capture readings | reading-capture permission |
| Review/correct readings | separate reading-review permission |
| Import supplier invoice | invoice-import permission |
| Reconcile/approve invoice | separate reconciliation and approval permissions |
| Record payment | finance payment-record permission |

No row is authorized by `users.role`, `employees.job_role`, a tab being visible,
or a client-supplied organization ID.

## Validation and audit minimum

All new tenant tables require:

- composite same-tenant foreign keys and tenant predicates;
- fail-closed RLS following current rollout policy;
- stable uniqueness within the tenant-owned authority;
- version and expected-version checks on consequential mutable projections;
- exact-payload idempotency receipts for batch and retriable commands;
- append-only event journals protected against update/delete;
- tenant audit with actor, action, resource, reason and request identity;
- canonical Document links for source invoices and formal evidence;
- no hard delete of submitted observations, approved schedules, invoices,
  decisions, payment evidence or audit/events;
- import provenance `(organization, source system, source table, source ID)`,
  source snapshot and checksum.

## Demo delivery slices

### Slice 0 — Evidence and contract

Status: **in progress**

- Complete legacy/code/data mapping.
- Confirm terminology and object granularity with engineers.
- Keep all production systems unchanged.

### Slice 1 — Object registry and fault sheet

- Rename the lighting surface to **Гэрэлтүүлгийн объектын бүртгэл**.
- Present 36 reviewed `ГТ-*` object candidates separately from 81 unclassified
  `sl_points` candidates.
- Add governed incident report/cancel/correction commands.
- Add the wide engineer fault sheet and dossier links.
- Reuse canonical Work Order, HSE and acceptance flow for repair completion.

Acceptance proof:

- An authorized lighting engineer can enter a multi-row fault batch without
  opening individual dossiers.
- A retry creates no duplicates.
- Invalid quantity, wrong-domain object, cross-tenant object and missing
  permission are rejected.
- Saved incidents appear identically in sheet, dossier and Work Board intake.
- Zero entry cannot erase or resolve a prior incident.
- Events and audit reject mutation.

### Slice 2 — Reviewed object composition

- Configure tenant-owned object/component reference data.
- Build street -> feed -> circuit/segment -> optional pole hierarchy.
- Allocate only evidence-backed Assets/quantities.
- Keep unresolved legacy rows in a review queue.

### Slice 3 — Schedule proposal and approval

- Add versioned plan, windows and assignments.
- Keep device application disabled until IoT priority and offline acceptance
  tests pass end to end.

### Slice 4 — Meter master and monthly reading

- Add measurement points, effective meter installation and reading batch.
- Provide an engineer/accountant wide entry sheet with server validation.
- Import legacy data only after dry-run reconciliation.

### Slice 5 — Invoice reconciliation and payment evidence

- Add server-side parse/normalize preview, approved commit, findings,
  invoice approval and separate payment evidence.
- Reconcile current and orphan legacy parent/child records before migration.

## Decisions still requiring human review

1. Confirm whether `ГТ-*` is the complete current road-object population or only
   one operational subset.
2. Classify the `ГЧ`, `НЭ`, `ЯЗ`, `ГД` and `НГ` `sl_points` code families using
   source evidence; do not infer from abbreviations.
3. Decide which poles require individual child-object dossiers now versus after
   a field survey.
4. Identify the real target of each schedule: feed point, circuit, control
   group, gateway or device.
5. Confirm whether monthly readings are collected independently in the field or
   only received inside the supplier invoice.
6. Identify the formal invoice reviewer, approver and payment recorder as
   capabilities, not fixed job titles.

## Explicit non-goals for the first demo slice

- No production deployment or production data correction.
- No live command to lighting devices.
- No schedule, meter, invoice or payment write.
- No automatic conversion of legacy counts into fixed assets.
- No hard-coded camera/object sharing in the lighting UI.
- No mass creation of 200 pole children without reviewed identifiers/evidence.
- No claim that the 117 imported `sl_points` rows are 117 verified road objects.
