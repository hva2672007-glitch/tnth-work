#!/usr/bin/env bash
# Khôi phục bộ backup DB + kho tệp private vào môi trường test hoặc sự cố.
# BẮT BUỘC kiểm tra manifest SHA-256 trước khi khôi phục. Không tự chạy vào DB cổng thông tin!
set -euo pipefail

BACKUP_DIR="${1:-}"
TARGET_DB_URL="${2:-${DATABASE_URL:-}}"
TARGET_UPLOADS_DIR="${3:-${UPLOAD_DIR:-./uploads-restored}}"

if [[ -z "$BACKUP_DIR" || -z "$TARGET_DB_URL" ]]; then
  echo "Cách dùng: bash scripts/restore.sh <thư_mục_backup> <DATABASE_URL_đích> [thư_mục_uploads_đích]"
  exit 1
fi

echo "[1/3] Kiểm tra toàn vẹn manifest SHA-256..."
(cd "$BACKUP_DIR" && shasum -a 256 -c manifest.sha256)

echo "[2/3] Khôi phục PostgreSQL..."
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DB_URL" "$BACKUP_DIR/db.dump"

if [[ -f "$BACKUP_DIR/uploads.tar.gz" ]]; then
  echo "[3/3] Khôi phục kho tệp private vào $TARGET_UPLOADS_DIR..."
  mkdir -p "$TARGET_UPLOADS_DIR"
  tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C "$TARGET_UPLOADS_DIR"
fi

echo "Hoàn tất khôi phục. Hãy kiểm tra /api/v1/health/ready và xác minh tải file mẫu."
