# OVERVA production deployment

This runbook prepares `overva.com` without changing Namecheap or the current LAN pilot. Production uses Caddy as the only public entry point. PostgreSQL, the API container, web container, workers and monitoring have no host ports.

## Domain routing

| Host | Route | Notes |
|---|---|---|
| `overva.com` | `public-site:8080` | Corporate landing page |
| `www.overva.com` | permanent redirect | Redirects to `https://overva.com` |
| `app.overva.com` | `web:80` | Main tenant COP/ERP application; existing same-origin `/api/*` remains compatible |
| `api.overva.com` | `api:4100` | Only `/api/*` and `/health` are accepted |
| `admin.overva.com` | platform assets and `/api/platform/*` | Platform administrator surface only |
| `auth.overva.com` | `/api/auth/*` | Existing authentication API; not a duplicate auth implementation |
| `iot.overva.com` | `/api/iot/*` | Device telemetry, policy, command polling and ACK |
| `map.overva.com` | `/api/map/*`, `/api/gps/*` | Existing GIS/GPS APIs; map UI remains in the main app |
| `status.overva.com` | live `/health` plus status page | Exposes no database sizes, tenant counts or admin diagnostics |

### Market Provider phone-assurance preparation

Production Compose mounts `secrets/market_sms_token` and
`secrets/market_phone_fingerprint_key` into API, migration, and optional worker
containers. The real files are ignored by Git; only `.example` guidance is
tracked. Generate the fingerprint key once with:

```powershell
node ops/prepare-market-phone-fingerprint-key.js
```

Do not rotate that key after verified phone fingerprints exist. Paste the real
provider token into `secrets/market_sms_token`, then set the provider-specific
`MARKET_SMS_ENDPOINT` and `MARKET_SMS_SENDER` in `.env.production`. Keep
`MARKET_SMS_ENABLED=false` until a provider sandbox request, real delivery,
wrong/expired/reused OTP, rate-limit, and rollback checks pass. Placeholder
secrets are rejected if the flag is enabled.

## Namecheap DNS records

Replace `SERVER_PUBLIC_IPV4` with the production server's static public IPv4. In Namecheap open **Domain List → overva.com → Advanced DNS** and add these records only when the server and firewall are ready. This repository does not make DNS changes.

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `@` | `SERVER_PUBLIC_IPV4` | 5 min during launch, then Automatic |
| CNAME Record | `www` | `overva.com` | Automatic |
| A Record | `app` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `api` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `admin` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `auth` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `iot` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `map` | `SERVER_PUBLIC_IPV4` | Automatic |
| A Record | `status` | `SERVER_PUBLIC_IPV4` | Automatic |

Do not add AAAA records unless the server has stable, firewall-protected IPv6. Do not remove or replace MX, SPF, DKIM or DMARC records used for email. An optional CAA record can authorize `letsencrypt.org`; check existing CAA records first because an incorrect CAA policy prevents TLS issuance.

## Server and firewall prerequisites

- Use a supported Linux server with a static public IP, Docker Engine and Docker Compose v2. Production should not depend on an interactive Docker Desktop login.
- Forward/open TCP 80 and TCP+UDP 443 to this server. SSH should be restricted to trusted administration IPs or VPN. Do not open 4100, 4101, 5432, 5433 or Docker's remote API.
- Configure the Docker service to start at boot. Every long-running OVERVA container uses `restart: unless-stopped`, so the stack returns after a server reboot.
- Keep the server clock synchronized; TLS, JWT expiration and audit timestamps depend on it.

## Secrets and environment

Create production-only files from the committed examples. Never commit the resulting files:

```sh
cp .env.production.example .env.production
mkdir -p secrets backups restore-rehearsal
openssl rand -base64 48 > secrets/postgres_password
openssl rand -base64 48 > secrets/app_database_password
openssl rand -base64 64 > secrets/jwt_secret
```

Create two connection files, URL-encoding passwords when necessary. The migration URL uses the PostgreSQL administrator only in the one-shot migration container; the long-running API uses the separate least-privilege role:

