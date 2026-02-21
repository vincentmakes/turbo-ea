#!/usr/bin/env bash
# Back up the PostgreSQL database to a timestamped SQL dump.
#
# Usage:
#   ./scripts/backup-db.sh                    # Uses .env defaults
#   ./scripts/backup-db.sh -o /path/to/dir    # Custom output directory
#
# Requires: pg_dump (install via: apt install postgresql-client)
# The dump is plain SQL (not custom format) for maximum portability.
#
# Restore with:
#   psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB < backup.sql
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Defaults (match docker-compose.yml)
PGHOST="${POSTGRES_HOST:-localhost}"
PGPORT="${POSTGRES_PORT:-5432}"
PGUSER="${POSTGRES_USER:-turboea}"
PGDATABASE="${POSTGRES_DB:-turboea}"
OUTPUT_DIR="${PROJECT_ROOT}/backups"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -o|--output) OUTPUT_DIR="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="turboea_${TIMESTAMP}.sql"
FILEPATH="${OUTPUT_DIR}/${FILENAME}"

echo "Backing up ${PGDATABASE}@${PGHOST}:${PGPORT} → ${FILEPATH}"

PGPASSWORD="${POSTGRES_PASSWORD:-turboea}" pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --no-owner \
    --no-acl \
    -f "$FILEPATH"

# Compress
gzip "$FILEPATH"
echo "Backup complete: ${FILEPATH}.gz ($(du -h "${FILEPATH}.gz" | cut -f1))"
