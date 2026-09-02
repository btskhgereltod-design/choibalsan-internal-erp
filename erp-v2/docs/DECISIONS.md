# OVERVA Decisions

Last updated: 2026-09-01

This is a lightweight decision log. It preserves rationale without freezing
implementation. Hypotheses are labelled separately from accepted decisions.

## Accepted Decisions

### D-001 — OVERVA is general-purpose

Choibalsan Hugjil is a pilot, evidence source, and tenant configuration. Its
terminology and workflows must not become the universal product model.

### D-002 — Configure relevant workspaces, not a universal sidebar

An organization defines its structure and actual work. A person sees capabilities
appropriate to the tenant configuration and their authorized role/workspace.

### D-003 — Employee master and login identity are separate

HR owns the canonical employee record. An employee may have zero or one OVERVA
login account. System roles/permissions do not replace department, position, or
employment data.

### D-004 — Tenant isolation is enforced server-side

Client input cannot choose the authorization tenant. Organization boundaries
must be preserved through data access, APIs, imports, audit, files, and jobs.

### D-005 — Critical history is append-only evidence

Security, access, HR, configuration, workflow, AI, administration, and device
control changes require attributable audit evidence that ordinary users cannot
rewrite.

### D-006 — AI proposes; governed application decides

AI output is untrusted until it passes deterministic validation, authorization,
and the appropriate human approval. Applied changes and outcomes are audited.

### D-007 — Smart Import is staged

Import follows upload/ingest → inspect → map → validate → preview → approve →
apply → reconcile. Raw customer data is never interpreted as permission to make
unreviewed consequential changes.

### D-008 — Preserve safe IoT command precedence

Emergency > Manual > Weather > Schedule > Default is enforced across every
control layer, with offline-safe local operation and fail-safe behavior.

### D-009 — Product purpose is stable; implementation can evolve

Architecture, libraries, UX, workflows, and models may improve. Existing work
should be searched and understood first, then extended, refactored, or replaced
with a migration, rollback, compatibility, and test rationale appropriate to
the risk.

### D-010 — Project memory lives in the repository

Chat history and compacted context are not the source of truth. Agents and
developers use `AGENTS.md`, `CURRENT_STATE.md`, `ARCHITECTURE.md`, and this log
to resume work and update them after material changes.

### D-011 — OVERVA develops through an evidence-driven spiral

OVERVA keeps one product center while drawing knowledge from BA, data, AI, UX,
architecture, operations, market research, and comparable products. Work moves
through understand → build small → test → measure → learn → improve. New study
or tooling is valuable when it returns to reduced customer effort, safer work,
better understanding, or measurable operational value.

### D-012 — External prototypes are design input, not production authority

Hercules and similar tools may accelerate UX exploration. Exported code is
audited component by component; only compatible ideas are reimplemented on
OVERVA's tenant, permission, audit, validation, and PostgreSQL foundations.
Prototype mock data, local workflow state, authentication assumptions, and data
schemas never become production truth merely because the prototype builds.

### D-013 — Conversation history is evidence, not implicit approval

OVERVA preserves durable workspace memory as structured evidence, hypotheses,
human decisions, plans, execution results, verification, and a current
checkpoint. A message, uploaded file, generated preview, or preview interaction
never becomes a confirmed tenant fact or authorization to mutate canonical data.
Only an explicit attributable human decision can promote a proposal to a
confirmed baseline. AI agents resume from the governed context package rather
than treating a model context window or raw transcript as the source of truth.

### D-014 — Preview, commercial agreement, deployment, and live operation are separate gates

The public OVERVA workspace is a safe workshop for discovery, incremental
building, and team testing. Saving a browser-local checkpoint does not provision
a tenant, create production credentials, accept a price or contract, authorize
deployment, or prove live operation. Scope, commercial acceptance, deployment
readiness, and operational acceptance require separate attributable human gates.
The interface shows the current stage and missing next requirements instead of
sending a user directly from an early preview into `app.overva.com`.

### D-015 — Evidence belongs to an explicit workspace identity

Conversation, files, hypotheses, confirmations, preview activity, and delivery
state are combined only inside one stable workspace ID. `Шинэ ажил` preserves
earlier work and creates a separate context. When an organization description
or file may belong to a different job, OVERVA asks the person whether to add it
to the current workspace or create another one before storing it. A legacy
single browser checkpoint is migrated non-destructively into the registry.
Extracted organization details remain preliminary until human confirmation.

### D-016 — OVERVA Connect extends governed contracts instead of duplicating integrations

OVERVA Connect is the integration surface of the same Connected Organization
Platform, not a second product or a replacement for every ERP. It extends the
existing tenant-scoped contract, adapter, webhook, idempotency, retry,
dead-letter, reconciliation, and audit foundations. A shared, versioned event
envelope carries identity, type, provenance, subject, correlation, time, and a
domain payload; domain schemas remain small and independently versioned rather
than becoming one universal data model. Tenant identity is derived from
authenticated server context and is never selected by an event payload.
GPS/IoT command control remains a separate safety-critical boundary.

### D-017 — Public Home and Workspace Studio are separate navigation levels

The public OVERVA entry opens a portfolio Home for creating, finding, and
resuming browser-local workspaces. Selecting or starting work opens one
Workspace Studio containing that workspace's conversation, preview, governed
memory, and seven-stage delivery journey. Home never merges workspace evidence,
and the Workspace Studio is not overloaded with global portfolio, marketplace,
academy, or community navigation. Starting from a Home prompt selects a stable
workspace identity before evidence is stored. `PUBLIC_PORTFOLIO_HOME_CONTRACT_V1.md`
defines the accepted boundary.

### D-018 — Public connector discovery and tenant authorization are separate

OVERVA may publicly show supported connector metadata, read-only capability,
scope purpose, and operational readiness. A public catalog never owns a provider
account, stores a token, or creates a workspace merely because a connector card
was selected. Connecting, reconnecting, testing, and disconnecting require an
authenticated tenant owner or administrator with `connectors.manage`.

