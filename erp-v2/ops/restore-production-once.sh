#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE is required}"

PGPASSWORD="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
export PGPASSWORD

table_count="$(psql --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --tuples-only --no-align \
  --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'")"
if [ "$table_count" != "0" ]; then
  echo "Refusing production restore: target database already has $table_count public tables." >&2
  exit 1
fi

backup_name="${BACKUP_NAME:-$(tr -d '\r\n' < /backups/LATEST)}"
echo "$backup_name" | grep -Eq '^(overva|erp-v2)-[0-9]{8}T[0-9]{6}Z$'
backup_dir="/backups/$backup_name"
test -d "$backup_dir"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)

if find /target/uploads -mindepth 1 -print -quit | grep -q .; then
  echo "Refusing production restore: uploads target is not empty." >&2
  exit 1
fi

pg_restore --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --no-owner --no-privileges --exit-on-error --single-transaction "$backup_dir/database.dump"
tar -xzf "$backup_dir/uploads.tar.gz" -C /target/uploads

echo "Production restore completed from $backup_name."
