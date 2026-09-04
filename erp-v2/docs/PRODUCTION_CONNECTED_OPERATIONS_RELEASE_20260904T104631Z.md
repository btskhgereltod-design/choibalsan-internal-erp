# Connected operations production release — 2026-09-04

Status: **SUCCESS — PRODUCTION HEALTHY**

The user explicitly authorized Production Go after the frozen candidate, clean
migration rehearsal, exact-image integration checks and fresh backup were
presented. Migrations `0106`–`0110` and the exact API/Web images were promoted
in a controlled API-first cutover.

## Release identity and timeline

- Release ID: `20260904T104631Z`.
- Feature commit: `7d31ef9`.
- Final API safety commit: `912d1b1`.
- Pre-cutover documentation commit: `e63fe42`.
- API write cutoff: `2026-09-04T10:47:20.9390541Z`.
- Migrations applied: `2026-09-04T10:47:30Z`.
- Candidate API start: `2026-09-04T10:47:59.274728168Z`.
- Candidate Web start: `2026-09-04T10:49:49.566623770Z`.
- Verification complete: `2026-09-04T10:52:35Z`.
- Live API image:
  `sha256:23dbce4ec014245d8695481461dc1e5ac2a86c349644e8f270bacd271f6cd2ed`.
- Live Web image:
  `sha256:aea90cc7162a10472dceb22a938743c5193c28a8ccc07ce4ff90a95b358cd775`.
- Immutable candidate tags:
  `overva-production-api:candidate-912d1b1-20260904T104631Z`,
  `overva-production-migrate:candidate-912d1b1-20260904T104631Z`, and
  `overva-production-web:candidate-912d1b1-20260904T104631Z`.

## Backup and rollback evidence

PostgreSQL readiness passed before the release. Fresh pre-deployment backup
`overva-20260904T103838Z` contains the production `overva` database and uploads.
Its stored SHA-256 manifest, `pg_restore --list`, and uploads archive listing
passed in the scheduler container and a separate read-only verifier. The backup
was copied to `D:\OVERVA\backups-production\overva-20260904T103838Z` and hash
matched:

- database dump:
  `B7773699F804CA8E9938D1E5B5C96D588A9FE00A58AE50D0B61FBC8D12A1F524`;
