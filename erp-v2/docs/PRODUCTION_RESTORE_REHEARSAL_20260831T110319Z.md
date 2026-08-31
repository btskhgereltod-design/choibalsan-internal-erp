# Production restore rehearsal evidence — 2026-08-31

Status: **passed and cleaned up**

This evidence records a real restore of the latest production backup. No
production database row, production uploads file, production service image, or
production tag was changed.

## Source backup

- Backup: `overva-20260831T083827Z`
- Rehearsal started: `2026-08-31T11:03:29Z`
- Database archive: PostgreSQL custom dump, 2,234,556 bytes
- Upload archive: gzip tar, 116 bytes
- Database SHA-256:
  `4ebdef532e7ee9ac64529ac355f31158cf54b49d3d906fc6cfc7e7b483b5b1aa`
- Upload SHA-256:
  `a4a39de29f257d1ac96452ed72aa648cd9e4af9ceb3dc5d7f82f68371d51318a`
- Metadata SHA-256:
  `01afe794c200cb07fe8f7cafc39fa55528788125743650173f4b002456e5a287`

`sha256sum -c` passed for all three files before restore. `pg_restore` ran
with `--exit-on-error --single-transaction` into the isolated database
`overva_restore_20260831t110319z`. The upload archive was extracted into the
separate workspace directory
`restore-rehearsal/overva-20260831T083827Z`. Its complete archive consisted of
`./` and the empty `./documents/` directory; the extracted result contained the
same directory topology and zero files.

## Database reconciliation

| Check | Restored result | Expected production baseline |
|---|---:|---:|
| Schema version | `0077` | `0077` |
| Applied migrations | 77 | 77 |
| Work Orders | 106 | 106 |
| Work Orders with assignee snapshot | 85 | 85 |
| Work Order events | 656 | 656 |
| Active users | 25 | 25 |
| Active organizations | 4 | 4 |
| Orphan Work Order events | 0 | 0 |
| Invalid assignee snapshots | 0 | 0 |

The restored tenant-scoped Work Order, event actor, organization, User, and
Employee foreign keys inspected during the rehearsal were all validated. The
restored `0077` event-parent FK correctly remained its pre-release `CASCADE`
form; migration `0079` changes that FK to `RESTRICT` during phase A.

## Application proof

The restored database received runtime grants using the exact currently
deployed API image, without applying migrations beyond the image's `0077`
head. A temporary API was then started against only the restored database and
restored uploads directory using this immutable identity:

`overva-production-api@sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2`

Results:

- API `/health`: HTTP 200
- authenticated `/api/auth/me`: passed
- authenticated organization session: passed
- restored organization session: 24 enabled modules and 47 permissions

## Cleanup proof

- Temporary API container `overva-restore-api-20260831t110319z`: removed
- Restore database `overva_restore_20260831t110319z`: absent after `dropdb --force`
- Workspace `restore-rehearsal` directory: removed bottom-up after confirming
  it contained only the two expected empty directories
- Production remained at schema `0077`, 106 Work Orders, 85 assigned snapshots,
  and 656 Work Order events
