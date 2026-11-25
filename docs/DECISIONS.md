# Quyết định kiến trúc, giả định & điểm cần xác minh (`DECISIONS.md`)

Tài liệu này ghi nhận các quyết định kỹ thuật theo mục 0.1, 3 và 20 của `WEB_PHAN_CONG_SPEC.md`.

## 1. Cấu trúc repository độc lập
- **Quyết định:** Khởi tạo `tnth-work/` là một repository độc lập (`git init -b main`), đặt song song với repository tham chiếu `Website-Thanh-ni-n-Tr-ng-h-c` (giữ nguyên không ghi đè).
- **Lý do:** Đảm bảo tách biệt hoàn toàn mã nguồn, database (`tnth_work`), cookie phiên (`tnth_work_session`), kho tệp nội bộ (`/srv/tnth-work/uploads`) và Docker Compose project (`tnth-work`), không ảnh hưởng cổng thông tin đang vận hành.

## 2. Xác minh từ repository tham chiếu `Website-Thanh-ni-n-Tr-ng-h-c`
Qua kiểm tra trực tiếp mã nguồn nhánh `main` (commit `010d946`):
- Cổng thông tin dùng Next.js 16 (App Router, `output: "standalone"`), React 19, Tailwind CSS v4 (bảng màu `doan` xanh `#2563eb`), PostgreSQL 16 qua `pg`, Docker Compose + Caddy + OneShield.
- Xác thực nguồn dùng bảng `accounts` (khóa chính dạng số), mật khẩu băm `scrypt`, phiên cookie `tnth_session` lưu SHA-256 trong `auth_sessions`.
- **Điểm quan trọng phát hiện trong code nguồn:**
  - `src/lib/server/auth.ts` tự động mở khóa tài khoản `LOCKED` khi đăng nhập. `tnth-work` **không** kế thừa hành vi này: mọi trạng thái `LOCKED`/`DISABLED`/`PENDING` từ nguồn đều bị từ chối truy cập.
  - `src/app/api/accounts/[id]/permissions/route.ts` dùng bảng `account_permissions` theo cơ chế **thay thế toàn bộ quyền mặc định** (`effectivePermissions`). Vì vậy luồng phân công quản trị cổng thông tin trong `tnth-work` tách riêng nhiệm vụ với yêu cầu kỹ thuật (`portal_permission_requests`) và không bao giờ tự ghi đè danh sách quyền nguồn.
  - Kho `/uploads` của cổng thông tin được Caddy phục vụ công khai (`file_server`). `tnth-work` tuyệt đối **không** dùng chung thư mục này; toàn bộ tệp của `tnth-work` nằm ngoài public root và chỉ tải qua `/api/v1/files/:id/download` sau khi kiểm tra object-level authorization.

## 3. Chiến lược Database cho dev/test và production
- **Production & Docker:** PostgreSQL 16 qua thư viện `pg` (`DATABASE_URL=postgres://...`), pool tối đa mặc định 5 kết nối, chạy SQL migrations bất biến trong `db/migrations/`.
- **Local dev & CI không cần cài PostgreSQL/Docker:** Hỗ trợ `@electric-sql/pglite` (PostgreSQL biên dịch WebAssembly, hỗ trợ đầy đủ SQL PostgreSQL: UUID, JSONB, TIMESTAMPTZ, NUMERIC, CHECK, partial unique indexes, transactions) khi `DATABASE_URL=pglite://...`.
- **Ràng buộc an toàn:** `src/server/config.ts` chặn cứng (`throw`) nếu `APP_ENV=production` hoặc `NODE_ENV=production` mà cấu hình `pglite://` hoặc `PORTAL_AUTH_MODE=mock`.

## 4. Tích hợp tài khoản cổng thông tin (Cần phối hợp trước production)
- **Hiện trạng đã triển khai:**
  - `PortalIdentityProvider` contract (`exchangeCode`, `getAccountStatus`, `searchAccounts`, `requestPortalPermissionChange`).
  - `MockPortalAdapter`: chỉ hoạt động ở `development`/`test` với tập tài khoản mô phỏng (bao gồm cả tài khoản đã cấp quyền và chưa cấp quyền để kiểm thử tra cứu + chặn truy cập).
  - `HttpPortalAdapter`: khung tích hợp production theo phương án A (SSO Authorization Code + PKCE/state + backchannel exchange) có timeout, không log token, kiểm tra trạng thái nguồn tối đa mỗi 5 phút và fail-closed khi mất kết nối quá ngưỡng.
- **Blockers / Chưa xác minh ở môi trường production `[CẦN XÁC MINH]`:**
  1. Cổng thông tin `thanhnientruonghoc.io.vn` hiện chưa có endpoint OAuth2/OIDC hoặc SSO bridge chính thức trong mã nguồn `main`. Cần quản trị viên cổng thông tin phê duyệt và bổ sung endpoint ủy quyền server-to-server (hoặc xác nhận endpoint xác thực fallback).
  2. Chưa có credential, `PORTAL_CLIENT_ID`, `PORTAL_CLIENT_SECRET`, DNS/WAF OneShield cho subdomain dự kiến `work.thanhnientruonghoc.io.vn`.
  3. Chưa có số liệu tài nguyên thực tế (`free -h`, `df -h`, `docker stats`) và kho backup mã hóa ngoài máy chủ.
  4. Chưa có API chính thức cấp quyền `account_permissions` từ xa → luồng `portal_permission_requests` hỗ trợ quy trình duyệt & xác nhận thủ công có bằng chứng và audit làm fallback được ghi rõ.

## 5. Các mặc định nghiệp vụ `[MẶC ĐỊNH]` (chưa phải quy chế đã Ban thông qua)
- Một cấp bậc chính hiệu lực cho mỗi thành viên; tối đa 1 `HEAD` và 1 `ACTING_HEAD` đang hiệu lực (ràng buộc partial unique index ở PostgreSQL).
- Trưởng và Phó Tổ chuyên môn (`LEADER`, `DEPUTY_LEADER`) có quyền mặc định như nhau trong phạm vi tổ mình lãnh đạo.
- Người nộp sản phẩm không thể tự nghiệm thu sản phẩm của chính mình.
- Ba chế độ hoàn thành nhiệm vụ (`TASKS_ONLY`, `TASKS_AND_PUBLICATIONS`, `PUBLICATIONS_ONLY` chỉ dành cho 01.01/01.02/02 có ghi lý do).
- Công thức KPI mặc định: `KPI = 0.6 * CompletionRate + 0.4 * (100 * W_on_time / W_total)` theo phút đánh giá của `effective_submitted_at`; `W_total = 0` trả `N/A`; hỗ trợ cấu hình trọng số mới cho kỳ tương lai.
- Ngưỡng đồng xác nhận sửa quy chế mặc định 1 người đại diện mỗi nhóm (trừ nâng 01.02 → 01.01 bắt buộc 100% toàn bộ tài khoản Bậc 03 đang giữ chức vụ hiệu lực, không cho hạ ngưỡng).
- Thời điểm lưu trữ DB bằng UTC (`timestamptz`), hiển thị giao diện và xuất Excel theo `Asia/Ho_Chi_Minh` (`dd/MM/yyyy HH:mm`).
