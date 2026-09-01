# Choibalsan HR, Records and Archive — GAP Analysis and Implementation Plan V1

Status: **analysis/proposal only — not approved for implementation**
Date: 2026-09-01
Evidence: six unique Choibalsan Hugjil AS-IS Visio/JPG process diagrams supplied by the user, repository code, migrations, tests, and read-only aggregate checks of the running local Compose database.

## Executive conclusion

OVERVA already has substantial but uneven foundations for this scope. Canonical employees, organization structure, employment lifecycle evidence, leave requests, personnel files, canonical documents and versions, data-retention governance, permissions, audit, notifications, correspondence, and archive registers all exist. The correct implementation path is therefore **extension and consolidation**, not a second HR/document/archive product.

The six AS-IS diagrams are not ready to be encoded directly as production workflows:

- HR is the strongest current area, but appointment and termination are represented by low-level lifecycle writes and mutable checklists rather than governed cases with appointment/dismissal decisions, handovers, orders, and four-eyes approval.
- Leave supports one pending-to-approved/rejected decision, but does not represent the diagram's duration-based routing, return-for-correction, order issuance, delegation, or employee self-service authority.
- `correspondence_records` and `archive_records` are useful registers, but their generic status `PATCH` APIs allow lifecycle jumps and do not create immutable domain event histories.
- The canonical `documents` model is materially stronger than those two registers, but the three are not consistently linked. Formal evidence can therefore be duplicated as document metadata, correspondence metadata, archive metadata, or a lightweight attachment.
- No citizen request/complaint case aggregate exists. A complaint must not be reduced to an incoming letter because it has its own validation, assignment, resolution, response, delivery, SLA, and appeal concerns.
- Archive appraisal, use/checkout, commission approval, destruction act, final disposal, and immutable disposal evidence are not implemented. Changing an archive row to `disposed` is not a safe destruction workflow.
- Broad permissions (`hr.manage`, `records.manage`, `archive.manage`, `documents.manage`) are insufficient for separation of registration, assignment, review, approval, signature, sensitive access, and destruction.
- Several critical writers lack idempotency, optimistic concurrency, atomic audit, and rejection of invalid state transitions.
- RLS policies exist for several newer tables but are intentionally not enabled because request-scoped tenant DB context is not deployed across all routes. Current isolation is primarily server-derived tenant context, explicit `organization_id` predicates, and composite tenant foreign keys.
- The service worker caches only the application shell. There is no offline mutation queue. Final approval, signing, archival transfer, or disposal must remain server-confirmed; safe local drafts can be added later.

Recommended sequence: close authority/audit/concurrency gaps first; introduce small shared workflow primitives; deliver leave and employment actions against canonical employees; add citizen cases and harden correspondence; unify formal documents; then implement archive retention/use/disposal. Migration must preserve unknown history as unknown and must not synthesize past approvals.

## A. Repository findings

### A1. Architecture and authority baseline

- PostgreSQL is the transactional source of truth. Tenant identity is derived from the authenticated user, not accepted from request input (`api/src/middleware/auth.js`, `docs/ARCHITECTURE.md`).
- Employee, login account, job definition, position, assignment, RBAC role, workspace access, and process authority are explicitly distinct (`docs/ARCHITECTURE.md`, D-032 in `docs/DECISIONS.md`).
- Current tenant roles and permissions are loaded live on every authenticated request. Fixed `users.role` / `employees.job_role` use remains compatibility debt.
- Critical evidence is intended to be append-only. `audit_logs`, canonical document versions/events, HR lifecycle histories, and selected approval/event journals have database guards, but coverage is inconsistent.
- The accepted five-layer model remains: Master Data → Organization → Responsibility and Authority → Process and Transactions → Measurement and Optimization. This proposal does not create a universal business table or merge identity/authority boundaries.

### A2. Relevant implemented schema

| Area | Existing entities | Assessment |
|---|---|---|
| Organization | `organizations`, `departments`, `jobs`, `positions`, `employee_assignments` | Implemented canonical structure; reuse. |
| People/access | `employees`, `employee_profiles`, `users`, `user_roles`, `organization_roles`, `permission_catalog`, `job_workspace_access` | Implemented, with some fixed-role compatibility debt. |
| Employment lifecycle | `employment_contracts`, `employee_compensation_history`, `position_description_versions`, `employment_lifecycle_events`, legacy `employee_events` | Partially implemented. New histories are append-only; legacy `employee_events` overlaps and is weaker. |
| Leave | `hr_leave_requests`, `hr_leave_events` | Partially implemented one-step approval. |
| On/offboarding | `employee_transition_checklists`, `employee_transition_checklist_items` | Partially implemented; item completion is mutable and may be undone silently in historical terms. |
| Correspondence | `correspondence_records` | Partially implemented register; no immutable event history or strict state machine. |
| Citizen complaints | None | Missing as a governed case domain. |
| Canonical documents | `documents`, `document_versions`, `document_lifecycle_events` | Strong foundation: versions, SHA-256, lifecycle, file immutability. Polymorphic single link and metadata breadth need extension. |
| Lightweight files | `attachments` | Useful for asset/work/employee evidence, but not a substitute for formal records. Non-personnel files can be hard-deleted. |
| Archive register | `archive_records` | Basic location/retention register only. |
| Retention governance | `data_lifecycle_policies`, `data_legal_holds`, `data_disposition_requests`, `data_lifecycle_events` | Strong approval/hold foundation, deliberately no disposal executor. |
| Approvals | `organization_workflow_policies`, `organization_work_type_routes`, `work_order_approvals` | Work-order-specific. Reusable concepts exist, but no shared cross-domain instance/assignment/decision contract. |
| Tasks/work | `work_orders`, `work_order_events`, assignment and material services | Strong operational example; must not be reused as the citizen/HR domain aggregate. |
| Notifications | `notifications` | Implemented but type constraint is narrow and operationally work-order-oriented. |
| Audit | `audit_logs`, `security_audit_events`, domain event tables | Implemented foundation; atomicity and before/after/reason coverage are inconsistent. |

### A3. API/service/UI findings

- HR APIs expose employee create/update, contracts, compensation, lifecycle transitions, employee documents, leave, schedules, attendance corrections, skills, training, performance, and transition checklists (`api/src/routes/hr.js`, `api/src/routes/hr-operations.js`).
- HR lifecycle transitions are server-validated and locked, but a user with broad `hr.manage` can make consequential lifecycle transitions without a separate approval case.
- Leave rejects overlapping pending/approved ranges and atomically writes an append-only leave event and tenant audit, but creation requires `hr.manage`; an ordinary employee cannot submit their own request.
- Records and archive have only overview/create/generic update APIs (`api/src/routes/records.js`, `api/src/routes/archive.js`). Status can be changed directly to any schema-allowed value without transition preconditions. Their mutation and `writeAudit` calls are not one transaction.
- Canonical document creation, version upload, and transition are transactionally audited. Signing requires provider/reference/time evidence; disposal requires an approved general disposition request.
- Employee attachments require HR plus sensitive-read permission and cannot be deleted; other attachment targets allow a deletion path. Attachments have no content hash/version model.
- The tenant UI has separate HR, Records, and Archive workspaces. HR is a mature tabbed workspace. Records and Archive are list/forms with free status selectors, which expose the backend lifecycle weakness (`web/administration.js`).
- No tenant UI currently exposes the canonical document workspace even though its API exists. Records/archive operators therefore cannot consistently use the stronger model.
- Notifications are readable and markable as read, but workflow-specific delivery, failure, escalation, and user preference evidence do not exist.

