# OVERVA host-retirement migration readiness — 2026-09-05

## Objective

Retire the current Windows workstation only after OVERVA production operates
from a new Linux server with no runtime, data, credential, tunnel, backup, or
administrative dependency on this computer.

## Verified state

- GitHub `origin/main` and local `main` both point to `47d9c47`. Forty-two
  previously local-only commits were pushed by a normal fast-forward update.
- A history scan of the unpushed range found no private key, GitHub token, AWS
  key, live OpenAI key, or large binary blob. Matches were confined to explicit
  test/example placeholders. Real files under `secrets/` remain ignored.
- Current production is healthy at schema `0110`; repository/demo head is
  schema `0111`. Server cutover must not silently change this boundary.
- Latest production backup `overva-20260905T032053Z` passed stored SHA-256,
  `pg_restore --list`, and uploads-tar validation.
- That backup was restored into disposable database
  `overva_restore_hostretire_20260905a`; the result contained schema `0110`,
  four organizations, and 106 Work Orders. The entire rehearsal database was
  dropped after verification.
- Production Compose renders successfully with the production, Cloudflare, and
  AI-egress overlays. All four public/local health probes returned HTTP 200.
- The current Docker data disk is active under
  `D:\DockerDesktopData\DockerDesktopWSL`. Moving it freed the system drive,
  but `C:` and `D:` are partitions of the same physical SSD and are not a 3-2-1
  backup boundary.

## Portable staging bundle

`D:\OVERVA-Server-Migration` contains:

- exact production API image
  `sha256:23dbce4ec014245d8695481461dc1e5ac2a86c349644e8f270bacd271f6cd2ed`;
- exact production Web image
  `sha256:83bf0037c1d69c3cb08f5116746d760255018978b2fa1135e2b49b6618d8a8aa`;
- a captured image of the running public site
  `sha256:fa09bf682fd4191dc3f9860fc6e8a5189a8b3379553ad1940cdee3dedc17ab5a`;
- the verified production database and uploads backup;
- a verified Git bundle containing complete repository history;
- `SHA256SUMS.txt` covering every portable artifact.

The public-site capture was necessary because its running container snapshot
still existed while its original local image metadata no longer did. The
capture has no mounted volume.

This staging directory is still on the same physical computer. It is a
portable handoff set, not an off-site backup.

## Persistent and confidential boundaries

The new server must restore or recreate these persistent resources:

| Resource | Required action |
|---|---|
| PostgreSQL `postgres_data` | Restore the verified custom-format dump into a newly initialized production volume. |
| `uploads_data` | Restore `uploads.tar.gz` together with the matching database backup. |
| `caddy_data`, `caddy_config` | Recreate for the new origin; do not treat cached certificates as application truth. |
| Production secrets | Transfer through an encrypted channel, restrict permissions, validate, and rotate where safe after cutover. |
| Cloudflare tunnel credential/config | Install on the new server, verify every hostname, then retire the workstation task and old credential. |
| Backups and monitoring | Configure independent scheduled backup, freshness alerting, restore proof, and off-site retention before Go. |

Real secrets currently required by Compose are the database passwords and
URLs, JWT key, Google OIDC client secret, phone fingerprint key, SMS token, and
OpenAI key. Their values are intentionally absent from this document and the
portable staging bundle.

## Migration sequence

1. Provision a supported Linux server with static addressing, patched Docker
   Engine/Compose, restricted SSH or VPN administration, synchronized time,
   host firewall, and encrypted storage.
2. Clone `origin/main` and verify commit `47d9c47`, or verify and clone the Git
   bundle when operating offline.
3. Copy `D:\OVERVA-Server-Migration` to the new host or access-controlled
   transfer media and verify every entry against `SHA256SUMS.txt` before use.
4. Transfer `.env.production`, the nine real secret files, and Cloudflare
   credentials through a separately approved encrypted channel. Never place
   them in Git or an unencrypted sync folder.
5. Decide explicitly whether the first server boot preserves current production
   at schema `0110` or promotes reviewed code/migration `0111`. A clone of
   repository head must not be allowed to migrate production implicitly.
6. Initialize a new PostgreSQL volume and runtime role, restore the database,
   restore the matching uploads archive, then run only the reviewed migration
   target. Load the exact saved images for parity or build reviewed candidates.
7. Start with production, Cloudflare, and AI-egress Compose overlays. Keep
   PostgreSQL, API, and administrative services off public host ports.
8. Validate all public hostnames, login, tenant isolation, platform-admin
   isolation, audit append-only behavior, upload/download, backup verification,
   isolated restore, and IoT policy/ACK paths.
9. Move Cloudflare traffic only after the new origin passes the full gate. Keep
   the workstation stack intact but write-drained as the rollback source.
10. Observe the new server for at least 3–7 days, including a scheduled backup
    and restore proof. Then power this computer off and repeat public, data,
    backup, and administration checks.
11. Only after the powered-off acceptance test succeeds, revoke the old tunnel
    credential and local tokens, securely erase customer data and secrets, and
    retire or reset the workstation.

## Go / No-Go

Current result: **NO-GO for workstation retirement**.

The repository and portable artifacts are protected, but three external gates
remain: a provisioned destination server, an encrypted off-device backup with a
recoverable key, and a completed Cloudflare cutover. An available OneDrive sync
root was detected, but customer data and secrets were not copied there because
no approved portable encryption key or recipient certificate exists.

Final acceptance is binary: with this workstation powered off, every approved
OVERVA hostname, production workflow, database write/read, upload, audit,
monitoring alert, scheduled backup, and isolated restore must succeed from the
new server.
