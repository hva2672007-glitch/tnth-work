# Web Phân công Công việc Ban Biên tập — Thanh niên Trường học (`tnth-work`)

Ứng dụng web nội bộ cho Ban Biên tập Thanh niên Trường học (~20 thành viên, dự phòng 50–100 tài khoản): số hóa toàn bộ quy trình giao việc, nhận/từ chối, nộp sản phẩm (link/file/folder), nghiệm thu, cập nhật kênh đăng tải, phát hiện điểm nghẽn, tính KPI, xuất báo cáo Excel, quy chế đồng xác nhận và liên kết tài khoản với `thanhnientruonghoc.io.vn`.

- Đặc tả nghiệp vụ đầy đủ: [`WEB_PHAN_CONG_SPEC.md`](./WEB_PHAN_CONG_SPEC.md)
- Quyết định kiến trúc, giả định & điểm cần xác minh production: [`docs/DECISIONS.md`](./docs/DECISIONS.md)
- Hướng dẫn vận hành, triển khai, backup & rollback: [`docs/RUNBOOK.md`](./docs/RUNBOOK.md)

## Khởi chạy local nhanh (không cần cài PostgreSQL hay Docker)

```bash
npm install
npm run db:migrate
npm run db:seed:demo
npm run dev
```

Mở trình duyệt tại `http://localhost:3001`.

> Ở chế độ local development (`.env.local`), hệ thống mặc định dùng `DATABASE_URL=pglite://./.data/pglite` (PostgreSQL biên dịch WebAssembly) và `PORTAL_AUTH_MODE=mock` với bộ tài khoản mẫu đủ 5 cấp bậc (`01.01`, `01.02`, `02`, `03`, `04`) cùng các tài khoản nguồn chưa được cấp quyền / bị khóa để kiểm thử.
>
> **Trong môi trường production**, ứng dụng tự động **chặn khởi động** nếu cấu hình `PORTAL_AUTH_MODE=mock` hoặc `DATABASE_URL=pglite://...`.

## Các lệnh phát triển & kiểm thử

| Lệnh | Công dụng |
|---|---|
| `npm run dev` | Chạy Next.js dev server tại cổng `3001` |
| `npm run build` | Build production (Next.js standalone) |
| `npm run start` | Chạy bản production đã build |
| `npm run typecheck` | Kiểm tra TypeScript strict (`tsc --noEmit`) |
| `npm run lint` | Kiểm tra ESLint |
| `npm test` | Chạy Unit Tests (`tests/unit`) |
| `npm run test:integration` | Chạy PostgreSQL Integration Tests (`tests/integration`) |
| `npm run test:all` | Chạy toàn bộ Unit + Integration tests |
| `npm run db:migrate` | Chạy SQL migrations trong `db/migrations/` (idempotent) |
| `npm run db:seed` | Nạp dữ liệu tham chiếu production (7 tổ, 8 kênh, KPI policy 60/40, SLA) |
| `npm run db:seed:demo` | Nạp dữ liệu demo phát triển (bị chặn ở production) |
| `npm run jobs:run` | Chạy quét nhắc deadline, cảnh báo quá hạn và sinh nhiệm vụ định kỳ |
| `npm run bootstrap:head` | Khởi tạo tài khoản Trưởng Ban Biên tập (`01.01`) lần đầu (chạy một lần) |

## Trạng thái tích hợp cổng thông tin nguồn

- Hợp đồng adapter (`PortalIdentityProvider`) và `HttpPortalAdapter` đã sẵn sàng cho phương án SSO / Authorization Code server-to-server.
- **Chưa hoàn tất kết nối production**: cần quản trị viên cổng `thanhnientruonghoc.io.vn` cung cấp endpoint xác thực ủy quyền, `PORTAL_CLIENT_ID`, `PORTAL_CLIENT_SECRET`, cấu hình DNS/TLS cho subdomain (dự kiến `work.thanhnientruonghoc.io.vn`) và chạy preflight tài nguyên máy chủ theo [`docs/RUNBOOK.md`](./docs/RUNBOOK.md).