### A4. Test findings

Implemented tests mainly assert schema/source contracts:

- Canonical employee separation and no shadow login.
- HR lifecycle tables and append-only triggers.
- Leave/attendance event presence and selected audit calls.
- Canonical document version hash, append-only lifecycle, and no delete route.
- Retention approval/hold foundation and absence of a destructive executor.
- Basic tenant columns for HR/records/archive.

Missing for this scope: full API integration tests for the six workflows, tenant-crossing attempts, invalid transition jumps, return/reassignment/delegation, idempotent command replay, concurrent decisions, audit atomicity, attachment/notification failure, offline draft replay, retention commission approval, and final-disposal evidence.

### A5. Read-only aggregate data observation

The running **local Compose** database was inspected without selecting personal values:

| Observation | Aggregate result |
|---|---:|
| Local schema migration | `0079` |
| Choibalsan employees / profiles | 21 / 21 |
| Employees missing `employee_no` | 21 |
| Employee assignments | 42 |
| Tenant users / users linked to employee / login-enabled | 22 / 21 / 1 |
| Legacy employee events | 0 |
| Employment lifecycle events | 0 |
| Employment contracts | 0 |
| Leave requests | 0 |
| Transition checklists | 0 |
| Correspondence / archive records | 0 / 0 |
| Canonical documents / versions | 0 / 0 |
| Attachments / notifications | 0 / 0 |
| Audit log rows | 48 |

This is not asserted to be the production database. `docs/CURRENT_STATE.md` says production is at schema `0080`, so environment identity and schema must be reconciled before any migration. The zero lifecycle history for 21 active employees is a real local data-quality signal: do not invent hire/approval events. Preserve those historical boundaries as unknown unless source evidence is imported and reviewed.

## B. Existing capabilities by maturity

| Capability | State | Decision |
|---|---|---|
| Canonical employee and organization structure | Implemented | Reuse unchanged as authoritative master data. |
| Login/access separation | Implemented | Reuse; employment actions must not imply login authority. |
| Versioned contracts and employment lifecycle evidence | Partial | Extend through governed employment-action cases. |
| Leave request/decision history | Partial | Extend to policy-routed workflow and self-service. |
| On/offboarding checklist | Partial | Extend with responsibility, immutable item event history, handover evidence. |
| Correspondence register | Partial | Keep register, add canonical document link, assignment/decision/delivery history. |
| Citizen request/complaint management | Missing | Add a distinct case aggregate. |
| Canonical document metadata/version/hash/lifecycle | Implemented foundation | Make it the formal document source of truth. |
| General attachment handling | Partial | Keep for lightweight operational evidence; migrate formal files to documents. |
| Archive inventory/location | Partial | Keep compatible snapshot but add transfers, use, appraisal, disposal. |
| Retention policy/hold/disposition approval | Implemented foundation | Reuse and extend with separately controlled execution evidence. |
| Cross-domain approval/assignment | Partial | Extract reusable primitives from existing work-order patterns without merging domain truth. |
| Notification inbox | Partial | Generalize types and add outbox/delivery/retry evidence. |
| Tenant audit | Implemented foundation | Make all consequential writes atomic and include before/after/reason. |
| Offline mutation | Missing | Permit drafts only; no offline final approval/sign/disposal. |

## C. Six AS-IS process extractions

Anything not visibly established by the supplied diagrams is explicitly marked unknown.

### C1. Citizen request/complaint intake, resolution and response

| Field | Extracted AS-IS |
|---|---|
| Initiator | Citizen submitting a request, complaint or suggestion on paper or electronically. |
| Actors | Citizen; records officer; organization management; assigned responsible official. |
| Process owner | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION` — likely records/administration owner. |
| Input | Paper/electronic request, complaint or suggestion and its supporting material. |
| Activities | Receive → completeness check → register electronically → present to management → management routing/notation → transfer to official → resolve and draft response → management review/approval → formalize/sign/seal → send response. |
| Decision points | Submission complete? Response approved? The approval rejection/return route is not drawn. |
| Approval | Management reviews and approves response; notation/signature/seal are shown. Exact approver authority is unknown. |
| Handoffs | Citizen → records → management → records → responsible official → management → records → citizen. |
| Output | Resolved case, approved response, paper/electronic delivery to citizen. |
| Deadline/SLA | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`. |
| Documents/evidence | Original submission, completeness result, registration, routing notation, resolution/draft, approval, signed response, delivery evidence. |
| Exceptions | Incomplete submission returns for completion. Reassignment, withdrawal, appeal, duplicate, anonymous, confidentiality and missed-SLA paths are unknown. |
| Final state | Citizen receives response; delivery failure/acknowledgement semantics are unknown. |

### C2. Employee release or dismissal

