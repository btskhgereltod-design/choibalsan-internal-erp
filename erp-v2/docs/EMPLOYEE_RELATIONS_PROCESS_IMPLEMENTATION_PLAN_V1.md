# Employee Relations Process Implementation Plan V1

Status: approved for staged local implementation on 2026-09-02. Production
deployment and production data writes are outside this approval.

## Objective

Extend the existing OVERVA architecture with three connected but separately
authoritative processes:

1. request, complaint and suggestion resolution in the existing Complaints
   domain;
2. employee temporary transfer and rotation in HR employee relations;
3. confidential disciplinary case review in HR employee relations.

The Visio diagrams are AS-IS evidence. They do not override repository
authority, tenant isolation, permissions, canonical documents, assignment
history, audit or idempotency contracts.

## Verified baseline and gaps

- Complaints already owns an authoritative, tenant-scoped, versioned and
  idempotent case lifecycle. It already supports registration, assignment,
  investigation, response review, management approval, official delivery,
  closure, canonical document links, immutable domain/workflow evidence and
  derived overdue queues.
- The Complaints gap is additional-information semantics, optional
  implementation monitoring and an explicit auditable request for HR to assess
  whether a separate disciplinary case is warranted.
- HR already owns appointment, leave and employment-exit governed cases and
  uses canonical Employee, Position and effective-dated Assignment records.
- HR has no authoritative transfer/rotation case and no confidential
  disciplinary case.
- Shared workflow is coordination evidence only. It must not become the owner
  of Complaints, transfer, discipline or Assignment state.
- Repository/local schema is `0090`. Documented production is `0080` and was
  not connected to during this work.

## Legal and policy boundary

The current official Mongolian Labour Law identifies article 58 as temporary
transfer, article 59 as rotation, article 123 as disciplinary action and
article 154 as labour-rights dispute resolution. The Visio reference to
article 126 as disciplinary authority is not used.

Tenant policy remains independently configurable and versioned. Every transfer
or future discipline case snapshots the reviewed policy source and material
rules used for its decision. Unverified tenant deadlines, routing and approver
assignments are not hard-coded.

## Delivery sequence and gates

### Slice 1 — Complaints extension — implemented and verified

- Preserve `complaint_cases` as the authority.
- Add an explicit additional-information command using existing immutable
  transition evidence.
- Add optional implementation-monitoring state and completion evidence.
- Add a governed complaint-to-HR handoff request. Creating the request must not
  create a disciplinary case.
- Gate: migration contract, tenant RLS, backend permission, idempotency,
  version conflict, audit/outbox, canonical evidence link, operator UI and
  regression tests pass.

### Slice 2 — Employee transfer/rotation — implemented and verified

- Add an authoritative `hr_transfer_case` aggregate with separate initiation,
  eligibility, consent, HR review, management decision, document,
  acknowledgement, implementation and monitoring stages.
- Reuse canonical Employee, Position and Assignment references.
- Change the canonical Assignment only through an approved effective command;
  end the previous assignment without deleting or overwriting its history.
- Gate: tenant isolation, permissions, policy snapshot, canonical documents,
  idempotency/concurrency, assignment-history and UI tests pass.

### Slice 3 — Disciplinary case — implemented and verified

- Add an authoritative confidential `hr_discipline_case` aggregate.
- Separate intake, investigation/review and final-decision capabilities.
- Preserve notice, explanation or refusal, evidence, finding, decision,
  acknowledgement, effective period, expiry/early removal and dispute evidence.
- Accept a Complaint handoff atomically with creation of a new discipline case;
  declining it must preserve an attributable reason.
- Prevent multiple sanctions for the same authoritative case/violation.
- Gate: confidential list/detail filtering, backend permissions, tenant RLS,
  policy/legal validation, four-eyes rules where configured, immutable history,
  idempotency and UI tests pass.

### Final verification

Status: completed locally on 2026-09-02. Clean `0001` to `0093`, focused
contracts, the full 394-test suite and disposable PostgreSQL integration pass.
The production evidence hardening additionally verifies separate Article 58/59
consent rules, server-computed Article 123 clocks/expiry, and denial of
restricted discipline inference through counts and canonical document paths.
Production deployment and production data writes remain outside approval.

- Run migration tests on a disposable `overva_test_*` database only.
- Run focused tests, the full unit/contract suite and relevant integration
  suites.
- Update `CURRENT_STATE`, `ARCHITECTURE` and `DECISIONS` to match proven code.
- Do not deploy, migrate production, rewrite history, import legacy data or
  broaden unrelated permissions.

## Stop conditions

Stop and report rather than guessing if implementation would require a new
cross-domain authority, uncertain consequential legal rule, historical rewrite,
destructive operation, production write/deploy or unrelated master-data
redesign.
