# Lighting, camera and fiber production rollout — 2026-09-03

Status: **SUCCESS — PRODUCTION HEALTHY**

The user gave the separate explicit `PRODUCTION RECONCILIATION GO` after the
read-only preview and production-clone rehearsal. The governed legacy-lighting
correction was applied exactly once, its append-only evidence reconciled, and
the frozen lighting/camera/fiber API and Web images were cut over successfully.

## Release identity and timeline

- Release ID: `20260903T131503Z`
- Implementation commit:
  `aee0306e5d9c714ccf9fb1d0d7d1dcff1c9c4dfe`
- Pre-rollout documentation commit:
  `3a1d6508258f513cb1ae36bc2bfe8c87a03b0788`
- API write cutoff: `2026-09-03T13:15:03.0351280Z`
- Fresh backup: `2026-09-03T13:15:19Z`
- Reconciliation audit: `2026-09-03T13:15:45.390705Z`
- Candidate API start: `2026-09-03T13:16:58.956504202Z`
- Candidate Web start: `2026-09-03T13:17:27.189572209Z`
- Live API image:
  `sha256:2abafdd820fa5d0916818c40bb703bc39550e9bf9363f86056ba6dd1837dacc0`
- Live Web image:
  `sha256:2e066846e1636cf46b8903a84a5ccb158b8d5957e19aa4518505c3886932f2e2`
- Immutable tags:
  `overva-production-api:candidate-aee0306-20260903T130614Z` and
  `overva-production-web:candidate-aee0306-20260903T130614Z`

Production was already at schema `0105`; this release ran no migration and
created no schema row.

## Backup and rollback evidence

Before the business-data write, the API writer was stopped. Production then
reported zero remaining connections, long transactions and waiting locks.
Fresh backup `overva-20260903T131519Z` passed stored SHA-256 checks,
`pg_restore --list` and uploads archive listing. Its files were independently
copied to `D:\OVERVA\backups-production\overva-20260903T131519Z` and hash-matched:

- database dump:
  `642C28BD364CA2007D8F31FF29D1323A898F550EBE32B70E8EB6591B85BF9BD9`;
- uploads archive:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`;
- metadata:
  `63F8F792ECB6B7D5C834397AE147A4F1A2A49F119E4AEDC189D0E5BA658800C5`;
- checksum manifest:
  `569492F8DE051C2DDB042400341EE2F37F0EB9FB3EB26BF93BA5BA5F07CC7D43`.

The prior running images were retagged as
`overva-production-api:rollback-20260903T131503Z` and
`overva-production-web:rollback-20260903T131503Z`. Their previously exported
archives were rechecked:

- rollback API image:
  `sha256:53c14f3fab97c25fbd38e328f86ac50f4989d1404e1df8bfda47b2150d6ed634`;
- rollback Web image:
  `sha256:2fad3edb192c7933762e31d9148d32736ea7daa5975c861fc971eeddc185765b`;
- API archive SHA-256:
  `2398A86C6C4BFCCA469FBEE897C6C00D3FCF4D3161969FA125FF1B5B494E2FEC`;
- Web archive SHA-256:
  `ECCB6D2656AE16F908D6338F11BFC8B14D054C870B73120C02405500F0A02E55`.

## Reconciliation result

The pinned API image read the legacy SQLite database read-only. Production
apply required the exact fingerprint
`3aa26b79d73511673a18b5a6499d307cebc89b9f8a5e89677f2cc50cf2aa8061`,
explicit write and production-write confirmations, schema/database/source/
tenant identity and an attributable active actor with
`operational-objects.update`.

The single transaction produced exactly:

| Result | Count |
| --- | ---: |
| matched and versioned objects | 117 |
| `ГТ` road-lighting objects | 36 |
| `ГД` traffic-signal compatibility copies | 12 |
| unresolved `ГЧ/НЭ/ЯЗ/НГ` objects | 69 |
| road-lighting poles | 1,747 |
| road-lighting heads | 2,582 |
| replacement poles | 43 |
| appended object events | 117 |
| attributable tenant audits | 1 |

The target version sum moved from 117 to 234. A second production apply
returned `replay=true`, 117 already-current targets and zero changes/events/
audits.

The immutable `source_import_records` hash remained
`3979187021c9e555d31e9295001069b5`; the non-target Operational Object hash
remained `40ca35f891d8824ed07505ac424fb816`. Core business counts stayed at 4
organizations, 25 users, 25 employees, 917 Assets, 561 Operational Objects,
242 incidents, 106 Work Orders, 772 Work Order events, 31 documents and 32
document versions. Only intended append-only totals changed: Operational Object
events 220 to 337 and audits 208 to 209.

No technical specification, lamp group, supply point, camera point/device,
canonical network route/node or legacy network-recovery candidate was created.
Their production counts remain zero. Configuration remains 99 permissions, 82
roles, 1,293 role-permission grants, 59 user-role assignments, 47 data-catalog
assets and 14 incident types.

## Application and authenticated verification

The exact API image was recreated first and became healthy. Before Web cutover,
the authenticated combined smoke confirmed:

- lighting: 36 road, 69 unresolved and 12 canonical signal records;
- exact road totals: 1,747 poles, 2,582 heads and 43 replacements;
- all 117 reconciliation fingerprints, 117 events and one audit present;
- camera: 110 objects, 302 legacy device references and six incident types;
- camera groups: 3, 5, 7, 8, 9, 98 and 99;
- panel/board hidden, camera master-only dossier boundaries retained.

The exact Web image was then recreated and became healthy. Post-cutover checks
passed:

- release check: 105 migrations, 25 active modules, canonical employees,
  frontend shell and zero orphan automation events;
- session/report/CSV authorization, including ordinary-user HTTP 403;
- Work intake: 236 authorized rows and zero rows for an ordinary user;
- Camera Work Board: 30 open incidents and six active works in their reviewed
  groups;
- fiber network: zero canonical routes/nodes or recovery candidates, 110 camera
  GPS review targets, and the expected manage/GPS permissions;
- external Home, App, API, Status, Auth, IoT and Map HTTP 200; Admin HTTP 302;
  `www` HTTP 301;
- all seven long-running production services healthy, with zero long
  transactions and waiting locks after rollout.

The monitor recorded expected unhealthy checks only while the API writer was
deliberately drained, then returned to healthy after candidate startup. The
repository API syntax/check and full test suite passed `462/462` before
cutover.

## Rollback boundary

An application regression may be handled by restoring the rollback Web image
first and rollback API image second. Schema remains `0105`. The successfully
attributed provenance correction, object events and audit receipt stay in
place; deleting or rewriting that evidence is forbidden. A database restore is
reserved for separately approved catastrophic recovery because it would also
discard valid post-cutoff work.

The release is complete. Later schedule, monthly meter-reading and electricity-
invoice work remains a separate discovery/design scope and was not bundled into
this rollout.
