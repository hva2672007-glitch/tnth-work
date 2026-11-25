#!/usr/bin/env bash
# Sao lưu nhất quán DB tnth_work + kho tệp nội bộ private với manifest SHA-256.
# Cần cấu hình thêm bước đẩy mã hóa ra ngoài máy chủ (vd restic/rclone) trước production.
set -euo pipefail
umask 077

BACKUP_ROOT="${WORK_BACKUP_DIR:-/var/backups/tnth-work}"
UPLOADS_SRC="${UPLOAD_DIR:-/srv/tnth-work/uploads}"
DB_NAME="${WORK_DB_NAME:-tnth_work}"
DB_USER="${WORK_DB_USER:-postgres}"
PG_CONTAINER="${PG_CONTAINER:-tnth-db-1}"
KEEP_DAYS="${KEEP_DAYS:-14}"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_ROOT/$STAMP"
mkdir -p "$TARGET"

echo "[1/3] Sao lưu PostgreSQL ($DB_NAME)..."
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
  docker exec -i "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom > "$TARGET/db.dump"
else
  pg_dump "${DATABASE_URL:?Thiếu DATABASE_URL}" --format=custom --file="$TARGET/db.dump"
fi

echo "[2/3] Sao lưu kho tệp private ($UPLOADS_SRC)..."
if [[ -d "$UPLOADS_SRC" ]]; then
  tar -czf "$TARGET/uploads.tar.gz" -C "$UPLOADS_SRC" .
else
  echo "Cảnh báo: Thư mục $UPLOADS_SRC chưa tồn tại, bỏ qua gói uploads."
fi

echo "[3/3] Tạo manifest SHA-256..."
(cd "$TARGET" && shasum -a 256 * > manifest.sha256)

find "$BACKUP_ROOT" -maxdepth 1 -mindepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "Hoàn tất sao lưu tại: $TARGET"