```text
secrets/migration_database_url:
postgresql://overva:URL_ENCODED_ADMIN_PASSWORD@db:5432/overva

secrets/app_database_url:
postgresql://overva_app:URL_ENCODED_APP_PASSWORD@db:5432/overva
```

The app password in `app_database_url` must match `secrets/app_database_password`. On a new volume PostgreSQL creates `overva_app` through the initialization script. The migration container refreshes runtime grants after every migration. The API role cannot update, delete or truncate any audit journal.

Restrict `.env.production`, `secrets/` and `backups/` to the deployment operator. Bootstrap passwords are intentionally absent from the production template. Create or migrate the initial organization through an approved one-time procedure, then remove any bootstrap credentials.

Development uses `.env`/`.env.development.example`; staging uses a separate host, database, secrets and `.env.staging`; production uses only `.env.production`. Never point staging at the production database or volumes.

## Preflight and launch

Before first launch, verify a backup of the current pilot and rehearse its restore on a separate database/server. Production migrations include ordered migrations already used by OVERVA; do not skip migration numbers.

Migration waits are bounded. `MIGRATION_LOCK_TIMEOUT_MS` defaults to 15000 and
`MIGRATION_STATEMENT_TIMEOUT_MS` defaults to 300000. A timeout is a stopped
release, not permission to raise limits during an active incident without a
new lock and volume review.

### Staging migration rehearsal

Rehearse on a disposable database named `overva_rehearsal_*`; never point these
commands at production. The runner permits a targeted old-schema stop only when
both the disposable name and `MIGRATION_REHEARSAL_MODE=1` are present:

1. Create an empty `overva_rehearsal_*` database on staging.
2. Run `MIGRATION_REHEARSAL_MODE=1 MIGRATION_REHEARSAL_TARGET_VERSION=0077 npm run migrate`.
3. Run `MIGRATION_REHEARSAL_MODE=1 node scripts/seed-work-order-hardening-rehearsal.js`.
4. Unset the target version and run `npm run migrate` to the candidate head.
5. Run `npm run migrate` again and require a no-op rerun.
6. Run `npm test`, `npm run test:work-assignment`, and
   `npm run test:automation-idempotency` against that database.
7. Reconcile 106 Work Orders, 85 assigned snapshots, 656 unchanged legacy
   events, zero fabricated typed events, validated identity/FK constraints,
   enabled append-only trigger, and zero duplicate automation rule/event runs.
8. Drop the entire disposable database after evidence is recorded. Do not
   delete individual immutable rows as test cleanup.

### Work Order assignment phased rollout

Migrations `0078`–`0080` are phase A. They remain readable and writable by the
previous API image: any old-image unversioned assignment insert remains explicit
non-canonical transition evidence. Deploy the new API, record the application
cutoff, and reconcile all post-cutoff Work Orders and typed assignment events.
An application-only rollback during phase A keeps the additive schema and does
not remove history.

Do not add or run the phase-B strict version trigger in the same release. Phase
B requires a separate review after the new writer has soaked, every old image
and external writer has been retired, transition evidence is reconciled, and a
forward-fix has been rehearsed. Until then reports truthfully return missing
assignment history as unknown.

