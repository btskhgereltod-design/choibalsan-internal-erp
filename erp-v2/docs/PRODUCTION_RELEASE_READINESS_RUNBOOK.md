# Production release readiness runbook — assignment history phase A

This is the executable release and rollback record for migrations `0078`–
`0080`. Run every command from the `erp-v2` repository root in PowerShell. Do
not substitute a mutable `latest` tag for an image identity.

## Accepted baseline and immutable current release identity

The release must be reviewed again if the production baseline changes before
the maintenance window.

```powershell
$ReleaseId = '20260831T083827Z'
$ExpectedWorkOrders = 106
$ExpectedLegacyEvents = 656
$ExpectedAssignedSnapshots = 85
$CurrentApiId = 'sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2'
$CurrentWebId = 'sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1'
$CurrentApiRef = 'overva-production-api@sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2'
$CurrentWebRef = 'overva-production-web@sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1'
$CurrentApiTag = "overva-production-api:rollback-$ReleaseId"
$CurrentWebTag = "overva-production-web:rollback-$ReleaseId"
$Compose = @('--env-file','.env.production','-f','docker-compose.production.yml','-f','docker-compose.cloudflare.yml','-f','docker-compose.ai.yml')
```

Expected current container identity:

```powershell
$ActualApiId = docker inspect overva-production-api-1 --format '{{.Image}}'
$ActualWebId = docker inspect overva-production-web-1 --format '{{.Image}}'
if ($ActualApiId -ne $CurrentApiId) { throw "API image changed: $ActualApiId" }
if ($ActualWebId -ne $CurrentWebId) { throw "Web image changed: $ActualWebId" }
```

Expected result: no output and exit code 0.

## Preserve rollback images before any build

These commands are mandatory immediately before the candidate build. They
have not been run by the readiness sprint.

```powershell
New-Item -ItemType Directory -Force -Path release-artifacts | Out-Null
docker image tag $CurrentApiId $CurrentApiTag
docker image tag $CurrentWebId $CurrentWebTag
docker image inspect $CurrentApiTag --format '{{.Id}}'
docker image inspect $CurrentWebTag --format '{{.Id}}'
docker image save --output "release-artifacts/api-$ReleaseId.tar" $CurrentApiTag
docker image save --output "release-artifacts/web-$ReleaseId.tar" $CurrentWebTag
Get-FileHash -Algorithm SHA256 "release-artifacts/api-$ReleaseId.tar","release-artifacts/web-$ReleaseId.tar"
```

Expected image IDs are exactly `$CurrentApiId` and `$CurrentWebId`. Copy the
two archives and their SHA-256 values to access-controlled storage on another
device before building. Record the archive checksums in the release record.
The tag is a readable local pin; the image ID/digest and exported archive are
the authoritative rollback identity.

## Pre-migration cutoff and baseline

Begin an announced write-drain window. Stop only API writers; leave DB, Caddy,
backup scheduler, and static web running.

```powershell
docker compose @Compose stop api
$MigrationCutoff = [DateTime]::UtcNow.ToString('o')
$sql = @"
SELECT max(version) schema_version,
       (SELECT count(*) FROM work_orders) work_orders,
       (SELECT count(*) FROM work_orders WHERE assigned_to IS NOT NULL) assigned_snapshots,
       (SELECT count(*) FROM work_order_events) legacy_events
  FROM schema_migrations;
SELECT count(*) long_transactions FROM pg_stat_activity
 WHERE datname=current_database() AND pid<>pg_backend_pid()
   AND xact_start IS NOT NULL AND now()-xact_start>interval '30 seconds';
SELECT count(*) waiting_relevant_locks FROM pg_locks l
 JOIN pg_class c ON c.oid=l.relation
 WHERE NOT l.granted AND c.relname IN('work_orders','work_order_events','automation_events','automation_runs');
"@
$sql | docker compose @Compose exec -T db psql -U overva -d overva -v ON_ERROR_STOP=1 -P pager=off
```

