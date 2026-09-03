# Lighting, camera and fiber production rollout — 2026-09-03

Status: **STOPPED — candidate application rolled back**

The explicit production GO targeted implementation commit
`b29365d498c3c767259784f1cc70c95666b17e40` and the release gate recorded by
commit `32149f790cc376fd5d31a6191367b36598129e9e`. Migrations `0099`–`0105`
completed and remain live because they are additive and rollback-compatible.
The candidate API/Web cutover was stopped after an authenticated production
smoke exposed missing legacy classification evidence. Web and API were restored
to their prior images. No guessed classification or legacy import was written.

## Release identity and timeline

- Release ID: `20260903T123901Z`
- Write cutoff: `2026-09-03T12:39:55.2797704Z`
- Migration start: `2026-09-03T12:40:27.8951978Z`
- Candidate cutover completed: `2026-09-03T12:41:51.1558725Z`
- Application rollback completed: `2026-09-03T12:44:21.9122186Z`
- Candidate API:
  `sha256:907664d3a1b37d1d655b0886d566ae141789485daaaf7bc240f6ae2d22353b15`
- Candidate migration:
  `sha256:8885c3116037109a2367290477fde598fd709638468f238f18d1f15f70e4c52d`
- Candidate Web:
  `sha256:8c139ad3a88a934caa910840ffaf49f6ef919f3822d135acc135035667092330`
- Restored API:
  `sha256:53c14f3fab97c25fbd38e328f86ac50f4989d1404e1df8bfda47b2150d6ed634`
- Restored Web:
  `sha256:2fad3edb192c7933762e31d9148d32736ea7daa5975c861fc971eeddc185765b`

## Backup and rollback evidence

The running API/Web images were pinned and exported before the write cutoff:

- rollback directory:
  `D:\OVERVA\release-artifacts\20260903T123901Z`;
- API archive SHA-256:
  `2398A86C6C4BFCCA469FBEE897C6C00D3FCF4D3161969FA125FF1B5B494E2FEC`;
- Web archive SHA-256:
  `ECCB6D2656AE16F908D6338F11BFC8B14D054C870B73120C02405500F0A02E55`.

Fresh backup `overva-20260903T123955Z` passed its stored checksums,
`pg_restore --list` and uploads archive listing. Its independently hash-checked
off-device copy is at
`D:\OVERVA\backups-production\overva-20260903T123955Z`:

- database dump:
  `B5A9C0C26D601FCA1BE25777CA6043B754891E157F5025501EBE8F970C5D1483`;
- uploads archive:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`;
- metadata:
  `6626427EAA223FE34FF69CC04E792698664BAC7373C9986AF7938635D05AEE5D`;
- checksum manifest:
  `0C62ED49C7F5B4DF2B9C714440E884D87B273BB21EEC7366ECD7299FA66B42A8`.

## Migration result

The pinned migration image applied `0099`–`0105` exactly once and refreshed the
`overva_app` runtime grants. Reconciliation passed before application cutover:

- schema `0105`, 105 migration rows and no incomplete filename/checksum from
  `0098` onward;
- unchanged core counts: 4 organizations, 25 users, 25 employees, 917 assets,
  561 operational objects, 242 operational incidents, 106 Work Orders, 772 Work
  Order events, 31 documents and 32 document versions;
- controlled configuration counts: 99 permissions, 82 organization roles,
  1,293 role-permission grants, 59 user-role assignments, 47 data-catalog
  assets and 14 tenant incident types;
- zero technical specifications, lamp groups, supply points, camera
  point/device profiles, canonical network routes/nodes and import review rows;
- missing RLS `0`, invalid constraints `0`, expected append-only triggers `13`;
- receipt runtime privilege `SELECT/INSERT=true`,
  `UPDATE/DELETE/TRUNCATE=false`;
- route runtime privilege `SELECT/INSERT/UPDATE=true`,
  `DELETE/TRUNCATE=false`;
- Choibalsan `panel-board` service-area row retained but inactive as reviewed;
- long transactions `0` and waiting locks `0`.

## Stop condition and root cause

The exact candidate images first passed the general release check and session,
report and CSV authorization smoke. The new authenticated workspace smoke then
returned:

- lighting: 451 visible objects, road `0`, unclassified `117`, 12 canonical
  traffic signals, eight incident types and no panel/board card;
- camera: 110 objects, 302 source camera references, six incident types and all
  seven reviewed source groups;
- network: zero canonical routes/nodes and zero recovery candidates; 110 camera
  objects were correctly exposed as GPS review targets;
- owner capabilities included network manage and camera-GPS update.

The lighting result is a release-blocking data-quality defect, not a permission
or migration failure. Read-only inspection proved all 117 production
`source_import_records` contain a `code` key, but its first three UTF-8 bytes are
`3f3f2d`, literal `??-`. The original `ГТ`, `ГД`, `ГЧ`, `НЭ`, `ЯЗ` and `НГ`
prefixes were destroyed during the earlier import. Therefore the candidate's
evidence-strict classifier cannot distinguish the reviewed 36 road-lighting
rows, 12 duplicate traffic-signal provenance rows and 69 unresolved rows.

The prior API classified every `sl_points` row as road lighting regardless of
source code. The candidate deliberately removed that unsafe assumption. The
demo looked correct only because a demo-hard-gated reconciler compared the
read-only legacy source, validated the `117 / 36 / 1,747 / 2,582 / 43`
baseline and wrote recovered codes into demo provenance. That write was never
authorized or run in production.

## Application rollback and current production state

Web was restored first, then API. The restored API had already been proven
schema-compatible with `0105` in the production-snapshot rehearsal. After
rollback:

- API and Web are healthy on their prior image IDs;
- the authenticated session/report/CSV smoke passes, including ordinary-user
  HTTP 403;
- the restored lighting endpoint returns its prior compatibility projection of
  117 road rows;
- schema remains `0105`; migrations and controlled configuration are retained;
- all seven long-running services are healthy;
- public Home, App, API, Status, Auth, IoT and Map return HTTP 200; Admin returns
  its expected HTTP 302;
- the monitor recorded one expected unhealthy interval while API writers were
  intentionally drained, then returned to healthy.

The old application still sees the reviewed inactive `panel-board` setting, so
its lighting service-area list now contains road, ger-area, tower and traffic
signal. No schema was dropped and no valid post-migration evidence was deleted.

## Required gate before another candidate rollout

Do not retry the candidate and do not run the demo reconciler on production.
A separately reviewed production reconciliation must first:

1. read a fingerprinted legacy export without modifying the legacy system;
2. validate exact source identity and the reviewed
   `117 / 36 / 1,747 / 2,582 / 43` totals;
3. preview the exact 36 road, 12 duplicate-signal and 69 unresolved mappings;
4. require an explicit production-write flag and current schema/database
   identity;
5. be idempotent and append object/incident provenance events plus tenant audit;
6. change no names, quantities or source snapshots beyond the reviewed recovered
   code/classification metadata;
7. pass on a fresh production clone, then receive a new explicit business-data
   write approval before execution;
8. rebuild, rehearse and freeze new candidate images before another rollout GO.

Until then, production stays on the restored application images at schema
`0105`. This rollout is not marked successful.

## Later resolution

The required fingerprinted reconciliation was subsequently implemented,
rehearsed on this rollout's fresh backup, explicitly approved as a separate
production business-data write, applied with append-only evidence and followed
by a successful frozen application cutover. This stopped attempt remains an
accurate historical record; see
`PRODUCTION_LIGHTING_CAMERA_FIBER_ROLLOUT_20260903T131503Z.md` for the successful
release.
