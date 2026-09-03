# Lighting, camera and fiber production release candidate — 2026-09-03

Status: **SUPERSEDED — rollout stopped and application rolled back**

Implementation commit `b29365d498c3c767259784f1cc70c95666b17e40`
contains the reviewed lighting and camera object masters, governed quick fault
capture, camera location/operation navigation, unified Work Board grouping and
the separate fiber-network GIS workspace. Production is still running commit
`d2f947c` at schema `0098`; no production migration, application recreation or
business-data write was performed while preparing this record.

An explicit **GO** and a fresh maintenance-window backup are still required.

## Frozen candidate and rollback identity

- Candidate artifact ID: `20260903T121824Z`
- Candidate API image:
  `sha256:907664d3a1b37d1d655b0886d566ae141789485daaaf7bc240f6ae2d22353b15`
- Candidate migration image:
  `sha256:8885c3116037109a2367290477fde598fd709638468f238f18d1f15f70e4c52d`
- Candidate Web image:
  `sha256:8c139ad3a88a934caa910840ffaf49f6ef919f3822d135acc135035667092330`
- Current/rollback API image:
  `sha256:53c14f3fab97c25fbd38e328f86ac50f4989d1404e1df8bfda47b2150d6ed634`
- Current/rollback Web image:
  `sha256:2fad3edb192c7933762e31d9148d32736ea7daa5975c861fc971eeddc185765b`

Local immutable candidate tags are:

- `overva-production-api:candidate-b29365d-20260903T121824Z`
- `overva-production-migrate:candidate-b29365d-20260903T121824Z`
- `overva-production-web:candidate-b29365d-20260903T121824Z`

The current production containers still reference the two rollback image IDs.
After the candidate images were pinned, local mutable production `latest` tags
were restored to the current API, migration and Web images to prevent an
accidental unapproved recreation. The running containers must still be checked
by image ID, never by `latest`.

## Candidate scope and deliberate exclusions

Migrations `0099`–`0105` are additive except for one reviewed tenant
configuration update: Choibalsan's retained `panel-board` lighting service-area
row becomes inactive. The migration does not delete that row or any history.

The migrations add:

- tenant-owned lighting and camera incident-type reference data;
- explicit reporter/supervisor roles and report/correct/cancel permissions;
- exact-payload, append-only incident command receipts;
- versioned Operational Object edit/retirement authority;
- immutable lighting and camera technical specifications with normalized lamp,
  supply-point, camera-point and camera-device children;
- separate fiber route/node masters, immutable geometry revisions and events;
- append-only legacy fiber recovery batches, candidates and review evidence.

They intentionally do **not** import or promote legacy business data. In
particular, production receives no technical specification, lamp group, supply
point, camera GPS, camera device, canonical fiber route/node, or staged legacy
route row from this rollout. The demo's 23 recovered routes and 184 preview
vertices stay in the demo database. The later schedule → monthly meter reading
→ electricity invoice work is outside this release.

The production-snapshot rehearsal showed these controlled configuration deltas:

| Authority/configuration | `0098` | rehearsed `0105` |
| --- | ---: | ---: |
| permission catalog | 91 | 99 |
| organization roles | 76 | 82 |
| role-permission grants | 1,210 | 1,293 |
| user-role assignments | 47 | 59 |
| data-catalog assets | 38 | 47 |
| seeded incident types | 0 | 14 |

The twelve new user-role links are compatibility assignments from existing job
labels into explicit lighting/camera domain roles. Runtime authorization checks
permissions, not job-label strings. Owner/administrator grants remain explicit
organization-role permissions.

## Completed release evidence

- Full repository suite: `457/457` passed.
- Syntax checks and `git diff --check` passed.
- Production-equivalent API, migration and Web images built successfully.
- A clean disposable database migrated from `0001` through `0105`; RLS,
  append-only triggers and restricted runtime privileges were checked.
- A read-only production snapshot restored into an isolated database and
  migrated from `0098` through `0105` successfully. A second run was
  idempotent and refreshed runtime grants without another migration.
- The exact production candidate images passed the release check at schema
  `0105`: 105 migrations, 25 active modules, canonical employee links, Web
  shell assets and zero orphan test events.
- Existing business row counts were identical between the production snapshot
  and the migrated clone: 4 organizations, 25 users, 25 employees, 917 assets,
  561 operational objects, 242 operational incidents, 106 Work Orders, 772 Work
  Order events, 31 documents and 32 document versions.
- The current production API image started against the migrated `0105` clone
  and returned HTTP 200 from `/health`, proving application rollback schema
  compatibility.