Expected: schema `0077`, Work Orders 106, assigned snapshots 85, legacy events
656, long transactions 0, waiting locks 0. Any difference is a stop; restart
the old API and perform a new review rather than changing expected values during
the release.

## Candidate migration and start

Only after a fresh verified backup and the immutable image preservation above:

```powershell
docker compose @Compose config --quiet
docker compose @Compose build
$ApplicationCutoff = [DateTime]::UtcNow.ToString('o')
docker compose @Compose up -d --wait
docker compose @Compose ps
```

Expected: the one-shot `migrate` service exits 0 and all seven long-running
services report healthy. `MIGRATION_LOCK_TIMEOUT_MS` is 15,000 and
`MIGRATION_STATEMENT_TIMEOUT_MS` is 300,000 unless the reviewed environment
sets another bounded value.

## Exact database reconciliation

Set `$MigrationCutoff` and `$ApplicationCutoff` to the values captured above.
Do not approximate them.

```powershell
$sql = @"
SELECT max(version) schema_version FROM schema_migrations;
SELECT
 count(*) FILTER(WHERE created_at<'$MigrationCutoff'::timestamptz) legacy_events_before_cutoff,
 count(*) FILTER(WHERE assignment_history_version=1 AND created_at<'$MigrationCutoff'::timestamptz) typed_backfill_before_cutoff,
 count(*) FILTER(WHERE event_type='assigned' AND assignment_history_version IS NULL AND created_at>='$ApplicationCutoff'::timestamptz) unversioned_after_app_cutoff
FROM work_order_events;
SELECT
 count(*) FILTER(WHERE created_at<'$MigrationCutoff'::timestamptz) work_orders_before_cutoff,
 count(*) FILTER(WHERE created_at<'$MigrationCutoff'::timestamptz AND assigned_to IS NOT NULL) assigned_before_cutoff
FROM work_orders;
WITH latest AS (
 SELECT DISTINCT ON(organization_id,work_order_id)
        organization_id,work_order_id,to_assignee_user_id
 FROM work_order_events
 WHERE event_type='assigned' AND assignment_history_version=1
 ORDER BY organization_id,work_order_id,created_at DESC,id DESC
)
SELECT count(*) snapshot_mismatches FROM latest l
JOIN work_orders w ON w.organization_id=l.organization_id AND w.id=l.work_order_id
WHERE l.to_assignee_user_id IS DISTINCT FROM w.assigned_to;
SELECT count(*) missing_initial_events FROM work_orders w
WHERE w.created_at>='$ApplicationCutoff'::timestamptz AND NOT EXISTS(
 SELECT 1 FROM work_order_events e
 WHERE e.organization_id=w.organization_id AND e.work_order_id=w.id
   AND e.event_type='assigned' AND e.assignment_history_version=1
   AND e.assignment_operation='initial' AND e.created_at<=w.created_at
);
SELECT conname,convalidated,confdeltype FROM pg_constraint
WHERE conname IN(
 'work_order_events_order_tenant_fk',
 'work_order_events_from_assignee_user_tenant_fk','work_order_events_to_assignee_user_tenant_fk',
 'work_order_events_from_assignee_employee_tenant_fk','work_order_events_to_assignee_employee_tenant_fk',
 'work_order_events_assignment_identity_check','automation_runs_rule_event_unique')
ORDER BY conname;
SELECT tgname,tgenabled FROM pg_trigger
WHERE NOT tgisinternal AND tgname IN(
 'work_order_events_append_only','work_order_events_assignment_identity_guard')
ORDER BY tgname;
SELECT has_table_privilege('overva_app','work_order_events','SELECT') can_select,
       has_table_privilege('overva_app','work_order_events','INSERT') can_insert,
       has_table_privilege('overva_app','work_order_events','UPDATE') can_update,
       has_table_privilege('overva_app','work_order_events','DELETE') can_delete,
       has_table_privilege('overva_app','work_order_events','TRUNCATE') can_truncate;
SELECT
 (SELECT count(*) FROM (SELECT organization_id,source_delivery_key FROM automation_events
   WHERE source_delivery_key IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) d) duplicate_deliveries,
 (SELECT count(*) FROM (SELECT organization_id,rule_id,event_id FROM automation_runs
   GROUP BY 1,2,3 HAVING count(*)>1) r) duplicate_rule_runs;
"@
$sql | docker compose @Compose exec -T db psql -U overva -d overva -v ON_ERROR_STOP=1 -P pager=off
```

