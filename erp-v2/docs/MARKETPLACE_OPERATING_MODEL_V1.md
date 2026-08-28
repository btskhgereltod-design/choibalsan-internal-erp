# OVERVA Marketplace Operating Model V1

Status: accepted product boundary; concierge-first implementation

Date: 2026-08-27

## Core business

OVERVA helps an organization turn a digital need into a comparable request,
meet a suitable implementation provider, and keep delivery governed until an
attributable production outcome. The business is neither simple lead resale nor
merely an AI app builder.

One account may act in both capacities, but the two work contexts stay visibly
and structurally separate:

- **Customer:** My Requests, My Projects, agreement, acceptance, and review.
- **Provider:** Find Work, My Proposals, Delivery Jobs, evidence, and review.

An internal customer workspace is never silently treated as a provider job.
Private organization discovery memory is never copied into a public request.
A private request-review workspace is also not a customer project. A customer
project is created only after provider selection and bilateral scope/agreement;
earlier request drafts and trial workspaces stay in their own clearly labelled
contexts.

## Contract control plane

Implementation may use GitHub, Figma, Zoom, cloud hosting, or another authorized
tool. OVERVA retains the official control record:

```text
confirmed request -> proposal -> selection -> bilateral scope/agreement
-> milestones -> delivery evidence -> customer acceptance/change request
-> production verification -> commercial reconciliation -> bilateral review
-> closed outcome
```

After selection, the path may optionally branch through a provider-proposed
`Joint Clarification` before bilateral agreement. The customer must explicitly
accept the invitation, and either party may proceed without it. The surface may
map the customer's real workflow, participants, information, decisions, and
acceptance outcome; it is neither a coding environment nor a mandatory project
stage. A project still begins only after bilateral agreement.

A provider cannot unilaterally mark work complete. A customer must accept the
submitted evidence or make an attributable change/rejection decision. A
verified review is allowed only for a closed, accepted engagement and is unique
per party. Real use requires server-side identity, organization membership,
authorization, audit, and idempotency.

## Revenue hypothesis

The first revenue stack to validate is:

1. paid requirement-definition and request-preparation assistance;
2. a transparent success/governance fee at an agreed commercial outcome;
3. later, optional subscriptions, support, hosting, certification, and
   integration services where evidence supports them.

An initial **8-10% total success-fee range** is a pricing experiment, not a
permanent price. The pilot must test willingness to pay, fee split, collection
cost, tax treatment, and whether the fee matches the protection received.

OVERVA must not claim or operate escrow, wallet, regulated payment service,
automatic contracting, or arbitration until specialist review and an
appropriate legal/payment operating model exist.

## Concierge-first release boundary

The public site may explain and separate the roles, show sample requests, and
explain completion. It must label samples and empty provider state truthfully.
It must not fabricate developers, proposals, payments, completed jobs, or
reviews.

Primary navigation should contain the work people came to do: customer
requests/projects and provider opportunities/proposals/delivery jobs. Rules,
legacy trial checkpoints, and optional clarification guidance belong in
contextual or secondary help rather than appearing as mandatory work stages.

The next real proof remains D-019/H-007: qualify a small group of providers and
customers, package real confirmed requests, compare proposals, and carry at
least one engagement to attributable accepted production outcome.