Provider access uses OAuth authorization code flow, short-lived one-time state,
server-side tenant attribution, encrypted token storage, least-privilege scopes,
and append-only connection/audit evidence. V1 exposes Google Drive, Google
Sheets, and public GitHub repository reads only. Provider credentials being
absent must appear as an unavailable status rather than a fake successful
connection. Consequential write, send, publish, payment, or device actions stay
outside this read-only slice and require their own approval and reconciliation
contract.

### D-019 — Freeze the ecosystem North Star and enter through governed digital needs

OVERVA's durable horizon is a connected digital organization, production, and
market ecosystem. The initial market position is not another ERP, a module
catalogue, or a generic AI app builder. It is a governed path that helps an
organization define a digital need, confirm its requirement and preview, choose
a trusted build or developer path, and carry delivery through an accepted
production outcome.

Product proof and market proof share one stable workspace and governed evidence
baseline. Raw conversation, files, or AI inference cannot become a public request,
commercial commitment, or production authorization without explicit human
confirmation. Tenant isolation remains intact across every future developer,
supplier, research, and market relationship.

For the first ninety-day validation cycle, large ecosystem additions stay out of
active build scope unless required by evidence from the next real pilot. A broad
app store, hundreds of connectors, consumer commerce, research marketplace,
industrial exchange, automated escrow, and international freelance market are
future horizons rather than current capability claims. The accepted entry wedge,
validation targets, and decision filter are defined in
`MARKET_ENTRY_STRATEGY_V1.md`.

### D-020 — Separate customer projects from provider jobs and retain the delivery control record

One OVERVA identity may eventually participate as both customer and provider,
but the product must present and authorize those capacities separately. Customer
projects must not be relabeled as provider delivery jobs, and private discovery
memory must not become Market memory without a redacted, confirmed snapshot.

External tools may hold implementation artifacts. OVERVA remains the official
control record for request, proposal, selection, bilateral scope, milestones,
delivery evidence, customer acceptance or change, production verification,
commercial reconciliation, bilateral review, and closure. Neither party can
unilaterally manufacture a completed job or verified reputation.

The durable business model is governed matching and outcome delivery rather
than simple lead resale. Requirement-definition service and a transparent
success/governance fee are the first revenue hypotheses; 8-10% is only a pilot
range. Escrow, wallet, regulated payment, automatic contract, and arbitration
remain outside current capability until specialist review and an appropriate
legal/payment operating model exist. See `MARKETPLACE_OPERATING_MODEL_V1.md`.

### D-021 — A customer request becomes a project only after provider selection and bilateral agreement

`My Requests` owns the pre-award lifecycle: draft, requirement review,
publication readiness, proposals, provider selection, and bilateral scope
agreement. A request-refinement conversation or preview may use a private
review workspace, but that workspace is not a customer project.

`My Projects` begins only after a provider has been selected and both parties
have confirmed the delivery scope and working conditions. It then owns
milestones, communication, delivery evidence, acceptance or change requests,
production verification, closure, and verified review. Earlier browser-local
Workspace Studio checkpoints remain available as explicitly labelled trial
rooms and must not be presented as real projects.

### D-022 — Joint clarification is optional and provider-proposed after selection

A customer is never required to enter a trial room, AI conversation, preview,
or fixed OVERVA lifecycle in order to select a provider, reach agreement, or
start a project. After selection, the provider may propose a `Joint
Clarification` when the work still needs shared understanding. The customer
chooses whether to accept it or proceed directly to bilateral agreement.

Joint Clarification is a collaboration surface, not a coding environment or a
project gate. The selected provider may invite the relevant customer
participants and use OVERVA's workflow-definition tools to map the real work,
actors, information, decisions, and acceptance outcome. Either party may keep
implementation artifacts in authorized external tools. OVERVA retains only the
governed agreement, delivery, evidence, acceptance, and outcome control record.
Legacy browser-local trial checkpoints remain recoverable but do not occupy a
primary customer or provider navigation position.

### D-023 — Separate the Platform, Market operator, and OVERVA Apps vendor arm

Accepted: 2026-08-28

OVERVA Platform at `app.overva.com` is the governed organization environment,
App Factory, review surface, and runtime. OVERVA Market is a separate
multi-supplier product, freelance, and community business. `OVERVA Apps` is a
vendor that may publish Platform-produced apps and bid for freelance work, but
it participates under the same listing, ranking, fee, review, enforcement, and
appeal rules as comparable suppliers.

This decision replaces D-019's mandatory one-workspace coupling and the part of
D-020 that made OVERVA the mandatory official control record for every delivery.
The Market keeps the minimum attributable
records required for the market service a participant chooses; source code,
internal project management, operational tenant data, and every delivery step
need not live in OVERVA. D-020's customer/provider separation, proposal privacy,
bilateral acceptance, and verified-review protections remain valid.

Market control means integrity, safety, confidentiality, moderation, and policy
enforcement. It does not mean controlling customer choice, choosing winners,
forcing Platform adoption, or preferring `OVERVA Apps`. Operator-only proposals,
private discussions, ranking controls, complaints, investigations, and policy
administration must be inaccessible to the vendor arm. Operator access and
interventions remain attributable and audited.

Market and Platform records require separate data, authorization, administration,
and commercial boundaries. Scoped shared sign-in may be added later without
merging Market profiles with tenant employees, private organization evidence,
builder/runtime data, or tenant audit journals. Even under common ownership, the
Market operator and `OVERVA Apps` must be technically, operationally, and
financially separated before accepting real competing suppliers.

Current production has no server-backed multi-supplier Market, product commerce,
freelance proposal system, forum, payments, or neutral ranking engine. This is an
accepted target boundary, not an implementation claim. Compatibility is
non-destructive: existing V25 browser-local requests and Platform tenant data
remain in place. Future Market records must be introduced in a new boundary,
not by relabelling existing tenant tables. Rollback of future implementation
means disabling Market publication/commerce without altering Platform tenant
operation. `MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md` is the canonical contract.

