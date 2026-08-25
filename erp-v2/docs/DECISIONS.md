# OVERVA Decisions

Last updated: 2026-08-24

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

## Decision Change Format

When evidence changes an accepted decision, append a replacement entry stating:

- what changed and why;
- evidence used;
- compatibility and data impact;
- migration and rollback path;
- verification performed.

Do not silently rewrite historical rationale.
