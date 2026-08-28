# OVERVA Product Direction

This file is a product compass for OVERVA. It defines the durable purpose and
the few boundaries that must not be broken. It does not freeze implementation.

## Working Context

Before proposing or implementing material work:

1. Read `docs/CURRENT_STATE.md` and `docs/DECISIONS.md`.
2. Read the relevant part of `docs/ARCHITECTURE.md` and search the repository.
3. Distinguish implemented, partial, planned, and hypothesis states explicitly.
4. Extend or refactor existing capabilities instead of duplicating them under a
   new name.

After a material capability or architecture change, verify the change and
update `docs/CURRENT_STATE.md`. Record a new entry in `docs/DECISIONS.md` only
when a durable product or architecture decision was actually made.

These are context-hygiene defaults, not a ban on better solutions. If current
documentation and code disagree, verify the code and correct the documentation.

### Parallel Agent Coordination

When several agents work on OVERVA, give each one a bounded outcome, relevant
files/boundaries, acceptance criteria, and verification command. Avoid assigning
the same files to multiple agents at the same time. Each handoff should state:

- what changed;
- what was verified;
- what remains;
- any risk, migration, or decision needing review.

Parallelism should reduce elapsed time, not split ownership of one unresolved
design across disconnected implementations.

## What OVERVA Is

OVERVA is a general-purpose Connected Organization Platform that helps an
organization understand, configure, operate, and improve its work from one
connected environment.

Users should not need to understand ERP, CRM, HRM, WMS, GIS, IoT, or other
software theory before they can use OVERVA.

OVERVA should learn how an organization works through its data, Smart Import,
guided discovery, and user feedback. It should then help the organization
configure only the capabilities and workspaces it actually needs.

Core promise:

> The organization should not have to adapt itself to software. The software
> should adapt to the organization.

## Accepted North Star and Market Entry

The durable horizon is a connected digital organization, production, and market
ecosystem. Organizations keep isolated tenant, data, authorization, and audit
boundaries while collaborating through explicit governed contracts.

OVERVA initially enters through a narrower promise: help an organization define
its digital need, turn it into a confirmed requirement and preview, find a
trusted delivery path or developer, and govern the work through production
outcome. Do not position the initial product primarily as another ERP, a module
catalogue, or a generic AI app builder.

`docs/MARKET_ENTRY_STRATEGY_V1.md` is the canonical scope guardrail. New large
ecosystem ideas go to the future horizon unless evidence shows they are required
for the next real pilot outcome.

## Product Philosophy

- Begin with the customer's real work, problems, people, and data—not a large
  menu of software modules.
- Show each person only the workspaces and information relevant to their role.
- Keep one reliable source of truth and reuse it across authorized workflows.
- Let users participate in configuring their own working environment so they
  understand it, adopt it faster, teach others, and can become internal OVERVA
  champions.
- Use AI to reduce effort and uncertainty, while keeping important decisions,
  approvals, and changes reviewable by people.
- Prefer a simple path to first value over a large initial implementation.
- Support organizations from one-person businesses to complex enterprises
  without forcing unnecessary complexity on smaller customers.
- Develop in an evidence-driven spiral: understand, build small, test with real
  work, measure, learn, and improve. Research must guide delivery, and delivery
  must produce evidence; neither should become an end in itself.

## Customer Journey Hypothesis

Discovery
→ AS-IS understanding
→ Needs and pain points
→ Blueprint
→ User configuration
→ Pilot
→ First Value
→ Go-live
→ Paid usage
→ Champion
→ Referral

This is a measurable product hypothesis, not a permanent workflow. Preserve
evidence about where customers succeed, hesitate, abandon, or need assistance,
and improve the journey when research supports a better approach.

## Marketing Direction

Do not market OVERVA primarily as another ERP or as a list of modules.

Lead with customer problems:

- too many separate applications;
- duplicated data entry;
- difficult and rigid software;
- disconnected information;
- reliance on specialist knowledge;
- slow implementation and migration;
- no clear, shared view of the organization.

Position OVERVA around simplicity, adaptation, connected work, rapid first
value, and one organizational view.

Primary product message:

> OVERVA — See Your Organization as One.

Mongolian expression:

> Байгууллагаа бүхэлд нь нэг дор хар.

## Business Model Hypothesis

Make discovery, initial configuration, and a safe pilot easy to try. Monetize
when the customer begins receiving real operational value. Pricing may evolve
toward plan, usage, capability, or value-based charging as evidence grows.

Do not treat this hypothesis as a reason to build fake demo functionality or to
mix one customer's data with another customer's data.

## Development Principle

Protect the product purpose, but do not freeze implementation.

Developers and AI agents may improve architecture, libraries, data models,
workflows, UX, naming, and internal design when a better solution is supported
by evidence. Do not preserve an implementation merely because it already
exists, and do not rebuild a working part without a clear benefit.

Keep domain concepts separate from one customer's local terminology. Choibalsan
Hugjil is a real pilot and learning source, not the universal OVERVA model.

## Non-Negotiable Boundaries

These protections apply regardless of implementation choice:

1. **Tenant isolation:** every organization's business data and authorization
   boundary must remain isolated and enforced server-side.
2. **Audit integrity:** critical security, permission, configuration, workflow,
   administrative, AI, and device actions must create attributable,
   append-only audit evidence.
3. **IoT command safety:** command priority is always Emergency > Manual >
   Weather > Schedule > Default. It must be enforced at UI/API, server,
   gateway/edge, and device levels. Approved local rules and the last valid safe
   configuration must continue when connectivity is lost.
4. **Secrets and private data:** never commit credentials, tokens, certificates,
   API keys, or private customer data. Do not expose internal databases,
   caches, or administrative services directly to the public internet.
5. **Truth before automation:** AI may propose, map, explain, and accelerate;
   consequential writes or control actions require validation, authorization,
   traceability, and an appropriate human approval path.

## Project Memory

- `docs/MARKETPLACE_OPERATING_MODEL_V1.md` — accepted customer/provider split,
  delivery control record, verified outcome, and revenue hypothesis boundary.

- `docs/MARKET_ENTRY_STRATEGY_V1.md` — accepted North Star, entry wedge,
  validation targets, and ninety-day scope guardrail.

- `docs/OVERVA_VISION.md` — human-readable product and market direction.
- `docs/CURRENT_STATE.md` — current implementation and active focus.
- `docs/ARCHITECTURE.md` — current system boundaries and stable defaults.
- `docs/DECISIONS.md` — accepted decisions and change rationale.