- uploads archive:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`;
- metadata:
  `70596D754FD03CE85E94BBDC127E57EC57686385B20679BD10F6583C736AC8B8`;
- checksum manifest:
  `BE67F67231765891217B61A1311F60BF73DC8DFB41E967753A10F1880510578C`.

The prior live images remain tagged as
`overva-production-api:rollback-20260904T104631Z` and
`overva-production-web:rollback-20260904T104631Z`. Their exported archives are
under `D:\OVERVA\release-artifacts\20260904T104631Z`:

- rollback API image:
  `sha256:2abafdd820fa5d0916818c40bb703bc39550e9bf9363f86056ba6dd1837dacc0`;
- rollback Web image:
  `sha256:2e066846e1636cf46b8903a84a5ccb158b8d5957e19aa4518505c3886932f2e2`;
- API archive SHA-256:
  `650C9C306AC48DB547BAC4488B829D382E4A2EA3DD8175723EFE69697E8D58E0`;
- Web archive SHA-256:
  `6615918FC6A16493DDD6ACF47B3C97EF3FC88527BB71EC142C95BCEF6342AB98`.

Post-deployment backup `overva-20260904T105136Z` also passed stored and
independent verification and was copied to
`D:\OVERVA\backups-production\overva-20260904T105136Z`:

- database dump:
  `5125488CF6A959DFFF784BE8A0EA7123845721128808B7B660127DEE1B26D247`;
- uploads archive:
  `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`;
- metadata:
  `E7DA14B22B7C8B832278EB589ECEDBE6E4E87E742EA1520C1C98AA79200C531D`;
- checksum manifest:
  `1957994976E05068A52DA738F2F690B85C03109F087694D5A0107E546F8E9E0B`.

## Migration and data result

The API writer was stopped before migration. Production reported zero remaining
connections, active transactions and waiting locks. The pinned migration image
applied exactly five migrations and refreshed `overva_app` grants:

| Version | Migration SHA-256 | Applied UTC |
| --- | --- | --- |
| `0106` | `4b17822dd9ef00fa0b8488c3de947e1d5c0d05153874a56895c64aa772004f4a` | `10:47:30.012003` |
| `0107` | `e55b0fb187cd6f0d3d5f10c75208ece7cd4fb7c7fe0706151b84b44ef9c6023c` | `10:47:30.110458` |
| `0108` | `4dfe07f6e140ee7e93274810d0e198c89c38809668d15331c23cedfa6b466736` | `10:47:30.117020` |
| `0109` | `15dc6e50f611cab45f27ed60e8d38874528dd5c2967324048342b78479e07404` | `10:47:30.162641` |
| `0110` | `1900768e87a66f5e21ce528a7e49a5aee50d640e2ea6befc4211881181e9b2e1` | `10:47:30.220078` |

Reconciliation passed at 110 migration rows, 25 active modules, 102 permission
catalog rows, 86 organization roles, 1,329 role-permission grants and 66 User
role assignments. Invalid constraints, unlinked Employee identities, orphan
automation events and waiting locks are all zero.

No legacy report schedule was imported into production. New report schedules,
schedule events/receipts, scope dispositions, operational Work participants and
participant events all remain zero after migration. The migration did not
invent report obligations, Employees, historical assignments or unfinished-work
decisions. Runtime may select and insert the four new evidence journals but
cannot update, delete or truncate them.

## Application and acceptance result

The exact API image became healthy before Web cutover. Authenticated checks
passed for:

- session, report and CSV access with ordinary-user HTTP 403;
- 236 tenant Work intake rows and zero rows for the ordinary User;
- lighting service areas: 36 road, 191 ger-area, 143 tower, 12 traffic-signal
  objects, while 69 unresolved objects remain explicitly unclassified;
- camera workspace: 110 objects and 30 visible incident rows;
- organization home: live lighting/camera summaries, six permission-scoped
  alerts and 12 redacted information-flow rows;
- the empty production report-schedule list through the new authorized API.

The exact Web image then became healthy and release check passed with 110
migrations, 25 modules, linked canonical Employees, all current frontend assets
and zero orphan automation events. The prior API image was also started without
traffic and passed session/report/CSV and ordinary-user authorization checks
against schema `0110`, proving application rollback compatibility.

External verification returned HTTP 200 for Home, App, API health, Status and
the Auth/IoT/Map health routes; Admin returned its intended 302 and `www` its
intended 301. Protected IoT/Map API probes without a token failed closed with
401. All seven long-running production services are healthy. The monitor shows
one expected unhealthy interval while the API writer was intentionally stopped,
then continuous healthy status after candidate startup.

## Rollback boundary

An application regression may restore the rollback Web image first and the
rollback API image second. Schema `0110` remains because the migrations are
additive and the old API passed compatibility smoke. Once users create schedule,
scope-disposition or participant evidence, those rows and the additive schema
must not be deleted or rewritten. Catastrophic database restoration requires a
separate outage decision because it would discard valid post-cutoff business
events.

The release is complete and production is healthy.

## Post-release Web hotfix

User acceptance found that a zero-fault service area could retain the previous
**Faulty only** client filter and show an empty table even though its healthy
objects were valid new-fault targets. Commit `8cade7e` makes **All** the
effective view whenever the scoped fault count is zero, disables the impossible
zero-result filter and applies the same behavior to lighting and camera intake.

The full repository suite passed `487/487`. Immutable Web image
`overva-production-web:hotfix-8cade7e-20260904T110425Z`
(`sha256:83bf0037c1d69c3cb08f5116746d760255018978b2fa1135e2b49b6618d8a8aa`)
was promoted at `2026-09-04T11:05:21.991569109Z`. The prior Web image remains
tagged `overva-production-web:rollback-zero-fault-20260904T110425Z`. The new
container, external App route and external `lighting.js` returned healthy/200,
and the externally served script contains the corrected state logic. All seven
services remained healthy; release check still reports 110 migrations and 25
modules with zero orphan events. The API, database schema, LAN and business
data were not changed by this hotfix.
