# Ma trận Phân quyền & Quy tắc Bảo mật (`PERMISSIONS.md`)

Tất cả kiểm tra quyền được tập trung duy nhất tại `src/server/authorization/policy.ts` (`can`, `canAssignToMember`, `requirePermission`, `buildMissionScopeClause`).

## 1. Năm cấp bậc Ban Biên tập
- `HEAD` — **Bậc 01.01**: Trưởng Ban Biên tập (tối đa 01 tài khoản hiệu lực).
- `ACTING_HEAD` — **Bậc 01.02**: Quyền Trưởng Ban Biên tập (tối đa 01 tài khoản hiệu lực).
- `DEPUTY` — **Bậc 02**: Phó Trưởng Ban Biên tập.
- `TEAM_LEAD` — **Bậc 03**: Trưởng, Phó Tổ chuyên môn (gắn phạm vi tổ qua `team_memberships`).
- `MEMBER` — **Bậc 04**: Thành viên (Mem) — 01 tổ chính, nhiều tổ phụ.

## 2. Quy tắc trọng yếu được cưỡng chế tại Server
1. **Deny-by-default**: Mọi endpoint private từ chối mặc định nếu không xác định được phiên, thành viên bị thu hồi quyền (`access_enabled=false`) hoặc tài khoản cổng nguồn bị khóa/vô hiệu hóa (`LOCKED`/`DISABLED`/`PENDING`).
2. **Cấp và thu hồi quyền**:
   - `01.01` cấp quyền từ `01.02` trở xuống, thu hồi `02/03/04`.
   - `01.02` chỉ đọc (read-only) hồ sơ thành viên người khác; không tự thêm/bỏ khối nhiệm vụ.
   - `02` thu hồi `03/04`, đề xuất và áp dụng cuối việc nâng `01.02 → 01.01` sau khi đạt đồng thuận **100% toàn bộ tài khoản Bậc 03**.
   - `03` thu hồi `04` trong tổ mình lãnh đạo; có ngoại lệ gốc **được giao việc cho Bậc 01/02** nhưng **không** nhờ vậy mà xem/sửa hồ sơ cấp trên hoặc nhiệm vụ ngoài phạm vi.
   - `04` chỉ tự sửa hồ sơ cá nhân, không tự sửa cấp bậc hay tình trạng hoạt động.
3. **Chống tự nghiệm thu**: Người nộp sản phẩm không bao giờ được duyệt phiên bản do chính mình nộp, kể cả khi giữ chức vụ `HEAD` hoặc `TEAM_LEAD`.
4. **Quyền tải tệp nội bộ**: Mọi tệp nằm ngoài `public/`, tải qua `/api/v1/files/:id/download` sau khi kiểm tra thành viên thuộc cùng mission hoặc có phạm vi lãnh đạo phù hợp. Thành viên thuộc các task khác nhau trong **cùng một mission** xem được sản phẩm của nhau để phối hợp, nhưng bị chặn hoàn toàn với tệp của mission khác.
5. **Quy chế & Đồng xác nhận**:
   - `01.01` sửa quy chế → cần `02` đồng xác nhận.
   - `01.02` sửa quy chế → cần `02` và `03` đồng xác nhận (2 người khác nhau).
   - `02` sửa quy chế → cần `01.01` đồng xác nhận.
   - `02` nâng `01.02 → 01.01` → cần **100% toàn bộ Bậc 03** đang giữ chức vụ hiệu lực; nếu danh sách Bậc 03 thay đổi trong lúc chờ, yêu cầu tự chuyển `STALE`.