### D-024 — OVERVA Group has three peer operating roles

Accepted: 2026-08-28

`OVERVA Group` is an ownership and strategy umbrella, not a tenant, data store,
authorization scope, or permission shortcut. Its three peer operating roles are
`OVERVA Platform`, `OVERVA Apps`, and `OVERVA Market`.

The Platform owns the governed App Factory and organization runtime. OVERVA Apps
is the first-party product vendor. Market is the supplier-neutral product,
custom-work/service, forum, and governance business. OVERVA Apps may use the
Platform, but it is not nested under Platform administration and receives no
Market operator power.

This decision refines D-023's two-business wording without weakening its
separation rules. Common Group ownership never merges operator access, tenant
data, vendor data, finances, rankings, reviews, complaints, investigations,
enforcement, or audit. Legal-entity separation is not claimed as implemented;
technical, operational, authorization, accounting, and conflict-of-interest
separation are required before real competing suppliers are accepted.

The public Market product categories are Apps, Modules, Connectors, Templates,
and AI Agents. Its other customer-facing domains are `Захиалгат ажил ба
үйлчилгээ` and `Форум`. `Маркетын засаглал` is an operator control domain, not a
supplier privilege or a false claim that current preview commerce exists.

`OVERVA_GROUP_OPERATING_MODEL_V1.md` is the canonical Group structure contract.

### D-025 — Administration follows bounded business responsibilities

Accepted: 2026-08-28

OVERVA administration is divided into Group oversight, Platform operations,
OVERVA Apps vendor operations, and Market operator contexts. There is no
universal Group super-admin. Group sees aggregate boundary health and
attestations, not raw tenant, vendor, proposal, complaint, investigation, or
operator records. Each operating context owns its work queues, permissions,
decisions, and audit evidence.

Consequential changes use separately attributable initiation, specialist
review, and completion roles. OVERVA Apps can send a reviewed, redacted release
package to Market, but cannot enter Market administration or approve its own
listing. Context handoffs are explicit contracts; shared ownership and UI
context switching never imply data access.

The initial implementation is an isolated test simulation with twenty virtual
roles in each of the four contexts. These eighty personas create no production
accounts and cannot substitute for real independent human approval. The model
is defined in `ADMIN_OPERATING_MODEL_V1.md`.

The first production-oriented foundation is bounded to the existing Platform
control plane: active Platform roles and permissions are resolved from the
database for every request and enforced on each control-plane route. Existing
administrators migrate to a backward-compatible `platform-owner` assignment.
No Platform role contains or implies Group, OVERVA Apps, or Market authority.

### D-026 — Founder operation uses layered authority, not one universal super-admin

Accepted: 2026-08-29

During the founder-led phase, one attributable person may hold several
non-conflicting assignments needed to build, test, deploy, and recover OVERVA.
The daily Founder account may hold Platform owner, founder operator, Apps
developer, Market customer/provider, and system-operator responsibilities, but
each remains a separately identified context. A Market customer/provider switch
selects a participant capacity; it never grants Market operator or super-admin
power.

Application authorization and infrastructure recovery remain separate. The
first real implementation is Platform-scoped: `founder-operator`, Founder
Control visibility, and reason/scope/time-bound tenant diagnostic grants. A
support grant lasts at most sixty minutes, belongs to the issuing administrator,
exposes only an explicitly scoped redacted snapshot, permits no tenant API
bypass or mutation, and creates append-only lifecycle evidence.

Root/break-glass is an offline recovery procedure requiring production migration
credentials, explicit confirmation, a named target, and a recorded reason. It
is not a daily web session, cannot suppress audit evidence, and grants no Market
ranking, listing, review, proposal, complaint, dispute, or IoT-safety override.
Apps and Market identities/backends remain separate future implementations;
Founder Control must describe them truthfully as preview or planned states.

This decision refines D-025 for the current one-person operating reality without
creating a Group-wide authorization shortcut or weakening tenant, audit, Market
neutrality, or device-safety boundaries.

### D-027 — Market identity owns participant memberships without inheriting Platform or tenant authority

Accepted: 2026-08-29

The first Market identity slice uses a Market-owned login, token context, tables,
routes, and append-only audit journal. It does not link to or reference tenant
users, employees, organizations, Platform administrators, or Platform role
assignments. Person-level federation is deliberately absent from this slice; a
future shared-sign-in link requires a separate reviewed contract and may map
identity only, never copy authority.

One Market identity may hold zero, one, or both `customer` and `provider`
memberships. These are self-service participation capacities, not supplier
verification. A selected participant view is a stored presentation/work-queue
preference and can be changed only when its corresponding membership is active.
It never changes permissions or creates another membership.

Market operator authority is a separately attributable live assignment. It is
not bootstrapped from founder, Platform, tenant, customer, or provider roles.
Operator suspension and reactivation of participant memberships require the
Market authentication context, a current operator assignment, a reason, and
append-only Market evidence. A Platform or tenant token is rejected at the
Market boundary, and a Market token is rejected at the tenant and Platform
boundaries.

For the current single-host pilot, the boundary is implemented as additive
`market_*` tables and `/api/market/*` routes in the existing PostgreSQL/API
deployment. Naming, foreign-key isolation, token typing, route isolation, and a
separate journal keep it extraction-compatible with a later independent Market
service/database. No listing, proposal, payment, dispute, forum, ranking, or
supplier-verification record is introduced. Rollback disables the Market route
and public identity controls while leaving the additive tables intact; V31
Platform and tenant operation remain compatible.

### D-028 — Market participation is action-driven; provider capability requires review

Accepted: 2026-08-29

D-027's identity and authority boundaries remain accepted, but its statement
that both participant memberships are self-service is replaced. A visitor has
one neutral public-browse context, not an unauthenticated Customer or Provider
view. Registration creates only a Market identity. Starting an order may create
an active `customer` capacity because the user has taken a customer action;
registration alone does not label the person a Customer.

