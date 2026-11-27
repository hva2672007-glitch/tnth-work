import { query, queryOne, withTransaction } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { can, isBoardLeadership, isObserverRole, isTeamLeadership, requirePermission } from "@/server/authorization/policy";
import { writeAudit } from "@/server/audit/service";
import { AppError } from "@/server/errors";
import { classifyTimeliness, currentVnYearMonth, vnMonthRange } from "@/lib/date";
import type { MemberRole } from "@/lib/constants";

export interface KpiAssignmentInput {
  assignmentId: string;
  taskId: string;
  taskCode: string;
  taskTitle: string;
  missionCode: string;
  status: string;
  weight: number;
  originalDeadline: string;
  evaluationDeadline: string;
  effectiveSubmittedAt: string | null;
  reviewedAt: string | null;
  exclusionReason: string | null;
  lateAgainstOriginalDeadline: boolean;
}

export interface KpiBonusBreakdown {
  conductReports: number;
  councilSubmissions: number;
  councilOpinions: number;
  councilOpinionsOntime: number;
  councilConclusions: number;
  metricPoints: number;
  initiativePoints: number;
  totalBonusEligible: number;
  totalBonusCompleted: number;
  totalBonusOntime: number;
}

export interface KpiMemberSummary {
  memberId: string;
  memberCode: string;
  displayName: string;
  role: MemberRole;
  primaryTeamName: string;
  eligibleWeight: number;
  completedWeight: number;
  ontimeWeight: number;
  completionRate: number | null;
  ontimeRate: number | null;
  score: number | null;
  lateCount: number;
  transferredCount: number;
  bonus: KpiBonusBreakdown;
  counts: {
    total: number;
    completed: number;
    early: number;
    onTime: number;
    lateCompleted: number;
    pendingReview: number;
    unsubmitted: number;
    declined: number;
    excluded: number;
    lateCount?: number;
    transferredCount?: number;
  };
  items: Array<
    KpiAssignmentInput & {
      includedInDenominator: boolean;
      timeliness: "EARLY" | "ON_TIME" | "LATE" | "PENDING_REVIEW" | "INCOMPLETE" | "EXCLUDED" | "DECLINED";
    }
  >;
}

const EMPTY_BONUS: KpiBonusBreakdown = {
  conductReports: 0,
  councilSubmissions: 0,
  councilOpinions: 0,
  councilOpinionsOntime: 0,
  councilConclusions: 0,
  metricPoints: 0,
  initiativePoints: 0,
  totalBonusEligible: 0,
  totalBonusCompleted: 0,
  totalBonusOntime: 0,
};

/**
 * Hàm tính KPI thuần túy dùng chung cho UI, API, chốt kỳ và xuất Excel (mục 10.2 + 5 quy tắc KPI V2):
 * - CompletionRate = 100 * W_completed / W_total
 * - OnTimeRate = 100 * W_on_time / W_completed (khi W_completed > 0)
 * - KPI = (wComp/100) * CompletionRate + (wOnTime/100) * (100 * W_on_time / W_total)
 * - Nếu W_total === 0 => score = null (N/A)
 * - Thời điểm hoàn thành = effectiveSubmittedAt (KHÔNG dùng reviewedAt)
 */
