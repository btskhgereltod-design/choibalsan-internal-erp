# OVERVA COP/ERP

The isolated, multi-tenant OVERVA platform. It does not mount, import, or modify
any tenant's legacy ERP source, SQLite database, or uploads.

Production deployment for `overva.com` is documented in `PRODUCTION_DEPLOYMENT.md`.
Customer-specific configurations remain tenant industry profiles and are never
hard-coded as the OVERVA product model.

## Local Docker startup

1. Copy `.env.example` to `.env` and replace every `change-this-*` value.
2. Start the stack:

```powershell
docker compose up --build
```

3. Open `http://localhost:4100`. The API is available directly at
   `http://localhost:4101` for development.

The startup process applies ordered SQL migrations and creates the optional first
organization/admin only when the configured organization slug does not exist.

Windows must have WSL2 and Docker Desktop enabled. After enabling the Windows
features for the first time, restart Windows before the initial `docker compose up`.

## Isolation rules

- Never mount `../data/app.db` into this stack.
- Never mount `../uploads` into this stack.
- Never point `DATABASE_URL` at the legacy ERP.
- Legacy employee migration streams data directly from the read-only SQLite database into the tenant import transaction; no plaintext export file is retained.

### Import active legacy employees

The importer requires exactly 21 active non-AI employee records, preserves compatible bcrypt password hashes and rolls the entire operation back on any conflict. Run a dry-run first:

```powershell
node ops\export-legacy-employees.js --base64 | docker compose exec -T api npm run import:legacy-employees -- --base64 --dry-run
node ops\export-legacy-employees.js --base64 | docker compose exec -T api npm run import:legacy-employees -- --base64
```

### Attendance and timesheets

The tenant attendance module provides one audited record per employee/day, an 8-hour work/leave split, overtime, late minutes, check-in/out times, monthly matrix and UTF-8 CSV export. Directors and HR can edit; chief engineers can read all employees; other roles can only read their own records.

```powershell
docker compose exec -T api npm run test:attendance
```

### Office LAN pilot access

Keep the database and direct API bound to localhost. Set `ERP_WEB_BIND_IP` to the server computer's stable office LAN address and add the matching URL to `CORS_ORIGINS`. Allow TCP 4100 only from `LocalSubnet`; do not forward port 4100 on the internet router. Employees on the same office network then open `http://<ERP_WEB_BIND_IP>:4100`.

On this pilot computer, open PowerShell with **Run as administrator** and run `./ops/enable-lan-access.ps1`. To close LAN access later, run `./ops/disable-lan-access.ps1` as administrator.
- Tenant identity is loaded from the authenticated user on the server. API callers
  cannot select `organization_id` in request bodies.

## Useful commands

```powershell
docker compose ps
docker compose logs -f api
docker compose exec api npm test
docker compose exec api npm run test:integration
docker compose exec api npm run test:business
docker compose exec api npm run test:finance
docker compose exec api npm run test:operations
docker compose exec api npm run test:developer
docker compose down
```

`docker compose down` preserves named volumes. Do not add `--volumes` unless the
ERP v2 database is intentionally being destroyed and a verified backup exists.

## Verified backups

Create a backup containing a PostgreSQL custom-format dump, all uploaded files,
metadata, and SHA-256 checksums:

```powershell
docker compose --profile ops run --rm backup
docker compose --profile ops run --rm backup-verify
```

Backups are written atomically under `backups/overva-YYYYMMDDTHHMMSSZ/`. Legacy
`erp-v2-*` backup folders remain readable. A failed
run never replaces `backups/LATEST`, and no retention deletion runs automatically.
Copy verified backup folders to a second physical disk or off-site location.

The normal stack also runs `backup-scheduler`, which creates and verifies an
atomic backup immediately after startup and then every 24 hours by default.
Set `BACKUP_INTERVAL_SECONDS` to change the interval (minimum 300 seconds).
Backups are not deleted automatically; off-site copying and retention remain an
explicit operator responsibility.

`monitor` checks PostgreSQL and the API every minute. Signed webhook deliveries
remain queued until the endpoint has been reviewed; then start the retry worker
explicitly with `docker compose --profile integrations up -d webhook-worker`.
The worker retries deliveries up to five times. Long-running services use Docker
`restart: unless-stopped`.

