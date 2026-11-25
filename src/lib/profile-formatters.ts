/**
 * Các hàm chuẩn hóa cú pháp cho Hồ sơ thành viên:
 * - Quá trình học tập, công tác: "Từ [năm] đến [năm]: [Nơi học tập, công tác]"
 * - Mạng xã hội theo danh mục nền tảng thông dụng
 * - Mẫu cú pháp chuẩn cho Thành tích học tập / NCKH và Thành tích công tác Đoàn
 */

export const SOCIAL_PLATFORMS = [
  "Facebook",
  "Instagram",
  "Locket",
  "Threads",
  "TikTok",
  "Zalo",
  "Khác",
] as const;

export type SocialPlatformOption = (typeof SOCIAL_PLATFORMS)[number];

export interface EducationEntry {
  fromYear: string;
  toYear: string;
  place: string;
  detail: string;
}

export interface SocialEntry {
  platform: string;
  customPlatform: string;
  handle: string;
}

/** Chuyển yyyy-mm-dd → dd/MM/yyyy */
export function formatDateInputVn(isoDate: string): string {
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Parse bản ghi education cũ/mới từ DB thành cấu trúc 4 ô gọn gàng */
export function parseEducationRecord(rec: { period?: string; school?: string; major?: string }): EducationEntry {
  const period = (rec.period ?? "").trim();
  let fromYear = "";
  let toYear = "";
  const vnMatch = period.match(/^Từ\s+(.+?)\s+đến\s+(.+)$/i);
  if (vnMatch) {
    fromYear = vnMatch[1].trim();
    toYear = vnMatch[2].trim();
  } else {
    const dashMatch = period.match(/^([^\-–—]+)\s*[\-–—]\s*(.+)$/);
    if (dashMatch) {
      fromYear = dashMatch[1].trim();
      toYear = dashMatch[2].trim();
    } else {
      fromYear = period;
    }
  }
  return {
    fromYear,
    toYear,
    place: (rec.school ?? "").trim(),
    detail: (rec.major ?? "").trim(),
  };
}

/** Định dạng hiển thị chuẩn: Từ [năm] đến [năm]: [Nơi học tập, công tác] */
export function formatEducationPeriod(fromYear: string, toYear: string): string {
  const from = fromYear.trim();
  const to = toYear.trim();
  if (from && to) return `Từ ${from} đến ${to}`;
  if (from) return `Từ ${from}`;
  if (to) return `Đến ${to}`;
  return "";
}

export function formatEducationPreview(entry: EducationEntry): string {
  const period = formatEducationPeriod(entry.fromYear, entry.toYear);
  const place = entry.place.trim();
  const detail = entry.detail.trim();
  const main = detail ? `${place} (${detail})` : place;
  if (period && main) return `${period}: ${main}`;
  return main || period;
}

export function serializeEducationEntry(entry: EducationEntry): { period: string; school: string; major: string } {
  return {
    period: formatEducationPeriod(entry.fromYear, entry.toYear),
    school: entry.place.trim(),
    major: entry.detail.trim(),
  };
}

export function parseSocialRecord(rec: { platform?: string; handle?: string }): SocialEntry {
  const rawPlatform = (rec.platform ?? "").trim();
  const matched = SOCIAL_PLATFORMS.find(
    (p) => p !== "Khác" && p.toLowerCase() === rawPlatform.toLowerCase(),
  );
  if (matched) {
    return { platform: matched, customPlatform: "", handle: (rec.handle ?? "").trim() };
  }
  return {
    platform: rawPlatform ? "Khác" : "Facebook",
    customPlatform: rawPlatform,
    handle: (rec.handle ?? "").trim(),
  };
}

/** Tách chuỗi thành tích lưu trong DB thành danh sách từng dòng (bỏ qua "Chưa có") */
export function parseAchievementLines(raw: string): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "chưa có") return [];
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== "chưa có");
}

export function serializeAchievementLines(lines: string[]): string {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  return clean.length === 0 ? "Chưa có" : clean.join("\n");
}

function buildDecisionClause(docType: string, docNumber: string, issuer: string, issueDate: string): string {
  const parts: string[] = [];
  if (docType.trim() && docNumber.trim()) {
    parts.push(`${docType.trim()} số ${docNumber.trim()}`);
  } else if (docNumber.trim()) {
    parts.push(`Số ${docNumber.trim()}`);
  }
  if (issuer.trim()) {
    parts.push(`do ${issuer.trim()} cấp`);
  }
  if (issueDate.trim()) {
    parts.push(`ngày ${formatDateInputVn(issueDate)}`);
  }
  if (parts.length === 0) return "";
  return ` (${parts.join(" ")})`;
}

export type YouthTemplateKind = "COMMENDATION" | "TITLE";

export interface YouthAchievementDraft {
  kind: YouthTemplateKind;
  awardType: string;
  content: string;
  schoolYear: string;
  level: string;
  docType: string;
  docNumber: string;
  issuer: string;
  issueDate: string;
}