| Field | Extracted AS-IS |
|---|---|
| Initiator | Management/HR on a legal basis, or employee through a written/electronic resignation request. |
| Actors | Employee; HR; management; handover participants; related asset/document holders. |
| Process owner | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION` — HR appears operational owner; management holds decision authority. |
| Input | Release/dismissal basis; employee request where applicable; supporting evidence. |
| Activities | Classify release vs dismissal basis → register employee request where applicable → observe 30-day notice shown in diagram → issue management order → hand over work → hand over assets/documents → complete routing sheet/signatures → assemble and archive personnel folder. |
| Decision points | Release or dismissal basis exists? Exact evidence threshold and appeal/review are unknown. |
| Approval | Management order. Whether legal/HR review and four-eyes control are mandatory is unknown. |
| Handoffs | Employee/management → HR → management → employee/units → HR/archive. |
| Output | Release/dismissal order, completed handover, access/property/document reconciliation, archived file. |
| Deadline/SLA | 30 days is shown for employee-initiated release; exceptions and current legal interpretation require legal confirmation. Other deadlines unknown. |
| Documents/evidence | Request, legal basis, management order, work handover, asset/document handover, routing sheet, signatures, personnel archive file. |
| Exceptions | Dispute, withdrawal, unreturned property, inaccessible employee, immediate dismissal, appeal, delegation unknown. |
| Final state | Employment ended and evidence archived. Whether system access is revoked before/at/after effective date is not drawn. |

### C3. Citizen appointment to a job

| Field | Extracted AS-IS |
|---|---|
| Initiator | Citizen interested in an available job. |
| Actors | Citizen; HR employee; director. |
| Process owner | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION` — HR appears operational owner. |
| Input | Application, civil-service questionnaire/form, three-generation biography, education certificate copy, social/health insurance book, ID copy, two photos, conflict-of-interest declaration/acknowledgement, conduct acknowledgement shown in the diagram. |
| Activities | Review job description → prepare documents → HR receive/check → request missing material if incomplete → evaluate/check → present candidate to director → director decides → issue appointment or refusal decision → notify citizen. |
| Decision points | Documents complete? Approve appointment? |
| Approval | Director approves appointment. Screening, interview panel and conflict checks beyond listed evidence are unknown. |
| Handoffs | Citizen → HR → director → HR/citizen. |
| Output | Appointment order and notification, or refusal decision and notification. |
| Deadline/SLA | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`. |
| Documents/evidence | Submitted document checklist, validation result, evaluation, director decision, order/refusal, delivery evidence. |
| Exceptions | Duplicate candidate, withdrawal, vacancy closure, data correction, appeal, conditional offer and background-check failure unknown. |
| Final state | Appointed/not appointed. Employee master creation should occur only after approved appointment/effective date, not at initial application. |

### C4. Leave permission

| Field | Extracted AS-IS |
|---|---|
| Initiator | Employee submitting a leave request and duration. |
| Actors | Employee; HR employee; unit-responsible engineer; director. |
| Process owner | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION` — HR administers; approver depends on duration. |
| Input | Leave request, requested period, reason, and supporting material for special paid leave where applicable. |
| Activities | Receive → verify duration → route one-day request to unit-responsible engineer → route longer request to director → approve/reject → record permission notation or issue order → notify employee. |
| Decision points | Duration/routing; approve leave? |
| Approval | One day: unit-responsible engineer shown. Longer leave: director shown. The diagram is internally inconsistent around 2–4 days versus over 4 days. |
| Handoffs | Employee → HR → responsible engineer/director → HR/employee. |
| Output | Approval notation or leave order, or rejection response. |
| Deadline/SLA | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`. |
| Documents/evidence | Request, reason/support, routing basis, decision/comment, permission/order, notification. |
| Exceptions | Return for correction, cancellation, overlap, replacement coverage, delegation and emergency retrospective request unknown. |
| Final state | Approved/rejected and employee notified. Whether attendance/schedule is updated is not shown. |

The paid-leave reasons and day counts printed on the diagram are evidence of the current AS-IS rule sheet, not verified current law. They must be reviewed by authorized HR/legal owners before configuration.

### C5. Official correspondence handling

| Field | Extracted AS-IS |
|---|---|
| Initiator | External/internal sender providing paper or electronic official material. |
| Actors | Records officer; organization management; assigned official; external recipient. |
| Process owner | Records officer/records function appears to own the register; exact accountable owner unknown. |
| Input | Incoming paper/electronic document, application or complaint; outgoing response/draft. |
| Activities | Receive/check/register → present to management → management routing notation → assign to official → official resolves/prepares response → records officer registers outgoing paper, obtains authorized signature, assigns number/registers, files, and sends paper/electronically. |
| Decision points | Routing and responsible official; whether a response/approval is required. Explicit rejection path is not drawn. |
| Approval | Management notation; authorized signature on outgoing document. |
| Handoffs | Sender → records → management → records → responsible official → records/signatory → recipient. |
| Output | Registered incoming/internal/outgoing record; filed original/copy; delivered outgoing document. |
| Deadline/SLA | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`. |
| Documents/evidence | Original, registration number, routing notation, assignment, response draft, signature, outgoing number, file/folder placement, delivery evidence. |
| Exceptions | Duplicate registration, wrong recipient, confidential item, returned mail, electronic signature failure, reassignment unknown. |
| Final state | Closed/archived after required response and delivery; exact closure rule unknown. |

### C6. Archive receipt, appraisal, use and destruction

This diagram contains four related sub-processes.

| Sub-process | Extracted AS-IS |
|---|---|
| Receive | Unit submits archival material → archive receives by count/type/period and list → completeness precheck → incomplete material returned for correction → receipt act/register → archival unit and registration number → list confirmation → organize, label box/folder, sequence → shelf/location → custody. |
| Appraise | Management order/plan → receive expired-retention lists/material → check retention/value/completeness → if retained mark permanent and keep → otherwise prepare destruction list/act/conclusion → commission meeting approval → submit to Aimag archive → receive approval/conclusion. |
| Use | Receive paper/electronic use request → register purpose/contact → inspect location/condition/readiness → if unavailable notify with a date → if available permit reading-room use or copy/reference under restrictions → record date/user/document/purpose → return original and confirm condition. |
| Destroy | List expired material → commission review/conclusion → obtain Aimag archive approval → issue destruction decision → approve act/sign → destroy by permitted method → second commission verifies → record act/date/count/volume/signatures → report to archive office. |
| Initiators | Organizational unit (transfer); management/archive plan (appraisal); user (access); retention schedule/commission (destruction). |
| Actors | Unit representative; archivist; management; appraisal/destruction commission; Aimag archive; requester/user. Exact membership and segregation are unknown. |
| Process owner | Archivist/archive function; final legal authority and commission ownership require confirmation. |
| Inputs/evidence | Transfer list, receipt act, retention schedule, appraisal list/conclusion, commission minutes, Aimag approval, access request/log, checkout/return condition, destruction act and verification. |
| Deadline/SLA | `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`. |
| Exceptions | Incomplete transfer and unavailable archive are shown. Legal hold, damaged/missing original, partial approval, commission conflict, failed destruction, duplicate act, appeal unknown. |
| Final states | In custody; permanently retained; access returned; or finally disposed with immutable evidence. |

## D. GAP matrix

