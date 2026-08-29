# OVERVA Group Operating Model V1

Status: accepted product, governance, and architecture boundary

Accepted: 2026-08-28

## Group structure

`OVERVA Group` is an ownership and strategy umbrella. It is not a shared tenant,
authorization scope, operational database, or permission shortcut.

The Group has three peer operating roles:

1. **OVERVA Platform** — the governed App Factory and organization runtime at
   `app.overva.com`;
2. **OVERVA Apps** — the first-party product vendor that creates and supports
   ERP, CRM, HR, finance, inventory, operations, fleet/GPS, IoT/SCADA, and AI
   agent products;
3. **OVERVA Market** — the supplier-neutral product, custom-work/service, forum,
   and market-governance business.

Common ownership does not merge their operator powers. A person or service must
receive an attributable role inside the relevant operating boundary.

## OVERVA Platform

The Platform contains:

- **App Factory:** AI-assisted creation, no-code/low-code development, governed
  templates, and developer tools;
- **Organization workspace:** user and access management, tenant management,
  workflow engine, data and integration layer, device/IoT runtime, audit, and
  security;
- **release boundary:** a reviewed, versioned release package that a vendor may
  explicitly publish or operate. Building an app does not publish it to Market.

## OVERVA Apps

OVERVA Apps is a vendor, not a Platform administrator and not a Market operator.
It may use the Platform to build products and may list or bid in Market only
under the same eligibility, fees, ranking, review, enforcement, and appeal rules
as comparable suppliers.

The vendor badge discloses Group ownership. It gives no ranking benefit and no
access to competitor listings, proposals, customer discussions, complaints,
investigations, or operator controls.

## OVERVA Market

The Market contains four operating domains:

1. **Product market:** apps, modules, connectors, templates, and AI agents;
2. **Custom work and services:** work orders, developers, implementation
   partners, consulting, support, and maintenance;
3. **Forum:** customer and developer areas, industry communities, and a governed
   knowledge base;
4. **Market governance:** product truth and technical review, security
   assurance, supplier verification, licensing, fee transparency, version
   compatibility, complaints, appeals, and dispute resolution.

Market governance protects integrity and participant choice. It does not choose
winners, force Platform adoption, or allow OVERVA Apps to administer its own
listing, ranking, review, fee, complaint, or enforcement state.

## Required separation

Before accepting real competing suppliers, Platform, OVERVA Apps, and Market
require separately attributable:

- administration and privileged access;
- operational data and authorization;
- financial evidence, revenue, costs, fees, refunds, and credits;
- policies, conflicts of interest, interventions, and appeals;
- security monitoring and audit records.

Scoped identity federation may connect accounts later, but Group membership or
shared login never grants cross-boundary access.

## Current implementation truth

The operating model is accepted, but legal-entity separation is not claimed.
Production currently has the Platform and a public V26 Market-shaped preview.
It does not yet have a server-backed multi-supplier catalog, supplier accounts,
commerce, proposals, payments, forum accounts/posts, ranking, certification, or
dispute system. Preview cards and topics remain labelled samples.

Admin shell V30 keeps a single deployable web application while presenting the
three operating boundaries explicitly. Only Platform admin is operational.
Group overview is static boundary information; OVERVA Apps and Market Operator
are disabled/no-backend contexts. Their business workspace blueprints and
twenty-role simulations are implementation guidance and test evidence, not
production identities or backend capability. This shell does not create
cross-boundary permissions or prove separate operator identities have been
implemented.

The local V30 Platform slice now has server-enforced, live-derived Platform
roles and permissions. This narrows the existing Platform control plane only;
it does not make Apps or Market operational and does not create a shared Group
administrator.

## Release order

1. Keep the public information architecture and terminology truthful.
2. Define separate Market identity, storage, administration, and audit.
3. Separate OVERVA Apps vendor users and finances from Market operator roles.
4. Publish supplier, listing, security, fee, complaint, appeal, and conflict
   policies before onboarding competing suppliers.
5. Pilot third-party and OVERVA Apps products under identical rules and measure
   neutrality before automating ranking or broad commerce.
