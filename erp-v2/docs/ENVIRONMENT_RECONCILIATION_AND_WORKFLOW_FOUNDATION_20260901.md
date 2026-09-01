# Environment reconciliation and shared workflow foundation — 2026-09-01

Status: **implemented and verified locally; not deployed to production**

## Phase 0 evidence

Repository and documented production authority agree through schema `0080`:

| Version | Repository file | Repository SHA-256 | Documented production |
|---|---|---|---|
| `0079` | `0079_work_order_assignment_write_guard.sql` | `6980b5008d1b7dc8a0fed8279133a2e06eaeb8a4444e5c79cd9bbb706c911ba2` | exact match |
| `0080` | `0080_automation_delivery_idempotency.sql` | `204ad706add8246f7478a0bb7b5e1dc24d414a80c6cd5df0cbc8f4ac0a6bf2d9` | exact match |

The production evidence remains
`PRODUCTION_PHASE_A_RELEASE_20260831T121534Z.md`; no production connection or
write was performed in this implementation.

The local database was at `0079` with applied checksum
`5c67374512217eec036f8f2d46830d3635863e07e95ea0a3c75fd10d66357d33`.
That known pre-release variant had the assignment identity check but lacked the
identity guard trigger and retained `ON DELETE CASCADE` on the Work Order parent
foreign key. The migration runner now recognizes only that exact
version/filename/checksum tuple. It preserves the original migration-history
row rather than rewriting it. Migration `0081` explicitly verifies/repairs the
constraint, trigger, function and `ON DELETE RESTRICT` authority.

## Migration safety

- No table, column, production row, employee number or historical event is
  dropped, renamed, deleted, guessed or synthesized.
- Migrations `0081`–`0085` are forward-only and transactional.
- `0081` repairs schema mechanics only; it does not insert/update Work Order
  evidence.
- `0082` adds independent coordination snapshots and append-only event journals.
- `0083` preserves `documents.linked_entity_*` and all existing domain tables.
  It projects only directly evidenced legacy document relationships, and leaves
  correspondence/archive/attachment canonical references null when unknown.
- The compatibility view includes legacy-only rows written by an older writer
  after migration. New document and HR-document routes dual-record the legacy
  fields and canonical link in one transaction.
- `0084` adds delivery coordination and attempt evidence without mutating the
  immutable notification intent. Existing intent receives only an honest
  pending projection; no delivery attempt or provider result is synthesized.
- `0085` enables RLS only on ten audited foundation tables. It makes the
  compatibility view security-invoker and explicitly tenant-filters both its
  canonical and legacy branches.

## Implemented foundation

`workflow_cases` stores tenant-scoped coordination identity/current snapshot and
an optimistic `version`. Immutable transition, assignment, decision, comment,
idempotency-receipt and notification-outbox tables record actor and server time.
The service requires live backend permissions, derives tenant/actor from the
authenticated request, locks commands and cases in a stable order, rejects
stale versions and conflicting idempotency payloads, and writes audit/outbox
evidence in the same transaction.

This foundation has no complaint UI, leave route, hiring/termination workflow,
archive destruction workflow or business-specific state machine. HR,
correspondence and archive domain state remain their own source of truth.

The document foundation adds append-only `document_links`, a compatibility
view, and nullable tenant-composite canonical document references on
correspondence, archive and attachment records. Existing binary versions,
lifecycle events, metadata and legacy references remain in place.

Phase 1.5 adds transaction-local tenant context, a safe-disabled notification
worker/adapter contract, mutable delivery state separated from append-only
attempt evidence, controlled RLS activation, and an offline/retry command
contract. A missing tenant context sees no protected tenant row, transaction
tenant mismatch is rejected, and connection-pool reuse does not retain tenant
state. System bypass is disabled by default and has no application caller.

## Verification

- Known-drift rehearsal: known pre-release `0079` checksum through `0085`,
  passed without rewriting the applied checksum.
- Clean bootstrap: `0001` through `0085`, passed; migration rerun was a no-op.
- Local development migration: `0083` through `0085`, passed.
- Local aggregate preservation after migration: 21 Employees, 21 null
  `employee_no` values, one organization and 106 Work Orders remained
  unchanged.
- Full Node unit/source suite: 336/336 passed.
- Workflow integration: authorization, cross-tenant denial, optimistic
  concurrency, exact replay, conflicting payload, assignments, decisions,
  comments, immutable evidence/audit, outbox and document compatibility passed.
- Canonical document integration additionally passed duplicate/concurrent
  links, atomic rollback, delete restriction, checksum/version uniqueness and
  attachment/document tenant mismatch.
- Delivery integration passed disabled-provider safety, stable provider
  idempotency, concurrent-safe claims, crash recovery, bounded retry,
  dead-letter state and append-only attempt evidence.
- RLS integration passed missing-context denial, canonical and legacy document
  tenant isolation, mismatched-write denial and pool-reuse cleanup.
- The broad legacy HTTP integration harness now passes fully on a disposable
  database. Its stale raw tenant fixture uses canonical provisioning,
  test-required modules are explicit, the current report response contract is
  asserted, the Platform create response no longer treats a plain subscription
  as a query result, and direct Work Order completion preserves assignee
  notification behavior.
- Existing Work Order assignment and material integrations pass on disposable
  `0085` databases.
- A disposable production-migration rehearsal verified runtime grants: insert
  remains available for immutable intent/evidence, delivery-state update
  remains available, and journal mutation plus state deletion remain revoked.

## Current versions and deployment boundary

- Repository latest schema: `0085`.
- Local development database: `0085`.
- Last documented production schema: `0080`.
- Production deployment: not performed.

## Remaining risks and Phase 2 boundary

- Ten audited foundation tables now have RLS enabled. Seven discovery evidence
  tables were already enabled. Thirty-seven other policy-bearing tables remain
  release-gated until their application, report, worker and admin consumers are
  audited and moved to transaction-local tenant context.
- Notification delivery has no real provider adapter yet. The worker is
  disabled by default and must not be enabled until an idempotent provider,
  credential handling, observability, alerting and an operator runbook are
  reviewed.
- Generic workflow adapters must update domain state and workflow evidence in
  one database transaction and must pass the domain-specific permission.
- Phase 2 may add reviewed adapters/state machines for selected complaint,
  leave, hiring/termination, correspondence or archive processes, plus canonical
  document adoption per domain. It must not infer historical transitions or
  employee numbers.
