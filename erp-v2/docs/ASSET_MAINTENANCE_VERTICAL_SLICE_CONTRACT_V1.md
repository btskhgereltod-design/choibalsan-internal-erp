# Asset Maintenance Vertical Slice Contract V1

Status: accepted implementation and pilot contract; Work Order authority is
implemented, remaining runtime completion is planned

Accepted: 2026-08-31

## Purpose

Prove the Connected Organization model through one real operational outcome
instead of building another broad module layer. The slice connects existing
employee, organization, asset, operational object, work order, approval,
inventory, measured outcome, attachment, finance-integration, and audit
foundations.

The pilot outcome is:

> A reported asset or operational-object problem reaches attributable,
> authorized, evidenced, accepted completion, while consumed material and
> measured work remain traceable to the same work identity.

## Scope boundary

This slice may extend existing capabilities and contracts. It does not:

- replace the work-order implementation with a universal workflow engine;
- treat a position or job title as a permission;
- make every inventory movement an accounting posting automatically;
- invent procurement, payment, or supplier records when evidence is absent;
- allow AI to approve, assign, issue material, complete work, or control a
  device;
- weaken IoT command precedence or offline safety;
- publish tenant work or evidence to Market.

## Existing foundations to reuse

- `employees`, primary `employee_assignments`, users and live tenant RBAC;
- departments/organization units, jobs, positions, reporting relationships;
- `assets`, `operational_objects`, and object-component links;
- `work_orders`, `work_order_events`, approval workflow,
  `work_order_approvals`;
- `work_order_scope_items` and append-only scope-item events;
- attachments and object-specific access controls;
- warehouses, inventory items, balances, stock movements, purchase requests,
  and purchase approval events;
- finance import/transaction foundations;
- tenant audit and integration-event contracts.

## Canonical journey

```text
1. Problem reported
2. Resource and location confirmed
3. Work order triaged
4. Authorized assignment made
5. Scope and measurable outcomes confirmed
6. Required material requested
7. Material approved and issued
8. Work performed with evidence
9. Outcome and unresolved/deferred quantity recorded
10. Authorized acceptance or exception decision
11. Resource history and material trace finalized
12. Deterministic measures produced
```

A purchase request may branch from step 6 when stock is unavailable. It is not
silently treated as issued inventory or completed procurement.

## Required action context

Every consequential action records or can resolve:

- tenant organization;
- acting login identity and linked employee where applicable;
- action and state transition;
- work order and affected asset/operational object;
- location/organization context where relevant;
- current permission or explicit process authority;
- approval/rule and decision reason where required;
- correlation/idempotency identity for retried external actions;
- time and append-only evidence.

## Authority model

Implementation status: **partial**. Migrations `0064` and `0065` implement explicit
permissions for Work Order read-all, create, assignment, progress, measurable
scope updates, safety review, management approval, exception decisions, material
request, material approval, warehouse issue, and consumption confirmation.
Sensitive attachment and cost-evidence authority remain to be completed in
later stages of this contract.

Exact permission codes are finalized during implementation after inventorying
existing catalog entries. The policy must distinguish at least:

- report/view relevant work;
- triage and assign;
- approve scope or work plan;
- request material;
- approve material issue;
- execute stock movement;
- record work outcome;
- accept completion;
- request and accept/reject an exception;
- read sensitive attachments or cost evidence.

Workspace access explains relevance only. Assignment to a job or position does
not itself grant any sensitive action. The server enforces authority; the UI
may only reflect it.

## State and transaction rules

- State changes use the existing explicit work-order workflow and extend it
  only with reviewed compatible transitions.
- Assignment validates the active tenant employee/account/organization context.
- Material issue and balance change occur atomically and are idempotent where a
  request can be retried.
- A material request is not a stock movement. Approval is not issue. Issue is
  not consumption confirmation. Each has distinct evidence.
- Completed quantities cannot exceed planned scope. Unresolved or deferred work
  requires the existing accepted-exception boundary before closure.
- Closing work never deletes earlier events, attachments, assignments, or
  decisions.
- Financial evidence, if produced, references the work/material transaction;
  it is not fabricated from UI state.

## Measurement contract

The first deterministic measures are:

- report-to-triage time;
- triage-to-assignment time;
- assignment-to-start and start-to-completion time;
- approval waiting time by gate;
- reassignment and rework count;
- planned/completed/unresolved/deferred quantities;
- requested versus issued/consumed material;
- stock-unavailable delay;
- repeat failure by asset/operational object and failure class;
- workload by active employee assignment;
- accepted exception rate.

Measures are observations, not automatic judgments. AI recommendations cite
their source measures and remain proposals until authorized human review.

## Acceptance scenarios

1. An authorized reporter creates work for a resource in their tenant; another
   tenant cannot see it.
2. An employee whose workspace is visible but lacks assignment authority cannot
   assign the work.
3. An inactive or revoked identity cannot perform a consequential transition.
4. A valid assignee records scoped progress and evidence without gaining
   approval authority.
5. Material approval without issue leaves inventory unchanged.
6. Repeating the same issue request does not double-decrement stock.
7. Insufficient stock fails safely or creates an explicit procurement branch;
   it never invents a successful issue.
8. Full completion closes normally; unresolved/deferred quantity blocks normal
   completion until an authorized exception is accepted.
9. Resource history shows the attributable work, scope outcome, and evidence.
10. Audit/event history rejects update and delete attempts.
11. Legacy role compatibility does not expand the new permission decision.
12. AI can explain a delay but cannot change assignment, approval, inventory,
    closure, permission, or device state.

## Delivery stages

1. Map the current work-order, inventory, attachment, finance, and audit
   contracts and identify missing links.
2. Approve the explicit permission/process-authority matrix and compatibility
   behavior.
3. Add only the minimum schema/service changes needed for the end-to-end trace.
4. Implement transactional material request/issue linkage and measured outcome
   evidence. **Implemented for request, approval/rejection, issue, and
   consumption trace; the explicit stock-shortage procurement branch remains
   planned.**
5. Update tenant UI around the same work identity without duplicating master
   records.
6. Run unit, integration, cross-tenant, authorization, idempotency, append-only,
   migration, rollback, and browser tests.
7. Pilot with a bounded real maintenance journey and measure the contract above.
8. Generalize only the patterns proven reusable by that pilot.

## Production gate

Implementation does not authorize production deployment. Production requires
an explicit request, verified backup, migration rehearsal, compatible rollback,
service health, authorization matrix, tenant-isolation checks, and evidence
that existing work orders and inventory balances remain intact.
