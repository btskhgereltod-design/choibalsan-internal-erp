# OVERVA Decisions

Last updated: 2026-08-27

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

### H-007 — Concierge digital-needs marketplace

A small assisted market can resolve the two-sided cold-start problem before
marketplace automation. The initial target is 10 qualified developer teams, 20
real organization discovery conversations, 5 confirmed request packages,
approximately 3 qualified proposals per request, 3 selected deliveries, and at
least 1 accepted production outcome with attributable feedback from both sides.
These targets validate or reject the market mechanism; they are not claims of
current adoption.

## Decision Change Format

When evidence changes an accepted decision, append a replacement entry stating:

- what changed and why;
- evidence used;
- compatibility and data impact;
- migration and rollback path;
- verification performed.

Do not silently rewrite historical rationale.
