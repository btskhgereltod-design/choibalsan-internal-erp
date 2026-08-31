# Controlled production Phase A release — 20260831T121534Z

Status: **SUCCESS**

The reviewed assignment-history Phase A release was deployed without adding a
feature, refactor, migration, or Phase B enforcement beyond the reviewed
artifact. No stop condition fired.

## Cutoffs and preserved rollback identity

- Migration cutoff: `2026-08-31T12:00:25.4889819Z`
- Candidate application cutoff: `2026-08-31T12:04:15.580Z`
- Previous API image:
  `sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2`
- Previous Web image:
  `sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1`
- Candidate API image:
  `sha256:036bfe0f7d9f223c0136328b53c74deec4755928ca78f40bc0e8a2e96bdebbc5`
- Candidate Web image:
  `sha256:b3936e47bec669d05b7797b9c38bbab9ca9d7caac922b90b758002c6955067be`

The rollback API/Web tags and archive SHA-256 values remained identical to the
pre-build release record after the candidate build and deployment.

## Migration result

The reviewed migration container used bounded defaults of 15,000 ms
`lock_timeout` and 300,000 ms `statement_timeout`. It exited 0 after sequential
transactional commits:

| Version | Migration | SHA-256 | Applied UTC |
|---|---|---|---|
| `0078` | `0078_work_order_assignment_history.sql` | `50828ccd6efbeea6c36e240a73e52a80e55af7af40748dd7033a0c8b8bdc0126` | `2026-08-31 12:02:33.748232` |
| `0079` | `0079_work_order_assignment_write_guard.sql` | `6980b5008d1b7dc8a0fed8279133a2e06eaeb8a4444e5c79cd9bbb706c911ba2` | `2026-08-31 12:02:33.785708` |
| `0080` | `0080_automation_delivery_idempotency.sql` | `204ad706add8246f7478a0bb7b5e1dc24d414a80c6cd5df0cbc8f4ac0a6bf2d9` | `2026-08-31 12:02:33.797225` |

The schema was exactly `0080` after migration. The Phase B
`work_order_events_assignment_v1_required` trigger remained absent.

## Deploy result

The old API writer was stopped before the migration cutoff. The candidate API
was started first and became healthy, followed by the candidate Web, which also
became healthy. Caddy and the database were not restarted. A transient monitor
health state caused by the API drain recovered immediately after its own DB/API
probe passed; the final Docker health state was healthy.

## Post-deploy reconciliation

| Check | Result |
|---|---:|
| Schema | `0080` |
| Total Work Orders | 106 |
| Assigned snapshots | 85 |
| Total Work Order events | 656 |
| Legacy events before migration cutoff | 656 |
| Typed history backfill before cutoff | 0 |
| Unversioned assignment events after application cutoff | 0 |
| Typed assignment events total | 0 |
| Latest event/snapshot mismatches | 0 |
| Missing canonical initial events after application cutoff | 0 |
| Validated critical constraints | 7 |
| Event parent delete action | `RESTRICT` |
| Enabled Phase A assignment triggers | 2 |
| Phase B strict triggers | 0 |
| Runtime UPDATE/DELETE/TRUNCATE privileges | `false/false/false` |
| Automation delivery duplicate groups | 0 |
| Automation rule-run duplicate groups | 0 |
| Long/open transactions | 0 |
| Relevant locks | 0 |

Fresh pre-deploy backup `overva-20260831T114722Z` was restored to isolated DB
`overva_restore_release_20260831t120600z`. Its 0077 event projection matched
the live 0080 legacy-column projection: 656 rows, fingerprint
`399dae2db0d21e9c5e35db8143384426`. The isolated database and temporary upload
directory were removed; remaining database count was 0. Two earlier harness
attempts failed before completing the comparison because of shell quoting and
a missing isolated parent directory; both cleanup checks also returned 0.

## Smoke and health results

- Release contract smoke: schema 0080, real cross-tenant assignee lookup
  denied, exact assignment idempotency replay accepted, changed payload
  rejected with the explicit conflict contract.
- Authenticated session, report, and CSV endpoints returned HTTP 200.
- CSV retained 23 columns and all six headline flags reconciled with the report.
  The deterministic previous-month smoke user had zero detail rows for that
  tenant/range; the structure and zero-valued reconciliation still passed.
- A second read-only smoke selected the production tenant containing all 106
  Work Orders and reconciled August 2026 with 106 CSV rows and 23 columns:
  opening 87, created 19, completed 0, cancelled 0, closing 106, overdue 102.
  Its first inline PowerShell wrapper failed parsing before any HTTP request;
  the file-backed ignored-artifact execution then passed.
- Ordinary user management-report access returned HTTP 403.
- API, Web, DB, Caddy, public site, monitor, and backup scheduler finished
  running and healthy.
- Home, App, API, Status, Auth, IoT, and Map public endpoints returned HTTP 200.
- Admin root returned the expected HTTP 302 redirect.

## Backup result

- Pre-deploy verified backup: `overva-20260831T114722Z`
- Post-deploy verified backup: `overva-20260831T121439Z`
- Post-deploy database dump SHA-256:
  `70eeffe443714a360f88c1bd6e5891d0202674b76cccefc7709230b15c57b84d`
- Post-deploy uploads archive SHA-256:
  `a4a39de29f257d1ac96452ed72aa648cd9e4af9ceb3dc5d7f82f68371d51318a`
- Post-deploy metadata SHA-256:
  `c8771e82935c442ff2b8524297c6383d0c375eed8780e5501db5be7b83b90b55`

`sha256sum -c`, `pg_restore --list`, and uploads tar listing all passed.

## Remaining risks

- Phase A intentionally accepts unversioned old-writer assignment evidence;
  Phase B remains a separate reviewed release after old writers are retired.
- No production business assignment occurred between the application cutoff
  and reconciliation, so typed-event count is truthfully zero. Production soak
  monitoring must confirm the first real assignments are canonical version 1.
- The backup scheduler container healthcheck still does not independently prove
  freshness or checksum; explicit verification passed for both release backups.
- Schema rollback is forbidden. Any future defect after canonical writes must
  use the runbook's schema-compatible application rollback or an additive
  forward-fix.
