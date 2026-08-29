# OVERVA Market and Platform Separation Contract V1

Status: accepted product, governance, and architecture boundary

Accepted: 2026-08-28

## Purpose

OVERVA Group has three peer operating roles that must not be collapsed into one
authorization, data, ranking, or commercial boundary:

1. **OVERVA Platform** — the governed organization environment, App Factory,
   review surface, and runtime at `app.overva.com`.
2. **OVERVA Apps** — the first-party product vendor.
3. **OVERVA Market** — a multi-supplier product, custom-work/service, and
   community market where customers choose freely and suppliers participate on
   equal terms.

`OVERVA Apps` is the peer product/vendor arm that may publish Platform-produced apps
and submit freelance proposals. It is a Market participant, not the Market
operator. Even if these businesses initially share ownership, they must operate
as if they were separate companies wherever operator power could advantage the
vendor arm.

## Control has two meanings

The Platform controls authorized organizational operation: tenant data,
configuration, workflow, permissions, runtime, consequential actions, and audit.

The Market controls market integrity: participant eligibility, listing truth,
malware and security review, proposal confidentiality, transaction evidence,
moderation, verified reviews, complaints, and policy enforcement. It does not
control customer choice, choose winners, force customers into the Platform, or
require every delivery artifact and internal work step to live in OVERVA.

## Equal-participation rule

`OVERVA Apps` receives the same listing requirements, fees, search eligibility,
ranking inputs, review rules, enforcement, and appeal path as every comparable
supplier. An explicit `OVERVA Apps` ownership badge provides transparency but no
ranking benefit.

The vendor arm must never receive:

- unpublished competitor listings or proposals;
- private customer/provider discussions outside its own participation;
- operator-only ranking, moderation, complaint, or investigation data;
- advance access to policy changes unavailable to comparable suppliers;
- an administrative ability to alter its own ranking, reviews, disputes, fees,
  verification, or enforcement state.

Operator interventions and administrative access are attributable and audited.
Ranking and featuring rules must be reviewable for self-preferencing.

## Market operating domains

The Market has three peer customer-facing surfaces and a separate operator
governance domain:

- **Products:** ready-to-use apps, templates, connectors, and solutions from
  multiple suppliers, including clearly labelled `OVERVA Apps` products;
- **Custom work and services:** customer orders, implementation partners,
  support, and supplier proposals, where `OVERVA Apps` may bid under the same
  information and rules as competitors;
- **Community:** forum, questions, implementation knowledge, and product support
  discussion with transparent moderation;
- **Market governance:** listing, security, supplier, licensing, compatibility,
  fee, complaint, appeal, and dispute controls inaccessible to suppliers.

A customer may buy a ready product, order custom work, or use community
knowledge without first completing Platform discovery, opening a Platform
workspace, or choosing an OVERVA product or service.

## Data and identity boundary

Market records and Platform tenant records require separate storage and
authorization boundaries. A shared sign-in may be introduced through scoped
identity federation, but it does not merge Market profiles with tenant employees,
roles, private organization evidence, builder projects, runtime data, or audit
journals.

Publishing a Platform-produced app requires a versioned release package and an
explicit vendor publication action. Publishing a customer request requires a
separate human-approved Market snapshot. Neither action copies private tenant
data, source material, credentials, or internal memory by default.

The Market retains only records needed to operate the chosen market service,
such as listing versions, order/request versions, proposals, selection,
commercial evidence, complaints, enforcement, and verified reviews. Source code,
internal project management, customer operational data, and every delivery step
may remain in authorized external or Platform tools.

## Commercial and organizational separation

The Market operator, Platform/App Factory, and `OVERVA Apps` vendor activity
require separately attributable revenue, costs, fees, refunds, credits, and
administrative decisions. Legal-entity separation may follow specialist review,
but technical, operational, data-access, and accounting separation begins before
the Market accepts real competing suppliers.

## Current implementation truth

This contract accepts the target boundary; it does not claim that a production
Market backend, supplier accounts, product commerce, freelance proposals,
payments, forum, ranking, or organizational separation is already implemented.
The deployed public Market-shaped screens remain examples and browser-local
request tooling until those capabilities are built and verified.

## Release gates

Before real multi-supplier operation:

1. define operator, Platform, and vendor ownership and administrative roles;
2. establish separate Market data and authorization boundaries;
3. implement supplier-neutral listing, search, ranking, fee, and review rules;
4. prove competitor proposal confidentiality against operator-vendor leakage;
5. separate Market and `OVERVA Apps` financial evidence;
6. publish clear customer, supplier, moderation, complaint, and appeal policies;
7. complete security, privacy, tax, payment, and legal review appropriate to the
   enabled commercial functions.