export function formatYouthAchievement(d: YouthAchievementDraft): string {
  const decision = buildDecisionClause(d.docType, d.docNumber, d.issuer, d.issueDate);
  const yearText = d.schoolYear.trim() ? ` năm học ${d.schoolYear.trim()}` : "";
  const levelText = d.level.trim() ? ` cấp ${d.level.trim()}` : "";

  if (d.kind === "TITLE") {
    const titleName = d.content.trim();
    if (!titleName) return "";
    return `Đạt danh hiệu "${titleName}"${levelText}${yearText}${decision}`.trim();
  }

  const award = d.awardType.trim() || "Giấy khen";
  const content = d.content.trim() || "công tác Đoàn và phong trào thanh niên trường học";
  return `Được tặng ${award} có thành tích xuất sắc trong ${content}${yearText}${levelText}${decision}`.trim();
}

export type AcademicTemplateKind =
  | "COMPETITION"
  | "JOURNAL"
  | "CONFERENCE"
  | "BOOK"
  | "RESEARCH_PROJECT";

export interface AcademicAchievementDraft {
  kind: AcademicTemplateKind;
  // Chung / Cuộc thi
  prize: string;
  scope: string; // Cá nhân / Tập thể
  field: string;
  title: string; // Tên cuộc thi / Tên bài báo / Tên sách / Tên công trình
  level: string;
  schoolYear: string;
  // NCKH chuyên biệt
  authorRole: string;
  venue: string; // Tên tạp chí / Tên hội nghị, hội thảo / Nhà xuất bản
  issueOrCode: string; // Số/tập, ISSN/DOI/ISBN
  yearOrDate: string;
  // Văn bản công nhận
  docType: string;
  docNumber: string;
  issuer: string;
  issueDate: string;
}

export function formatAcademicAchievement(d: AcademicAchievementDraft): string {
  const title = d.title.trim();
  if (!title) return "";

  if (d.kind === "COMPETITION") {
    const prize = d.prize.trim() || "Khuyến khích";
    const scope = d.scope.trim() ? ` (${d.scope.trim()})` : "";
    const field = d.field.trim() ? ` lĩnh vực ${d.field.trim()}` : "";
    const level = d.level.trim() ? ` cấp ${d.level.trim()}` : "";
    const year = d.schoolYear.trim() ? ` năm học ${d.schoolYear.trim()}` : "";
    const decision = buildDecisionClause(d.docType, d.docNumber, d.issuer, d.issueDate);
    return `Đạt giải ${prize}${scope}${field} tại cuộc thi "${title}"${level}${year}${decision}`.trim();
  }

  if (d.kind === "JOURNAL") {
    const parts = [`Bài đăng tạp chí chuyên ngành: "${title}"`];
    if (d.authorRole.trim()) parts.push(`Vai trò: ${d.authorRole.trim()}`);
    if (d.venue.trim()) parts.push(`đăng trên ${d.venue.trim()}`);
    if (d.issueOrCode.trim()) parts.push(`(${d.issueOrCode.trim()})`);
    if (d.yearOrDate.trim()) parts.push(`năm ${d.yearOrDate.trim()}`);
    return parts.join(", ").replace(", (", " (");
  }

  if (d.kind === "CONFERENCE") {
    const parts = [`Bài đăng Kỷ yếu Hội nghị, Hội thảo: "${title}"`];
    if (d.authorRole.trim()) parts.push(`Vai trò: ${d.authorRole.trim()}`);
    if (d.venue.trim()) parts.push(`tại ${d.venue.trim()}`);
    if (d.level.trim()) parts.push(`cấp ${d.level.trim()}`);
    if (d.issuer.trim()) parts.push(`do ${d.issuer.trim()} tổ chức`);
    if (d.issueDate.trim()) parts.push(`ngày ${formatDateInputVn(d.issueDate)}`);
    if (d.issueOrCode.trim()) parts.push(`(${d.issueOrCode.trim()})`);
    return parts.join(", ").replace(", (", " (");
  }

  if (d.kind === "BOOK") {
    const parts = [`Sách: "${title}"`];
    if (d.authorRole.trim()) parts.push(`Vai trò: ${d.authorRole.trim()}`);
    if (d.venue.trim()) parts.push(`Nhà xuất bản ${d.venue.trim()}`);
    if (d.yearOrDate.trim()) parts.push(`năm xuất bản ${d.yearOrDate.trim()}`);
    if (d.issueOrCode.trim()) parts.push(`(ISBN: ${d.issueOrCode.trim()})`);
    return parts.join(", ").replace(", (", " (");
  }

  // RESEARCH_PROJECT
  const parts = [`Công trình nghiên cứu khoa học: "${title}"`];
  if (d.authorRole.trim()) parts.push(`Vai trò: ${d.authorRole.trim()}`);
  if (d.prize.trim()) parts.push(`kết quả: ${d.prize.trim()}`);
  if (d.level.trim()) parts.push(`cấp ${d.level.trim()}`);
  if (d.schoolYear.trim()) parts.push(`năm học ${d.schoolYear.trim()}`);
  const decision = buildDecisionClause(d.docType, d.docNumber, d.issuer, d.issueDate);
  return `${parts.join(", ")}${decision}`.trim();
}
