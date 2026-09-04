# Production Go Candidate — 2026-09-04

Status: **READY FOR EXPLICIT GO; not deployed**

This record prepares the 2026-09-04 local work for a controlled production
decision. It does not authorize or record a production deployment.

## Candidate identity

- Feature implementation commit: `7d31ef9`.
- Final API implementation commit: `912d1b1` (serializes tenant-transaction
  dossier/workspace reads after an exact-image rehearsal exposed the pg@9
  concurrent-query deprecation).
- API image: `overva-production-go-api:912d1b1`
  (`sha256:23dbce4ec014245d8695481461dc1e5ac2a86c349644e8f270bacd271f6cd2ed`).
- Web image: `overva-production-go-web:912d1b1`
  (`sha256:aea90cc7162a10472dceb22a938743c5193c28a8ccc07ce4ff90a95b358cd775`).
- Production currently remains on API
  `sha256:2abafdd820fa5d0916818c40bb703bc39550e9bf9363f86056ba6dd1837dacc0`
  and Web
  `sha256:2e066846e1636cf46b8903a84a5ccb158b8d5957e19aa4518505c3886932f2e2`.
- Production and LAN containers were not rebuilt, restarted, migrated or
  switched during this preparation.

The image digests above were rebuilt from implementation commit `912d1b1` and
passed the exact-image release and live integration checks. They are the only
candidate digests eligible for this promotion.

## Included capability scope

- Governed report-obligation schedules and organization-home warning signals.
- Compact organization home with permission-scoped information flow,
  attendance/work/resource signals, and lighting/camera operational summaries.
- Measured unfinished Work disposition, exact-quantity follow-up Work creation,
  and responsible/executing Employee participation.
- Lighting and camera multi-fault batch intake, open-fault visibility,
  idempotent correction by cancellation, and object-dossier activity projection.
- Release-check, smoke-fixture and runtime append-only privilege hardening.

## Schema transition

Production is read-only verified at `0105` with 105 migration records. This
candidate adds exactly five ordered migrations:

1. `0106_report_schedule_governance.sql`
2. `0107_report_schedule_recurrence_anchor.sql`
3. `0108_work_scope_disposition_follow_up.sql`
4. `0109_work_order_operational_team.sql`
5. `0110_work_assignment_source_follow_up.sql`

Migration `0110` is an additive compatibility correction found by the live
follow-up rehearsal: follow-up participant evidence uses the explicit
`scope_follow_up` assignment source. No applied migration was rewritten.

A disposable database migrated sequentially from `0001` through `0110`.
Re-running the production migration path was a no-op except for refreshing
runtime grants. The candidate release check passed with 110 migration rows,
25 active modules, linked Employee identities, frontend assets and zero orphan
automation events.

## Verification evidence

- API syntax check: passed.
- Repository Node suite: **487/487 passed**. Integration entry files that are
  opt-in are not represented here as live database proof.
- Work production-go live rehearsal: cross-tenant Employee rejection,
  responsible/executor persistence, measured residual scope, invalid terminal
  close rejection, one follow-up, exact replay and participant inheritance all
  passed.
- Lighting live rehearsal: tenant isolation, capacity validation, batch capture,
  cancellation, exact replay and append-only evidence passed.
- Camera live rehearsal: tenant isolation, capacity/occurrence validation,
  cancellation, exact replay and append-only evidence passed.
- The exact-image lighting and camera rehearsals were repeated with Node
  deprecation tracing after commit `912d1b1`; no concurrent-client warning
  remained.
- Work material live rehearsal: request/replay, approval, insufficient-stock
  fail-safe, one issue, consumption and evidence passed.
- Authenticated local report/home smoke: 20 active schedules, one dashboard
  alert, 12 redacted information-flow groups, live lighting/camera projection,
  CRUD/replay and four schedule events passed.
- `git diff --check`: passed; line-ending warnings are informational.
- Dependency audit previously returned zero known production dependency
  vulnerabilities. The final committed rebuild must repeat it with network
  availability.

## Production baseline and open gates

Read-only production checks on 2026-09-04 found:

- all production containers healthy;
- schema `0105` / 105 migration rows;
- zero active Employee-type login identities missing a canonical Employee;
- zero tenantless automation events;
- previously verified production backup `overva-20260903T131519Z` for database
  `overva`, including SHA-256, PostgreSQL archive listing and uploads archive.

The scheduled 2026-09-04 backup attempt ran while PostgreSQL was starting and
failed. A fresh production database-plus-uploads backup was therefore created
manually after `pg_isready` passed: `overva-20260904T103838Z`. Its SHA-256 files,
PostgreSQL custom archive listing and uploads tar archive passed both the
scheduler-container verification and a separate read-only verifier container.
Do not use the similarly named local `backups/` artifact for production—the
production authority is `backups-production/`.

The local demo release check intentionally remains blocked by one pre-existing
bootstrap admin marked as an Employee without an Employee link. Production has
no such row. Reconcile that local identity through a governed review before
using the local dataset as release acceptance evidence; do not silently relabel
or create an Employee.

## Required Go sequence

1. Confirm the recorded implementation commit and image digests. The unrelated
   `OVERVA.code-workspace` remains outside this release.
2. Confirm the recorded syntax, full tests, dependency audit, clean
   `0001`–`0110` migration, release check and exact-image live rehearsals.
3. Obtain explicit user authorization for production deployment and agree a
   short write/cutover window.
4. Reconfirm PostgreSQL health and the fresh verified backup
   `overva-20260904T103838Z` immediately before migration.
5. Run the dedicated migration service once. Stop immediately on migration,
   checksum, privilege or canonical-data failure.
6. Switch API/Web only to the recorded candidate digests. Do not rebuild from a
   mutable working directory on the production path.
7. Run health, release, session/authorization, dashboard/report schedule,
   lighting, camera, Work Board/follow-up, object dossier and external endpoint
   smokes. Verify migration count 110 and runtime evidence-table revocations.
8. Create and verify a post-deployment backup and update `CURRENT_STATE.md` with
   the actual deployment evidence.

Application rollback restores the previous API/Web image digests. After valid
business evidence is written, additive migrations and append-only evidence are
not rolled back or deleted; defects require a forward-compatible correction.

## Current decision

The source, exact images, clean migration, live behavior and fresh production
backup are verified. The candidate is **READY FOR EXPLICIT GO**, but production
migration and traffic switch have not been authorized or performed in this
record.
