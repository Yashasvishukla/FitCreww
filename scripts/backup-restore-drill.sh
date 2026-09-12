#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the staging source database}"
: "${RESTORE_TARGET_URL:?Set RESTORE_TARGET_URL to an isolated restore target}"
: "${ALLOW_RESTORE:?Set ALLOW_RESTORE=YES to run the destructive restore step}"

if [[ "${ALLOW_RESTORE}" != "YES" ]]; then
  echo "Refusing to restore: set ALLOW_RESTORE=YES only for an isolated staging target." >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./artifacts/backup-drill}"
mkdir -p "${backup_dir}"
backup_file="${backup_dir}/fitcrew-$(date -u +%Y%m%dT%H%M%SZ).dump"

echo "Creating compressed PostgreSQL backup..."
pg_dump --format=custom --no-owner --no-acl --file="${backup_file}" "${SOURCE_DATABASE_URL}"
pg_restore --list "${backup_file}" >/dev/null

echo "Restoring into the explicitly supplied staging target..."
pg_restore --clean --if-exists --no-owner --no-acl --dbname="${RESTORE_TARGET_URL}" "${backup_file}"

echo "Running restore smoke checks..."
psql "${RESTORE_TARGET_URL}" -v ON_ERROR_STOP=1 -c 'SELECT 1 FROM platform.tenant LIMIT 1;' -c 'SELECT 1 FROM public.tenant_config LIMIT 1;' -c "SELECT CASE WHEN EXISTS (SELECT 1 FROM public.tenant_config) THEN 1 ELSE 0 END AS tenant_config_present;"
echo "Backup/restore drill completed: ${backup_file}"