export function computeKpiFromAssignments(
  assignments: KpiAssignmentInput[],
  policy: { completionWeight: number; ontimeWeight: number } = { completionWeight: 60, ontimeWeight: 40 },
  bonus: KpiBonusBreakdown = EMPTY_BONUS,
) {
  let eligibleWeight = bonus.totalBonusEligible;
  let completedWeight = bonus.totalBonusCompleted;
  let ontimeWeight = bonus.totalBonusOntime;
  let lateCount = 0;
  let transferredCount = 0;
  const nowMs = Date.now();

  const counts = {
    total: 0,
    completed: 0,
    early: 0,
    onTime: 0,
    lateCompleted: 0,
    pendingReview: 0,
    unsubmitted: 0,
    declined: 0,
    excluded: 0,
    lateCount: 0,
    transferredCount: 0,
  };

  const items = assignments.map((a) => {
    if (a.status === "TRANSFERRED") {
      transferredCount++;
    }
    // Loại trừ bản ghi đã chuyển giao / hủy do tổ chức có lý do hợp lệ
    if (a.status === "TRANSFERRED" || a.status === "CANCELLED" || a.exclusionReason) {
      counts.excluded++;
      return { ...a, includedInDenominator: false, timeliness: "EXCLUDED" as const };
    }
    // Assignment bị từ chối chờ phân công lại không tự phạt điểm chưa có quy chế (mục 10.2)
    if (a.status === "DECLINED") {
      counts.declined++;
      return { ...a, includedInDenominator: false, timeliness: "DECLINED" as const };
    }

    counts.total++;
    eligibleWeight += a.weight;

    if (a.status === "COMPLETED" && a.effectiveSubmittedAt) {
      counts.completed++;
      completedWeight += a.weight;
      const timeliness = classifyTimeliness(a.effectiveSubmittedAt, a.evaluationDeadline);
      if (timeliness === "EARLY") {
        counts.early++;
        ontimeWeight += a.weight;
        if (a.lateAgainstOriginalDeadline) lateCount++;
      } else if (timeliness === "ON_TIME") {
        counts.onTime++;
        ontimeWeight += a.weight;
        if (a.lateAgainstOriginalDeadline) lateCount++;
      } else {
        counts.lateCompleted++;
        lateCount++;
      }
      return { ...a, includedInDenominator: true, timeliness };
    }

    if (a.status === "SUBMITTED") {
      counts.pendingReview++;
      if (a.lateAgainstOriginalDeadline) lateCount++;
      return { ...a, includedInDenominator: true, timeliness: "PENDING_REVIEW" as const };
    }

    counts.unsubmitted++;
    if (new Date(a.evaluationDeadline).getTime() < nowMs || a.lateAgainstOriginalDeadline) {
      lateCount++;
    }
    return { ...a, includedInDenominator: true, timeliness: "INCOMPLETE" as const };
  });

  counts.lateCount = lateCount;
  counts.transferredCount = transferredCount;

  const round2 = (v: number) => Math.round(v * 100) / 100;
  const wTotal = round2(eligibleWeight);
  const wCompleted = round2(completedWeight);
  const wOnTime = round2(ontimeWeight);

  if (wTotal === 0) {
    return {
      eligibleWeight: 0,
      completedWeight: 0,
      ontimeWeight: 0,
      completionRate: null,
      ontimeRate: null,
      score: null,
      lateCount,
      transferredCount,
      bonus,
      counts,
      items,
    };
  }

  const completionRate = round2((100 * wCompleted) / wTotal);
  const ontimeRate = wCompleted > 0 ? round2((100 * wOnTime) / wCompleted) : null;
  const ontimeContribution = (100 * wOnTime) / wTotal;
  const rawScore = (policy.completionWeight / 100) * completionRate + (policy.ontimeWeight / 100) * ontimeContribution;
  const score = round2(Math.min(100, Math.max(0, rawScore)));

  return {
    eligibleWeight: wTotal,
    completedWeight: wCompleted,
    ontimeWeight: wOnTime,
    completionRate,
    ontimeRate,
    score,
    lateCount,
    transferredCount,
    bonus,
    counts,
    items,
  };
}

