export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Định dạng thời gian chuẩn Việt Nam: dd/MM/yyyy HH:mm */
export function formatVnDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`;
}

/** Định dạng ngày Việt Nam: dd/MM/yyyy */
export function formatVnDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.day}/${map.month}/${map.year}`;
}

/** Chuẩn hóa timestamp xuống phút UTC (bỏ giây/ms) để so sánh trước/đúng/trễ hạn nhất quán */
export function toUtcMinute(value: string | Date): number {
  const date = typeof value === "string" ? new Date(value) : value;
  return Math.floor(date.getTime() / 60_000);
}

export type TimelinessResult = "EARLY" | "ON_TIME" | "LATE";

/**
 * Phân loại trước/đúng/trễ hạn chính xác theo phút (mục 10.2):
 * - submittedMinute < deadlineMinute => EARLY (Trước hạn)
 * - submittedMinute === deadlineMinute => ON_TIME (Đúng hạn)
 * - submittedMinute > deadlineMinute => LATE (Trễ hạn)
 */
export function classifyTimeliness(submittedAt: string | Date, deadline: string | Date): TimelinessResult {
  const subMin = toUtcMinute(submittedAt);
  const dueMin = toUtcMinute(deadline);
  if (subMin < dueMin) return "EARLY";
  if (subMin === dueMin) return "ON_TIME";
  return "LATE";
}

/** Overdue bắt đầu ngay sau phút deadline (mục 10.2) */
export function isOverdueAt(deadline: string | Date, now: Date = new Date()): boolean {
  return toUtcMinute(now) > toUtcMinute(deadline);
}

/** Khoảng [start, end) của tháng YYYY-MM theo múi giờ Asia/Ho_Chi_Minh (+07:00) */
export function vnMonthRange(year: number, month: number): { start: Date; end: Date; periodKey: string; label: string } {
  const mm = String(month).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMm = String(nextMonth).padStart(2, "0");
  const start = new Date(`${year}-${mm}-01T00:00:00+07:00`);
  const end = new Date(`${nextYear}-${nextMm}-01T00:00:00+07:00`);
  return {
    start,
    end,
    periodKey: `${year}-${mm}`,
    label: `Tháng ${mm}/${year}`,
  };
}

/** Lấy năm/tháng hiện tại theo giờ Việt Nam */
export function currentVnYearMonth(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month) };
}

/** Chuyển giá trị datetime-local (giờ Việt Nam) sang ISO UTC */
export function vnLocalInputToIso(value: string): string {
  if (!value) return "";
  // Nếu đã có timezone offset hoặc Z thì giữ nguyên
  if (/[Zz]|[+-]\d{2}:\d{2}$/.test(value)) {
    return new Date(value).toISOString();
  }
  const normalized = value.length === 16 ? `${value}:00+07:00` : `${value}+07:00`;
  return new Date(normalized).toISOString();
}

/** Chuyển ISO/Date sang chuỗi YYYY-MM-DDTHH:mm theo giờ Việt Nam cho input datetime-local */
export function isoToVnLocalInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

/**
 * Tính lần chạy kế tiếp của lịch định kỳ (giờ VN +07:00).
 * Ngày 29-31 của tháng ngắn hơn được kẹp về ngày cuối tháng (mục 7.7).
 */
export function computeNextOccurrence(params: {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  intervalCount: number;
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  runTime: string; // HH:mm
  from: Date;
}): Date {
  const [hhStr, minStr] = (params.runTime || "08:00").split(":");
  const hh = Number(hhStr) || 8;
  const min = Number(minStr) || 0;
  const step = Math.max(1, params.intervalCount || 1);

  // Chuyển from sang thành phần lịch VN (+07:00)
  const vnMs = params.from.getTime() + 7 * 60 * 60 * 1000;
  const d = new Date(vnMs);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (params.frequency === "DAILY") {
    const next = new Date(Date.UTC(y, m - 1, day + step, hh, min, 0));
    return new Date(next.getTime() - 7 * 60 * 60 * 1000);
  }
  if (params.frequency === "WEEKLY") {
    const next = new Date(Date.UTC(y, m - 1, day + step * 7, hh, min, 0));
    return new Date(next.getTime() - 7 * 60 * 60 * 1000);
  }
  if (params.frequency === "MONTHLY") {
    const totalMonths = (m - 1) + step;
    y += Math.floor(totalMonths / 12);
    m = (totalMonths % 12) + 1;
    const targetDay = params.dayOfMonth ?? day;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const clampedDay = Math.min(targetDay, daysInMonth);
    const next = new Date(Date.UTC(y, m - 1, clampedDay, hh, min, 0));
    return new Date(next.getTime() - 7 * 60 * 60 * 1000);
  }
  // YEARLY
  y += step;
  const targetMonth = params.monthOfYear ?? m;
  const targetDay = params.dayOfMonth ?? day;
  const daysInMonth = new Date(Date.UTC(y, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(targetDay, daysInMonth);
  const next = new Date(Date.UTC(y, targetMonth - 1, clampedDay, hh, min, 0));
  return new Date(next.getTime() - 7 * 60 * 60 * 1000);
}
