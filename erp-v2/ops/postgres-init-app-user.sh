#!/bin/sh
set -eu

: "${POSTGRES_APP_USER:?POSTGRES_APP_USER is required}"
echo "$POSTGRES_APP_USER" | grep -Eq '^[a-z_][a-z0-9_]{2,62}$'
: "${POSTGRES_APP_PASSWORD_FILE:?POSTGRES_APP_PASSWORD_FILE is required}"
app_password="$(tr -d '\r\n' < "$POSTGRES_APP_PASSWORD_FILE")"
test "${#app_password}" -ge 32

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_user="$POSTGRES_APP_USER" --set=app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'app_user') \gexec
SQL