export async function ensureKpiPeriod(periodKey?: string) {
  const { year: curY, month: curM } = currentVnYearMonth();
  let y = curY;
  let m = curM;
  if (periodKey && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [ys, ms] = periodKey.split("-");
    y = Number(ys);
    m = Number(ms);
  }
  const range = vnMonthRange(y, m);

  const existing = await queryOne<{
    id: string;
    period_key: string;
    label: string;
    start_at: Date;
    end_at: Date;
    policy_id: string;
    version_code: string;
    completion_weight: string | number;
    ontime_weight: string | number;
    status: "OPEN" | "FINALIZED";
    revision: number;
    finalized_at: Date | null;
    finalized_by_name: string | null;
  }>(
    `SELECT p.*, pol.version_code, pol.completion_weight, pol.ontime_weight, fm.display_name AS finalized_by_name
     FROM kpi_periods p
     JOIN kpi_policies pol ON pol.id = p.policy_id
     LEFT JOIN members fm ON fm.id = p.finalized_by
     WHERE p.period_key = $1`,
    [range.periodKey],
  );
  if (existing) return existing;

  // Chọn chính sách KPI mới nhất có hiệu lực
  let policy = await queryOne<{ id: string }>(
    `SELECT id FROM kpi_policies ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
  );
  if (!policy) {
    const ins = await query<{ id: string }>(
      `INSERT INTO kpi_policies (version_code, completion_weight, ontime_weight) VALUES ('KPI-V1', 60, 40) RETURNING id`,
    );
    policy = ins[0];
  }

  await query(
    `INSERT INTO kpi_periods (period_key, label, start_at, end_at, policy_id, status)
     VALUES ($1, $2, $3, $4, $5, 'OPEN')
     ON CONFLICT (period_key) DO NOTHING`,
    [range.periodKey, range.label, range.start.toISOString(), range.end.toISOString(), policy.id],
  );

  const created = await queryOne<{
    id: string;
    period_key: string;
    label: string;
    start_at: Date;
    end_at: Date;
    policy_id: string;
    version_code: string;
    completion_weight: string | number;
    ontime_weight: string | number;
    status: "OPEN" | "FINALIZED";
    revision: number;
    finalized_at: Date | null;
    finalized_by_name: string | null;
  }>(
    `SELECT p.*, pol.version_code, pol.completion_weight, pol.ontime_weight, fm.display_name AS finalized_by_name
     FROM kpi_periods p
     JOIN kpi_policies pol ON pol.id = p.policy_id
     LEFT JOIN members fm ON fm.id = p.finalized_by
     WHERE p.period_key = $1`,
    [range.periodKey],
  );
  return created!;
}

/** Tính báo cáo KPI cho kỳ (nếu kỳ đã FINALIZED, đọc snapshot tái lập được; nếu OPEN, tính live) */
export async function getKpiReport(
  actor: AuthActor,
  options?: { periodKey?: string; teamId?: string; memberId?: string },
) {
  if (isObserverRole(actor.role)) {
    throw new AppError(403, "FORBIDDEN", "Tài khoản Ngoại lệ (Bậc 06) không có quyền xem báo cáo KPI.");
  }
  const period = await ensureKpiPeriod(options?.periodKey);
  const policy = {
    versionCode: period.version_code,
    completionWeight: Number(period.completion_weight),
    ontimeWeight: Number(period.ontime_weight),
  };

  // Lấy danh sách thành viên trong phạm vi quyền (loại trừ Bậc 06 OBSERVER không đánh giá KPI)
  const members = await query<{
    id: string;
    member_code: string;
    display_name: string;
    role: MemberRole;
    primary_team_id: string | null;
    primary_team_name: string | null;
  }>(
    `SELECT m.id, m.member_code, m.display_name, m.role,
            tm.team_id AS primary_team_id, t.name AS primary_team_name
     FROM members m
     LEFT JOIN team_memberships tm ON tm.member_id = m.id AND tm.is_primary = true AND tm.effective_to IS NULL
     LEFT JOIN teams t ON t.id = tm.team_id
     WHERE m.archived_at IS NULL AND m.role <> 'OBSERVER'
     ORDER BY m.display_name ASC`,
  );

  const allTeamMemberships = await query<{ member_id: string; team_id: string }>(
    `SELECT member_id, team_id FROM team_memberships WHERE effective_to IS NULL`,
  );
  const memberTeamsMap = new Map<string, string[]>();
  for (const r of allTeamMemberships) {
    const arr = memberTeamsMap.get(r.member_id) ?? [];
    arr.push(r.team_id);
    memberTeamsMap.set(r.member_id, arr);
  }

  const scopedMembers = members.filter((m) => {
    if (options?.memberId && m.id !== options.memberId) return false;
    const tIds = memberTeamsMap.get(m.id) ?? [];
    if (options?.teamId && !tIds.includes(options.teamId)) return false;
    return can(actor, "kpi.view_member", {
      targetMemberId: m.id,
      targetRole: m.role,
      targetTeamIds: tIds,
    });
  });

  if (options?.memberId && scopedMembers.length === 0) {
    throw new AppError(403, "FORBIDDEN", "Bạn không có quyền xem KPI của thành viên này.");
  }

  // Nếu kỳ đã chốt → trả snapshot của revision hiện hành
  if (period.status === "FINALIZED") {
    const snapRows = await query<{
      member_id: string;
      eligible_weight: string | number;
      completed_weight: string | number;
      ontime_weight: string | number;
      completion_rate: string | number | null;
      ontime_rate: string | number | null;
      score: string | number | null;
      counts: KpiMemberSummary["counts"];
      evidence_snapshot: KpiMemberSummary["items"];
    }>(
      `SELECT * FROM kpi_results WHERE period_id = $1 AND revision = $2`,
      [period.id, period.revision],
    );
    const snapByMember = new Map(snapRows.map((s) => [s.member_id, s]));

    const summaries: KpiMemberSummary[] = scopedMembers.map((m) => {
      const s = snapByMember.get(m.id);
      return {
        memberId: m.id,
        memberCode: m.member_code,
        displayName: m.display_name,
        role: m.role,
        primaryTeamName: m.primary_team_name ?? "Chưa phân tổ",
        eligibleWeight: s ? Number(s.eligible_weight) : 0,
        completedWeight: s ? Number(s.completed_weight) : 0,
        ontimeWeight: s ? Number(s.ontime_weight) : 0,
        completionRate: s && s.completion_rate !== null ? Number(s.completion_rate) : null,
        ontimeRate: s && s.ontime_rate !== null ? Number(s.ontime_rate) : null,
        score: s && s.score !== null ? Number(s.score) : null,
        lateCount: Number(s?.counts?.lateCount ?? s?.counts?.lateCompleted ?? 0),
        transferredCount: Number(s?.counts?.transferredCount ?? 0),
        bonus: EMPTY_BONUS,
        counts: s?.counts ?? {
          total: 0,
          completed: 0,
          early: 0,
          onTime: 0,
          lateCompleted: 0,
          pendingReview: 0,
          unsubmitted: 0,
          declined: 0,
          excluded: 0,
          lateCount: 0,
          transferredCount: 0,
        },
        items: Array.isArray(s?.evidence_snapshot) ? s.evidence_snapshot : [],
      };
    });

    return {
      period: {
        id: period.id,
        periodKey: period.period_key,
        label: period.label,
        startAt: new Date(period.start_at).toISOString(),
        endAt: new Date(period.end_at).toISOString(),
        status: period.status,
        revision: period.revision,
        finalizedAt: period.finalized_at ? new Date(period.finalized_at).toISOString() : null,
        finalizedByName: period.finalized_by_name,
      },
      policy,
      pendingReviewCount: 0,
      members: summaries,
      teamSummaries: aggregateTeamKpi(summaries),
    };
  }

  // Kỳ đang mở → tính live từ assignments có evaluation_deadline thuộc [start_at, end_at)
  const memberIds = scopedMembers.map((m) => m.id);
  const assignRows =
    memberIds.length > 0
      ? await query<{
          id: string;
          task_id: string;
          member_id: string;
          task_code: string;
          task_title: string;
          mission_code: string;
          status: string;
          weight: string | number;
          original_deadline: Date;
          evaluation_deadline: Date;
          effective_submitted_at: Date | null;
          reviewed_at: Date | null;
          exclusion_reason: string | null;
          late_against_original_deadline: boolean;
        }>(
          `SELECT ta.id, ta.task_id, ta.member_id, t.code AS task_code, t.title AS task_title, m.code AS mission_code,
                  ta.status, ta.weight, ta.original_deadline, ta.evaluation_deadline,
                  ta.effective_submitted_at, ta.reviewed_at, ta.exclusion_reason, ta.late_against_original_deadline
           FROM task_assignments ta
           JOIN tasks t ON t.id = ta.task_id
           JOIN missions m ON m.id = t.mission_id
           WHERE ta.member_id = ANY($1::uuid[])
             AND m.status <> 'DRAFT'
             AND ta.evaluation_deadline >= $2
             AND ta.evaluation_deadline < $3
           ORDER BY ta.evaluation_deadline ASC`,
          [memberIds, new Date(period.start_at).toISOString(), new Date(period.end_at).toISOString()],
        )
      : [];

  const byMember = new Map<string, KpiAssignmentInput[]>();
  for (const r of assignRows) {
    const arr = byMember.get(r.member_id) ?? [];
    arr.push({
      assignmentId: r.id,
      taskId: r.task_id,
      taskCode: r.task_code,
      taskTitle: r.task_title,
      missionCode: r.mission_code,
      status: r.status,
      weight: Number(r.weight),
      originalDeadline: new Date(r.original_deadline).toISOString(),
      evaluationDeadline: new Date(r.evaluation_deadline).toISOString(),
      effectiveSubmittedAt: r.effective_submitted_at ? new Date(r.effective_submitted_at).toISOString() : null,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      exclusionReason: r.exclusion_reason,
      lateAgainstOriginalDeadline: r.late_against_original_deadline,
    });
    byMember.set(r.member_id, arr);
  }

  // Tính 5 nguồn điểm cộng KPI V2 trong kỳ [start_at, end_at)
  const startIso = new Date(period.start_at).toISOString();
  const endIso = new Date(period.end_at).toISOString();
  const [py, pm] = period.period_key.split("-").map(Number);
  const startDateStr = `${period.period_key}-01`;
  const nextMonthDateStr =
    pm === 12 ? `${py + 1}-01-01` : `${py}-${String(pm + 1).padStart(2, "0")}-01`;

  const [conductRows, councilSubRows, councilOpRows, councilConcRows, metricRows, initiativeRows] =
    memberIds.length > 0
      ? await Promise.all([
          query<{ member_id: string; c: string | number }>(
            `SELECT reporter_id AS member_id, count(*) AS c
             FROM conduct_reports
             WHERE reporter_id = ANY($1::uuid[]) AND created_at >= $2 AND created_at < $3
             GROUP BY reporter_id`,
            [memberIds, startIso, endIso],
          ),
          query<{ member_id: string; c: string | number }>(
            `SELECT submitted_by AS member_id, count(*) AS c
             FROM council_items
             WHERE submitted_by = ANY($1::uuid[]) AND created_at >= $2 AND created_at < $3
             GROUP BY submitted_by`,
            [memberIds, startIso, endIso],
          ),
          query<{ member_id: string; total_c: string | number; ontime_c: string | number }>(
            `SELECT co.member_id,
                    count(*) AS total_c,
                    count(*) FILTER (WHERE ci.item_type = 'GENERAL_DOCUMENT' OR co.created_at <= ci.opinion_deadline) AS ontime_c
             FROM council_opinions co
             JOIN council_items ci ON ci.id = co.council_item_id
             WHERE co.member_id = ANY($1::uuid[]) AND co.created_at >= $2 AND co.created_at < $3
             GROUP BY co.member_id`,
            [memberIds, startIso, endIso],
          ),
          query<{ member_id: string; c: string | number }>(
            `SELECT concluded_by AS member_id, count(*) AS c
             FROM council_items
             WHERE concluded_by = ANY($1::uuid[]) AND concluded_at >= $2 AND concluded_at < $3
             GROUP BY concluded_by`,
            [memberIds, startIso, endIso],
          ),
          query<{ member_id: string; pts: string | number }>(
            `SELECT member_id, COALESCE(SUM(computed_points), 0) AS pts
             FROM metric_logs
             WHERE member_id = ANY($1::uuid[]) AND status = 'APPROVED'
               AND period_date >= $2::date AND period_date < $3::date
             GROUP BY member_id`,
            [memberIds, startDateStr, nextMonthDateStr],
          ),
          query<{ member_id: string; pts: string | number }>(
            `SELECT ip.member_id, COALESCE(SUM(ip.awarded_points), 0) AS pts
             FROM initiative_participants ip
             JOIN initiatives i ON i.id = ip.initiative_id
             WHERE ip.member_id = ANY($1::uuid[]) AND i.status = 'APPROVED'
               AND i.reviewed_at >= $2 AND i.reviewed_at < $3
             GROUP BY ip.member_id`,
            [memberIds, startIso, endIso],
          ),
        ])
      : [[], [], [], [], [], []];

  const bonusMap = new Map<string, KpiBonusBreakdown>();
  const ensureBonus = (mid: string) => {
    let b = bonusMap.get(mid);
    if (!b) {
      b = { ...EMPTY_BONUS };
      bonusMap.set(mid, b);
    }
    return b;
  };
  for (const r of conductRows) ensureBonus(r.member_id).conductReports = Number(r.c);
  for (const r of councilSubRows) ensureBonus(r.member_id).councilSubmissions = Number(r.c);
  for (const r of councilOpRows) {
    const b = ensureBonus(r.member_id);
    b.councilOpinions = Number(r.total_c);
    b.councilOpinionsOntime = Number(r.ontime_c);
  }
  for (const r of councilConcRows) ensureBonus(r.member_id).councilConclusions = Number(r.c);
  for (const r of metricRows) ensureBonus(r.member_id).metricPoints = Math.round(Number(r.pts) * 100) / 100;
  for (const r of initiativeRows) ensureBonus(r.member_id).initiativePoints = Math.round(Number(r.pts) * 100) / 100;

  for (const b of bonusMap.values()) {
    const round2 = (v: number) => Math.round(v * 100) / 100;
    b.totalBonusEligible = round2(
      b.conductReports + b.councilSubmissions + b.councilOpinions + b.councilConclusions + b.metricPoints + b.initiativePoints,
    );
    b.totalBonusCompleted = b.totalBonusEligible;
    b.totalBonusOntime = round2(
      b.conductReports + b.councilSubmissions + b.councilOpinionsOntime + b.councilConclusions + b.metricPoints + b.initiativePoints,
    );
  }

  let pendingReviewCount = 0;
  const summaries: KpiMemberSummary[] = scopedMembers.map((m) => {
    const calc = computeKpiFromAssignments(byMember.get(m.id) ?? [], policy, bonusMap.get(m.id) ?? EMPTY_BONUS);
    pendingReviewCount += calc.counts.pendingReview;
    return {
      memberId: m.id,
      memberCode: m.member_code,
      displayName: m.display_name,
      role: m.role,
      primaryTeamName: m.primary_team_name ?? "Chưa phân tổ",
      ...calc,
    };
  });

  // Thống kê SLA reviewer (tách riêng khỏi KPI người thực hiện theo mục 10.2)
  const reviewerStats =
    isBoardLeadership(actor.role) || isTeamLeadership(actor.role)
      ? await query<{
          reviewer_id: string;
          reviewer_name: string;
          reviewed_count: string | number;
          avg_review_hours: string | number | null;
        }>(
          `SELECT r.reviewer_id, m.display_name AS reviewer_name,
                  count(*) AS reviewed_count,
                  ROUND(AVG(EXTRACT(EPOCH FROM (r.reviewed_at - sv.submitted_at)) / 3600.0)::numeric, 2) AS avg_review_hours
           FROM reviews r
           JOIN submission_versions sv ON sv.id = r.submission_version_id
           JOIN members m ON m.id = r.reviewer_id
           WHERE r.reviewed_at >= $1 AND r.reviewed_at < $2
           GROUP BY r.reviewer_id, m.display_name
           ORDER BY reviewed_count DESC`,
          [new Date(period.start_at).toISOString(), new Date(period.end_at).toISOString()],
        )
      : [];

  return {
    period: {
      id: period.id,
      periodKey: period.period_key,
      label: period.label,
      startAt: new Date(period.start_at).toISOString(),
      endAt: new Date(period.end_at).toISOString(),
      status: period.status,
      revision: period.revision,
      finalizedAt: period.finalized_at ? new Date(period.finalized_at).toISOString() : null,
      finalizedByName: period.finalized_by_name,
    },
    policy,
    pendingReviewCount,
    members: summaries,
    teamSummaries: aggregateTeamKpi(summaries),
    reviewerStats: reviewerStats.map((r) => ({
      reviewerId: r.reviewer_id,
      reviewerName: r.reviewer_name,
      reviewedCount: Number(r.reviewed_count),
      avgReviewHours: r.avg_review_hours !== null ? Number(r.avg_review_hours) : null,
    })),
  };
}

function aggregateTeamKpi(members: KpiMemberSummary[]) {
  const map = new Map<string, { teamName: string; memberCount: number; eligibleWeight: number; completedWeight: number; ontimeWeight: number; scores: number[] }>();
  for (const m of members) {
    const cur = map.get(m.primaryTeamName) ?? {
      teamName: m.primaryTeamName,
      memberCount: 0,
      eligibleWeight: 0,
      completedWeight: 0,
      ontimeWeight: 0,
      scores: [],
    };
    cur.memberCount++;
    cur.eligibleWeight += m.eligibleWeight;
    cur.completedWeight += m.completedWeight;
    cur.ontimeWeight += m.ontimeWeight;
    if (m.score !== null) cur.scores.push(m.score);
    map.set(m.primaryTeamName, cur);
  }
  return [...map.values()].map((t) => ({
    teamName: t.teamName,
    memberCount: t.memberCount,
    eligibleWeight: Math.round(t.eligibleWeight * 100) / 100,
    completedWeight: Math.round(t.completedWeight * 100) / 100,
    ontimeWeight: Math.round(t.ontimeWeight * 100) / 100,
    avgScore: t.scores.length > 0 ? Math.round((t.scores.reduce((a, b) => a + b, 0) / t.scores.length) * 100) / 100 : null,
  }));
}

/** Chốt kỳ KPI (lưu snapshot bất biến, mặc định chặn nếu còn sản phẩm chờ duyệt trừ khi có lý do ngoại lệ) */
export async function finalizeKpiPeriod(
  actor: AuthActor,
  periodId: string,
  input: { allowPendingReviews?: boolean; exceptionReason?: string },
  requestId?: string,
) {
  requirePermission(actor, "kpi.finalize", {}, "Chỉ Trưởng Ban (01.01) hoặc Phó Ban (02) mới được chốt kỳ KPI.");

  const period = await queryOne<{ id: string; period_key: string; status: string; revision: number }>(
    `SELECT id, period_key, status, revision FROM kpi_periods WHERE id = $1`,
    [periodId],
  );
  if (!period) throw new AppError(404, "PERIOD_NOT_FOUND", "Không tìm thấy kỳ KPI.");
  if (period.status === "FINALIZED") {
    throw new AppError(409, "ALREADY_FINALIZED", "Kỳ KPI này đã được chốt.");
  }

  const live = await getKpiReport(actor, { periodKey: period.period_key });
  if (live.pendingReviewCount > 0) {
    if (!input.allowPendingReviews || !input.exceptionReason?.trim()) {
      throw new AppError(
        409,
        "PENDING_REVIEWS_EXIST",
        `Còn ${live.pendingReviewCount} sản phẩm đang chờ nghiệm thu trong kỳ. Vui lòng duyệt hết hoặc ghi lý do ngoại lệ trước khi chốt.`,
      );
    }
  }

  await withTransaction(async (tx) => {
    for (const m of live.members) {
      await tx.query(
        `INSERT INTO kpi_results (
           period_id, member_id, revision, eligible_weight, completed_weight, ontime_weight,
           completion_rate, ontime_rate, score, counts, evidence_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
         ON CONFLICT (period_id, member_id, revision) DO UPDATE SET
           eligible_weight = EXCLUDED.eligible_weight,
           completed_weight = EXCLUDED.completed_weight,
           ontime_weight = EXCLUDED.ontime_weight,
           completion_rate = EXCLUDED.completion_rate,
           ontime_rate = EXCLUDED.ontime_rate,
           score = EXCLUDED.score,
           counts = EXCLUDED.counts,
           evidence_snapshot = EXCLUDED.evidence_snapshot`,
        [
          periodId,
          m.memberId,
          period.revision,
          m.eligibleWeight,
          m.completedWeight,
          m.ontimeWeight,
          m.completionRate,
          m.ontimeRate,
          m.score,
          JSON.stringify(m.counts),
          JSON.stringify(m.items),
        ],
      );
    }

    await tx.query(
      `UPDATE kpi_periods SET status = 'FINALIZED', finalized_by = $1, finalized_at = now() WHERE id = $2`,
      [actor.memberId, periodId],
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "KPI_PERIOD_FINALIZED",
        targetType: "KPI_PERIOD",
        targetId: periodId,
        safeDiff: { periodKey: period.period_key, revision: period.revision, memberCount: live.members.length, exceptionReason: input.exceptionReason ?? null },
        requestId,
      },
      tx,
    );
  });

  return { periodId, status: "FINALIZED", revision: period.revision };
}

/** Mở lại kỳ KPI đã chốt (tăng revision để không ghi đè âm thầm bản chốt cũ) */
export async function reopenKpiPeriod(actor: AuthActor, periodId: string, reason: string, requestId?: string) {
  requirePermission(actor, "kpi.finalize", {}, "Chỉ Trưởng Ban (01.01) hoặc Phó Ban (02) mới được mở lại kỳ KPI.");
  if (!reason.trim()) throw new AppError(400, "REASON_REQUIRED", "Vui lòng ghi rõ lý do mở lại kỳ KPI.");

  const period = await queryOne<{ id: string; period_key: string; status: string; revision: number }>(
    `SELECT id, period_key, status, revision FROM kpi_periods WHERE id = $1`,
    [periodId],
  );
  if (!period) throw new AppError(404, "PERIOD_NOT_FOUND", "Không tìm thấy kỳ KPI.");
  if (period.status !== "FINALIZED") {
    throw new AppError(409, "NOT_FINALIZED", "Kỳ KPI đang mở, không cần mở lại.");
  }

  const nextRevision = period.revision + 1;
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE kpi_periods SET status = 'OPEN', revision = $1, reopen_reason = $2 WHERE id = $3`,
      [nextRevision, reason.trim(), periodId],
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "KPI_PERIOD_REOPENED",
        targetType: "KPI_PERIOD",
        targetId: periodId,
        safeDiff: { periodKey: period.period_key, newRevision: nextRevision, reason: reason.trim() },
        requestId,
      },
      tx,
    );
  });

  return { periodId, status: "OPEN", revision: nextRevision };
}
