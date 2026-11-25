export type MemberRole = "HEAD" | "ACTING_HEAD" | "DEPUTY" | "TEAM_LEAD" | "MEMBER";
export type ActivityStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE";
export type TeamTitle = "MEMBER" | "LEADER" | "DEPUTY_LEADER";

export type UrgencyLevel = "FLASH" | "VERY_URGENT" | "URGENT" | "NORMAL";
export type ImportanceLevel = "KEY" | "NORMAL";
export type CompletionMode = "TASKS_ONLY" | "TASKS_AND_PUBLICATIONS" | "PUBLICATIONS_ONLY";
export type SubmissionMode = "INDIVIDUAL" | "SHARED";

export type MissionStatus =
  | "DRAFT"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_REVIEW"
  | "AWAITING_PUBLICATION"
  | "COMPLETED"
  | "ON_HOLD"
  | "CANCELLED";

export type TaskStatus =
  | "DRAFT"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REVISION_REQUIRED"
  | "COMPLETED"
  | "ON_HOLD"
  | "CANCELLED";

export type AssignmentStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "SUBMITTED"
  | "REVISION_REQUIRED"
  | "COMPLETED"
  | "TRANSFERRED"
  | "CANCELLED";

export type ApprovalType = "REGULATION_AMENDMENT" | "ROLE_PROMOTION_HEAD";
export type ApprovalStatus = "PENDING" | "READY_TO_APPLY" | "APPLIED" | "REJECTED" | "CANCELLED" | "STALE";

export const ROLE_LABELS: Record<MemberRole, { code: string; name: string; full: string }> = {
  HEAD: { code: "Bậc 01.01", name: "Trưởng Ban Biên tập", full: "Bậc 01.01 — Trưởng Ban Biên tập" },
  ACTING_HEAD: { code: "Bậc 01.02", name: "Quyền Trưởng Ban Biên tập", full: "Bậc 01.02 — Quyền Trưởng Ban Biên tập" },
  DEPUTY: { code: "Bậc 02", name: "Phó Trưởng Ban Biên tập", full: "Bậc 02 — Phó Trưởng Ban Biên tập" },
  TEAM_LEAD: { code: "Bậc 03", name: "Trưởng, Phó Tổ chuyên môn", full: "Bậc 03 — Trưởng, Phó Tổ chuyên môn" },
  MEMBER: { code: "Bậc 04", name: "Thành viên (Mem)", full: "Bậc 04 — Thành viên" },
};

export const TEAM_TITLE_LABELS: Record<TeamTitle, string> = {
  LEADER: "Trưởng Tổ",
  DEPUTY_LEADER: "Phó Tổ",
  MEMBER: "Thành viên tổ",
};

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  ACTIVE: "Đang hoạt động",
  ON_LEAVE: "Tạm dừng vì lý do cá nhân",
  INACTIVE: "Đã dừng hoạt động",
};

export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  FLASH: "Hỏa tốc",
  VERY_URGENT: "Thượng khẩn",
  URGENT: "Khẩn",
  NORMAL: "Thông thường",
};

export const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
  KEY: "Trọng tâm",
  NORMAL: "Thông thường",
};

export const COMPLETION_MODE_LABELS: Record<CompletionMode, string> = {
  TASKS_ONLY: "Hoàn thành khi đủ tất cả task",
  TASKS_AND_PUBLICATIONS: "Hoàn thành khi đủ task và đủ link đăng tải",
  PUBLICATIONS_ONLY: "Hoàn thành theo link đăng tải (ngoại lệ nguồn)",
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  DRAFT: "Nháp",
  ASSIGNED: "Đã giao, chưa thực hiện",
  IN_PROGRESS: "Đang thực hiện",
  AWAITING_REVIEW: "Chờ nghiệm thu",
  AWAITING_PUBLICATION: "Chờ đăng tải",
  COMPLETED: "Đã hoàn thành",
  ON_HOLD: "Tạm hoãn",
  CANCELLED: "Đã hủy",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  DRAFT: "Nháp",
  ASSIGNED: "Đã giao, chưa nhận",
  IN_PROGRESS: "Đang thực hiện",
  SUBMITTED: "Chờ nghiệm thu",
  REVISION_REQUIRED: "Cần chỉnh sửa",
  COMPLETED: "Đã hoàn thành",
  ON_HOLD: "Tạm hoãn",
  CANCELLED: "Đã hủy",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "Chờ nhận việc",
  ACCEPTED: "Đang thực hiện",
  DECLINED: "Đã từ chối",
  SUBMITTED: "Đã nộp, chờ duyệt",
  REVISION_REQUIRED: "Cần sửa lại",
  COMPLETED: "Đã hoàn thành",
  TRANSFERRED: "Đã chuyển giao",
  CANCELLED: "Đã hủy",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Đang chờ đồng xác nhận",
  READY_TO_APPLY: "Đủ phiếu, chờ áp dụng",
  APPLIED: "Đã áp dụng",
  REJECTED: "Đã từ chối",
  CANCELLED: "Đã hủy",
  STALE: "Cần lập lại (danh sách cử tri đổi)",
};

