# OVERVA Market Boundary and Demo Audit V1

Status: repository audit and test-only simulation; amended by D-023; no
production marketplace backend is claimed

Date: 2026-08-27

D-023 requires Market records, administration, and commercial activity to
remain separate from Platform tenant records. Individual Market participation
must not fabricate a tenant. The earlier organization-owned simulation remains
valid test evidence for organizational participants, not the universal Market
identity model. `MARKET_PLATFORM_SEPARATION_CONTRACT_V1.md` is authoritative.

## Audit conclusion

The current product does not yet mix Market customer, developer, order, and
negotiation memory because those server-backed Market records do not exist.
Public V19 stores versioned unpublished request drafts linked to browser-local
workspaces;
`app.overva.com` stores tenant users, private AI/interview evidence, builder
projects, and internal operational work in PostgreSQL.

The absence of mixing today is not proof that existing tables can safely be
reused for Market. Four existing concepts have different meanings:

| Existing concept | Current boundary | Why it is not a Market record |
| --- | --- | --- |
| `users` | One `organization_id`, tenant login and permissions | A Market participant may collaborate across organizations, but must still act for an explicit organization and engagement |
| `work_orders` | Internal tenant operational work | A software procurement/delivery request has proposal, commercial, IP, dispute, and cross-organization states |
| `ai_agent_messages`, `ai_interview_*`, `ai_requirement_records` | Tenant-private discovery and AI evidence | Buyer-developer negotiation is intentionally shared with selected parties and must not expose raw tenant evidence |
| Developer Platform (`api_clients`, webhooks) | Tenant API clients and integrations | It is not a human developer/team profile, portfolio, verification, proposal, or reputation model |

## Browser-local risks and V19 correction

1. Resolved locally in V19: the legacy `overva.public.request.draft.v1` single
   key migrates into `overva.public.request.drafts.v2`; later requests append
   separate ID/revision records instead of overwriting earlier drafts.
2. `overva.public.workspaces.v1` belongs to a browser profile, not an
   authenticated person. Different people sharing one browser can see the same
   local workspaces.
3. Local storage is not an encrypted system of record. Sensitive business
   evidence must not be treated as safely published or retained there.
4. Resolved locally in V19: a workspace is selected first, the draft stores its
   stable workspace ID, and the workspace checkpoint stores the matching draft
   ID.
5. The current `visibility` choice is intake context only. No server-side
   authorization or publication is implemented behind it.

These are acceptable only while the page clearly states that the artifact is an
unpublished local draft. They block treating V18 as a real Market database.

## Required separate Market aggregates

Do not copy raw conversations into a global table. Introduce bounded records:

```text
tenant user + organization authorization
                |
                v
market organization participant/profile
                |
confirmed requirement version --redacted snapshot--> market request
                                                    |
                         +--------------------------+-------------------+
                         v                          v                   v
                 public clarification       private proposal    selected delivery
                         |                          |                   |
                         +--------------------------+-------------------+
                                                    v
                                   commercial -> pilot -> acceptance
                                                    |
                                                    v
                                    production -> verified outcome
```

Minimum server-side records:

- `market_provider_profiles`: organization-owned developer/team profile,
  verification state, capabilities, support model, and portfolio claims;
- `market_requests`: owner organization, source workspace/requirement version,
  redacted immutable publication snapshot, status, and publication decision;
- `market_request_participants`: attributable user, organization, role, joined
  and revoked state;
- `market_proposals`: one versioned commercial/technical proposal per developer
  organization, visible only to its developer team and the customer;
- `market_threads` and append-only `market_messages`: explicit public,
  proposal-private, and selected-delivery visibility;
- `market_agreements`, milestones, acceptance evidence, change requests,
  disputes, and verified outcome reviews;
- append-only Market audit/event records, idempotency keys, retention policy,
  and demo/test flags.

Every cross-organization query must authorize through request membership on the
server. Client-supplied organization IDs must never select a tenant boundary.

## Test-only demo executed

`api/test/marketplace-simulation.test.js` creates:

- 5 customer actors in 5 separate organizations;
- 10 developer actors in 10 separate organizations;
- 5 request types: inventory, approval workflow, service work, CRM, and system
  integration;
- 3 proposals per request, for 15 proposals total;
- public clarification, proposal-private negotiation, selected-delivery
  discussion, commercial acceptance, pilot, customer acceptance, production,
  and closure paths.

The simulation also proves expected denials for:

- reading a draft from another organization;
- proposing before human confirmation/publication;
- another customer confirming or selecting an owner's request;
- one developer reading another developer's proposal terms;
- duplicate proposals;
- non-participants entering a private thread;
- unselected developers entering delivery discussion;
- starting a pilot before both parties accept the agreement;
- deploying before customer acceptance;
- leaking tenant-private evidence into the published snapshot.

Both automated scenarios pass. This proves the proposed state and authorization
rules are internally coherent in a sequential in-memory model. It does **not**
prove database transactions, concurrent selection, production authentication,
notifications, file safety, payment, legal agreement, or dispute handling.

## Remaining high-risk tests before a real pilot

1. Two customer sessions select different proposals concurrently; exactly one
   selection must commit.
2. Proposal and message writes retry with the same idempotency key without
   duplication.
3. User access, provider verification, or organization status is revoked during
   an active delivery.
4. Published requirement version changes after proposals exist; old proposals
   remain attributable to the old snapshot and re-confirmation is explicit.
5. Scope change creates a priced, accepted change request instead of silently
   rewriting the contract.
6. Attachments are access-controlled, malware-scanned, retained, and deleted
   according to policy.
7. Reviews can be written only after attributable acceptance/production
   evidence and cannot be fabricated or edited silently.
8. Demo actors, orders, messages, and outcomes are excluded from real adoption,
   revenue, reputation, and customer-journey metrics.
9. Currency, tax, invoice, IP ownership, confidentiality, e-signature, dispute,
   and Mongolian legal/privacy requirements receive specialist review before
   handling real money or binding agreements.

## Recommended implementation order

1. Promote the V19 versioned local draft and stable workspace link into an
   authenticated, server-side requirement draft without changing its IDs.
2. Add organization-owned provider profiles and verification without proposals.
3. Add a redacted, human-approved Market request snapshot and participant model.
4. Add private proposal and clarification threads with server-side membership
   tests.
5. Run the concierge pilot manually with demo/test flags and no platform-held
   payment.
6. Add commercial, milestone, acceptance, change, review, and dispute records
   only when the pilot demonstrates the need and legal/operational ownership is
   defined.
