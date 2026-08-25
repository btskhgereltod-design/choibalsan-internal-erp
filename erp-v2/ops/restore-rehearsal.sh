#!/bin/sh
set -eu

: "${TARGET_DATABASE:?TARGET_DATABASE is required and must be a new rehearsal database}"
case "$TARGET_DATABASE" in
  overva_restore_[a-zA-Z0-9_]*) ;;
  *) echo "TARGET_DATABASE must start with overva_restore_" >&2; exit 1 ;;
esac
if [ "$TARGET_DATABASE" = "$POSTGRES_DB" ]; then
  echo "Refusing to restore over the configured live database" >&2
  exit 1
fi

if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  PGPASSWORD="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
else
  PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is required}"
fi
export PGPASSWORD

backup_name="${BACKUP_NAME:-$(tr -d '\r\n' < /backups/LATEST)}"
echo "$backup_name" | grep -Eq '^(overva|erp-v2)-[0-9]{8}T[0-9]{6}Z$'
backup_dir="/backups/$backup_name"
test -d "$backup_dir"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

createdb --host=db --username="$POSTGRES_USER" "$TARGET_DATABASE"
pg_restore --host=db --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" \
  --no-owner --no-privileges --exit-on-error --single-transaction "$backup_dir/database.dump"

restore_dir="/restore-rehearsal/$backup_name"
mkdir "$restore_dir"
tar -xzf "$backup_dir/uploads.tar.gz" -C "$restore_dir"
echo "Restore rehearsal completed: database=$TARGET_DATABASE uploads=$restore_dir"