Provider capability has a higher trust threshold. A registered identity must
submit a professional summary, bounded skill list, optional portfolio link, and
explicit rules acceptance. Submission grants no Provider view or proposal
authority. A separately assigned live Market operator must approve the
application with an attributable reason before an active `provider` membership
is created. The operator cannot decide their own application. Rejection creates
no membership, and a suspended provider remains subject to the existing
operator-only reactivation boundary.

One identity may still hold both active capacities and switch between their
work queues. That switch remains presentation context only and adds no
membership, Market operator, Platform founder, tenant, or infrastructure
authority. The model follows the observed MQL5 distinction between public
browsing, order-driven customer participation, and reviewed seller/developer
participation, while keeping OVERVA's own governance vocabulary and boundaries.

Migration `0059` adds only provider applications and attributable audit links;
`0060` completes the same accepted boundary by enforcing
`submitted -> under_review -> approved/rejected` and preventing lifecycle
skips. Active/suspended remain membership states. These migrations introduce no
listing, proposal, payment, dispute, forum, ranking, or transaction backend.
Application rollback may return to compatible earlier API/Public images while
leaving the additive records intact; deployment requires a separate explicit
request.

### D-029 — Market monetizes bounded service access, not participant transactions

Accepted: 2026-08-29

OVERVA Market's initial commercial model sells its own bounded services:
Provider digital-storefront subscriptions, future paid request/ad publication,
featured placement, and premium storefront capability. OVERVA does not receive,
hold, split, settle, refund, or guarantee money exchanged between a Customer and
a Provider. Therefore storefront subscriptions and their external payment
references are evidence of payment for OVERVA service access only and must not
be reused as engagement price, escrow, payout, commission, or dispute records.

A public storefront exists only for an approved active Provider with an active,
unexpired service subscription. Plans are operator-configured and versioned;
subscription activation and expiry plus storefront suspension and visibility
are separate attributable states. Entitlements are copied as immutable snapshots so
later plan edits cannot silently change an existing grant. Provider membership
suspension hides the storefront, while membership reactivation does not by
itself republish it.

Migration `0061` implements only this Digital Storefront foundation. Listing,
proposal, selection, engagement, completion, review, moderation, payment,
dispute, forum, and social-like backends remain out of scope. A later review may
be authored only by the actual Customer tied to a completed engagement; guests,
unrelated identities, and the Provider themself must never create trust scores.

### D-030 — One Market identity may have multiple proof methods, never merged authority

Accepted: 2026-08-29

A person uses one canonical Market identity and may prove control through a
password, a verified email recovery channel, and explicitly linked external
identity providers. Authentication credentials are not Customer/Provider
memberships and are not Market operator, Platform founder, tenant, or Group
authority. Adding or switching a login method must therefore change no business
permission.

External accounts are keyed by provider issuer plus immutable subject, not by
display name or email. A verified email claim may establish a new identity only
when no active Market identity already owns that email. When one exists, the
user must authenticate that identity and explicitly link the external account;
silent email-based merge is forbidden. The last usable credential cannot be
removed. Facebook, phone/person/business KYC, payment identity, and federation
with tenant or Platform accounts remain future reviewed contracts.

Market sessions are revocable server-side. Recovery, verification, OIDC state,
and login exchange codes are short-lived, hashed at rest, single-use, and
audited. OIDC uses authorization code flow with PKCE, state, nonce, issuer,
audience, expiry, signature, and verified-email validation. Raw KYC documents
are not stored in this slice; only attributable verification facts and
privacy-safe hashes are retained. Possible duplicate-account signals enter a
separate operator-only review queue and never grant, suspend, merge, or delete
authority automatically.

Migration `0062` is additive except that password hashes become nullable for
external-provider-only identities. Existing identities and memberships are not
rewritten. Email and Google providers are fail-closed feature flags and must
remain disabled until their separate secrets, callback registration, delivery
behavior, and operational rollback have been verified. Listing, proposal,
engagement, review, transaction payment, dispute, forum, and ranking backends
remain out of scope.

### D-031 — Provider onboarding requires bounded assurance, not a Seller role

Accepted: 2026-08-29

Applying to become a Provider is a sensitive capability request. Every new
policy-1 application requires a live verified phone and a successful step-up
on the current revocable Market session within ten minutes. Password and linked
Google proof are equivalent step-up methods, but neither proof grants Provider
membership. Only a different live Market operator may review and approve the
application under the existing lifecycle and four-eyes boundary.

Phone numbers are encrypted for recovery/operations and separately represented
by a keyed fingerprint for uniqueness checks. OTP values are short-lived,
bcrypt-protected, single-use, attempt-bounded, rate-limited, and audited. A
fingerprint decision is serialized in PostgreSQL. A phone collision never
merges accounts and never grants authority; it produces a privacy-safe risk
signal for operator review. Provider approval rechecks that the recorded phone
verification and its contact remain live.

Existing policy-0 Provider applications and already active Provider memberships
remain compatible. The new API always creates policy-1 applications. Phone
assurance is not person/business KYC, payment identity, or a guarantee of work
quality, and raw KYC documents are not introduced.

`Provider` means permission to participate in reviewed custom-work supply.
`Seller` or `Publisher` for future digital-product publication is a distinct
capability and onboarding contract. It must not be inferred from Provider
status, a verified phone, Google login, Market operator authority, Platform
founder authority, or tenant organization access. Migration `0063` and Public
V34 therefore stop at Provider assurance; listing, proposal, payment, dispute,
forum, ranking, Seller/Publisher, and KYC-document backends remain out of scope.

### D-032 — Model connected organizational work in five layers without creating a universal schema

Accepted: 2026-08-31

OVERVA reasons about tenant operation in this order: Master Data ->
Organization -> Responsibility and Authority -> Process and Transactions ->
Measurement and Optimization. Product modules and workspaces may present these
capabilities, but they do not own duplicate copies of the same organizational
truth. Processes reference authoritative domain records and important actions
remain explainable by actor, action, resource, place, time, authority,
approval/rule, and evidence.