To start ERP automatically after Windows logon, run PowerShell as the intended
ERP operator and execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\install-autostart.ps1
```

This installs a scheduled task that calls `docker compose up -d --wait`. Docker
Desktop itself must also be configured to start when the user signs in.

Restore is intentionally not exposed in the web application. A restore can
overwrite live data, so it must first be rehearsed into a new empty PostgreSQL
database, verified there, and only then performed during an approved outage.

## Current foundation

- PostgreSQL migrations with transaction and advisory-lock protection
- Organization, user, subscription, immutable audit foundation
- Tenant-scoped asset and work-order tables
- Login rate limiting and server-loaded tenant/role identity
- Strict CORS allowlist, security headers, request size limit, graceful shutdown
- Separate PostgreSQL and upload volumes

## Business modules

The tenant ERP at `http://localhost:4100` now includes:

- Organization structure: departments, positions, reporting manager and role-based access
- Inventory: warehouses, items, minimum stock, receipt, issue, transfer and adjustments
- Preventive maintenance: asset-linked recurring plans, due/overdue tracking and completion history
- Procurement: line-item requests and controlled submitted → approved → ordered → received workflow
- Organization settings: customer name, short name, logo URL, colors and contact details
- Subscription billing: tenant plan/invoice view with subscription enforcement
- COP Map: OpenStreetMap layers, asset/work-order locations, custom operational markers and tenant-specific map center
- GPS/Fleet: vehicles, provider-neutral devices, latest position, 24-hour route history, online/offline state and circular geofences
- IoT Control Center: telemetry, online/health monitoring, priority command queue, device polling/ACK and COP Map device layer
- Finance Integration Hub: tenant accounts, budgets, CSV/XLSX imports, duplicate protection and cash-flow dashboard
- Executive KPI and AI Director: cross-module health score, prioritized evidence and stored management briefs
- Integration Lab and Automation: provider field mapping, GPS/IoT simulators and event → condition → action rules
- Installable field PWA: cached work list plus offline status/note queue with online synchronization
- Developer Platform: scoped API keys, HMAC-signed webhooks, delivery journal and module marketplace

The provider console at `http://localhost:4100/platform.html` includes plan,
invoice, receivable and payment management. Billing records are tenant-scoped;
only the separate platform administrator can create invoices or record payments.

Migration `0008_business_modules.sql` installs all module tables and seeds the
Pilot, Starter and Business plan catalog. All write endpoints create audit entries,
and inventory movements use database transactions to prevent negative stock.

COP Map vendors Leaflet `1.9.4` into the web image, so no third-party JavaScript
runs in the browser. Only OpenStreetMap raster tiles are fetched at runtime. Map
records remain tenant-scoped and every coordinate/settings write is audited.

## GPS provider integration

Register the asset as a Fleet vehicle, then register its GPS device from the
`GPS / Fleet` screen. The generated API key is shown once and only its SHA-256
hash is stored. A provider sends positions to `POST /api/gps/ingest` with the
key in the `X-Device-Key` header:

```json
{
  "latitude": 48.0726,
  "longitude": 114.5356,
  "speedKph": 32.5,
  "heading": 90,
  "ignition": true,
  "fuelLevelPct": 74,
  "odometerKm": 12345.6,
  "accuracyM": 5,
  "recordedAt": "2026-08-20T02:00:00.000Z",
  "metadata": {}
}
```

The ingest endpoint validates subscription/device state, stores provider-neutral
telemetry, updates vehicle odometer and calculates geofence enter/exit events.
Provider-specific payload adapters can be added in front of this endpoint without
changing the Fleet or COP Map data model.

## IoT gateway integration

Register a device from `IoT Control`. The generated `iot_...` key is displayed
once; only its SHA-256 hash is stored. Gateways use `X-Device-Key` with:

- `POST /api/iot/ingest` — state, health, electrical/temperature metrics and arbitrary sensor JSON
- `GET /api/iot/device/commands` — fetch queued commands in priority order
- `POST /api/iot/device/commands/{id}/ack` — acknowledge success/failure and return result JSON

The server enforces `Emergency > Manual > Weather > Schedule > Default`. A new
higher-priority command supersedes queued lower-priority commands, while a lower
priority command cannot override an active higher-priority one. Devices must also
implement the same priority and safe fallback policy locally so loss of internet
does not leave equipment in an unsafe state.
