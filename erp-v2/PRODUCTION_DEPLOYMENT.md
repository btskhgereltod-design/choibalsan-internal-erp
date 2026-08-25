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

```sh
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d --wait
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Caddy obtains and renews public certificates after DNS points to the server and ports 80/443 are reachable. Its certificate state is persisted in `caddy_data`. Do not manually copy certificates into Git.

### Cloudflare Tunnel deployment

The current `overva.com` host uses Cloudflare Tunnel instead of exposing Caddy
directly. Every Compose command that can create or recreate Caddy **must** add
the Cloudflare overlay; otherwise port `127.0.0.1:4180` disappears and the
public hostnames return Cloudflare 502 errors:

```sh
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml config --quiet
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml build
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml up -d --wait
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.cloudflare.yml ps
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
