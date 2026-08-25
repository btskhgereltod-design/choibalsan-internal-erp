#!/bin/sh
set -eu

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="/backups/.partial-${timestamp}"
final="/backups/overva-${timestamp}"

cleanup() {
  case "$partial" in /backups/.partial-*) rm -rf -- "$partial" ;; esac
}
trap cleanup EXIT INT TERM

mkdir -p "$partial"
if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
  PGPASSWORD="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
else
  PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is required}"
fi
export PGPASSWORD
pg_dump --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --file="$partial/database.dump"
tar -czf "$partial/uploads.tar.gz" -C /source/uploads .

cat > "$partial/metadata.txt" <<EOF
created_at_utc=${timestamp}
database=${POSTGRES_DB}
format=postgres-custom-plus-uploads-tar-gz
EOF

(cd "$partial" && sha256sum database.dump uploads.tar.gz metadata.txt > SHA256SUMS)
mv "$partial" "$final"
printf '%s\n' "$(basename "$final")" > /backups/LATEST.tmp
mv /backups/LATEST.tmp /backups/LATEST
trap - EXIT INT TERM
echo "Backup created: $final"
