# Production lighting provenance reconciliation preview — 2026-09-03

Status: **COMPLETED — PRODUCTION RECONCILIATION AND CUTOVER PASSED**

This record prepared the data-quality remediation for stopped rollout
`20260903T123901Z`. The user later gave the separate explicit production
business-data GO. The reconciliation and frozen application cutover completed
successfully; final evidence is recorded in
`PRODUCTION_LIGHTING_CAMERA_FIBER_ROLLOUT_20260903T131503Z.md`.

## Frozen identity

- Implementation commit:
  `aee0306e5d9c714ccf9fb1d0d7d1dcff1c9c4dfe`
- Candidate artifact ID: `20260903T130614Z`
- Candidate API/reconciliation image:
  `sha256:2abafdd820fa5d0916818c40bb703bc39550e9bf9363f86056ba6dd1837dacc0`
- Candidate Web image:
  `sha256:2e066846e1636cf46b8903a84a5ccb158b8d5957e19aa4518505c3886932f2e2`
- Immutable tags:
  `overva-production-api:candidate-aee0306-20260903T130614Z` and
  `overva-production-web:candidate-aee0306-20260903T130614Z`
- Current rollback API:
  `sha256:53c14f3fab97c25fbd38e328f86ac50f4989d1404e1df8bfda47b2150d6ed634`
- Current rollback Web:
  `sha256:2fad3edb192c7933762e31d9148d32736ea7daa5975c861fc971eeddc185765b`

## Exact source and production preview

The read-only legacy export and production target both passed the closed-world
guards. The SHA-256 source fingerprint is:

`3aa26b79d73511673a18b5a6499d307cebc89b9f8a5e89677f2cc50cf2aa8061`

The exact preview is:

| Measure | Expected change |
| --- | ---: |
| matched `sl_points` objects | 117 |
| `ГТ` road-lighting objects | 36 |
| `ГД` traffic-signal compatibility copies | 12 |
| unresolved `ГЧ/НЭ/ЯЗ/НГ` objects | 69 |
| road-lighting poles | 1,747 |
| road-lighting heads | 2,582 |
| replacement poles | 43 |
| object events on first apply | 117 |
| tenant audit receipts on first apply | 1 |

The live preview ran in a PostgreSQL `REPEATABLE READ READ ONLY` transaction,
without `--apply`, and reported 117 corrupt literal `??-` snapshots, zero
already-current targets and 117 proposed changes. No production business data
was written.

## Rehearsal evidence

Fresh backup `overva-20260903T123955Z` was independently hash-checked before
restore. Its database dump SHA-256 was
`B5A9C0C26D601FCA1BE25777CA6043B754891E157F5025501EBE8F970C5D1483`.
It restored at schema `0098` into isolated database
`overva_rehearsal_reconcile_0105`, then migrated through `0105`.

On the clone:

- dry-run proposed exactly the table above;
- first apply updated 117 versions, appended 117 object events and one
  attributable tenant audit;
- second apply and post-apply dry-run both returned zero changes with replay
  true;
- the pristine and corrected source-snapshot hash remained
  `3979187021c9e555d31e9295001069b5`;
- the 117 target version sum advanced from 117 to 234;
- organizations 4, users 25, employees 25, assets 917, operational objects
  561, incidents 242, Work Orders 106 and documents 31 were unchanged;
- the hash of every non-target Operational Object remained
  `40ca35f891d8824ed07505ac424fb816`;
- only the intended evidence counts changed: object events 220 to 337 and
  audit rows 208 to 209;
- the exact frozen candidate API returned 36 road objects, 69 unresolved
  objects, 12 canonical traffic signals and the exact pole/head totals;
- camera remained 110 objects and 302 source device references, with all seven
  reviewed source groups and six incident types;
- exact candidate API and Web health passed; Web served lighting, camera and
  network workspace assets.

API syntax/check and the final complete `462/462` suite passed, including the
focused reconciliation baseline, write-gate and order-independent JSONB replay
tests.

## Write safety contract

The command refuses to apply unless all of these agree:

1. target database and environment variables;
2. schema exactly `0105`;
3. tenant slug `choibalsan-hugjil`;
4. source system `choibalsan-legacy-erp` and table `sl_points`;
5. exactly 117 unique source IDs and names;
6. all six reviewed prefix totals and lighting quantity totals;
7. all 117 immutable snapshots still beginning with literal `??-` bytes;
8. an active attributed actor with `operational-objects.update`;
9. `--confirm-write`, the exact fingerprint, and
   `--confirm-production-write`.

The apply transaction takes organization and advisory locks, uses optimistic
object versions, increments each changed object version, and writes object
events plus one tenant audit receipt. It never updates
`source_import_records`. Receipt/state disagreement fails closed.

## Controlled sequence after a new explicit GO

1. Recheck Git/image identities, schema `0105`, service health, core counts,
   long transactions, waiting locks and the read-only preview.
2. Drain API writers and take a fresh database/uploads backup. Verify archive
   lists, stored checksums and an independently copied off-device checksum.
3. Run only the pinned reconciliation image with all three apply confirmations
   and the exact fingerprint above.
4. Require 117 changes, 117 events, one attributed audit, unchanged immutable
   source hash, unchanged core counts and unchanged non-target object hash.
5. Run the command a second time and require replay true with zero changes.
6. Recreate API and Web only from the two frozen candidate images.
7. Run health, authentication, lighting, camera, Work Board, fiber-network,
   report/CSV and external endpoint smokes; then observe enhanced monitoring.

Any fingerprint/count/name drift, unauthorized actor, non-target change,
source-snapshot mutation, missing evidence, unhealthy service or failed smoke is
an immediate stop. Application rollback restores the prior Web image first and
prior API image second while retaining schema `0105` and append-only correction
evidence. Destructive evidence deletion is not a rollback path.