- Governed lighting and camera integration rehearsals passed tenant isolation,
  quantity/capacity validation, idempotent replay, changed-payload conflict and
  matching incident/event/receipt/audit evidence.
- Authenticated demo smokes passed for lighting objects, camera objects, camera
  Work Board groups and the fiber network workspace. The demo remains schema
  `0105`; production remains schema `0098`.
- Current production's read-only release check passed at 98 migrations and all
  seven long-running production services were healthy. Latest scheduled backup
  `overva-20260902T162822Z` passed checksum and archive verification, but it is
  not a substitute for a fresh pre-cutover backup.

The historical `schema_migrations` row `0026|legacy:0026-duplicate` has a null
checksum in both the production source and clone. Every normal row from `0098`
through `0105` has its filename and 64-character checksum. This is recorded
legacy metadata, not a partial candidate migration.

## Mandatory GO gate

Do not deploy unless all of the following are true in one announced maintenance
window:

1. The user gives an explicit production **GO** for this exact commit and image
   set after reviewing the demo.
2. Git HEAD is exactly `b29365d498c3c767259784f1cc70c95666b17e40`
   plus this rollout-document commit only; no implementation drift is present.
3. Running production still reports schema `0098`, API image
   `53c14f3…d634`, Web image `2fad3edb…765b`, no long transaction and no waiting
   relevant lock. Any baseline drift requires a new clone rehearsal.
4. The current API/Web images are retagged, exported, SHA-256 hashed and copied
   to access-controlled off-device storage.
5. A fresh database-plus-uploads backup is created after the write cutoff,
   verified by checksum, `pg_restore --list` and uploads archive listing, then
   independently copied and hash-checked off-device.
6. API writers are drained before migration. Database, backup scheduler, Caddy
   and public site stay running.
7. The migration service exits zero at exactly schema `0105`; all new tables,
   RLS policies, triggers, runtime grants and the controlled configuration
   deltas reconcile before API/Web cutover.

## Controlled rollout sequence after GO

Use the production compose overlays and `.env.production`. Capture every
timestamp and command output in the final release record.

1. Verify Git, running image IDs, schema `0098`, service health, transactions
   and locks.
2. Preserve/export the running API and Web image IDs; verify the off-device
   copies.
3. Announce write drain, stop only the API, take and verify the fresh backup.
4. Recheck that business counts match the captured cutoff values.
5. Run the pinned candidate migration image and require `0099`–`0105` exactly
   once. Do not run any demo reconcile, legacy import, staging or promotion
   script.
6. Reconcile schema, constraints, RLS, append-only triggers, runtime privileges,
   configuration counts and zero newly imported master/network rows.
7. Recreate API and Web only from the pinned candidate images. Do not recreate
   DB, Caddy, public site, monitor or backup scheduler.
8. Run release, authenticated lighting, camera, Work Board and fiber read
   smokes. Verify external Home/App/API and all service health.
9. Keep enhanced monitoring during the observation window. Any tenant leak,
   unauthorized action, unexpected import row, append-only mutation or
   reconciliation mismatch is an immediate stop.

## Rollback

The normal rollback is application-only: restore Web image
`2fad3edb…765b` first and API image `53c14f3…d634` second, without dropping the
`0099`–`0105` schema. The old API health check against `0105` passed in the
production-snapshot rehearsal.

Application rollback does not reverse the deliberate `panel-board` inactivation
or remove new permissions/reference rows. If the prior panel/board presentation
must return, reactivate the retained row through an authorized, audited
configuration change after impact review; do not hide that change inside raw
schema rollback.

Once any canonical incident, specification, media, camera point/device, route,
node or review evidence is written on `0105`, destructive schema rollback is
forbidden. Use an additive forward fix. A database restore is reserved for a
separately approved catastrophic recovery with traffic stopped, a fresh
pre-restore backup, new volumes, full reconciliation and an explicit traffic
switch; it must not silently discard valid post-cutover work.

## Current decision

The candidate is technically ready for a controlled release, but the correct
decision now is **HOLD**. Keep the demo available for final visual/UAT review.
Move to production only after the explicit GO gate above; do not bundle any
schedule, meter-reading, billing, CAD/PTZ import or legacy-data promotion into
this rollout.

## Rollout outcome

Production GO was later given for this exact candidate. Backup and migration
passed, but the authenticated lighting smoke exposed destroyed `??-*` legacy
code prefixes in production and returned road `0` / unclassified `117`.
Candidate API/Web were rolled back; schema `0105` remains. See
`PRODUCTION_LIGHTING_CAMERA_FIBER_ROLLOUT_20260903T123901Z.md` for the complete
evidence and the new reconciliation gate. This candidate must not be retried
unchanged.
