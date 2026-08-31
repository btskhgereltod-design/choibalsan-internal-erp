# Production pre-build gate evidence — 20260831T115011Z

Status: **PASS — deployment execution may proceed under the accepted runbook**

This gate did not build or deploy candidate images, run migrations, enable the
Phase B strict guard, or write production database data.

## Immutable rollback artifacts

The production API and Web containers remained healthy and continued to run
the exact image IDs below before and after preservation:

| Service | Container | Image ID/digest | Immutable tag | Archive SHA-256 |
|---|---|---|---|---|
| API | `overva-production-api-1` | `sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2` | `overva-production-api:rollback-20260831T083827Z` | `B964DF0B176068267B401EE05695AA7BEEF687D9C2756D132E538238E318C640` |
| Web | `overva-production-web-1` | `sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1` | `overva-production-web:rollback-20260831T083827Z` | `F25E97A8B39680AABDAE172B8EB1A8859F947018BEAAD7AEBD3068A17BCE6A68` |

Docker archive inspection returned exit code 0 and found `manifest.json` in
both tar files. The canonical filename, byte size, checksum, local location,
off-host file ID, and private vault location are recorded in
`PRODUCTION_RELEASE_IMAGE_RECORD_20260831T083827Z.md`.

The off-host folder is Google Drive ID
`1AkRgK65HWV7E7_sFwcwnBnVp_ktS15dh`. Metadata read-back returned the exact
local byte sizes, `shared=false`, and owner-only access. `D:` was not accepted
as independent storage because it is a partition on the same physical disk as
`C:`.

## Fresh backup proof

The existing production backup workflow created and verified
`overva-20260831T114722Z`:

| File | Bytes | SHA-256 |
|---|---:|---|
| `database.dump` | 2,234,556 | `ea94be0424a8f5c2987558284c8efadf6a7e605762403dbd7c5eaa00e5e2cdb5` |
| `uploads.tar.gz` | 116 | `a4a39de29f257d1ac96452ed72aa648cd9e4af9ceb3dc5d7f82f68371d51318a` |
| `metadata.txt` | 91 | `1d1f2d2efef7832e7ae490fff5a6adc0221503692e7d2a6db706783ea02679af` |

Verification evidence:

- `sha256sum -c SHA256SUMS`: all three files `OK`;
- `pg_restore --list database.dump`: exit 0, 1,792 list lines;
- `tar -tzf uploads.tar.gz`: exit 0, 2 entries;
- `metadata.txt`: database `overva`, format
  `postgres-custom-plus-uploads-tar-gz`, created at `20260831T114722Z`;
- `LATEST`: `overva-20260831T114722Z`;
- off-host private copy folder:
  [`production-backup-overva-20260831T114722Z`](https://drive.google.com/drive/folders/10ebRTMgPikRs1KVmF2ryfVQf0QtnZo5f),
  ID `10ebRTMgPikRs1KVmF2ryfVQf0QtnZo5f`;
- off-host read-back listed all four backup files with matching byte sizes and
  `shared=false`.

## Read-only production baseline

The baseline was checked before artifact creation and again after the fresh
backup:

| Check | Required | Observed before | Observed after |
|---|---:|---:|---:|
| Schema version | `0077` | `0077` | `0077` |
| Work Orders | 106 | 106 | 106 |
| Assigned snapshots | 85 | 85 | 85 |
| Work Order events | 656 | 656 | 656 |
| Long/open transactions | 0 | 0 | 0 |
| Relevant waiting locks | 0 | 0 | 0 |
| Relevant granted write locks | 0 | 0 | 0 |

Both production containers remained healthy on their original image IDs. No
baseline stop condition fired.

## Remaining operational risks

- The Drive upload API confirmed completed uploads and exact size/access
  read-back; it did not expose a provider-side SHA-256 field. The authoritative
  local SHA-256 manifest is therefore stored beside the off-host objects and
  must be checked after any future recovery download.
- The current backup scheduler healthcheck still checks only `LATEST` path
  existence, not freshness or checksum. This gate used the explicit verifier;
  the known scheduler-health hardening remains future work.
- Database migration rollback rules remain unchanged: after 0078–0080 commit,
  use only a schema-compatible image rollback or forward-fix as defined by the
  readiness runbook.

## Gate recommendation

**GO** for the next deployment-execution stage, subject to the existing
pre-migration stop conditions and exact release runbook. This is not evidence
that migration or deploy has already occurred.
