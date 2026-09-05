# OVERVA next-chat handoff — 2026-09-05

## Start here

The next agent must work from the `erp-v2` repository root and read, in order:

1. `AGENTS.md`
2. `docs/CURRENT_STATE.md`
3. `docs/DECISIONS.md`
4. the relevant section of `docs/ARCHITECTURE.md`
5. this handoff and the files relevant to the new request

Search the repository before proposing material work. Keep implemented,
partial, planned, and hypothesis states distinct. Do not infer that the legacy
Choibalsan application and OVERVA share one product or data boundary.

## Verified baseline

- Branch: `main`
- Local and GitHub `origin/main`: `c22df57`
- Divergence at handoff: `0 ahead / 0 behind`
- Only visible untracked item: `../OVERVA.code-workspace`; it belongs to the
  user and must not be added, changed, or removed without an explicit request.
- Docker Desktop is running with its data disk at
  `D:\DockerDesktopData\DockerDesktopWSL`.
- Docker inventory: 38 containers total, 15 running, 34 volumes, and 98 unique
  images at the completed relocation baseline.
- Health at handoff: demo `localhost:4200`, local stack `localhost:4101`, local
  production origin `localhost:4180`, and `https://app.overva.com/health` all
  return HTTP 200.
- Repository API regression baseline: 492/492 tests passed after the governed
  human-workflow work.

## Environment boundaries

| Environment | Database/schema | Rule |
|---|---|---|
| Production | `overva`, schema `0110` | Treat as live. Read-only unless the user explicitly authorizes a reviewed production change. Do not implicitly apply repository migration `0111`. |
| Local/demo stack | `erp_v2`, schema `0111` | Use for development and governed demonstrations. Do not copy production customer data into it. |

Production currently runs from this workstation through Cloudflare Tunnel.
The user has explicitly deferred server migration and intends to continue
development on this computer. Keep the workstation, Docker Desktop, production
containers, tunnel task, and internet connection running unless a new request
explicitly changes that scope.

## Recent completed work

- Governed lighting/camera human-workflow E2E goals A–J are complete. See
  `DEMO_HUMAN_WORKFLOW_E2E_20260905.md`.
- Migration `0111` adds exact unused-material return/reconciliation and remains
  demo/repository-only; production remains on `0110`.
- Docker's 31 GB data VHDX moved from `C:` to `D:`. `C:` has approximately
  31.65 GB free. `C:` and `D:` are partitions of the same physical SSD.
- Forty-two previously local-only commits plus the host-readiness documentation
  were pushed to GitHub.
- Host-retirement preparation exists but is not an active migration project.
  See `HOST_RETIREMENT_MIGRATION_READINESS_20260905.md`.

## Backup and recovery state

- Latest demo/local backup: `backups/overva-20260905T025927Z`
- Latest production backup: `backups-production/overva-20260905T032053Z`
- The production backup passed SHA-256, `pg_restore --list`, uploads archive,
  and a real disposable restore rehearsal through schema `0110`; the rehearsal
  database was removed.
- Portable future-server artifacts are staged under
  `D:\OVERVA-Server-Migration` with `SHA256SUMS.txt`.
- Two Docker relocation recovery VHDXs remain under
  `D:\DockerDesktopMigrationBackup`. Do not delete them casually.
- These local copies are on the same physical computer and are not an off-site
  backup. Source history is protected on GitHub; customer data and secrets were
  not uploaded to OneDrive without approved portable encryption.

## Safety reminders

- Preserve server-side tenant isolation and append-only audit evidence.
- Never print, commit, or upload real files from `secrets/` or
  `.env.production`.
- IoT command priority remains Emergency > Manual > Weather > Schedule >
  Default at every applicable layer.
- Consequential AI/configuration/control writes require authorization,
  validation, attribution, and appropriate human approval.
- Do not run broad Docker prune/reset, WSL unregister, recursive delete, or Git
  reset/clean operations. There are live production volumes and user-owned
  workspace files on this host.

## Quick read-only startup check

```powershell
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
docker desktop status
docker ps
Invoke-WebRequest -UseBasicParsing http://localhost:4200/health
Invoke-WebRequest -UseBasicParsing http://localhost:4180/health
Invoke-WebRequest -UseBasicParsing https://app.overva.com/health
```

After those checks, scope the new task independently. Do not resume server
migration merely because the readiness artifacts exist.
