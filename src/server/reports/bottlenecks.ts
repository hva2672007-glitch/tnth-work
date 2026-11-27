import { query, queryOne } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { buildMissionScopeClause, isManagerRole, isObserverRole } from "@/server/authorization/policy";
import { DEFAULT_SLA_MINUTES, type UrgencyLevel } from "@/lib/constants";

export type BottleneckCode =
  | "B01"
  | "B02"
  | "B03"
  | "B04"
  | "B05"
  | "B06"
  | "B07"
  | "B08"
  | "B09"
  | "B10"
  | "B11";

export interface BottleneckItem {
  code: BottleneckCode;
  label: string;
  severity: "HIGH" | "MEDIUM";
  targetType: "MISSION" | "TASK" | "ASSIGNMENT" | "APPROVAL";
  targetId: string;
  missionId?: string;
  missionCode?: string;
  title: string;
  cause: string;
  responsibleName: string;
  link: string;
  detectedAt: string;
}

export async function getSlaConfig(): Promise<Record<UrgencyLevel, number> & { APPROVAL_HOURS: number }> {
  const row = await queryOne<{ value: Record<string, number> }>(
    `SELECT value FROM system_settings WHERE key = 'sla_minutes'`,
  );
  const v = row?.value ?? {};
  return {
    FLASH: Number(v.FLASH ?? DEFAULT_SLA_MINUTES.FLASH),
    VERY_URGENT: Number(v.VERY_URGENT ?? DEFAULT_SLA_MINUTES.VERY_URGENT),
    URGENT: Number(v.URGENT ?? DEFAULT_SLA_MINUTES.URGENT),
    NORMAL: Number(v.NORMAL ?? DEFAULT_SLA_MINUTES.NORMAL),
    APPROVAL_HOURS: Number(v.APPROVAL_HOURS ?? 72),
  };
}

/**
 * Bộ phát hiện điểm nghẽn dựa trên luật (mục 10.3 — B01 đến B11).
 * Phân biệt rạch ròi giữa thành viên chưa nhận/chưa nộp với lãnh đạo chưa nghiệm thu/chưa chốt.
 */