This is a conceptual domain model, not one universal table, identity, workflow,
event payload, or shared database. Domain schemas remain small and versioned;
tenant Platform, Market, Platform administration, OVERVA Apps, Group oversight,
and infrastructure operation retain their accepted data, identity,
authorization, and audit separations. A future shared sign-in or integration
contract may map identity or exchange approved records but never copies
authority implicitly.

Employee, login identity, job definition, position, employee assignment,
responsibility, system role, permission, workspace access, and process approval
authority are distinct concepts. Existing tenant RBAC and job-workspace access
already implement part of this separation. Fixed `users.role` and
`employees.job_role` checks remain compatibility debt and must be migrated one
domain at a time through explicit policy, fail-closed comparison, tests, and
rollback; they are not removed by this decision. IoT migration must preserve
Emergency > Manual > Weather > Schedule > Default at every control layer.

Optimization begins only after reliable attributable process evidence exists.
AI may measure, explain, and propose but cannot silently change master data,
permissions, workflow, financial truth, production state, or device control.
The first approved vertical proof is Asset Maintenance, reusing existing
employee, organization, asset/operational-object, work-order, approval,
inventory, measured-outcome, attachment, finance-integration, and audit
foundations. Implementation and production deployment remain separate gates.

`CONNECTED_ORGANIZATION_DOMAIN_MODEL_V1.md`,
`SURFACE_AUTHORITY_MATRIX_V1.md`, `LEGACY_AUTHORIZATION_USAGE_AUDIT_V1.md`, and
`ASSET_MAINTENANCE_VERTICAL_SLICE_CONTRACT_V1.md` define the accepted model,
routing, baseline debt, and first proof contract.

### D-033 — Preserve the current Work Order assignee snapshot and add a versioned append-only timeline

Accepted: 2026-08-31

`work_orders.assigned_to` remains the compatible current-assignee reference to
a tenant User. Work Order assignment history is recorded as versioned, typed
`assigned` events in the existing `work_order_events` journal rather than as a
second current-state table. Version 1 distinguishes initial state, assignment,
reassignment, and unassignment; keeps same-tenant from/to User references; and
captures the linked Employee identifiers observed at event time for workforce
reporting. Employee evidence does not grant login or process authority.

Snapshot change, assignment event, and tenant audit are one transaction. The
Work Order row is locked before comparison, an unchanged assignee is a no-op,
and an optional tenant/work-order idempotency key makes a replay non-mutating.
The event journal rejects update and delete at the database layer. UI/API,
import, and system-created Work Orders use one assignment service contract;
direct assignment SQL is compatibility debt to eliminate rather than copy.

No existing assignment event or Work Order is rewritten or synthesized.
Events without `assignment_history_version=1` remain legacy/non-canonical
evidence. If no version-1 event exists for a historical boundary, the assignee
is unknown even when the Work Order has a current snapshot. A source import may
record the assignment observed at import time, but it may not claim that the
assignment occurred at the source Work Order creation time. Correction uses a
new attributable event, never mutation of prior evidence.

Migrations `0078`–`0079` are additive and retain old response fields. Earlier
application code can continue reading `assigned_to`; it must not write after
deployment without the canonical event service. Rollback therefore means an
application rollback to compatible reads while preserving the new columns and
immutable evidence, not deleting the event history.

### D-034 — Activate strict assignment writers only after a backward-compatible schema phase

Accepted: 2026-08-31

This decision replaces only D-033's rollout assumption that an earlier
application image must stop writing immediately after migrations `0078`–`0079`.
Production review showed that such a guard would make assignment rollback fail
and would leave a create-write transition window while the previous API was
still serving traffic.

Assignment history therefore deploys in two releases. The first release adds
the canonical columns, constraints, append-only trigger, delete restriction,
pair-consistent User/Employee evidence, and new application writer while still
accepting old-image unversioned assignment events as non-canonical transition
evidence. No legacy or transition evidence is backfilled. The previous image
may be restored during this phase without breaking assignment writes.

Only a later, separately reviewed activation migration may reject unversioned
assignment inserts. Its gates are: every repository and external writer uses
version 1; the new image has completed a production soak; the old image is
retired as a rollback target; transition-write reconciliation is complete; and
a forward-fix procedure is rehearsed. Parent Work Order deletion is restricted,
event mutation privileges are revoked from the runtime role, and consequential
integration tests use a disposable database rather than deleting evidence.

Idempotency means exact-request replay. Reusing an assignment or automation
delivery identity with a different consequential payload is a conflict. A
stable automation source delivery is processed at most once per tenant and a
rule runs at most once per event.

### D-035 — Shared workflow coordinates domains but never replaces their authority

Accepted: 2026-09-01

OVERVA uses one reusable tenant-scoped workflow coordination foundation for
case identity, current coordination snapshot, optimistic version, assignment,
transition, decision, reason, comment, idempotency, audit and notification
intent. Transition, assignment, decision, comment and command-receipt evidence
is append-only. Consequential commands derive tenant and actor from the
authenticated request, require backend permissions and reject a stale version
or an idempotency key reused with a different payload.

The coordination snapshot is not authoritative business state. HR employment
state remains in HR, correspondence state remains in correspondence, and
archive/retention/disposition state remains in archive. A future domain adapter
must validate its domain transition and permission, then update the domain row
and append workflow/audit/outbox evidence in the same transaction. Generic
workflow code may record domain before/after values as evidence but may not
project or invent them. This phase adds no business state machine or UI.

### D-036 — Canonical documents gain append-only relationships through compatibility

Accepted: 2026-09-01

`documents` and immutable `document_versions` remain the canonical formal
document model. Many-to-many domain relationships are added as append-only
`document_links` with tenant-composite references and attributable recording.
The existing `documents.linked_entity_type/linked_entity_id` pair and current
attachments, correspondence and archive records are retained as supported
compatibility surfaces. New compatible writers dual-record a relationship in
one transaction, and a compatibility view includes legacy-only writers.

