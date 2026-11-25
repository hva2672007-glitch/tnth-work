# Hướng dẫn Vận hành, Triển khai & Khôi phục (`RUNBOOK.md`)

## 1. Preflight trên máy chủ trước khi triển khai chung (Bắt buộc)
Người có quyền vận hành máy chủ cổng thông tin kiểm tra các chỉ số sau trước khi deploy `tnth-work`:
- Bộ nhớ & CPU: `free -h`, `uptime`, `docker stats --no-stream`
- Ổ đĩa & phân vùng: `df -h` (đảm bảo dư tối thiểu 20% headroom sau khi cấp quota 5GB cho `/srv/tnth-work/uploads`)
- Kết nối PostgreSQL hiện tại và cấu hình `max_connections`
- DNS & WAF OneShield cho subdomain dự kiến `work.thanhnientruonghoc.io.vn`

## 2. Tạo Database & User riêng (tách biệt hoàn toàn với DB cổng thông tin)
Chạy bởi quản trị viên PostgreSQL trên instance hiện có:
```sql
CREATE ROLE tnth_work LOGIN PASSWORD 'THAY_BANG_MAT_KHAU_MANH';
CREATE DATABASE tnth_work OWNER tnth_work ENCODING 'UTF8';
REVOKE ALL ON DATABASE tnth_prod FROM tnth_work;
```
Không cấp quyền đọc/ghi của `tnth_work` sang database cổng thông tin.

## 3. Tạo kho tệp private & cấu hình môi trường
```bash
sudo mkdir -p /srv/tnth-work/uploads
sudo chown -R 1000:1000 /srv/tnth-work/uploads
sudo chmod 700 /srv/tnth-work/uploads
```
Tạo `.env.production` (quyền `600`, không commit vào Git) dựa trên `.env.example`:
- `APP_ENV=production`
- `DATABASE_URL=postgres://tnth_work:...@127.0.0.1:5432/tnth_work?sslmode=disable`
- `PORTAL_AUTH_MODE=sso` (hoặc `bridge` theo thỏa thuận với quản trị viên nguồn)
- `PORTAL_CLIENT_ID`, `PORTAL_CLIENT_SECRET`, `PORTAL_ALLOWED_REDIRECT_URI`

## 4. Migration, Seed tham chiếu & Bootstrap Trưởng Ban (01.01)
```bash
npm run db:migrate
npm run db:seed
ALLOW_HEAD_BOOTSTRAP=true node scripts/bootstrap-head.mjs <externalAccountId> <username> "<Họ và tên>"
```
Sau khi bootstrap thành công, đảm bảo `ALLOW_HEAD_BOOTSTRAP=false`.

## 5. Triển khai Docker Compose & Caddy
1. Build & khởi động container `work-web` (không mở 80/443, chỉ bind `127.0.0.1:3001`):
   ```bash
   docker compose build && docker compose up -d
   ```
2. Kiểm tra health:
   ```bash
   curl -fsS http://127.0.0.1:3001/api/v1/health/live
   curl -fsS http://127.0.0.1:3001/api/v1/health/ready
   ```
3. Bổ sung block `https://work.thanhnientruonghoc.io.vn` từ `deploy/Caddyfile.work.example` vào Caddyfile hiện hữu và reload Caddy. **Tuyệt đối không mở `file_server` cho `/srv/tnth-work/uploads`.**
4. Cài đặt cron job chạy nhắc deadline & nhiệm vụ định kỳ mỗi phút:
   ```cron
   * * * * * docker compose -f /opt/tnth-work/docker-compose.yml exec -T work-web npm run jobs:run >> /var/log/tnth-work-jobs.log 2>&1
   ```

## 6. Sao lưu & Khôi phục (Backup / Restore)
- Chạy hằng đêm (cùng lúc khóa dọn orphan): `bash scripts/backup.sh`
- Đồng bộ thư mục `/var/backups/tnth-work` sang kho lưu trữ mã hóa **ngoài máy chủ** (ví dụ `restic` hoặc `rclone` mã hóa).
- Kiểm thử restore định kỳ vào DB/thư mục test:
  ```bash
  bash scripts/restore.sh /var/backups/tnth-work/<timestamp> <TEST_DATABASE_URL> /tmp/work-uploads-test
  ```

## 7. Rollback nhanh khi lỗi deploy
1. Dừng container mới hoặc quay lại tag image cũ (`tnth-work:previous`).
2. Không tự chạy `DROP TABLE` trên production; chỉ restore từ bản dump trước migration nếu thực sự cần và đã có xác nhận của người vận hành.