| AS-IS step | Current OVERVA capability/entity | Gap | Risk | Proposed TO-BE capability |
|---|---|---|---|---|
| Citizen submits request/complaint | `correspondence_records` can register an incoming record | No citizen case, channel, complainant/contact, consent/privacy, category or case identity | Complaint reduced to a letter; SLA/appeal lost | `citizen_cases` plus canonical submission document and contact snapshot |
| Completeness check/correction | No equivalent for correspondence | No validation result, missing-item list or return cycle | Work proceeds on incomplete evidence; no trace | Case validation command + immutable case event + requested corrections |
| Electronic registration/number | Correspondence number generation under advisory lock | No idempotency; number is correspondence-only | Retry can create duplicates | Tenant/year registry sequence + idempotent register command |
| Management routing/notation | Direct `responsible_user_id` update | No assignment history, role-based route, delegation or comment evidence | Silent reassignment and unclear authority | Shared assignment primitive + domain event + policy-selected assignee |
| Official resolution and response | `resolution` text + status | No response document/version or structured outcome | Mutable summary substitutes for evidence | Case outcome + canonical response document/version |
| Approve/sign/send response | Canonical document transitions support approve/sign; records UI does not use them | Disconnected models; no delivery attempt/acknowledgement | False “responded/closed” | Link case/correspondence to document; server-confirmed approval/sign/delivery |
| Employee release/dismissal basis | `employment_lifecycle_events` can write `terminated`/`retired` | No employment-action case, basis taxonomy/version or required evidence | One broad HR user can end employment directly | `employment_actions` with typed basis and governed decision |
| Employee resignation + notice | No request object | 30-day/exception policy cannot be measured | Missed notice; unknown legal exception | Employee separation request + policy-calculated target date |
| Management termination order | Canonical document can represent order; no required link | Lifecycle can change without approved order | Employment snapshot and legal evidence diverge | Approved/signed order precondition before effective transition |
| Work/property/document handover | Transition checklist exists | Mutable completion; no accountable evidence, unresolved item gate or asset integration | Access/property left open | Versioned offboarding checklist + append-only item events + blocking exceptions |
| Archive personnel file | Employee documents/attachments and archive register exist separately | No transfer package or retention class enforcement | Duplicate/weak personnel evidence | Employee document links + archive transfer + retention schedule |
| Candidate application/materials | No recruitment/candidate aggregate | Employee may be created too early | Candidate becomes employee master incorrectly | `recruitment_applications` separate from employees |
| Completeness/evaluation | No appointment-case checklist/evaluation | Missing evidence and inconsistent decision basis | Unreviewable hiring | Required-document checklist + review evidence |
| Director appointment/refusal | Lifecycle offers candidate/offered/onboarding but only for employees | Candidate state and employee lifecycle conflated | Privacy/authority/duplicate identity risk | Appointment decision; create/link employee only on approval/effective transition |
| Appointment order/notification | Documents/notifications foundations exist | No mandatory link/delivery evidence | Appointment without order or acknowledged notice | Signed order + notification outbox/delivery event |
| Leave submission | `hr_leave_requests` | Requires `hr.manage`; no self-service/delegation/idempotency | Employees cannot own request; duplicates | `hr.leave.request` permission with self/authorized-on-behalf policy |
| Duration-based leave routing | One `hr.leave.approve` decision | No versioned tenant policy or multi-route approval | Wrong approver | Leave policy versions + evaluated route snapshot |
| Leave return/reassign/delegate | Not implemented | Only approved/rejected/cancelled | No correction or continuity | Returned/reassigned/delegated states/events |
| Permission notation/order | Decision event only | No canonical document/order requirement | Approval evidence incomplete | Optional/required decision document by route policy |
| Attendance/schedule impact | Attendance supports leave status manually | No approved-leave projection/reconciliation | Double entry and inconsistency | Idempotent approved-leave projection with reconciliation event |
| Incoming/outgoing official register | `correspondence_records` | Duplicates document metadata; no canonical document FK | Competing sources of truth | Correspondence envelope + document link; document owns content/version |
| Records assignment/response/close | Mutable status selector | No transition rules/events/preconditions | Lifecycle jumps and silent overwrite | Explicit commands and append-only `correspondence_events` |
| Outgoing signature/delivery | Canonical document sign exists | Not integrated; no delivery tracking | Closed without signed/sent proof | Signature and delivery preconditions |
| Archive receipt/transfer | `archive_records` create | No transfer/list/items/acceptance/correction | Row creation falsely implies custody | Archive transfer aggregate + item acceptance events |
| Classification/location/retention | Basic archive fields; general lifecycle policy | Free text/years, duplicated metadata, no schedule version | Wrong disposal date | Versioned retention schedule/class + archive unit/location history |
| Appraisal commission | General disposition request only | No commission, item conclusion, minutes or external approval | One admin can approve unsafe disposal | Appraisal case/items/commission decisions/external approval evidence |
| Archive access/use/return | Missing | No authorization, checkout or condition history | Confidentiality breach/loss | Access request, approval, checkout/use/return events |
| Destruction execution | Archive status can directly become `disposed`; data governance intentionally has no executor | Unsafe direct state; no act/verifier/external approval | Irrecoverable deletion without evidence | Two-stage approved disposal execution with four-eyes, legal-hold recheck, immutable act |
| Notifications | Generic inbox | Narrow types; no outbox/retry/failure | User not informed despite state completion | Transactional notification outbox + delivery attempts |
| Offline/failure | Shell cache only | No draft queue/idempotent replay | Data loss or duplicate retries | Local draft store only; server-confirmed commands with idempotency |

## E. Proposed domain architecture

| Domain | Owns | References but does not duplicate |
|---|---|---|
| HR / Workforce | Employee master/profile and effective employment truth | Users, positions, documents, approval evidence |
| Recruitment & Employment Lifecycle | Candidate applications; appointment/separation action cases; approved effective transitions | Employee created/updated only at governed gate; canonical orders |
| Leave | Leave request, policy-route snapshot, current state, leave events | Employee, approver authority, optional order, attendance projection |
| Citizen Requests & Complaints | Citizen case, category, channel, contact snapshot, SLA, resolution and appeal | Canonical submission/response documents, assignments, delivery |
| Records / Correspondence | Official incoming/outgoing/internal envelope and registry numbers | Canonical documents, citizen case where applicable, assignments |
| Document Management | Formal document metadata, parties, links, versions, checksum, classification, signature lifecycle | Domain aggregates remain owners of business state |
| Archive / Records Retention | Transfer, archival unit, classification/location, access/use, appraisal and disposal evidence | Canonical documents; general lifecycle policy/hold/disposition governance |
| Approval & Assignment | Versioned organization policy, bounded workflow instance, assignment/decision/evidence primitives | Never owns employee, complaint, leave, correspondence, document or archive business truth |
| Notification | In-app/outbound notification intent, delivery attempts, failure/retry | Domain event/correlation only |
| Audit | Attributable append-only critical command evidence | Domain event history; no raw document body |

### Shared workflow boundary

Extend `organization_workflow_policies` into a versioned, multi-domain policy catalogue, but do not force all domains into one hard-coded sequence. Add small orchestration primitives:

- policy version and structured step definitions;
- a workflow instance linked to exactly one tenant/domain record;
- assignment history (`assigned_to`, `assigned_by`, role/person, reason, delegation and reassignment);
- immutable decisions (`approved`, `rejected`, `returned`) with step, comment, actor and time;
- immutable workflow events with schema version and correlation/idempotency identity.

The domain aggregate remains the authoritative status. The workflow instance cannot mutate a domain by itself; a domain service validates both records and commits domain state, workflow evidence, audit and notification outbox in one transaction.

## F. TO-BE workflows and state machines

### Common command contract

Every consequential transition uses:

`actor + live permission + tenant + expected_version + idempotency_key + precondition + command + reason/comment + resulting state + side effects + audit event`.

Exact replay returns the prior result. Reusing a key with a different payload is `409 conflict`. State and evidence are locked and committed atomically. UI labels come from the same backend state enumeration/transition response.

### F1. Citizen case

TO-BE: receive → register → validate → return for correction or classify → assign → investigate/resolve → draft response → review → approve/sign → deliver → acknowledge/close → archive.