Migration may project a link only when an existing document explicitly stores
both legacy entity fields. Unknown correspondence, archive or attachment links
remain null. No timestamp is claimed as the original historical linking time,
no file is moved, and no legacy reference is deleted. Domain adoption and any
correction/unlink event contract are separate reviewed work.

### D-037 — Tenant RLS context is transaction-local and activated by audited slice

Accepted: 2026-09-01

Tenant RLS context uses PostgreSQL transaction-local `app.organization_id`.
The server derives the organization from authenticated authority, begins a
transaction, sets and verifies the context in a separate statement, and rejects
both missing context and a different tenant on the same transaction. Context is
never session-global, so commit/rollback and pooled connection reuse clear it.
Application permissions, server-derived tenant predicates and composite tenant
foreign keys remain mandatory; RLS is defense in depth, not an authorization
replacement.

RLS activation is incremental. Migration `0085` enables only the ten audited
workflow, delivery and canonical-link tables. The document compatibility view
is security-invoker and explicitly tenant-filters its canonical and legacy
branches. Other staged policies require a route, query, report, background job
and admin compatibility inventory before activation. System transactions are
disabled by default, require a deployment gate plus an explicit reason, and can
bypass RLS only when the database role itself has reviewed bypass authority.

### D-038 — Notification intent, delivery coordination and attempt evidence are separate

Accepted: 2026-09-01

`workflow_notification_outbox` is immutable business intent committed in the
same transaction as workflow evidence. It is never rewritten into a delivery
status. `workflow_notification_delivery_state` is the mutable claim/lease and
retry projection, while `workflow_notification_delivery_events` is the
append-only attempt journal. Pending, processing, retry-scheduled, delivered
and dead-letter states use bounded retry, lease recovery and stable outbox ID as
the provider idempotency identity.

Delivery is asynchronous and tenant-explicit. Provider failure cannot roll back
an already committed domain/workflow transaction. An enabled adapter must state
that it honors idempotency and returns attributable provider metadata. Until a
real email/SMS/push adapter and its operational controls are reviewed, the
shipped adapter remains disabled and claims no intent; no fake success provider
is permitted.

### D-039 — Consequential offline commands require matching server confirmation

Accepted: 2026-09-01

Offline storage may queue local drafts, but approval, rejection, return,
termination, archive destruction, final closure and permission/security change
remain `awaiting_server` and may not appear final. Unknown command types default
to server confirmation rather than optimistic success. Retry envelopes carry a
client-generated request UUID and idempotency UUID, contain no client-selected
tenant, and become final only after a server response confirms the exact two
identities. Domain APIs must still implement their own authorization,
idempotency and version checks when Phase 2 adapters are added.

### D-040 — Domain authority remains separate under shared workflow coordination

Accepted: 2026-09-01

Choibalsan Human Resources, correspondence, complaints and archive each retain
their own authoritative aggregate and explicit state machine. Shared workflow
is used only for coordination identity/version, assignment, decision, comment,
immutable transition evidence and notification intent. A consequential command
must commit the domain change, workflow evidence, audit and outbox intent in one
tenant transaction and must require an expected version plus exact-payload
idempotency identity.

Formal evidence uses the canonical `documents`/`document_links` authority while
legacy attachment and domain-reference reads remain compatible. Existing
employees receive no fabricated appointment history or guessed employee number.
Existing correspondence and archive records receive no synthetic histories.

Archive disposal is a separated-duty evidence process, not a status toggle. It
requires retention eligibility, legal-hold review, stable item-set hash,
commission decision, a canonical destruction act, execution and verification
by different users. None of appointment finalization, employment exit,
official response send or archive disposal may appear final offline.

### D-041 — Legacy migration decisions are provenance, not imported history

Accepted: 2026-09-01

Every legacy row is identified within a tenant by source, table and legacy ID.
An identical checksum-bearing replay is idempotent; reuse of that identity with
changed source or payload evidence is a conflict. Classification and review are
versioned projections backed by an append-only human decision journal and
attributable audit. They do not become Employee, HR, correspondence, archive or
workflow history merely by being staged.

Existing identifiers take precedence. A display name alone can suggest human
review but cannot merge a record. Choibalsan Employees use the retained legacy
user identifier; derived masters may be matched only when those identified
Employees and their active assignments corroborate one tenant target. Legacy
status is stored as provenance only and must never fabricate transitions,
approvals, appointment/termination/leave cases or archive events. Actual import
requires a later, separately approved adapter and reconciliation gate.

### D-042 — Deterministic legacy grouping reduces review effort without deciding truth

Accepted: 2026-09-01

Legacy review may deterministically group already staged provenance and propose
`IMPORT_NEW`, `LEGACY_ONLY`, manual review or external reconciliation. Group
identity, membership, source signals and recommendation are immutable evidence.
A human decision changes only a tenant-scoped, versioned migration-review
projection through an append-only journal and exact-payload idempotent batch
receipt; it does not import, merge, create or update authoritative domain data.

Attendance uses legacy Employee/date only as a reconciliation-group identity.
The latest row and earlier superseded rows are candidates, not accepted history.
Approval and legacy-only disposition fail closed until production comparison
evidence is separately verified. An equal content hash is a duplicate signal,
never sufficient authority to merge logical documents. Name overlap is a human
review signal, never an Employee match key, and legacy correspondence is not
automatically promoted to a complaint.

### D-043 — Canonical legacy import requires separate approval and immutable mapping evidence

Accepted: 2026-09-01

Reviewer approval and import execution are separate authorities. Only an
approved, high-confidence order/decision or correspondence recommendation may
enter the canonical adapter. Approval itself never starts an import. The
adapter is dry-run by default; commit additionally requires a dedicated backend
permission, explicit environment gate, tenant transaction and idempotency key.

