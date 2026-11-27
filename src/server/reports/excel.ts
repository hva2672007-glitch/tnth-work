import ExcelJS from "exceljs";
import { query } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { buildMissionScopeClause, isWorkerRole } from "@/server/authorization/policy";
import { getKpiReport } from "@/server/reports/kpi";
import { detectBottlenecks } from "@/server/reports/bottlenecks";
import { writeAudit } from "@/server/audit/service";
import {
  ASSIGNMENT_STATUS_LABELS,
  IMPORTANCE_LABELS,
  MISSION_STATUS_LABELS,
  TASK_STATUS_LABELS,
  URGENCY_LABELS,
  type AssignmentStatus,
  type ImportanceLevel,
  type MissionStatus,
  type TaskStatus,
  type UrgencyLevel,
} from "@/lib/constants";
import { classifyTimeliness, formatVnDateTime } from "@/lib/date";

/** Chống Excel Formula Injection (mục 10.4): prefix nháy đơn nếu ô text bắt đầu =, +, -, @, tab, CR */
export function sanitizeExcelCell(value: unknown): string | number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function styleHeaderRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

export async function generateReportWorkbook(
  actor: AuthActor,
  options?: {
    periodKey?: string;
    allTime?: boolean;
    groupId?: string;
    teamId?: string;
    compact?: boolean;
  },
  requestId?: string,
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const kpi = await getKpiReport(actor, { periodKey: options?.periodKey, teamId: options?.teamId });
  const bottlenecks = await detectBottlenecks(actor, { teamId: options?.teamId, groupId: options?.groupId });

  const scope = buildMissionScopeClause(actor, 1);
  const params: unknown[] = [...scope.params];
  const where: string[] = [scope.clause];
  if (isWorkerRole(actor.role)) where.push(`m.status <> 'DRAFT'`);
  if (!options?.allTime) {
    params.push(kpi.period.startAt, kpi.period.endAt);
    where.push(`m.deadline_current >= $${params.length - 1} AND m.deadline_current < $${params.length}`);
  }
  if (options?.groupId) {
    params.push(options.groupId);
    where.push(`m.group_id = $${params.length}`);
  }
  if (options?.teamId) {
    params.push(options.teamId);
    where.push(`EXISTS (SELECT 1 FROM mission_teams mt WHERE mt.mission_id = m.id AND mt.team_id = $${params.length})`);
  }

  // Sắp xếp nhiệm vụ thuộc cùng khối LIÊN TỤC (mục 10.4 & yêu cầu gốc Word!)
  const rows = await query<{
    group_name: string;
    mission_code: string;
    mission_title: string;
    mission_status: MissionStatus;
    task_code: string;
    task_title: string;
    task_status: TaskStatus;
    team_name: string;
    supervisors: string | null;
    assignee_name: string | null;
    assignment_status: AssignmentStatus | null;
    urgency: UrgencyLevel;
    importance: ImportanceLevel;
    original_deadline: Date;
    current_deadline: Date;
    effective_submitted_at: Date | null;
    reviewed_at: Date | null;
    weight: string | number | null;
    product_links: string | null;
    note: string | null;
  }>(
    `SELECT tg.name AS group_name,
            m.code AS mission_code, m.title AS mission_title, m.status AS mission_status,
            t.code AS task_code, t.title AS task_title, t.status AS task_status,
            tm.name AS team_name,
            (SELECT string_agg(sm.display_name, ', ') FROM task_supervisors ts JOIN members sm ON sm.id = ts.member_id WHERE ts.task_id = t.id) AS supervisors,
            am.display_name AS assignee_name,
            ta.status AS assignment_status,
            t.urgency, t.importance,
            COALESCE(ta.original_deadline, t.deadline_original) AS original_deadline,
            COALESCE(ta.evaluation_deadline, t.deadline_current) AS current_deadline,
            ta.effective_submitted_at, ta.reviewed_at,
            COALESCE(ta.weight, t.weight) AS weight,
            (SELECT string_agg(pl.url, ' | ')
             FROM mission_publication_requirements r
             JOIN publication_links pl ON pl.requirement_id = r.id
             WHERE r.mission_id = m.id AND pl.active = true) AS product_links,
            COALESCE(ta.decline_reason, ta.transfer_reason, m.hold_reason, m.cancel_reason, '') AS note
     FROM missions m
     JOIN task_groups tg ON tg.id = m.group_id
     LEFT JOIN tasks t ON t.mission_id = m.id
     LEFT JOIN teams tm ON tm.id = t.owner_team_id
     LEFT JOIN task_assignments ta ON ta.task_id = t.id
     LEFT JOIN members am ON am.id = ta.member_id
     WHERE ${where.join(" AND ")}
     ORDER BY tg.sort_order ASC, tg.name ASC, m.deadline_current ASC, m.code ASC, t.sort_order ASC, am.display_name ASC
     LIMIT 5000`,
    params,
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = "Web Phân công Ban Biên tập TNTH";
  wb.created = new Date();

  // Sheet 1: Tổng quan
  if (!options?.compact) {
    const sOverview = wb.addWorksheet("Tổng quan");
    sOverview.columns = [
      { header: "Chỉ số", key: "metric", width: 38 },
      { header: "Giá trị", key: "value", width: 32 },
    ];
    styleHeaderRow(sOverview);
    sOverview.addRows([
      { metric: "Kỳ báo cáo", value: sanitizeExcelCell(options?.allTime ? "Toàn thời gian" : kpi.period.label) },
      { metric: "Thời điểm xuất (giờ Việt Nam)", value: formatVnDateTime(new Date()) },
      { metric: "Người xuất báo cáo", value: sanitizeExcelCell(actor.displayName) },
      { metric: "Trạng thái kỳ KPI", value: kpi.period.status === "FINALIZED" ? `Đã chốt (Rev ${kpi.period.revision})` : "Đang mở (tạm tính)" },
      { metric: "Chính sách KPI áp dụng", value: `${kpi.policy.versionCode} (${kpi.policy.completionWeight}% hoàn thành / ${kpi.policy.ontimeWeight}% đúng hạn)` },
      { metric: "Tổng dòng phân công xuất", value: rows.length },
      { metric: "Tổng điểm nghẽn đang ghi nhận", value: bottlenecks.items.length },
    ]);
  }

  // Sheet 2: Task & phân công (nhóm cùng Khối nhiệm vụ liên tục)
  const sTasks = wb.addWorksheet("Task & phân công");
  sTasks.columns = [
    { header: "STT", key: "stt", width: 6 },
    { header: "Khối nhiệm vụ", key: "groupName", width: 26 },
    { header: "Mã nhiệm vụ", key: "missionCode", width: 15 },
    { header: "Tên nhiệm vụ", key: "missionTitle", width: 34 },
    { header: "Mã task", key: "taskCode", width: 18 },
    { header: "Tên task", key: "taskTitle", width: 30 },
    { header: "Tổ phụ trách", key: "teamName", width: 24 },
    { header: "Thường vụ phụ trách", key: "supervisors", width: 22 },
    { header: "Người thực hiện", key: "assigneeName", width: 22 },
    { header: "Mức khẩn", key: "urgency", width: 14 },
    { header: "Phân loại nội dung", key: "importance", width: 16 },
    { header: "Deadline gốc", key: "originalDeadline", width: 18 },
    { header: "Deadline hiện tại", key: "currentDeadline", width: 18 },
    { header: "Trạng thái", key: "status", width: 20 },
    { header: "Nộp lúc", key: "submittedAt", width: 18 },
    { header: "Nghiệm thu lúc", key: "reviewedAt", width: 18 },
    { header: "Trước/đúng/trễ hạn", key: "timeliness", width: 18 },
    { header: "Link đăng tải", key: "links", width: 32 },
    { header: "Điểm khối lượng", key: "weight", width: 14 },
    { header: "Ghi chú", key: "note", width: 26 },
  ];
  styleHeaderRow(sTasks);

  rows.forEach((r, idx) => {
    let timelinessText = "—";
    if (r.effective_submitted_at) {
      const t = classifyTimeliness(r.effective_submitted_at, r.current_deadline);
      timelinessText = t === "EARLY" ? "Trước hạn" : t === "ON_TIME" ? "Đúng hạn" : "Trễ hạn";
    }
    const statusText = r.assignment_status
      ? ASSIGNMENT_STATUS_LABELS[r.assignment_status]
      : r.task_status
        ? TASK_STATUS_LABELS[r.task_status]
        : MISSION_STATUS_LABELS[r.mission_status];

    sTasks.addRow({
      stt: idx + 1,
      groupName: sanitizeExcelCell(r.group_name),
      missionCode: sanitizeExcelCell(r.mission_code),
      missionTitle: sanitizeExcelCell(r.mission_title),
      taskCode: sanitizeExcelCell(r.task_code ?? ""),
      taskTitle: sanitizeExcelCell(r.task_title ?? ""),
      teamName: sanitizeExcelCell(r.team_name ?? ""),
      supervisors: sanitizeExcelCell(r.supervisors ?? ""),
      assigneeName: sanitizeExcelCell(r.assignee_name ?? ""),
      urgency: URGENCY_LABELS[r.urgency] ?? r.urgency,
      importance: IMPORTANCE_LABELS[r.importance] ?? r.importance,
      originalDeadline: formatVnDateTime(r.original_deadline),
      currentDeadline: formatVnDateTime(r.current_deadline),
      status: statusText,
      submittedAt: formatVnDateTime(r.effective_submitted_at),
      reviewedAt: formatVnDateTime(r.reviewed_at),
      timeliness: timelinessText,
      links: sanitizeExcelCell(r.product_links ?? ""),
      weight: r.weight !== null ? Number(r.weight) : 0,
      note: sanitizeExcelCell(r.note ?? ""),
    });
  });

  if (!options?.compact) {
    // Sheet 3: KPI cá nhân (KHÔNG xuất ngày sinh, SĐT, địa chỉ - mục 10.4)
    const sKpi = wb.addWorksheet("KPI cá nhân");
    sKpi.columns = [
      { header: "Mã TV", key: "code", width: 12 },
      { header: "Họ và tên", key: "name", width: 24 },
      { header: "Tổ chính", key: "team", width: 26 },
      { header: "Tổng khối lượng", key: "eligibleWeight", width: 16 },
      { header: "KL hoàn thành", key: "completedWeight", width: 16 },
      { header: "KL đúng/trước hạn", key: "ontimeWeight", width: 18 },
      { header: "Điểm cộng (HĐĐH/SK/SL)", key: "bonusPoints", width: 20 },
      { header: "Trước hạn", key: "early", width: 11 },
      { header: "Đúng hạn", key: "onTime", width: 11 },
      { header: "Trễ hạn (HT)", key: "late", width: 12 },
      { header: "Số lần trễ hạn", key: "lateCount", width: 14 },
      { header: "Số lần chuyển giao", key: "transferredCount", width: 16 },
      { header: "Chờ duyệt", key: "pendingReview", width: 11 },
      { header: "Chưa nộp", key: "unsubmitted", width: 11 },
      { header: "Từ chối", key: "declined", width: 11 },
      { header: "Tỷ lệ HT (%)", key: "compRate", width: 14 },
      { header: "Tỷ lệ ĐH (%)", key: "ontimeRate", width: 14 },
      { header: "Điểm KPI", key: "score", width: 12 },
    ];
    styleHeaderRow(sKpi);
    for (const m of kpi.members) {
      sKpi.addRow({
        code: sanitizeExcelCell(m.memberCode),
        name: sanitizeExcelCell(m.displayName),
        team: sanitizeExcelCell(m.primaryTeamName),
        eligibleWeight: m.eligibleWeight,
        completedWeight: m.completedWeight,
        ontimeWeight: m.ontimeWeight,
        bonusPoints: m.bonus?.totalBonusCompleted ?? 0,
        early: m.counts.early,
        onTime: m.counts.onTime,
        late: m.counts.lateCompleted,
        lateCount: m.lateCount ?? 0,
        transferredCount: m.transferredCount ?? 0,
        pendingReview: m.counts.pendingReview,
        unsubmitted: m.counts.unsubmitted,
        declined: m.counts.declined,
        compRate: m.completionRate ?? "N/A",
        ontimeRate: m.ontimeRate ?? "N/A",
        score: m.score ?? "N/A",
      });
    }

    // Sheet 4: KPI tổ
    const sTeam = wb.addWorksheet("KPI tổ");
    sTeam.columns = [
      { header: "Tổ chuyên môn", key: "teamName", width: 32 },
      { header: "Số thành viên", key: "memberCount", width: 14 },
      { header: "Tổng khối lượng", key: "eligibleWeight", width: 16 },
      { header: "KL hoàn thành", key: "completedWeight", width: 16 },
      { header: "KL đúng hạn", key: "ontimeWeight", width: 16 },
      { header: "KPI TB", key: "avgScore", width: 12 },
    ];
    styleHeaderRow(sTeam);
    for (const t of kpi.teamSummaries) {
      sTeam.addRow({
        teamName: sanitizeExcelCell(t.teamName),
        memberCount: t.memberCount,
        eligibleWeight: t.eligibleWeight,
        completedWeight: t.completedWeight,
        ontimeWeight: t.ontimeWeight,
        avgScore: t.avgScore ?? "N/A",
      });
    }

    // Sheet 5: Điểm nghẽn
    const sBot = wb.addWorksheet("Điểm nghẽn");
    sBot.columns = [
      { header: "Mã", key: "code", width: 8 },
      { header: "Loại điểm nghẽn", key: "label", width: 26 },
      { header: "Mức độ", key: "severity", width: 12 },
      { header: "Đối tượng", key: "title", width: 36 },
      { header: "Nguyên nhân ghi nhận", key: "cause", width: 42 },
      { header: "Đầu mối xử lý", key: "responsible", width: 28 },
    ];
    styleHeaderRow(sBot);
    for (const b of bottlenecks.items) {
      sBot.addRow({
        code: b.code,
        label: sanitizeExcelCell(b.label),
        severity: b.severity === "HIGH" ? "Cao" : "Trung bình",
        title: sanitizeExcelCell(b.title),
        cause: sanitizeExcelCell(b.cause),
        responsible: sanitizeExcelCell(b.responsibleName),
      });
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filename = `bao-cao-phan-cong-${kpi.period.periodKey}.xlsx`;

  await writeAudit({
    actorId: actor.memberId,
    action: "REPORT_EXCEL_EXPORTED",
    targetType: "REPORT",
    targetId: kpi.period.periodKey,
    safeDiff: {
      periodKey: kpi.period.periodKey,
      allTime: Boolean(options?.allTime),
      groupId: options?.groupId ?? null,
      teamId: options?.teamId ?? null,
      compact: Boolean(options?.compact),
      rowCount: rows.length,
    },
    requestId,
  });

  return { buffer, filename, rowCount: rows.length };
}