| From → command → to | Actor / proposed permission | Preconditions | Atomic side effects / audit |
|---|---|---|
| — → register → `registered` | Records intake / `citizen-cases.register` | Valid channel/contact minimum; unique idempotency | Registry number, submission link, event `case.registered` |
| `registered` → validate complete → `classified` | Records reviewer / `citizen-cases.validate` | Required evidence checked | Category/SLA snapshot, `case.validated` |
| `registered` → return → `awaiting_correction` | Records reviewer | Missing items listed | Correction notice/outbox, `case.returned` |
| `awaiting_correction` → resubmit → `registered` | Citizen/intake | New evidence/version | Submission version/link, `case.resubmitted` |
| `classified` → assign/reassign → `assigned` | Management/delegate / `citizen-cases.assign` | Live authority and assignee eligibility | Assignment event/outbox, `case.assigned` |
| `assigned` → start/resolve → `in_progress`/`response_draft` | Assigned official / `citizen-cases.resolve` | Actor is active assignee/delegate | Outcome evidence, response document draft |
| `response_draft` → return → `in_progress` | Reviewer / `citizen-cases.review` | Comment required | Decision `returned`, `case.response_returned` |
| `response_draft` → approve/sign → `approved` | Authorized approver/signatory / separate permissions | Current response version; policy step complete | Document approval/sign evidence, `case.response_approved` |
| `approved` → deliver → `delivered` | Records dispatch / `citizen-cases.deliver` | Signed response where required | Delivery attempt/reference, outbox, `case.delivered` |
| `delivered` → close → `closed` | Records owner / `citizen-cases.close` | Delivery success or documented exception | Closure reason, archive eligibility, `case.closed` |

Appeal/reopen rules: `UNKNOWN / REQUIRES BUSINESS CONFIRMATION`.

### F2. Employment separation

TO-BE: initiate → classify basis → collect/review evidence → approve/reject → issue/sign order → plan handover → execute handover/access actions → effective termination → verify → archive.

| From → command → to | Actor / permission | Preconditions | Side effects / audit |
|---|---|---|
| — → submit separation → `submitted` | Employee self or HR/management / `employment-actions.initiate` | Active employee; typed basis; evidence | Action case, notice target snapshot, `employment.separation_submitted` |
| `submitted` → validate/return → `under_review`/`returned` | HR reviewer / `employment-actions.review` | Basis/evidence checklist | Review event or correction request |
| `under_review` → approve/reject → `approved`/`rejected` | Authorized management / `employment-actions.approve` | Reviewer complete; four-eyes if policy requires | Immutable decision, order draft/outbox |
| `approved` → sign order → `ordered` | Signatory / `documents.sign` | Approved current order version | Signature evidence, effective date locked |
| `ordered` → start offboarding → `handover` | HR / `employment-actions.execute` | Checklist version selected | Account/asset/document tasks assigned |
| `handover` → record exception → `handover_blocked` | Responsible item owner | Required item unresolved | Escalation/outbox, append-only item event |
| `handover` → make effective → `effective` | HR executor / `employment-actions.make-effective` | Signed order; effective date reached; mandatory gates satisfied or approved exception | Append `employment_lifecycle_events`, update employee active snapshot, initiate access revocation separately, audit |
| `effective` → verify/archive → `closed` | HR + archivist / separate permissions | Reconciliation complete; personnel documents linked | Transfer package, `employment.separation_closed` |

No login or permission change is inferred from employee status; an explicit access-revocation command is required and audited.

### F3. Appointment

TO-BE: receive candidate application → validate → review/evaluate → submit decision → approve/reject → issue/sign order → create/link employee → onboarding → verify/close.

| From → command → to | Actor / permission | Preconditions | Side effects / audit |
|---|---|---|
| — → submit application → `submitted` | Candidate/intake / `recruitment.register` | Vacancy/reference and minimum contact; consent policy | Candidate application; document links |
| `submitted` → return/validate → `returned`/`eligible_for_review` | HR / `recruitment.validate` | Required-document checklist | Validation evidence/notice |
| `eligible_for_review` → record evaluation → `decision_pending` | HR/panel / `recruitment.evaluate` | Conflict checks/evaluation complete | Evaluation evidence, management task |
| `decision_pending` → approve/reject → `approved`/`rejected` | Director / `recruitment.decide` | Actor authority; comment/reason | Immutable decision and notification intent |
| `approved` → sign appointment order → `ordered` | Authorized signatory | Approved current order document | Signature evidence |
| `ordered` → appoint → `onboarding` | HR executor / `employment-actions.make-effective` | Effective date, unique employee matching reviewed, signed order | Create/link canonical employee, lifecycle `onboarding`/`active`, assignment, onboarding checklist |
| `rejected` → notify → `closed_rejected` | HR/intake | Refusal decision exists | Delivery evidence, retention schedule |
| `onboarding` → verify → `closed_appointed` | HR | Mandatory onboarding gates complete | Reconciliation/closure event |

Candidate retention/deletion and duplicate-person resolution require a separately approved privacy/retention policy.

### F4. Leave

TO-BE: request → validate → evaluate policy route → assign approver → approve/reject/return → issue decision/order → project schedule/attendance → notify → close/cancel.

| From → command → to | Actor / permission | Preconditions | Side effects / audit |
|---|---|---|---|
| — → request → `pending_validation` | Employee self or HR on behalf / `hr.leave.request` | Active employee; dates/days consistent; no prohibited overlap; idempotency | Request/event/audit |
| `pending_validation` → return → `returned` | HR / `hr.leave.validate` | Missing/invalid supporting evidence listed | Notice/outbox/event |
| `pending_validation` → route → `pending_approval` | HR/system policy evaluator | Active policy version; route calculable | Policy snapshot, assignment event |
| `pending_approval` → reassign/delegate → same state | Authorized approver/admin | Live delegation and no decision yet | Assignment event/outbox |
| `pending_approval` → return → `returned` | Approver | Comment required | Decision/event |
| `pending_approval` → reject → `rejected` | Route-authorized approver / `hr.leave.approve` | Expected version/current assignment | Decision, outbox, audit |
| `pending_approval` → approve → `approved` | Route-authorized approver | Balance/evidence rechecked; no conflict | Decision; optional order draft; projection command |
| `approved` → reconcile → `effective` | HR/system executor | Required order signed if policy says so | Idempotent schedule/attendance projection, notification |
| `pending_*`/`approved` → cancel → `cancelled` | Employee/HR according to policy | Effective-period rules satisfied | Cancellation/reversal event; no history deletion |

The exact 1-day, 2–4-day and over-4-day routes remain configuration-blocked until business confirmation resolves the diagram inconsistency.

### F5. Official correspondence

TO-BE: receive/create → register → validate → classify → present/route → assign → process → prepare outgoing document → approve/sign → dispatch → close → transfer to archive.

| From → command → to | Actor / permission | Preconditions | Side effects / audit |
|---|---|---|---|
| — → register → `registered` | Records officer / `correspondence.register` | Canonical document/current version where content exists | Registry number, document link, event |
| `registered` → return invalid → `returned` | Records reviewer | Reason/missing evidence | Notice and event |
| `registered` → route/assign → `assigned` | Management/delegate / `correspondence.assign` | Eligible assignee | Assignment event/outbox |
| `assigned` → start → `in_progress` | Assignee / `correspondence.work` | Active assignment | Event |
| `in_progress` → submit response → `response_review` | Assignee | Canonical response version | Document link/event |
| `response_review` → return/approve → `in_progress`/`approved` | Reviewer/signatory | Current version and authority | Immutable decision/signature evidence |
| `approved` → dispatch → `sent` | Records dispatch / `correspondence.dispatch` | Signed/approved as policy requires | Outbound registry number, delivery attempt |
| `sent` → close → `closed` | Records owner | Delivery result or approved exception | Closure event/SLA result |
| `closed` → transfer → `archived` | Records + archivist | Transfer accepted | Archive transfer/item and event |

