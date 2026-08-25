#!/bin/sh
set -eu

test -f /backups/LATEST
backup_name="$(tr -d '\r\n' < /backups/LATEST)"
echo "$backup_name" | grep -Eq '^(overva|erp-v2)-[0-9]{8}T[0-9]{6}Z$'
backup_dir="/backups/$backup_name"
test -d "$backup_dir"

(cd "$backup_dir" && sha256sum -c SHA256SUMS)
pg_restore --list "$backup_dir/database.dump" >/dev/null
tar -tzf "$backup_dir/uploads.tar.gz" >/dev/null
echo "Backup verified: $backup_dir"
