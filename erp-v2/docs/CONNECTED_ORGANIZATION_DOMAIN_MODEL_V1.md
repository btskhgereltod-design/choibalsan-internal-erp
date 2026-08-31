# Connected Organization Domain Model V1

Status: accepted conceptual model; runtime normalization remains incremental

Accepted: 2026-08-31

## Purpose

OVERVA models an organization as connected truth, responsibility, work, and
learning. Product navigation may expose modules or workspaces, but domain
design starts from the organization's real records and work rather than from
isolated software categories.

The durable reasoning order is:

```text
Master Data
-> Organization
-> Responsibility and Authority
-> Process and Transactions
-> Measurement and Optimization
```

This is a conceptual ontology, not a proposal for one universal table, event
payload, workflow engine, or shared database. Domain schemas remain small,
versioned, and bounded. Market, tenant Platform, Platform administration, and
external systems retain their accepted identity, data, authorization, and
audit boundaries.

## Non-goals

- Do not rebuild implemented capabilities under new names.
- Do not make every organization use one fixed hierarchy or process.
- Do not infer system permission from a job title or reporting position.
- Do not merge Market identities with tenant employees or Platform operators.
- Do not turn the conceptual model into an entity-attribute-value schema.
- Do not let AI apply consequential configuration or operational changes.

## Layer 1 — Master Data

Master data answers: **what and who exist in this bounded organization?**

Typical tenant-owned master domains include employees, assets, operational
objects, inventory items, products, customers, suppliers, locations,
warehouses, equipment, and reference catalogs. Each record has one
authoritative owner in its domain. Processes reference that record instead of
recreating a local copy of its identity and descriptive truth.

Important distinctions:

- `Person` is a human concept, not a currently accepted universal cross-product
  database identity.
- `Employee` is tenant-owned workforce master data.
- `Login Identity` proves access and may optionally link to an employee.
- `Asset` is accounting/asset master data.
- `Operational Object` is a functional system, line, area, or segment that may
  contain multiple assets.
- A future Market product or supplier record belongs to the Market boundary and
  is not tenant master data merely because a tenant may consume it.

## Layer 2 — Organization

Organization answers: **where does it belong and how is work arranged?**

The model separates:

- Organization / tenant;
- Organization Unit (current compatible department/unit representation);
- Job Definition — reusable description of work;
- Position — an approved place in the structure;
- Employee Assignment — a time-bounded employee placement;
- Reporting Relationship — accountable working/reporting relation.

Choibalsan-specific unit names, ranks, job titles, and reporting patterns are
tenant data and pilot evidence, not universal OVERVA defaults. Changes to
structure or assignment preserve history and use explicit effective state
rather than silently rewriting past work.

## Layer 3 — Responsibility and Authority

Responsibility answers: **who is expected or allowed to do what, in which
context?**

These concepts are not interchangeable:

```text
Employee != Login Identity
Job Definition != Position
Position != Responsibility
Responsibility != System Role
System Role != Permission
Permission != Workspace Access
Workspace Access != Process Approval Authority
```

Current tenant access combines server-derived tenant identity, organization
roles, permissions, enabled modules, and job-to-workspace policy. A workspace
being visible does not authorize every action inside it. A job assignment may
explain relevance or responsibility but never silently grant a sensitive
permission.

Process-specific authority must be explicit when generic RBAC is insufficient.
Examples include approving a work order, reading sensitive HR evidence, issuing
an IoT command at a given priority, or accepting an exception to measured work.
Those decisions remain tenant-scoped, attributable, and audited.

## Layer 4 — Process and Transactions

Process answers: **what is happening to organizational truth?**

An operational action should be explainable as:

```text
WHO
did WHAT
to WHICH RESOURCE
WHERE
WHEN
under WHICH AUTHORITY
with WHICH APPROVAL OR RULE
and WHICH EVIDENCE
```

Processes reference master and organization records. They use explicit state
transitions, idempotency where repeated delivery is possible, transactional
application, and append-only evidence for consequential changes. A process may
span several bounded domains through explicit contracts; it does not obtain
authority by copying another domain's record.

OVERVA Connect continues to use small versioned domain envelopes. This model
does not replace that contract with one universal event payload.

## Layer 5 — Measurement and Optimization

Optimization answers: **what should be learned or improved after reliable work
evidence exists?**

Initial deterministic measures include cycle time, waiting time, approval count,
rework, reassignment, workload, recurring asset failure, material shortage,
deferred work, exception frequency, and measurable outcome variance.

AI may explain evidence, identify a suspected bottleneck, compare alternatives,
or draft a change proposal. A proposed change remains separate from approved
configuration and execution:

```text
Evidence -> Measurement -> Proposal -> Validation -> Human approval
         -> Transactional application -> Audit -> Outcome measurement
```

No optimization result silently changes permissions, workflows, master data,
production releases, financial records, or device control.

## Current implementation mapping

| Layer | Implemented foundation | Important remaining work |
| --- | --- | --- |
| Master Data | Canonical employees, assets, operational objects, warehouses and inventory items | Normalize ownership/contracts across remaining partner, product, material, and location domains from real pilots |
| Organization | Departments/units, jobs, positions, employee assignments, reporting, Structure Hub and Smart Import | Continue effective-history normalization and reduce compatibility mirrors |
| Responsibility | Tenant RBAC, permissions, user-role assignments, job-workspace access, Platform RBAC | Remove legacy job-role authorization from domain routes without breaking compatible tenants |
| Process | Work orders, approvals, HR, inventory/procurement, IoT, audit, measured outcomes | Prove connected cross-domain vertical slices rather than introduce a universal workflow rewrite |
| Optimization | Executive metrics, data-quality learning, AI proposal boundaries, measured work outcomes | Add process measures only after reliable attributable event evidence exists |

## Evolution rules

1. Inventory existing tables, routes, services, UI, and tests before adding a
   concept.
2. State whether a capability is implemented, partial, planned, or hypothesis.
3. Prefer compatibility views/mappings and additive migration over destructive
   renaming.
4. Derive tenant identity from authenticated server context.
5. Scope foreign keys and uniqueness to the owning boundary where applicable.
6. Define permission, process authority, audit, migration, rollback, and test
   impact before implementation.
7. Validate one real end-to-end work outcome before generalizing a pattern.
8. Update `CURRENT_STATE.md` only after implementation status changes.

## Design review questions

Before material domain work, answer:

1. Which layer owns the proposed truth?
2. Is an authoritative record already present?
3. Which identity and tenant/data boundary owns it?
4. Is the requested access relevance, visibility, permission, or process
   authority?
5. Which state transition and audit evidence are required?
6. What compatibility data is mirrored today, and how will it converge safely?
7. What real pilot outcome proves the change is needed?