Citizen cases can reference correspondence records, but neither table owns or copies the other's status.

### F6. Archive lifecycle

TO-BE: propose transfer → inspect → return/accept → classify/store → available → access request/approve/checkout/return → appraisal → external approval → disposal approval → execute/verify → disposed.

| From → command → to | Actor / permission | Preconditions | Side effects / audit |
|---|---|---|---|
| — → propose transfer → `transfer_submitted` | Source unit / `archive.transfer.submit` | Item list and document links | Transfer snapshot/event |
| `transfer_submitted` → return → `transfer_returned` | Archivist / `archive.transfer.inspect` | Missing/defect list | Notice/event |
| `transfer_submitted` → accept → `in_custody` | Archivist | Count/list/condition verified | Receipt act, archive identifiers, location event |
| `in_custody` → classify/store → `available` | Archivist / `archive.classify` | Retention class/version and location | Unit metadata/current snapshot + event |
| `available` → request access → `access_pending` | Authorized requester / `archive.access.request` | Purpose/contact/scope | Access case/audit |
| `access_pending` → approve/reject → `access_approved`/`access_rejected` | Archivist/data owner / `archive.access.approve` | Classification and permission checks | Decision/outbox |
| `access_approved` → checkout/use → `checked_out` | Archivist | Original/copy restrictions satisfied | User/date/purpose/condition event |
| `checked_out` → return → `available` | Archivist | Returned item verified | Return condition/event; exception if damaged/missing |
| `available` → appraise → `under_appraisal` | Archivist/commission secretary | Retention due; no active hold | Appraisal case/items |
| `under_appraisal` → retain → `permanent`/`available` | Commission / `archive.appraise` | Commission quorum/decision | Conclusion/minutes/evidence |
| `under_appraisal` → propose disposal → `disposal_external_review` | Commission | Item conclusion + signed act | General disposition request + external submission |
| `disposal_external_review` → authorize → `disposal_approved` | External authority evidence registrar + internal approver | Verified external approval; no hold; four-eyes | Approval evidence; execution token/plan |
| `disposal_approved` → execute → `disposal_executed` | Authorized executor / `archive.dispose.execute` | Online server confirmation; hold recheck; exact item set/hash | Execution event; physical method/reference; no silent data deletion |
| `disposal_executed` → verify → `disposed` | Different verifier/commission / `archive.dispose.verify` | Execution evidence and item reconciliation | Immutable destruction act/signatures/report; final state |

No offline or single-actor transition may reach `disposed`.

## G. Data model changes

### Keep and extend

- Keep `employees`, `departments`, `jobs`, `positions`, `employee_assignments` as master truth.
- Keep `employment_lifecycle_events` append-only; add `source_action_id`, event schema version and stronger effective-date uniqueness/ordering rules if required.
- Keep `hr_leave_requests` as leave aggregate, but add `version`, policy/route snapshot, current workflow link, request origin/on-behalf actor, cancellation fields and idempotency identity. Extend states; never rewrite prior `hr_leave_events`.
- Keep `documents`, `document_versions`, `document_lifecycle_events`; add source, sender/recipient party links, received/sent dates, confidentiality mapping, retention-class FK, signature evidence structure and version/optimistic guard.
- Replace single weak polymorphic document link with tenant-scoped `document_links(document_id, entity_type, entity_id, relation_type)` plus service-level target validation. Preserve old columns during compatibility phase.
- Keep `correspondence_records` and `archive_records` current snapshots for compatibility; link them to canonical documents and add `version`.
- Keep general `data_lifecycle_*` policy/hold/disposition approval. Add separate immutable disposition execution evidence rather than turning approval into deletion.

### Add domain aggregates/evidence

- `citizen_cases`, `citizen_case_events`, `citizen_case_contacts`, `citizen_case_sla_snapshots`.
- `recruitment_applications`, `recruitment_application_events`, required-document/review evidence.
- `employment_actions`, `employment_action_events`, typed basis and effective decision/order links.
- `correspondence_events`, registry/delivery records.
- `archive_transfers`, `archive_transfer_items`, `archive_units` or compatible archive item master, `archive_location_events`.
- `archive_access_requests`, `archive_access_events`.
- `archive_appraisals`, `archive_appraisal_items`, `archive_commission_decisions`.
- `archive_disposal_executions` and immutable destruction/verification evidence linked to `data_disposition_requests`.
- Versioned retention class/schedule catalogue rather than only arbitrary integer years.
- Shared policy versions, workflow instances, assignment/decision/event primitives as described in E.
- Transactional `notification_outbox` and delivery attempts; inbox notifications can remain the in-app projection.
- Per-aggregate idempotency and optimistic concurrency; prefer a shared command receipt table only if payload hash, tenant, domain and resource scopes remain explicit.

### Deprecation targets

- `employee_events`: stop new writes after mapping its few event types to governed employment/leave action histories. Do not delete historical rows.
- `employee_profiles.job_description`: position description versions are canonical; retain legacy read compatibility until migrated.
- Formal personnel files stored only as `attachments`: migrate verified formal evidence to canonical document versions; keep operational attachments for lightweight evidence.
- Direct mutable status update paths for correspondence/archive.
- Duplicate document fields in archive/correspondence should become compatibility snapshots, not independent truth.

## H. API and service changes

1. Introduce domain command services, not route-local SQL, for case registration, assignment, decisions, delivery, employment actions, leave transitions, archive transfer/access/appraisal/disposal.
2. Require `Idempotency-Key` (or explicit equivalent) for create/decision/delivery/disposal commands and `expectedVersion` or `If-Match` for mutable snapshots.
3. Return `availableTransitions`, required evidence, and authority reasons from backend read models so UI never invents allowed statuses.
4. Replace generic records/archive `PATCH` status with named commands. Keep old reads and temporarily translate safe old writes during a measured compatibility phase; reject lifecycle jumps.
5. Make domain update, workflow event/decision, audit row, document link, and notification outbox one DB transaction.
6. Add self-service leave endpoint constrained to `req.user.employee_id`; separate on-behalf permission.
7. Make employment effective transition a service that validates signed order and action case, then writes lifecycle snapshot/event atomically.
8. Generalize notification type constraints and implement retry/dead-letter/reconciliation for outbound channels. Notification failure must not roll back the approved business decision; the outbox intent must commit with it.
9. Add archive read/use APIs that enforce classification, purpose, requester, checkout and return evidence.
10. Add disposal execute/verify endpoints only after policy, four-eyes, external approval and operational runbook gates are accepted. They must be disabled by default.

## I. UI changes

