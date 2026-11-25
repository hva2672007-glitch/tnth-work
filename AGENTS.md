# AGENTS.md — Web Phân công Công việc Ban Biên tập Thanh niên Trường học (`tnth-work`)

- Nguồn yêu cầu chính thức: [`WEB_PHAN_CONG_SPEC.md`](./WEB_PHAN_CONG_SPEC.md)
- Quyết định kiến trúc, giả định phát triển và các điểm cần xác minh production: [`docs/DECISIONS.md`](./docs/DECISIONS.md)
- Repository cổng thông tin tham chiếu (read-only, không ghi đè): `../Website-Thanh-ni-n-Tr-ng-h-c`

## Nguyên tắc cốt lõi
1. Tất cả quyền truy cập phải kiểm tra tại server qua `src/server/authorization/policy.ts` (`can`, `requirePermission`, `scopeMissionQuery`).
2. Không cho phép `PORTAL_AUTH_MODE=mock` hoặc `DATABASE_URL=pglite://...` trong production.
3. Không trả dữ liệu demo giả lập khi DB lỗi; fail-closed theo đặc tả.
4. Một hàm duy nhất tính trạng thái, độ khẩn, điểm nghẽn và KPI dùng chung giữa UI, API và xuất Excel.
5. Chạy `npm run typecheck`, `npm run lint`, `npm run test:all`, `npm run build` để kiểm chứng trước khi bàn giao.