```sh
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d --wait
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Caddy obtains and renews public certificates after DNS points to the server and ports 80/443 are reachable. Its certificate state is persisted in `caddy_data`. Do not manually copy certificates into Git.

### Cloudflare Tunnel deployment

The current `overva.com` host uses Cloudflare Tunnel instead of exposing Caddy
directly. Production Compose commands **must** add both the Cloudflare and AI
egress overlays. Omitting Cloudflare removes `127.0.0.1:4180` and causes public
502 errors; omitting AI egress leaves the API on the internal backend network
and breaks approved outbound providers such as Google OIDC and OpenAI:

```sh
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml -f docker-compose.ai.yml config --quiet
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml -f docker-compose.ai.yml build
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml -f docker-compose.ai.yml up -d --wait
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml -f docker-compose.ai.yml ps
```

The overlay binds plain HTTP only to loopback (`127.0.0.1:4180`). Cloudflare
provides the public TLS endpoint, and `cloudflared.production.yml` forwards all
approved OVERVA hostnames to that loopback origin. PostgreSQL and internal
services remain unreachable from the public network.

When restoring an existing database into a new production volume, let PostgreSQL initialize the empty volume and create the runtime role first, then restore into that database and rerun the one-shot `migrate` service. Do not attach an old volume that lacks the least-privilege role without an explicit role/grant review.

Validate every public hostname, login, tenant isolation, platform-admin isolation, file upload, backup, IoT policy download and command ACK before accepting users. Enable the webhook worker only after outbound destinations and secrets have been reviewed:

```sh
docker compose --env-file .env.production -f docker-compose.production.yml --profile integrations up -d webhook-worker
```

## Backup and restore

The scheduler immediately creates an atomic `overva-YYYYMMDDTHHMMSSZ` PostgreSQL custom dump plus uploads archive, metadata and SHA-256 checksums, then repeats daily. `LATEST` changes only after a completed backup and verification. Legacy `erp-v2-*` backup folders remain restorable. No automatic retention deletion is performed.

Use a 3-2-1 strategy: production volume, encrypted backup copy on different media, and an encrypted off-site copy. Alert on missed backups and test a restore at least monthly. A backup is not proven until restore succeeds.

`ops/restore-rehearsal.sh` refuses to overwrite the configured live database and accepts only a new database named `overva_restore_*`. Run it from a temporary PostgreSQL tooling container or isolated restore server with `/backups` and `/restore-rehearsal` mounted. It never drops an existing database. Live restoration requires an approved outage, a fresh pre-restore backup and an explicit operator procedure.

## IoT safety boundary

The server and database enforce `Emergency > Manual > Weather > Schedule > Default`; lower commands cannot override an active higher command and higher commands supersede queued lower commands. Emergency commands are accepted only from directors and chief engineers in both UI and API. Command creation, override details, emergency/manual actions, acknowledgements, policy changes and IoT state changes are append-only audited.

Gateways fetch `/api/iot/device/policy`, verify its checksum, store it durably and keep the last valid policy when disconnected. The repository contains no gateway firmware, PLC program or device controller. Therefore device- and edge-level enforcement is a mandatory integration acceptance test, not something the server can truthfully guarantee alone. A device/gateway is production-approved only when it demonstrably:

1. applies the same five-level priority order;
2. rejects stale, expired, replayed or lower-priority overrides;
3. persists the last checksum-valid policy across power loss;
4. executes its approved fail-safe action when no valid policy exists;
5. queues signed state/ACK events for delivery after connectivity returns;
6. prevents remote commands from bypassing a physical emergency interlock.

## Rollback

Keep the previous application image/configuration and a verified pre-deployment backup. Application rollback must never run old code against a schema it cannot understand. Prefer forward-compatible migrations; if database rollback is unavoidable, stop writes and restore the full database plus uploads together into new volumes, validate, then switch traffic.

For assignment-history phase A, prefer application-only rollback while keeping
the additive `0078`–`0080` schema. Stop and forward-fix if migration state is
partial, baseline counts change, a constraint is invalid, append-only mutation
succeeds, a cross-tenant or mismatched User/Employee pair is accepted, an exact
idempotent replay duplicates work, or historical unknown coverage changes
retroactively. Never drop assignment columns or delete event rows as rollback.

For this phase-A release, the exact immutable image capture, reconciliation,
application rollback commands, stop conditions, and backup freshness design are
maintained in `docs/PRODUCTION_RELEASE_READINESS_RUNBOOK.md`. The latest real
restore evidence is
`docs/PRODUCTION_RESTORE_REHEARSAL_20260831T110319Z.md`. Both documents are
release gates rather than optional background notes.