- Replace records/archive free status dropdowns with server-provided contextual actions and a visible immutable timeline.
- Add one “My requests/approvals” work queue driven by assignments, without merging the separate domain workspaces.
- HR: add employee self-service leave, returned/correction state, route/approver explanation, delegation/reassignment, order/evidence and reconciliation status.
- Employment: add separate candidate/application and employment-action case views; do not create an employee at candidate intake.
- Citizen cases: intake, validation checklist, SLA, assignment, response document, approval/signature, delivery and appeal/exception panels.
- Records: make the canonical document/version primary; show registry envelope, routing, assignment, response and delivery around it.
- Documents: expose authorized document search/version/history/links; classification-sensitive UI and downloads.
- Archive: separate transfer, inventory/location, access/use, appraisal and disposal queues. Destruction UI must show item hash/count, hold check, approvals, executor/verifier separation and irreversible-action confirmation.
- Offline: allow local encrypted draft metadata/content only after a threat/privacy design. Clearly label “local draft / not submitted.” Never show approval, signature, archive acceptance or disposal as final until server response.
- Surface data-quality warnings for unknown imported history rather than displaying inferred events.

## J. Migration and compatibility strategy

### Preconditions

- Identify the actual target environment. Reconcile repository/latest migration `0080`, documented production `0080`, and running local Compose `0079`.
- Take verified DB and upload backups; rehearse restore; record row counts/checksums and current writers.
- Inventory external writers/importers before any status/write guard is activated.

### Schema-first phase

- Add new tables/columns/indexes/constraints/events without rewriting current rows.
- Preserve current API read fields and snapshot statuses.
- Add canonical document links and workflow evidence alongside old fields.
- Add compatibility writers that emit new evidence for new commands while still reading legacy rows.

### Backfill policy

- Backfill stable master links only when deterministically evidenced: tenant, employee profile link, known document/archive/correspondence IDs.
- Do not synthesize approval, assignment, receipt, delivery, employment or archive events from a current snapshot.
- Existing rows without canonical event history receive `history_quality = legacy_unknown` (or equivalent read-model flag).
- The 21 local employees with zero lifecycle events remain historically unknown unless validated source material is imported through a reviewed migration. “Active now” is not evidence of a historical hire decision/date.
- Use source provenance, import batch, observed-at time, row hash and reviewer identity for any reviewed historical import.

### Cutover

- Compare old and new writers in fail-closed shadow/read mode.
- Reconcile counts, state distributions, orphan links, duplicate numbers, event/snapshot agreement, tenant isolation and audit atomicity.
- Retire old mutation endpoints only after all clients are updated and a rollback image no longer depends on them.
- Activate database write guards in a later migration, following the two-phase precedent in D-034.

### Rollback/recovery

- Application rollback must preserve additive tables and append-only evidence.
- Do not drop new evidence to roll back a UI/API release.
- Before irreversible archive disposal capability, rehearse forward-fix, cancellation-before-execution, backup restoration boundaries, and evidence reconciliation. Physical destruction is not recoverable; rollback is therefore prevention and evidence, not data resurrection.

## K. Security, audit and failure controls

### Permissions

Split broad permissions into at least register/read/assign/work/review/approve/sign/dispatch/archive/sensitive-read/dispose-execute/dispose-verify. Preserve owner/admin grants only through explicit role-permission rows. Job workspace access decides visibility, not command authority.

### Required controls

- Server-derived tenant on every command; composite tenant foreign keys; no client organization ID.
- Route and service authorization; optional staged RLS only after transaction-scoped tenant context is deployed and tested across every writer.
- Append-only domain events and decisions; runtime DB role cannot update/delete/truncate them.
- Atomic domain snapshot + event + audit + outbox.
- Audit actor/time/action/resource, before/after, authority/policy version, reason, correlation and outcome. Avoid raw sensitive content in general audit JSON.
- Encryption/access separation for sensitive personal/contact data; classification-aware document download.
- Exact-payload idempotency and optimistic concurrency.
- Four-eyes for appointment, involuntary termination where policy requires, and all archival disposal. Executor and verifier must differ for final disposal.
- Legal-hold recheck immediately before disposal execution.
- No silent overwrite or event deletion; corrections append new events.
- Upload allowlist, size checks, content hash, malware-scanning/quarantine design before expanding external intake.
- Session/live-authority recheck for approval and destructive commands.

### Failure/offline behavior

- Safe offline candidates: unsent intake draft, leave draft, response draft metadata. Store the minimum locally, encrypt where feasible, expire it, and require explicit submit.
- Online-only: assignment acceptance, approval/rejection, signature, employment effective transition, archive transfer acceptance, checkout, commission decision, disposal execution/verification.
- Use outbox/retry for notification and delivery integrations. A failed delivery remains a visible retryable state, not `delivered`.
- File upload failure leaves no document version/current-version mutation; orphan storage cleanup is separately auditable.
- Retry returns the original result; concurrent decision loser receives conflict and current state.

The IoT priority rule is not applicable to ordinary HR/document workflows. If a workflow later issues a device command, it must call the IoT authority boundary and cannot override Emergency > Manual > Weather > Schedule > Default.

## L. Test matrix

Apply every row to all six processes, with domain-specific additions below.

| Test | Expected evidence |
|---|---|
| Happy path | Correct final snapshot, complete ordered events, audit and notification intent |
| Reject | Authorized decision, reason required, no prohibited side effect |
| Return for correction | Returned state, missing-item/comment evidence, safe resubmission |
| Reassignment/delegation | Old/new assignee timeline, live authority checks, notification |
| Unauthorized actor | 403, no snapshot/event/outbox mutation, optional denied security audit |
| Cross-tenant ID | 404/403 without information leak; zero mutation |
| Duplicate command | Exact replay returns original; changed payload with same key conflicts |
| Concurrent update/decision | One winner; loser conflict; one event/side effect |
| Invalid transition jump | 409; no mutation |
| Attachment/version failure | No current-version change; storage/database reconciliation |
| Notification failure | Business decision committed; outbox pending/failed and retryable |
| Offline/retry | Draft remains non-final; replay idempotent after reconnect |
| Audit verification | Actor/time/before/after/reason/policy/correlation and append-only DB guard |
| Tenant isolation | API and disposable-DB integration coverage |
| Historical unknown | No fabricated approval/assignment/lifecycle; warning visible |

Domain additions:

- Citizen case: incomplete/resubmit, anonymous/confidential policy, SLA pause/resume, duplicate case, delivery failure, appeal/reopen once defined.
- Separation: employee request withdrawal, notice exception, order-sign failure, unresolved asset/access, effective-date race, access revocation reconciliation.
- Appointment: duplicate candidate/employee matching, rejection retention, missing required document, sign/order failure, employee creation exactly once.
- Leave: overlap, policy boundary (1/2/4/5 days after confirmation), insufficient balance if applicable, delegation expiry, cancellation after approval, attendance projection replay.
- Correspondence: annual number concurrency, incoming/outgoing links, signature requirement, returned delivery, closure preconditions.
- Archive: incomplete transfer, classification denial, missing/damaged return, active legal hold, commission quorum/conflict, external approval mismatch, disposal item-set hash mismatch, executor=verifier denial, partial physical failure, immutable final act.

Verification must include source/unit tests and disposable PostgreSQL integration tests. Consequential evidence tests must not clean up by deleting immutable production-like journals.

## M. Ordered implementation plan

No phase below is approved to start by this document.

### Phase 0 — Confirm evidence and production baseline

