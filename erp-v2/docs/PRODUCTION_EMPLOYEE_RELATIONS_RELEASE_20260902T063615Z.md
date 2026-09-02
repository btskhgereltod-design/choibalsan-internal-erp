# Controlled production Employee Relations release — 2026-09-02

Status: **SUCCESS**

Commit `68a7b59ac3ee86c7d93865991b12baf8dcb9b60c` was deployed through the
existing Cloudflare-overlay production Compose path. The release added only
the reviewed Complaints handoff, employee transfer/rotation and restricted
discipline capability. No rollback stop condition fired.

## Release identity and cutoffs

- Final migration cutoff: `2026-09-02T06:23:13.5438388Z`
- Candidate application cutoff: `2026-09-02T06:24:16.3047389Z`
- Previous API image: `sha256:6831f3e23dc8d72909a7bdfa392a46e096f2aff32334f10dc5e0a98d8c1df1c8`
- Previous Web image: `sha256:8fd01bb8cce61fab502c5257070f01622619ce5dcac836c92e07f32c34a500bb`
- Candidate API image: `sha256:8c24706b277e0ccbd63dbb511530d3a2401599ac914c7fce006d7053dfcc642b`
- Candidate Web image: `sha256:1d885425517bc3ac5777ed9dfc43c50b675ac05e44debaa5a0690f4714df8da9`

The prior images were pinned as rollback tags and exported before the build.
The API archive SHA-256 is
`b86566ee0b3f6e0ae0d227c01e86c18e022d2163a065effe9ff960eb3d9a438d`;
the Web archive SHA-256 is
`b98b8b3572a0fb794f8b698d8857e14c77a50f3f263669ef1e53267b2bb81dae`.

## Migration and security result

The bounded production migration runner exited 0 and refreshed runtime grants:

| Version | Migration SHA-256 | Applied UTC |
|---|---|---|
| `0091` | `324a222fe06c986ef60ba375e2785619efe06cf875bcf9c9a26083f2dd0af122` | `2026-09-02 06:24:18.862197+00` |
| `0092` | `7077e973fc3f5a99052d0772cdbd4239398c26a397a27b6606ad1cf072a1b9dd` | `2026-09-02 06:24:18.941022+00` |
| `0093` | `5e52158c31a054a318dd8dd2c811acfc00ec902eb3d7ac5e2693387afe849f86` | `2026-09-02 06:24:19.011905+00` |

All six new case/event tables have tenant RLS enabled with organization-scoped
`USING` and `WITH CHECK` policies. All three event tables have enabled
append-only triggers. The runtime role can select/insert events but cannot
update, delete or truncate them. Both reviewed constraints are validated.
Production contained zero complaint handoffs, transfers, discipline cases or
their events after migration, proving that no prior history was fabricated.

## Smoke and invariant result

- Authenticated session, organization, report and CSV smoke passed; an ordinary
  user remained denied from the management report.
- Live Complaints, HR workflow and confidential discipline overview reads
  returned 200. An ordinary user received 403 from discipline overview and
  detail without counts or items; discipline download was denied. Cross-tenant
  document detail and download both returned 404.
- A fresh production-backup clone was migrated by the candidate image and ran
  the full Phase 2 integration: tenant denial, RLS, idempotency/conflict,
  concurrency, Complaints lifecycle and explicit HR handoff, atomic discipline
  intake, confidential discipline lifecycle and documents, transfer/rotation
  Assignment change, audit and immutable events all passed. The clone and its
  extracted uploads were removed afterward.
- Production remained at 4 organizations, 25 users, 25 employees, 63 employee
  assignments, 1,715 attendance records, 106 Work Orders, 662 Work Order
  events, zero complaint cases/events, 31 documents and 32 document versions.
  Every corresponding pre/post row fingerprint was identical. Long
  transactions, waiting locks and Employee Relations orphan counts were zero.
- API, Web, DB, Caddy, public site, monitor and backup scheduler were healthy.
  Home, App, API, Status, Auth, IoT and Map returned HTTP 200; Admin returned
  its expected HTTP 302 redirect.

## Backup and rollback result

- Pre-deploy verified backup: `overva-20260902T062158Z`
  - database: `a21ddadafcd01ac4afd2b77ebacd55d0760a0d805ee74e2b9694d737a3302bd3`
  - uploads: `6772796c7f1845bca700012d688ddfedf5ac9dda88b413358c48729df6e4e0ae`
  - metadata: `6bc698541bd6d884f1de15aed36d0b49602dce25276f122208e6b000f03ebc2f`
- Post-deploy verified backup: `overva-20260902T063615Z`
  - database: `ec611e66dbf7903720603373da9da2ed2b6c8c64f0446297819d232c60505a6a`
  - uploads: `6772796c7f1845bca700012d688ddfedf5ac9dda88b413358c48729df6e4e0ae`
  - metadata: `5f34423da1ac9b0254bfd0920405b24d4bb4c4ae5be8fe45993ecd106697cc79`

Both backups passed `sha256sum -c`, `pg_restore --list` and uploads archive
listing. The pre-deploy backup also completed an isolated application-level
Employee Relations proof. Rollback was not invoked; the preserved prior images
and verified pre-deploy backup remain the recovery evidence for this release.