Expected:

- schema `0080`;
- legacy events before cutoff 656;
- typed backfill before cutoff 0;
- unversioned assignment events after candidate application cutoff 0;
- Work Orders before cutoff 106 and assigned snapshots 85;
- snapshot mismatches 0 and missing initial events 0;
- all seven listed constraints present and `convalidated=t`;
- `work_order_events_order_tenant_fk.confdeltype=r`;
- both triggers present with `tgenabled=O`;
- runtime privileges `SELECT=t`, `INSERT=t`, `UPDATE=f`, `DELETE=f`, `TRUNCATE=f`;
- duplicate deliveries 0 and duplicate rule runs 0.

## Deployed contract and HTTP/CSV smoke

These commands are read-only. The contract smoke uses deployed code with a
mock event for the conflict branch and a real read-only cross-tenant identity
lookup; it never creates a production row.

```powershell
docker compose @Compose exec -T api npm run smoke:release-contract
docker compose @Compose exec -T api npm run smoke:session
```

Expected:

- schema 0080;
- foreign-tenant assignee lookup returns no identity;
- exact assignment idempotency payload replays;
- changed payload returns `ASSIGNMENT_IDEMPOTENCY_CONFLICT`;
- authenticated session and report HTTP 200;
- CSV HTTP 200 with 23 columns;
- CSV opening/created/completed/cancelled/closing/overdue flags equal the report;
- ordinary user report request returns HTTP 403.

External and container health:

```powershell
$serviceState = docker compose @Compose ps --format json | ConvertFrom-Json
$required = @('api','backup-scheduler','caddy','db','monitor','public-site','web')
foreach ($service in $required) {
  $item = $serviceState | Where-Object Service -eq $service
  if (-not $item -or $item.State -ne 'running' -or $item.Health -ne 'healthy') {
    throw "$service is not running and healthy"
  }
}
docker compose @Compose exec -T backup-scheduler /bin/sh /ops/verify-latest.sh
$urls = @(
 'https://overva.com/','https://app.overva.com/','https://api.overva.com/health',
 'https://status.overva.com/health','https://auth.overva.com/health',
 'https://iot.overva.com/health','https://map.overva.com/health'
)
foreach ($url in $urls) {
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
  if ($response.StatusCode -ne 200) { throw "$url returned $($response.StatusCode)" }
}
$adminStatus = curl.exe -sS -o NUL -w "%{http_code}" https://admin.overva.com/
if ($adminStatus -ne '302') { throw "Admin redirect was $adminStatus" }
```

Expected: API, Web, DB, Caddy, public site, monitor, and backup scheduler healthy;
latest backup checksums/list/archive pass; seven public endpoints return 200;
Admin root returns its expected 302 redirect.

## Application rollback after `0078`–`0080`

Rollback is application-only. Keep schema `0080`; never drop assignment columns
or delete history.