- Business walkthrough of all six diagrams; resolve open questions N.
- Confirm current legal/internal policy versions and named authorities.
- Identify target environment and reconcile `0079`/`0080` discrepancy.
- Export schema/data-quality aggregates, writer inventory and verified backup/restore evidence.
- Acceptance: signed process catalogue, no unresolved blocking authority/SLA/state questions for the first slice.

### Phase 1 — Shared workflow and command safety foundation

- Versioned workflow policies, instance/assignment/decision/event primitives.
- Idempotency, optimistic concurrency, atomic audit/outbox pattern.
- Permission decomposition and backend transition contract.
- Acceptance: disposable-DB replay/concurrency/tenant/append-only suite; no domain migration yet.

### Phase 2 — HR processes

- Leave first: self-service, policy route, return/delegation, optional order, attendance projection.
- Recruitment/appointment case separated from employee master.
- Separation action, signed order, offboarding handover and access/property/document reconciliation.
- Acceptance: complete HR matrix, unknown legacy history preserved, pilot UAT.

### Phase 3 — Citizen cases and correspondence

- Citizen request/complaint aggregate and SLA/assignment/response/delivery.
- Harden correspondence state machine and link canonical documents.
- Acceptance: paper/electronic intake through delivered response; invalid lifecycle jumps impossible.

### Phase 4 — Document/records consolidation

- Expand canonical document metadata/links/parties/signature and authorized UI.
- Migrate formal personnel/correspondence evidence; keep compatibility snapshots.
- Acceptance: one canonical file/version/checksum source per formal document; no duplicate mutation authority.

### Phase 5 — Archive and retention

- Transfer/acceptance, archive unit/location, access/use/return.
- Retention schedules, appraisal commission and external approval.
- Disposal execute/verify is a separately reviewed feature flag after operational rehearsal.
- Acceptance: legal hold and four-eyes enforced; no direct `disposed` status path.

### Phase 6 — Migration/backfill

- Source-provenance import and reviewed deterministic links.
- Unknown history remains unknown; compatibility read/write cutover and reconciliation.
- Acceptance: counts/hash/orphan/event-snapshot report signed off; restore and rollback rehearsed.

### Phase 7 — Tests, rollout and learning

- Full matrix, security review, performance/load, UAT, training and runbooks.
- Staged tenant/pilot feature flags; metrics for cycle time, returns, overdue, reassignment, delivery and data quality.
- Update `CURRENT_STATE.md` only after verified capability changes. Add a `DECISIONS.md` entry only after the durable workflow/document/archive boundary is explicitly accepted.

## N. Open business questions

### Cross-process

1. Who is the accountable process owner and final approver for each process and branch?
2. What current internal policy/legal instrument and version governs every deadline, required document, retention and authority rule?
3. Which steps require four-eyes separation, qualified electronic signature, stamp, or paper original?
4. What constitutes delivered/received/closed, and what happens when delivery fails?
5. Which roles may delegate or reassign, for how long, and may an actor approve their own initiated case?
6. What confidentiality classes apply, and who may search/download each class?
7. Which existing paper registers/numbers must be preserved exactly during transition?

### Citizen cases/correspondence

8. Are requests, complaints and suggestions one configurable case type or legally distinct lifecycles/SLAs?
9. Are anonymous cases allowed? How are duplicates, withdrawals, appeals and reopened cases handled?
10. Does official correspondence include complaints, or is correspondence only the document envelope linked to a citizen case?
11. What are the management notation, assignment and signature authority matrices?

### Appointment/separation

12. Is appointment only for citizens/external candidates, or can internal transfer/promotion use the same action family?
13. Which listed candidate documents remain legally/currently required, and what is their retention after rejection?
14. When exactly is the employee master created and the employee number assigned?
15. What release/dismissal basis taxonomy, evidence, notice exceptions, appeal and effective-date controls apply?
16. Which offboarding checklist items block termination closure, and which may close with approved exception?
17. Which system revokes login, physical access and assigned assets, and who verifies completion?

### Leave

18. Resolve the diagram inconsistency: who approves exactly 2–4 days and over 4 days?
19. Are the printed paid-leave reasons/day counts still current and tenant policy, law, or both?
20. Are leave balances/accruals required? Who may submit on behalf of an employee?
21. Does approved leave automatically update attendance/schedule, and how are cancellations corrected?

### Archive

22. What is the approved retention schedule/classification catalogue and its effective version?
23. Who are commission members, what is quorum, and how are conflicts/absence recorded?
24. Which external Aimag archive approval evidence is mandatory and how is authenticity verified?
25. What archive access categories allow originals, reading-room use, copies or certified references?
26. What is the checkout duration and escalation for missing/damaged material?
27. What physical destruction methods, executor/verifier separation, act format and reporting are mandatory?
28. Does final disposal delete binaries, retain tombstone/metadata, or move encrypted evidence to another custody boundary?

## Final code decisions

### KEEP

- Canonical `employees` and organization/job/position/assignment masters.
- Employee/login/RBAC/workspace separation.
- `employment_lifecycle_events`, versioned contracts and position descriptions.
- `hr_leave_requests` + append-only `hr_leave_events` as the base aggregate/history.
- Canonical `documents`, `document_versions`, hashes and lifecycle events.
- General data lifecycle policy, legal hold, disposition request and lifecycle event foundations.
- Tenant-derived server authorization, permission catalogue, audit foundation and current modular HR/records/archive workspace separation.
- Work-order assignment/approval/event services as implementation patterns, not as domain records for this scope.

### MODIFY

- Version and generalize `organization_workflow_policies` through bounded shared primitives.
- Harden HR lifecycle actions, leave routing, checklists and self-service authority.
- Convert records/archive generic status updates into named state-machine commands with atomic events/audit/outbox.
- Link correspondence/archive/personnel evidence to canonical documents.
- Expand document metadata/links/parties/retention/signature and expose authorized UI.
- Decompose permissions; add idempotency, optimistic concurrency, transactional outbox and delivery evidence.
- Stage RLS only after request-scoped tenant DB context is implemented across all routes.

### DEPRECATE

- New writes to legacy `employee_events` once governed replacements cover them.
- `employee_profiles.job_description` as canonical truth.
- Formal documents stored only as lightweight attachments.
- Direct records/archive status dropdowns and generic `PATCH` lifecycle mutation.
- Archive `status='disposed'` as proof that destruction occurred.
- Duplicate independently editable document metadata across modules.

### ADD

- Citizen request/complaint case domain.
- Candidate/recruitment and employment-action cases.
- Shared versioned assignment/approval/decision/event primitives.
- Correspondence immutable events and delivery evidence.
- Archive transfer, unit/location history, access/use, appraisal commission, external approval and disposal execution/verification evidence.
- Retention schedule/class versions and canonical document relationship model.
- Transactional notification outbox/delivery attempts.
- Full six-process integration/security/concurrency/failure test suite and migration reconciliation tooling.

## Approval gate

This report authorizes no code, migration, production data change, role/permission change, deployment or disposal action. Implementation may begin only after the user explicitly approves a bounded phase and the blocking business questions for that phase have documented answers.
