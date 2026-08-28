# OVERVA Product Delivery and Commercial Contract V1

Status: Accepted foundation  
Date: 2026-08-26

## Purpose

OVERVA must let a person understand, shape, and test a useful product before a
tenant, production environment, payment obligation, or long-term operating
commitment is created. The public builder is a safe workshop, not a shortcut
into the full ERP.

## Separate lifecycles

The following records must remain distinct:

1. Conversation memory records evidence, hypotheses, decisions, plans, and
   verification.
2. Product delivery records discovery, builder preview, team testing, agreed
   scope, commercial agreement, deployment, and live operation.
3. Commercial records offers, pricing, acceptance, contract authority, billing,
   ownership, and support terms.
4. Operations records hosting, security, data migration, acceptance, service
   ownership, backup, recovery, monitoring, and changes after go-live.

Existing organization growth events begin after a governed tenant exists. They
do not authorize anonymous workspace delivery or commercial decisions.

## Stage gates

```text
Ойлгох → Бүтээх → Багаар турших → Хамрах хүрээ
       → Нөхцөл тохирох → Байршуулах → Ажиллуулах
```

- **Ойлгох:** accept free-form conversation and evidence from files, images,
  diagrams, or current systems.
- **Бүтээх:** show a working preview based on an explicit hypothesis.
- **Багаар турших:** require a human-confirmed understanding and recorded preview
  activity. Preview actions remain test evidence, not production execution.
- **Хамрах хүрээ:** explicitly confirm objectives, workflows, data, roles, and
  acceptance criteria. Freeze the reviewed scope before commercial acceptance.
- **Нөхцөл тохирох:** keep the offer, price, delivery responsibility, ownership,
  hosting, support, code handoff, and authorized agreement attributable.
- **Байршуулах:** require an accepted agreement plus an explicit hosting choice,
  security readiness, and data readiness.
- **Ажиллуулах:** require verified deployment, user acceptance, an operations
  owner, and backup/recovery readiness.

No conversation, upload, generated preview, preview click, or saved local
checkpoint may silently advance a commercial, deployment, or live-operation
gate.

## Environment boundary

The public workshop saves browser-local checkpoints. It does not provision a
tenant or user in `app.overva.com`. Tenant creation and production deployment
belong to the governed final delivery flow after their gates are met.

Code export is a governed delivery option, not the default result of a preview.
Its ownership, maintenance, security, deployment, and support consequences must
be included in the accepted commercial scope.

## Product rule

The interface should always show the current stage, the next gate, and what is
still missing. A locked action explains why it is locked. It must never frighten
or mislead a learner, student, small business, or large organization by dropping
them into a production ERP before they have chosen and prepared for that step.