```powershell
$env:OVERVA_ROLLBACK_API_IMAGE = $CurrentApiRef
$env:OVERVA_ROLLBACK_WEB_IMAGE = $CurrentWebRef
$Rollback = $Compose + @('-f','docker-compose.rollback.yml')
$compatibility = docker compose @Compose exec -T db psql -U overva -d overva -At -F '|' -c "SELECT max(version),(SELECT count(*) FROM pg_trigger WHERE tgname='work_order_events_assignment_v1_required') FROM schema_migrations"
if ($compatibility.Trim() -ne '0080|0') { throw "Old-image rollback is not schema compatible: $compatibility" }
docker image inspect $env:OVERVA_ROLLBACK_API_IMAGE --format '{{.Id}}'
docker image inspect $env:OVERVA_ROLLBACK_WEB_IMAGE --format '{{.Id}}'
docker compose @Rollback config --quiet
docker compose @Rollback up -d --no-build --no-deps web
for ($i=0; $i -lt 30; $i++) {
  if ((docker inspect overva-production-web-1 --format '{{.State.Health.Status}}') -eq 'healthy') { break }
  Start-Sleep -Seconds 2
}
if ((docker inspect overva-production-web-1 --format '{{.State.Health.Status}}') -ne 'healthy') { throw 'Rollback Web is not healthy' }
docker compose @Rollback up -d --no-build --no-deps api
for ($i=0; $i -lt 30; $i++) {
  if ((docker inspect overva-production-api-1 --format '{{.State.Health.Status}}') -eq 'healthy') { break }
  Start-Sleep -Seconds 2
}
if ((docker inspect overva-production-api-1 --format '{{.State.Health.Status}}') -ne 'healthy') { throw 'Rollback API is not healthy' }
docker exec overva-production-api-1 node scripts/session-smoke.js
Invoke-WebRequest -Uri 'https://app.overva.com/' -UseBasicParsing -TimeoutSec 20
Invoke-WebRequest -Uri 'https://api.overva.com/health' -UseBasicParsing -TimeoutSec 20
```

Expected image IDs are `$CurrentWebId` and `$CurrentApiId`; Web and API become
healthy; old session smoke passes; external App and API health return 200.
Caddy and DB are not restarted. Web rolls back first because the old Web is
compatible with both API versions; API follows because the old API is
compatible with phase-A schema and writes explicit unversioned transition
evidence.

If an image is absent locally, verify the recorded archive checksum, then use
`docker image load --input release-artifacts/api-$ReleaseId.tar` or the matching
Web archive before the commands above. Never fall back to `latest`.

### Rollback stop conditions

Do not application-rollback; stop traffic and forward-fix when any condition is
true:

- schema is not exactly `0080`, migration state is partial, or any candidate
  constraint is invalid;
- a phase-B strict version trigger exists;
- the preserved image ID differs from the release record or its archive
  checksum is unavailable;
- append-only mutation succeeds, tenant/pair isolation fails, or runtime event
  mutation privileges remain;
- the old API fails its session smoke against schema `0080`;
- a database restore would discard valid post-migration business events.

Once canonical events exist, schema rollback is forbidden. Correct defects with
an additive forward migration. Full database-plus-uploads restoration is only
for a separately approved catastrophic recovery with writes stopped, a fresh
pre-restore backup, new volumes, reconciliation, and an explicit traffic switch.

## Backup freshness and proof design

Current scheduler verification is useful but its healthcheck checks only that
`LATEST` and its directory exist. Also, `backup.sh` currently advances `LATEST`
before `verify-latest.sh` completes. A future additive operations change should:

- write a candidate backup, verify SHA-256, `pg_restore --list`, and upload tar,
  then atomically promote both `LATEST` and a `LAST_VERIFIED` marker;
- run full checksum validation after every scheduled backup and an independent
  verification at least every six hours;
- define daily-backup freshness as `fresh <= 26h`, `warning > 26h`, and
  `unhealthy > 30h`; missing/corrupt checksum evidence is immediately unhealthy;
- expose separate `process_health`, `backup_freshness`, and `restore_proof`
  fields rather than marking the API unhealthy for a warning;
- alert the operator on the first failed verification, at 26 hours without a
  verified backup, and urgently at 30 hours;
- require a successful isolated restore proof at least every 31 days for
  production release readiness.

This release does not change scheduler behavior. The latest backup used by this
release was independently verified and fully restored as recorded in
`PRODUCTION_RESTORE_REHEARSAL_20260831T110319Z.md`.
