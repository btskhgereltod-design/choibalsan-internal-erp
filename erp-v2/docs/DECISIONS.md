# OVERVA Decisions

Last updated: 2026-08-29

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