Every committed source keeps its provenance identity and immutable mapping to
canonical targets. Documents, versions and links use the canonical document
model; correspondence uses its 0086 authoritative table. Existing masters are
read-only match dependencies and cannot be updated. Legacy status remains
provenance metadata, never workflow or approval history. Checksum drift,
unstable Employee/User linkage and unexplained number collisions fail closed.
An exact rerun reuses its mapping, while a partial failure rolls back database
writes and newly created files.

### D-044 — Legacy SQLite executes only in an isolated one-shot importer runtime

Accepted: 2026-09-01

The request-serving API does not carry the legacy SQLite native dependency or
its install/build chain. Canonical legacy import executes only through a
dedicated non-root, no-port, opt-in one-shot runtime with its own locked
dependencies and a read-only mount of the approved immutable source snapshot.
It retains the existing tenant-scoped PostgreSQL authority, default dry-run,
explicit commit flag and environment gate. Runtime isolation is a packaging
and security boundary; it does not change migration schema, reviewer approval,
provenance, checksums, canonical mapping rules or domain authority.

### D-045 — Complaints requests HR assessment without creating discipline authority

Accepted: 2026-09-02

Complaints remains the authority for request, complaint and suggestion case
state. Additional-information requests and optional implementation monitoring
extend that same aggregate rather than introducing a second complaint model.

When complaint evidence may warrant employee discipline, Complaints creates an
explicit tenant-scoped handoff request with expected version, exact-payload
idempotency, canonical evidence links, audit, workflow/outbox coordination and
append-only handoff history. The request is not a disciplinary finding or case.
Only HR, under a separate intake permission, may later accept it by atomically
creating a separately authoritative confidential disciplinary case. Decline or
cancellation must retain an attributable reason. No existing complaint receives
synthetic handoff history.

Employee transfer/rotation and discipline remain separate HR employee-relations
case authorities. Transfer may change canonical Assignment only at an approved
effective command while preserving the prior effective-dated row; discipline
may not be reduced to a generic Employee event or shared-workflow state.

### D-046 — Employee transfer owns reviewed effective Assignment change

Accepted: 2026-09-02

Temporary transfer and rotation use one tenant-scoped HR transfer aggregate
with explicit type, source Assignment, target placement, effective dates,
consent, reviewed policy snapshot, proposal and management-decision evidence.
The case is distinct from Employee and Assignment projections and from shared
workflow coordination.

No draft or review command changes placement. Only an approved effective
implementation command may end the locked current primary Assignment, create
one new active effective-dated Assignment and synchronize compatibility
projections atomically. Temporary completion restores the prior placement by
creating another Assignment; it never reopens or deletes history. Existing
employees receive no synthetic transfer cases or events.

Tenant policy and legal references are review evidence captured per case, not
universal rules inferred from the pilot Visio. Backend permission, version,
idempotency, canonical-document, audit, RLS and append-only evidence controls
remain mandatory for every consequential command.

### D-047 — Discipline is a restricted HR case with independent decision authority

Accepted: 2026-09-02

A complaint-to-HR handoff is only an assessment request. HR may accept it only
by atomically creating a separately authoritative restricted discipline case
and recording the new identity on immutable handoff evidence. A reasoned
decline remains versioned, exact-payload idempotent and audited. Manual intake
uses the same discipline authority.

The discipline case owns notice, explanation or documented refusal,
investigation, finding, recommendation, decision, acknowledgement, effective
period, expiry or early removal and dispute evidence. List/detail, intake,
investigation, recommendation, decision and administration permissions remain
separate. When the snapshotted tenant policy requires four eyes, the creator,
investigator and recommender cannot make the final decision.

Restricted command narratives remain only in the discipline event authority.
Shared workflow, notification intent and general audit evidence receive a
redacted command label and case identity rather than the sensitive reason.

The case snapshots its reviewed policy/version, legal basis and decision due
date. Those inputs are evidence, not rules inferred from the pilot Visio. One
tenant/Employee/violation identity prevents a second authoritative case for the
same violation. Existing employees and handoffs receive no synthetic cases or
events; shared workflow remains coordination evidence only.

### D-048 — Statutory discipline clocks are computed and restricted existence is confidential

Accepted: 2026-09-02

The verified Article 123 clock is server authority rather than a user-selected
deadline. For an ordinary case, the service computes six calendar months from
the violation or last continuing date and one calendar month from discovery,
then uses the earlier limit. Full-property-liability cases replace only the
occurrence limit with one calendar year. Evidenced medical, annual or personal
leave and competent investigation periods suspend both clocks; overlapping
periods are merged so time is not counted twice. The rule version, inputs,
suspensions and both calculated limits are snapshotted on the restricted case.

A sanction may not be imposed after the computed deadline. Its expiry is one
calendar year from the server decision date, and early removal requires a
canonical written/electronic decision. Tenant policy remains separately
versioned evidence and cannot override the statutory maximum.

Discipline existence is itself restricted. Without
`hr.discipline.confidential.read`, APIs expose no real list or aggregate count.
Canonical documents linked to a discipline case are hidden across document
listing, version metadata, version upload, lifecycle mutation and file download
unless that confidential permission is present; document classification rules
still apply independently.

Migration `0093` was still repository-only: documented production remained at
`0080` and the primary local business database at `0090`. The new columns and
checks therefore extend `0093` without rewriting any applied business data or
changing an already deployed checksum. Verification passed 27 focused tests,
the full 394-test suite, clean `0001` to `0093` migration and the disposable
Phase 2 PostgreSQL integration; the disposable database was removed afterward.

### D-049 — HSE permits are tenant-configured Work Order evidence

Accepted: 2026-09-02

Field-work start permission and completion inspection extend the canonical
Work Order rather than creating a Choibalsan-specific work registry. The
platform owns generic stages, action authority, immutable review evidence,
tenant isolation and audit. Each organization owns versioned safety templates,
work-type routes and policy choices; camera, lighting and local checklist terms
are pilot configuration, not universal OVERVA semantics.