export async function detectBottlenecks(
  actor: AuthActor,
  filters?: { teamId?: string; groupId?: string },
): Promise<{
  items: BottleneckItem[];
  countsByCode: Record<string, number>;
}> {
  if (isObserverRole(actor.role)) {
    return { items: [], countsByCode: {} };
  }
  const sla = await getSlaConfig();
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const scope = buildMissionScopeClause(actor, 1);
  const params: unknown[] = [...scope.params];
  const extraWhere: string[] = [scope.clause, `m.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED')`];
  if (filters?.teamId) {
    params.push(filters.teamId);
    extraWhere.push(`EXISTS (SELECT 1 FROM mission_teams mt WHERE mt.mission_id = m.id AND mt.team_id = $${params.length})`);
  }
  if (filters?.groupId) {
    params.push(filters.groupId);
    extraWhere.push(`m.group_id = $${params.length}`);
  }
  const missionWhereSql = extraWhere.join(" AND ");

  const items: BottleneckItem[] = [];

  // Lấy assignments mở trong phạm vi mission
  const assignments = await query<{
    assignment_id: string;
    task_id: string;
    task_code: string;
    task_title: string;
    mission_id: string;
    mission_code: string;
    urgency: UrgencyLevel;
    status: string;
    assigned_at: Date;
    evaluation_deadline: Date;
    submitted_at: Date | null;
    member_name: string;
    member_activity: string;
    member_access: boolean;
    assigner_name: string;
    reviewer_id: string | null;
    reviewer_name: string | null;
    owner_team_name: string;
  }>(
    `SELECT ta.id AS assignment_id, t.id AS task_id, t.code AS task_code, t.title AS task_title,
            m.id AS mission_id, m.code AS mission_code, t.urgency, ta.status,
            ta.assigned_at, ta.evaluation_deadline, ta.submitted_at,
            mem.display_name AS member_name, mem.activity_status AS member_activity, mem.access_enabled AS member_access,
            asg.display_name AS assigner_name, t.reviewer_id, rev.display_name AS reviewer_name, tm.name AS owner_team_name
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN missions m ON m.id = t.mission_id
     JOIN members mem ON mem.id = ta.member_id
     JOIN members asg ON asg.id = ta.assigned_by
     JOIN teams tm ON tm.id = t.owner_team_id
     LEFT JOIN members rev ON rev.id = t.reviewer_id
     WHERE ${missionWhereSql} AND t.status NOT IN ('COMPLETED', 'CANCELLED')`,
    params,
  );

  for (const a of assignments) {
    const slaMinutes = sla[a.urgency] ?? 1440;
    const deadlineMs = new Date(a.evaluation_deadline).getTime();

    // B01: Assignment PENDING vượt ngưỡng tiếp nhận
    if (a.status === "PENDING") {
      const waitMinutes = (nowMs - new Date(a.assigned_at).getTime()) / 60_000;
      if (waitMinutes > slaMinutes || nowMs > deadlineMs) {
        items.push({
          code: "B01",
          label: "Chưa nhận việc",
          severity: nowMs > deadlineMs ? "HIGH" : "MEDIUM",
          targetType: "ASSIGNMENT",
          targetId: a.assignment_id,
          missionId: a.mission_id,
          missionCode: a.mission_code,
          title: `${a.task_code}: ${a.task_title}`,
          cause: `Chưa xác nhận nhận việc sau ${Math.round(waitMinutes)} phút (ngưỡng ${slaMinutes} phút).`,
          responsibleName: `${a.member_name} (người giao: ${a.assigner_name})`,
          link: `/missions/${a.mission_id}`,
          detectedAt: nowIso,
        });
      }
    }

    // B02: Đến hạn nhưng chưa có sản phẩm hợp lệ (PENDING hoặc ACCEPTED quá hạn)
    if ((a.status === "PENDING" || a.status === "ACCEPTED") && nowMs > deadlineMs) {
      items.push({
        code: "B02",
        label: "Quá hạn chưa nộp sản phẩm",
        severity: "HIGH",
        targetType: "ASSIGNMENT",
        targetId: a.assignment_id,
        missionId: a.mission_id,
        missionCode: a.mission_code,
        title: `${a.task_code}: ${a.task_title}`,
        cause: "Đã quá thời hạn nhưng chưa nộp sản phẩm hợp lệ.",
        responsibleName: a.member_name,
        link: `/missions/${a.mission_id}`,
        detectedAt: nowIso,
      });
    }

    // B03: Có sản phẩm chờ nghiệm thu vượt SLA (lỗi tắc ở khâu lãnh đạo tổ/reviewer)
    if (a.status === "SUBMITTED" && a.submitted_at) {
      const waitReviewMinutes = (nowMs - new Date(a.submitted_at).getTime()) / 60_000;
      if (waitReviewMinutes > slaMinutes) {
        items.push({
          code: "B03",
          label: "Chờ nghiệm thu quá SLA",
          severity: "HIGH",
          targetType: "ASSIGNMENT",
          targetId: a.assignment_id,
          missionId: a.mission_id,
          missionCode: a.mission_code,
          title: `${a.task_code}: ${a.task_title}`,
          cause: `Sản phẩm đã nộp cách đây ${Math.round(waitReviewMinutes / 60 * 10) / 10} giờ nhưng lãnh đạo tổ chưa nghiệm thu (ngưỡng ${slaMinutes} phút).`,
          responsibleName: a.reviewer_name ? `${a.reviewer_name} (${a.owner_team_name})` : `Lãnh đạo ${a.owner_team_name}`,
          link: `/missions/${a.mission_id}`,
          detectedAt: nowIso,
        });
      }
    }

    // B04: REVISION_REQUIRED quá hạn
    if (a.status === "REVISION_REQUIRED" && nowMs > deadlineMs) {
      items.push({
        code: "B04",
        label: "Chờ chỉnh sửa quá hạn",
        severity: "HIGH",
        targetType: "ASSIGNMENT",
        targetId: a.assignment_id,
        missionId: a.mission_id,
        missionCode: a.mission_code,
        title: `${a.task_code}: ${a.task_title}`,
        cause: "Sản phẩm bị trả sửa và đã quá hạn nộp lại.",
        responsibleName: a.member_name,
        link: `/missions/${a.mission_id}`,
        detectedAt: nowIso,
      });
    }

    // B07: Từ chối hoặc người đang giữ việc bị ngừng/tạm nghỉ chưa phân công lại
    if (a.status === "DECLINED" || (!a.member_access || a.member_activity !== "ACTIVE") && ["PENDING", "ACCEPTED", "REVISION_REQUIRED"].includes(a.status)) {
      items.push({
        code: "B07",
        label: "Chờ phân công lại",
        severity: "HIGH",
        targetType: "ASSIGNMENT",
        targetId: a.assignment_id,
        missionId: a.mission_id,
        missionCode: a.mission_code,
        title: `${a.task_code}: ${a.task_title}`,
        cause: a.status === "DECLINED" ? `${a.member_name} đã từ chối nhận việc, cần phân công lại.` : `${a.member_name} đã tạm nghỉ/thu hồi quyền khi task còn mở.`,
        responsibleName: a.assigner_name,
        link: `/missions/${a.mission_id}`,
        detectedAt: nowIso,
      });
    }
  }

  // B05: Task bị chặn bởi task tiền nhiệm chưa hoàn thành
  const blockedTasks = await query<{
    task_id: string;
    task_code: string;
    task_title: string;
    mission_id: string;
    mission_code: string;
    pred_code: string;
    pred_title: string;
    pred_owner_name: string;
  }>(
    `SELECT t.id AS task_id, t.code AS task_code, t.title AS task_title,
            m.id AS mission_id, m.code AS mission_code,
            pt.code AS pred_code, pt.title AS pred_title, po.display_name AS pred_owner_name
     FROM task_dependencies td
     JOIN tasks t ON t.id = td.task_id
     JOIN tasks pt ON pt.id = td.predecessor_task_id
     JOIN missions m ON m.id = t.mission_id
     JOIN members po ON po.id = pt.owner_id
     WHERE ${missionWhereSql} AND t.status NOT IN ('COMPLETED', 'CANCELLED') AND pt.status <> 'COMPLETED'`,
    params,
  );
  for (const b of blockedTasks) {
    items.push({
      code: "B05",
      label: "Đang bị chặn bởi task tiền nhiệm",
      severity: "MEDIUM",
      targetType: "TASK",
      targetId: b.task_id,
      missionId: b.mission_id,
      missionCode: b.mission_code,
      title: `${b.task_code}: ${b.task_title}`,
      cause: `Đang phụ thuộc task ${b.pred_code} ("${b.pred_title}") chưa hoàn thành.`,
      responsibleName: b.pred_owner_name,
      link: `/missions/${b.mission_id}`,
      detectedAt: nowIso,
    });
  }

  // B11: Task chưa có reviewer hợp lệ (hoặc reviewer không còn active)
  const noReviewerTasks = await query<{
    task_id: string;
    task_code: string;
    task_title: string;
    mission_id: string;
    mission_code: string;
    owner_team_name: string;
  }>(
    `SELECT t.id AS task_id, t.code AS task_code, t.title AS task_title,
            m.id AS mission_id, m.code AS mission_code, tm.name AS owner_team_name
     FROM tasks t
     JOIN missions m ON m.id = t.mission_id
     JOIN teams tm ON tm.id = t.owner_team_id
     LEFT JOIN members rv ON rv.id = t.reviewer_id
     WHERE ${missionWhereSql} AND t.status NOT IN ('COMPLETED', 'CANCELLED')
       AND (t.reviewer_id IS NULL OR rv.access_enabled = false OR rv.activity_status <> 'ACTIVE')`,
    params,
  );
  for (const nr of noReviewerTasks) {
    items.push({
      code: "B11",
      label: "Thiếu người nghiệm thu hợp lệ",
      severity: "MEDIUM",
      targetType: "TASK",
      targetId: nr.task_id,
      missionId: nr.mission_id,
      missionCode: nr.mission_code,
      title: `${nr.task_code}: ${nr.task_title}`,
      cause: `Chưa có lãnh đạo/reviewer đang hoạt động cho ${nr.owner_team_name}.`,
      responsibleName: "Trưởng/Phó Ban Biên tập",
      link: `/missions/${nr.mission_id}`,
      detectedAt: nowIso,
    });
  }

  // B06, B09, B10 ở cấp Mission
  const openMissions = await query<{
    id: string;
    code: string;
    title: string;
    status: string;
    completion_mode: string;
    hold_until: Date | null;
    owner_name: string;
    req_tasks: string | number;
    done_tasks: string | number;
    req_pubs: string | number;
    done_pubs: string | number;
  }>(
    `SELECT m.id, m.code, m.title, m.status, m.completion_mode, m.hold_until, ow.display_name AS owner_name,
            (SELECT count(*) FROM tasks t WHERE t.mission_id = m.id AND t.required = true AND t.status <> 'CANCELLED') AS req_tasks,
            (SELECT count(*) FROM tasks t WHERE t.mission_id = m.id AND t.required = true AND t.status = 'COMPLETED') AS done_tasks,
            (SELECT count(*) FROM mission_publication_requirements r WHERE r.mission_id = m.id AND r.required = true) AS req_pubs,
            (SELECT count(*) FROM mission_publication_requirements r WHERE r.mission_id = m.id AND r.required = true AND r.confirmed_at IS NOT NULL
              AND (SELECT count(*) FROM publication_links pl WHERE pl.requirement_id = r.id AND pl.active = true) >= r.required_count) AS done_pubs
     FROM missions m
     JOIN members ow ON ow.id = m.owner_id
     WHERE ${missionWhereSql}`,
    params,
  );

  for (const m of openMissions) {
    const allTasksDone = Number(m.req_tasks) > 0 && Number(m.done_tasks) === Number(m.req_tasks);
    const allPubsDone = Number(m.req_pubs) > 0 && Number(m.done_pubs) === Number(m.req_pubs);

    // B06: Đủ task nhưng thiếu kênh đăng tải bắt buộc
    if (m.completion_mode === "TASKS_AND_PUBLICATIONS" && allTasksDone && !allPubsDone) {
      items.push({
        code: "B06",
        label: "Chờ cập nhật link đăng tải",
        severity: "MEDIUM",
        targetType: "MISSION",
        targetId: m.id,
        missionId: m.id,
        missionCode: m.code,
        title: `${m.code}: ${m.title}`,
        cause: `Đã nghiệm thu đủ task nhưng còn ${Number(m.req_pubs) - Number(m.done_pubs)} kênh đăng tải bắt buộc chưa hoàn tất.`,
        responsibleName: m.owner_name,
        link: `/missions/${m.id}`,
        detectedAt: nowIso,
      });
    }

    // B09: Đã đủ điều kiện hoàn thành nhưng lãnh đạo chưa bấm xác nhận chốt nhiệm vụ
    const readyToClose =
      (m.completion_mode === "TASKS_ONLY" && allTasksDone) ||
      (m.completion_mode === "TASKS_AND_PUBLICATIONS" && allTasksDone && allPubsDone) ||
      (m.completion_mode === "PUBLICATIONS_ONLY" && allPubsDone);
    if (readyToClose && m.status !== "COMPLETED") {
      items.push({
        code: "B09",
        label: "Chờ chốt hoàn thành nhiệm vụ",
        severity: "MEDIUM",
        targetType: "MISSION",
        targetId: m.id,
        missionId: m.id,
        missionCode: m.code,
        title: `${m.code}: ${m.title}`,
        cause: "Nhiệm vụ đã đạt đủ điều kiện hoàn thành nhưng quản lý chưa xác nhận chốt.",
        responsibleName: m.owner_name,
        link: `/missions/${m.id}`,
        detectedAt: nowIso,
      });
    }

    // B10: Hoãn quá ngày dự kiến tiếp tục
    if (m.status === "ON_HOLD" && m.hold_until && new Date(m.hold_until).getTime() < nowMs) {
      items.push({
        code: "B10",
        label: "Tạm hoãn quá ngày dự kiến",
        severity: "MEDIUM",
        targetType: "MISSION",
        targetId: m.id,
        missionId: m.id,
        missionCode: m.code,
        title: `${m.code}: ${m.title}`,
        cause: "Đã quá ngày dự kiến tiếp tục nhiệm vụ nhưng chưa khôi phục hoặc hủy.",
        responsibleName: m.owner_name,
        link: `/missions/${m.id}`,
        detectedAt: nowIso,
      });
    }
  }

  // B08: Yêu cầu phê duyệt quy chế / nâng bậc chờ quá SLA (mặc định 72 giờ)
  if (isManagerRole(actor.role)) {
    const staleApprovals = await query<{
      id: string;
      title: string;
      created_at: Date;
      missing_voters: string | null;
    }>(
      `SELECT ar.id, ar.title, ar.created_at,
              (SELECT string_agg(m.display_name, ', ')
               FROM approval_eligible_voters ev
               JOIN members m ON m.id = ev.member_id
               WHERE ev.request_id = ar.id
                 AND NOT EXISTS (SELECT 1 FROM approval_votes av WHERE av.request_id = ar.id AND av.member_id = ev.member_id)
              ) AS missing_voters
       FROM approval_requests ar
       WHERE ar.status = 'PENDING' AND ar.created_at < now() - ($1 || ' hours')::interval`,
      [String(sla.APPROVAL_HOURS)],
    );
    for (const ap of staleApprovals) {
      items.push({
        code: "B08",
        label: "Phê duyệt chờ quá hạn",
        severity: "MEDIUM",
        targetType: "APPROVAL",
        targetId: ap.id,
        title: ap.title,
        cause: `Yêu cầu đồng xác nhận chờ quá ${sla.APPROVAL_HOURS} giờ.`,
        responsibleName: ap.missing_voters || "Thành viên cần đồng xác nhận",
        link: `/approvals`,
        detectedAt: nowIso,
      });
    }
  }

  const countsByCode: Record<string, number> = {};
  for (const item of items) {
    countsByCode[item.code] = (countsByCode[item.code] ?? 0) + 1;
  }

  return { items, countsByCode };
}
