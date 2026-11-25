# Tài liệu API nội bộ (`/api/v1`) — `tnth-work`

Mọi endpoint trừ `/api/v1/health/*`, `/api/v1/auth/me`, `/api/v1/auth/callback` và `/api/v1/auth/mock-login` (chỉ dev/test) đều yêu cầu cookie phiên `tnth_work_session` hợp lệ và kiểm tra phân quyền tại server qua `src/server/authorization/policy.ts`.

## Quy ước phản hồi
- Thành công: `{"data": ...}`
- Lỗi: `{"error": {"code": "...", "message": "Thông báo tiếng Việt an toàn", "requestId": "uuid", "fields": {...}}}`
- Mã trạng thái chuẩn: `200`, `201`, `400`, `401`, `403`, `404`, `409` (xung đột version / state / idempotency), `413`, `415`, `503`, `507`.
- Các mutation hỗ trợ header `Idempotency-Key` chống click lặp (`POST /missions`, `POST /tasks/:id/submissions`, `POST /submission-versions/:id/{approve,request-revision}`).

## Danh sách endpoints

| Nhóm | Endpoint | Mô tả |
|---|---|---|
| Health | `GET /api/v1/health/live`, `GET /api/v1/health/ready` | Kiểm tra sống & sẵn sàng DB/storage (không lộ dữ liệu) |
| Auth | `GET /api/v1/auth/me`, `GET /api/v1/auth/callback`, `POST /api/v1/auth/logout` | Phiên đăng nhập, đổi code SSO, thu hồi phiên |
| Auth (Dev) | `GET/POST /api/v1/auth/mock-login` | Chỉ hoạt động khi `PORTAL_AUTH_MODE=mock` (bị chặn ở production) |
| Tích hợp nguồn | `GET /api/v1/integration/accounts?q=...` | Tra cứu tài khoản cổng thông tin nguồn (01.01, 02) |
| Tích hợp nguồn | `GET/POST /api/v1/integration/portal-permission-requests`, `POST .../resolve` | Yêu cầu & xác nhận phân công quản trị cổng thông tin nguồn |
| Thành viên | `GET /api/v1/members`, `GET /api/v1/members/:id`, `PATCH /api/v1/members/:id/profile` | Danh bạ, hồ sơ chi tiết, cập nhật trường được phép |
| Quyền & Tổ | `POST /api/v1/members/access`, `POST /api/v1/members/:id/access/revoke`, `POST /api/v1/members/:id/activity`, `POST /api/v1/members/:id/teams` | Cấp/thu hồi quyền, đổi tình trạng hoạt động, cập nhật tổ chính/phụ |
| Danh mục | `GET/POST /api/v1/teams`, `PATCH /api/v1/teams/:id`, `GET/POST /api/v1/groups`, `PATCH /api/v1/groups/:id`, `GET/POST /api/v1/channels`, `PATCH /api/v1/channels/:id` | Quản trị 7 tổ, khối nhiệm vụ, 8 kênh đăng tải |
| Nhiệm vụ | `GET/POST /api/v1/missions`, `GET/PATCH /api/v1/missions/:id` | Danh sách nhóm theo khối, tạo nháp/giao ngay, chi tiết, sửa có `version` |
| Vòng đời | `POST /api/v1/missions/:id/{assign,hold,resume,cancel,reopen,complete}` | Giao bản nháp, hoãn, tiếp tục, hủy, mở lại, xác nhận hoàn thành |
| Phân công | `POST /api/v1/assignments/:id/{accept,decline,transfer}`, `GET /api/v1/my-work` | Nhận/từ chối/chuyển giao, màn Việc của tôi & hàng chờ nghiệm thu |
| Tệp & Sản phẩm | `GET/POST /api/v1/files`, `GET /api/v1/files/:id/download`, `POST /api/v1/tasks/:id/submissions`, `POST /api/v1/submission-versions/:id/{approve,request-revision}` | Kho tệp private, nộp sản phẩm nhiều phiên bản, nghiệm thu/trả sửa |
| Đăng tải & Trao đổi | `POST /api/v1/missions/:id/publications`, `PATCH /api/v1/publications/:id`, `POST /api/v1/missions/:id/comments` | Cập nhật & xác nhận link kênh đăng tải, bình luận `@mention` |
| Định kỳ | `GET/POST /api/v1/recurring-schedules`, `PATCH /api/v1/recurring-schedules/:id` | Lịch nhiệm vụ định kỳ tuần/tháng/năm và chạy job thủ công |
| Báo cáo | `GET /api/v1/dashboard`, `GET /api/v1/bottlenecks`, `GET /api/v1/kpi`, `POST /api/v1/kpi/periods/:id/{finalize,reopen}`, `GET /api/v1/reports/export` | Tổng quan real-time, điểm nghẽn B01–B11, KPI 60/40, xuất Excel `.xlsx` |
| Quy chế & Phê duyệt | `GET/POST /api/v1/regulations`, `GET/POST /api/v1/approvals`, `POST /api/v1/approvals/:id/{vote,apply,cancel}` | Quy chế, đồng xác nhận sửa quy chế và nâng Bậc 01.02 → 01.01 |
| Thông báo & Hệ thống | `GET/POST /api/v1/notifications`, `PATCH /api/v1/notifications/:id/read`, `GET/PATCH /api/v1/settings`, `GET /api/v1/audit-logs` | Chuông thông báo, cấu hình KPI/SLA, nhật ký audit |
