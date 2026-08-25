#!/bin/sh
set -u
interval="${MONITOR_INTERVAL_SECONDS:-60}"
while true; do
  now="$(date -u +%FT%TZ)"
  if pg_isready -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && wget -q -T 5 -O /dev/null http://api:4100/health; then
    echo "$now status=healthy"
  else
    echo "$now status=unhealthy" >&2
  fi
  sleep "$interval"
done
