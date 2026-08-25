#!/bin/sh
set -eu
interval="${BACKUP_INTERVAL_SECONDS:-86400}"
case "$interval" in *[!0-9]*|'') echo "Invalid BACKUP_INTERVAL_SECONDS"; exit 1;; esac
if [ "$interval" -lt 300 ]; then echo "Backup interval must be at least 300 seconds"; exit 1; fi
while true; do
  if /bin/sh /ops/backup.sh && /bin/sh /ops/verify-latest.sh; then
    echo "Scheduled backup completed and verified at $(date -u +%FT%TZ)"
  else
    echo "Scheduled backup failed at $(date -u +%FT%TZ)" >&2
  fi
  sleep "$interval"
done
