# Controlled production purpose-aware work routing release — 2026-09-02

Status: **SUCCESS**

Commit `1a49a1f379e695b8d87efe95a3d016d3798caaa4` and schema `0096` are live.
The release adds tenant-configured intake suggestions, separate operational
purpose and assignment-kind dimensions, a responsible-team backlog, and an
authorized self-claim command. No rollback stop condition fired.

## Release and rollback identity

- Release artifact ID: `20260902T142842Z`
- API image: `sha256:76fe2a0c24a52c0be9b58a3ba431891ea3a3439c624ab6d4c1cc0b980be5fbe3`
- Web image: `sha256:7694769dcb6ee762ce7ea347dafa1f5b401065b88b88b391a179408b9cb8f96b`
- Migration image: `sha256:b1602d1136faa22a20b63ed372eb35df61ef1e23968c4f767e0468c8ec401338`
- Migration `0096` SHA-256: `e5fea6fe2aa2eddc13fabfe74cb23202b95d6f5cc7f741494937f34ed3dff597`
- Rollback API image: `sha256:2c2b267716f3074dcef180e36df42e752166edae692dbd070a2a40aeb47aafb2`
- Rollback Web image: `sha256:9266df73fc2e1344717cf0378cb4a2eb482cf4734f8f51de69580e097d1c35d1`
- API rollback archive SHA-256: `600E7AF65E5EF5A9A7375F3585A1FE6D9B10DB94EB3E1427CF4E4E4AAEB7EEEC`
- Web rollback archive SHA-256: `B8A8BDA004F57932470F15B65E87B5EA8EC230E68737E51EFC0172D560A35241`
- Off-device rollback directory: `D:\OVERVA\release-artifacts\20260902T142842Z`

The schema is additive and remains compatible with the preserved old images:
new Work Order columns have safe defaults or are nullable, and `self_claim` is
an additive assignment-event source.

## Migration and data result

The API writer was stopped before migration. The stop gate observed schema
`0095`, zero long transactions, zero waiting relevant locks, and exactly 15
untyped Work Orders; all 15 carried the reviewed `legacy-workflow-v2` evidence.
Migration `0096` applied in one bounded transaction and refreshed runtime
grants.

- Work Orders: `106`
- Core-service Work Orders: `91`
- Internal-operation Work Orders: `15`
- Normal assignment kind: `106`
- Choibalsan intake routes: `2`
- Other-tenant intake routes: `0`
- Validated new/changed checks: `4/4`
- Intake-route RLS: enabled
- Runtime intake-route select/insert: allowed
- Runtime Work Order event update/delete: denied

The internal-operation backfill was restricted to the 15 evidence-bearing
legacy records. It did not infer a purpose for new or otherwise unreviewed
untyped work. No Work Order status, workflow stage, assignment, approval,
safety review, or append-only event was created or changed by the migration.

## Verification

- Full repository suite: `416/416` passed.
- Production-clone `0095` to `0096` rehearsal and idempotent rerun passed.
- Clone runtime grants and cross-tenant RLS checks passed (`2` versus `0`).
- Production session/report/CSV smoke passed with 25 modules and 91
  permissions; ordinary-user report access remained HTTP `403`.
- Authenticated production Work Board read returned `106` items: `26` assigned,
  `9` team backlog, `9` exception, and `62` closed.
- Authenticated intake returned `236` unresolved source items; all `236` had a
  deterministic tenant suggestion. These are intake records, not new Work
  Orders.
- Seven classified Choibalsan Work Types were exposed; the Web served
  `app.js?v=42` with the team-backlog and claim contracts.
- API, Web, DB, Caddy, public site, monitor, and backup scheduler were healthy.
- Public Home, App, API, Status, Auth, IoT, and Map returned HTTP `200`; Admin
  returned its expected HTTP `302`.
- Long transactions and waiting relevant locks remained zero.
- The disposable rehearsal database and its temporary restore log were removed.

Production invariants closed at 4 organizations, 25 users, 25 employees, 63
assignments, 1,715 attendance rows, 106 Work Orders, 768 Work Order events, 103
approvals, zero structured safety reviews, 31 documents, and 32 document
versions.

## Backup evidence

- Pre-deploy backup: `overva-20260902T142952Z`
  - database SHA-256: `C88ABE7AE6BE579BB92CFCC01BEC6607CAF62FA59CE438EDE5B133A6E0A30C96`
  - uploads SHA-256: `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`
- Post-deploy backup: `overva-20260902T143412Z`
  - database SHA-256: `335D34072F79EDCCA1DBFC0F9FC94578B7E7377CB0892AB689A28E3CDF138FB4`
  - uploads SHA-256: `6772796C7F1845BCA700012D688DDFEDF5AC9DDA88B413358C48729DF6E4E0AE`

Both backups passed SHA-256 verification, PostgreSQL custom-dump listing, and
uploads archive listing. Each was copied to `D:\OVERVA\backups-production` and
independently hash-verified.