/**
 * Mức độ khẩn cấp chuẩn hóa theo mục 7.4:
 * - Hỏa tốc: <= 3 giờ (bao gồm < 1 giờ)
 * - Thượng khẩn: > 3 đến 12 giờ
 * - Khẩn: > 12 đến 48 giờ
 * - Thông thường: > 48 giờ
 */
export function suggestUrgency(assignedAt: Date, deadline: Date): UrgencyLevel {
  const diffHours = (deadline.getTime() - assignedAt.getTime()) / (1000 * 60 * 60);
  if (diffHours <= 3) return "FLASH";
  if (diffHours <= 12) return "VERY_URGENT";
  if (diffHours <= 48) return "URGENT";
  return "NORMAL";
}

/** Mốc nhắc deadline mặc định (phút trước hạn) theo mục 9 */
export const DEFAULT_REMINDER_OFFSETS_MINUTES: Record<UrgencyLevel, number[]> = {
  FLASH: [30, 10],
  VERY_URGENT: [120, 30],
  URGENT: [360, 60],
  NORMAL: [1440, 120],
};

/** Ngưỡng SLA tiếp nhận & duyệt (phút) theo mục 10.3 */
export const DEFAULT_SLA_MINUTES: Record<UrgencyLevel, number> = {
  FLASH: 30,
  VERY_URGENT: 120,
  URGENT: 360,
  NORMAL: 1440,
};

export const WEIGHT_OPTIONS = [1, 2, 3, 5, 8] as const;

export const SEED_TEAMS = [
  { code: "NOI_DUNG", name: "Tổ Xây dựng Nội dung", sort_order: 1 },
  { code: "PHONG_VIEN", name: "Tổ Phóng viên – Công tác cơ sở", sort_order: 2 },
  { code: "MEDIA", name: "Tổ Media", sort_order: 3 },
  { code: "KY_THUAT", name: "Tổ Kỹ thuật", sort_order: 4 },
  { code: "CONG_TAC_35", name: "Tổ Công tác 35", sort_order: 5 },
  { code: "VIETGENIUS", name: "Tổ VietGENIUS", sort_order: 6 },
  { code: "THAM_TRA", name: "Tổ Thẩm tra – Giám sát", sort_order: 7 },
] as const;

export const SEED_CHANNELS = [
  { code: "FB_TW_DOAN", name: "Trang cộng đồng Facebook Cổng thông tin Trung ương Đoàn TNCS Hồ Chí Minh", allow_custom_name: false, sort_order: 1 },
  { code: "FB_TNTH", name: "Trang cộng đồng Facebook Thanh niên Trường học", allow_custom_name: false, sort_order: 2 },
  { code: "IG_TNTH", name: "Trang cộng đồng Instagram Thanh niên Trường học", allow_custom_name: false, sort_order: 3 },
  { code: "TIKTOK_TNTH", name: "Trang cộng đồng TikTok Thanh niên Trường học", allow_custom_name: false, sort_order: 4 },
  { code: "FB_ANH_SAO", name: "Trang cộng đồng Facebook Ánh Sao", allow_custom_name: false, sort_order: 5 },
  { code: "WEB_TNTH", name: "Trang web Thanh niên Trường học", allow_custom_name: false, sort_order: 6 },
  { code: "FB_DOI_TTTH", name: "Trang cộng đồng Facebook Đội Công tác Truyền thông Trường học", allow_custom_name: false, sort_order: 7 },
  { code: "OTHER", name: "Khác", allow_custom_name: true, sort_order: 8 },
] as const;