For the Choibalsan pilot, assignment is followed by HSE start review. Approval
may directly authorize execution because this tenant disables a separate
management start gate. The responsible engineer submits completion, HSE records
the final inspection, and the chief engineer remains the independent authority
that closes the Work Order. Return, suspension and denial remain attributable
evidence rather than destructive state rewrites.

An approved start review snapshots the assignee, operational object and work
scope and has an explicit validity limit. Completion fails closed if that
permit has expired or the governed scope changed. Adding a future organization
must not copy Choibalsan templates, routes, data or terminology automatically;
its onboarding evidence may instead instantiate organization-owned templates
through the same generic capability.

### D-050 — Operational intake and execution keep separate truths

Accepted: 2026-09-02

An operational defect, inspection finding, complaint-derived need or other
reported condition remains an `operational_incident` until it is resolved. A
Work Order remains the canonical authority for assignment, execution, safety
review and management acceptance. The two are connected by an explicit,
tenant-scoped, append-only link; neither record is copied into a competing
generic work registry.

Organization-wide triage authority decides whether an intake item becomes work,
selects its configurable work type and responsible unit, and assigns an owner.
Only then may a configured safety workflow begin. Possible same-object work is
shown as a duplicate warning, while a direct active link is a hard duplicate
stop. Closing the final active linked work may resolve its source condition in
the same transaction, with attributable incident evidence.

The Choibalsan pilot assigns this triage and final-acceptance responsibility to
its chief engineer through existing Work Order permissions. That local role
mapping is not a universal OVERVA job-title rule. Lighting, camera, HSE, fleet,
facilities and future sources may feed the same generic intake boundary without
becoming mandatory modules or sharing another tenant's configuration.

### D-051 — Routine work is pulled by the responsible team; management handles exceptions

Accepted: 2026-09-02

OVERVA keeps one canonical Work Order engine and models three independent
questions explicitly: why work exists (`core_service` or
`internal_operation`), whether the assignment is normal, special or emergency,
and which governed safety/approval workflow applies. A purpose label must not
grant authority or silently select a safety decision.

An organization may configure deterministic intake-domain to Work-Type
suggestions. The suggestion inherits that tenant's reviewed department and
workflow route but remains advisory until an authorized person creates the Work
Order. A normal, fully routed and unassigned item becomes visible to its
responsible team. A same-department user with explicit assignment and progress
permissions may claim it through an idempotent, audited, append-only assignment
command. A claim starts any configured HSE gate; it does not bypass it.

Missing routing, special assignments and emergencies stay in a management
exception queue. The chief engineer oversees internal operational flow and
retains independent final acceptance, but routine dispatch is not forced
through that person. Choibalsan's lighting and camera mappings are tenant-owned
pilot configuration and are not universal OVERVA rules. Fleet, facilities,
general administration and future domains use the same engine only after their
own reviewed configuration.

### D-052 — Service area is independent from ownership and workflow

Accepted: 2026-09-02

A Work Board may need a second, organization-specific classification below a
broad source domain. This service area answers what kind of organizational
service the need or work belongs to. It must not be represented as a department
column, Work Type, permission, or Kanban stage. Filtering by service area changes
presentation only and follows the same canonical Work Order through intake,
team backlog, safety, execution and acceptance.

The source incident owns its reviewed service-area classification. Work created
from that incident inherits the same tenant-scoped identifier, while direct
urgent work may select one explicitly. A conflicting client override is
rejected. When legacy or imported evidence is incomplete, the record remains
unclassified and visible in the broader queue rather than being guessed.

Choibalsan's five lighting areas are tenant configuration derived from its
reviewed legacy operating view. The old screen mixed open-fault counts with
inventory-location and asset totals; the new Work Board counts only current
queue items and states that distinction. No other organization receives these
names or records automatically.

## Active Hypotheses

### H-001 — Customer journey

Discovery → AS-IS → Needs → Blueprint → Configuration → Pilot → First Value →
Go-live → Paid → Champion → Referral is the current measurable adoption model.

### H-002 — Market entry

Easy discovery/configuration and a safe pilot reduce adoption friction; charging
should increase when real operational value begins.

### H-003 — AI-assisted self-configuration

Guided conversation, Smart Import, and governed recommendations can allow more
customers to configure useful environments without requiring an ERP specialist
for every step.

### H-004 — Creator Studio, Client Review, and Runtime

OVERVA may serve a spectrum from self-builders and app enthusiasts to business/
data analysts, professional developers, implementation partners, and internal IT
teams. Frequent creators use a business-aware Studio; business stakeholders use
a simpler review/approval surface; approved apps run in a governed Runtime. This
is a market and product-surface hypothesis to validate with real users, not yet
an accepted replacement for the current product architecture.

### H-005 — Connector ecosystem and certification

Reusable contracts, adapters, a test sandbox, certification, and clear support
ownership may reduce repeated integration work across Mongolian business
software. This must first be validated with one business event and at least two
independent real systems. A national standard, connector marketplace, or broad
vendor adoption must not be claimed from an internal framework alone.

### H-006 — Contributor community and academy

Business analysts, data analysts, developers, researchers, students, internal
IT teams, and implementation partners may contribute reusable evidence methods,
schemas, adapters, templates, and measured solutions. Start with governed pilot
projects and contributor rules; introduce marketplace, commercial certification,
or academy positioning only after repeatable contribution and customer value are
observed.

### H-007 — Bounded supplier-neutral market

A small assisted market can resolve the multi-sided cold-start problem before
ranking, payment, and onboarding automation. Validate both ready products and
freelance orders with third-party suppliers and `OVERVA Apps` under equal rules.
Measure discovery, customer choice, qualified proposals, completion, complaints,
supplier satisfaction, and operator neutrality. These are validation targets,
not claims of current adoption.

## Decision Change Format

When evidence changes an accepted decision, append a replacement entry stating:

- what changed and why;
- evidence used;
- compatibility and data impact;
- migration and rollback path;
- verification performed.

Do not silently rewrite historical rationale.
