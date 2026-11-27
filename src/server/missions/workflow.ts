import { query, queryOne, withTransaction, type DbClient } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import {
  buildMissionScopeClause,
  can,
  canAssignToMember,
  isBoardLeadership,
  isManagerRole,
  isObserverRole,
  isTeamLeadership,
  isWorkerRole,
  requirePermission,
} from "@/server/authorization/policy";
import { writeActivity, writeAudit } from "@/server/audit/service";
import { createNotification, createNotifications } from "@/server/notifications/service";
import { AppError } from "@/server/errors";
import {
  suggestUrgency,
  type CompletionMode,
  type ConfidentialityLevel,
  type ImportanceLevel,
  type MemberRole,
  type MissionStatus,
  type SubmissionMode,
  type TaskStatus,
  type UrgencyLevel,
} from "@/lib/constants";

export interface CreateTaskInput {
  tempKey?: string;
  title: string;
  description?: string;
  deliverable?: string;
  requiresArtifact?: boolean;
  ownerTeamId: string;
  collaboratingTeamIds?: string[];
  ownerId?: string;
  reviewerId?: string | null;
  supervisorIds?: string[];
  submissionMode?: SubmissionMode;
  required?: boolean;
  weight?: number;
  urgency?: UrgencyLevel;
  importance?: ImportanceLevel;
  deadline: string;
  assigneeIds?: string[];
  assigneeWeights?: Record<string, number>;
  predecessorTempKeys?: string[];
  metricEnabled?: boolean;
  metricUnit?: string;
  metricTarget?: number | null;
  metricPointsPerUnit?: number;
}

export interface CreateMissionInput {
  groupId: string;
  title: string;
  description: string;
  expectedOutcome?: string;
  refs?: { label: string; url: string }[];
  directiveAuthorities?: string[];
  confidentiality?: ConfidentialityLevel;
  ownerId: string;
  teamIds?: string[];
  importance?: ImportanceLevel;
  urgency?: UrgencyLevel;
  urgencyOverrideReason?: string;
  deadline: string;
  startsAt?: string;
  completionMode?: CompletionMode;
  completionModeReason?: string;
  publicationChannels?: { channelId: string; customChannelName?: string; required?: boolean; requiredCount?: number }[];
  tasks: CreateTaskInput[];
  saveAsDraft?: boolean;
  scheduleId?: string;
  occurrenceAt?: string;
}

/** Kiểm tra đồ thị phụ thuộc task không chứa chu trình (DFS) */
export function assertNoDependencyCycle(edges: Array<[string, string]>): void {
  const adj = new Map<string, string[]>();
  for (const [task, pred] of edges) {
    if (task === pred) {
      throw new AppError(400, "DEPENDENCY_CYCLE", "Task không thể tự phụ thuộc vào chính nó.");
    }
    const list = adj.get(task) ?? [];
    list.push(pred);
    adj.set(task, list);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const dfs = (node: string) => {
    state.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      const st = state.get(next) ?? 0;
      if (st === 1) {
        throw new AppError(400, "DEPENDENCY_CYCLE", "Phát hiện vòng phụ thuộc (cycle) giữa các task.");
      }
      if (st === 0) dfs(next);
    }
    state.set(node, 2);
  };
  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) dfs(node);
  }
}

async function generateMissionCode(tx: DbClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `NV-${year}-`;
  const row = await tx.query<{ code: string }>(
    `SELECT code FROM missions WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
    [`${prefix}%`],
  );
  const last = row.rows[0]?.code;
  const seq = last ? Number(last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** Tính lại trạng thái tổng hợp của task từ các assignments (mục 7.5) */
export async function recomputeTaskStatus(taskId: string, tx: DbClient): Promise<TaskStatus> {
  const taskRes = await tx.query<{ status: TaskStatus; mission_id: string }>(
    `SELECT status, mission_id FROM tasks WHERE id = $1`,
    [taskId],
  );
  const task = taskRes.rows[0];
  if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Không tìm thấy task.");
  if (task.status === "DRAFT" || task.status === "ON_HOLD" || task.status === "CANCELLED") {
    return task.status;
  }

  const assRes = await tx.query<{ status: string }>(
    `SELECT status FROM task_assignments WHERE task_id = $1 AND status NOT IN ('TRANSFERRED', 'CANCELLED')`,
    [taskId],
  );
  const active = assRes.rows.filter((a) => a.status !== "DECLINED");

  let nextStatus: TaskStatus = "ASSIGNED";
  if (active.length === 0) {
    nextStatus = "ASSIGNED";
  } else if (active.every((a) => a.status === "COMPLETED")) {
    nextStatus = "COMPLETED";
  } else if (active.some((a) => a.status === "REVISION_REQUIRED")) {
    nextStatus = "REVISION_REQUIRED";
  } else if (active.every((a) => a.status === "SUBMITTED" || a.status === "COMPLETED")) {
    nextStatus = "SUBMITTED";
  } else if (active.some((a) => a.status === "ACCEPTED" || a.status === "SUBMITTED" || a.status === "COMPLETED")) {
    nextStatus = "IN_PROGRESS";
  } else {
    nextStatus = "ASSIGNED";
  }

  await tx.query(
    `UPDATE tasks
     SET status = $1,
         completed_at = CASE WHEN $1 = 'COMPLETED' THEN COALESCE(completed_at, now()) ELSE NULL END,
         updated_at = now()
     WHERE id = $2`,
    [nextStatus, taskId],
  );
  await recomputeMissionStatus(task.mission_id, tx);
  return nextStatus;
}

/** Đánh giá điều kiện hoàn thành nhiệm vụ theo 3 completion_mode (mục 7.6) */
export async function evaluateMissionCompletion(missionId: string, tx?: DbClient) {
  const runQuery = async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
    tx ? (await tx.query<T>(sql, params)).rows : query<T>(sql, params);

  const mRows = await runQuery<{ id: string; status: MissionStatus; completion_mode: CompletionMode }>(
    `SELECT id, status, completion_mode FROM missions WHERE id = $1`,
    [missionId],
  );
  const mission = mRows[0];
  if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

  const tasks = await runQuery<{ id: string; status: TaskStatus; required: boolean }>(
    `SELECT id, status, required FROM tasks WHERE mission_id = $1 AND status <> 'CANCELLED'`,
    [missionId],
  );
  const requiredTasks = tasks.filter((t) => t.required);
  const completedRequiredTasks = requiredTasks.filter((t) => t.status === "COMPLETED");
  const allTasksComplete = requiredTasks.length > 0 && completedRequiredTasks.length === requiredTasks.length;

  const pubReqs = await runQuery<{
    id: string;
    required: boolean;
    required_count: number;
    confirmed_at: Date | null;
    link_count: string | number;
  }>(
    `SELECT r.id, r.required, r.required_count, r.confirmed_at,
            (SELECT count(*) FROM publication_links pl WHERE pl.requirement_id = r.id AND pl.active = true) AS link_count
     FROM mission_publication_requirements r
     WHERE r.mission_id = $1`,
    [missionId],
  );
  const requiredPubs = pubReqs.filter((p) => p.required);
  const completedPubs = requiredPubs.filter((p) => Number(p.link_count) >= p.required_count && p.confirmed_at !== null);
  const allPublicationsComplete = requiredPubs.length > 0 && completedPubs.length === requiredPubs.length;

  let canComplete = false;
  const reasons: string[] = [];
  if (mission.completion_mode === "TASKS_ONLY") {
    canComplete = allTasksComplete;
    if (!allTasksComplete) reasons.push(`Còn ${requiredTasks.length - completedRequiredTasks.length} task bắt buộc chưa nghiệm thu.`);
  } else if (mission.completion_mode === "TASKS_AND_PUBLICATIONS") {
    canComplete = allTasksComplete && allPublicationsComplete;
    if (!allTasksComplete) reasons.push(`Còn ${requiredTasks.length - completedRequiredTasks.length} task bắt buộc chưa nghiệm thu.`);
    if (requiredPubs.length === 0) reasons.push("Chưa khai báo kênh đăng tải bắt buộc.");
    else if (!allPublicationsComplete) reasons.push(`Còn ${requiredPubs.length - completedPubs.length} kênh đăng tải bắt buộc chưa đủ link hoặc chưa xác nhận.`);
  } else {
    // PUBLICATIONS_ONLY: giữ yêu cầu "hoặc" của nguồn, KHÔNG tự hoàn thành task chưa nghiệm thu!
    canComplete = allPublicationsComplete;
    if (requiredPubs.length === 0) reasons.push("Chế độ theo link đăng tải yêu cầu tối thiểu 01 kênh đăng tải bắt buộc.");
    else if (!allPublicationsComplete) reasons.push(`Còn ${requiredPubs.length - completedPubs.length} kênh đăng tải bắt buộc chưa đủ link hoặc chưa xác nhận.`);
  }

  return {
    completionMode: mission.completion_mode,
    requiredTaskCount: requiredTasks.length,
    completedTaskCount: completedRequiredTasks.length,
    requiredPublicationCount: requiredPubs.length,
    completedPublicationCount: completedPubs.length,
    allTasksComplete,
    allPublicationsComplete,
    canComplete,
    reasons,
  };
}

/** Tính trạng thái tổng hợp của Mission — KHÔNG tự auto-chốt COMPLETED âm thầm (mục 7.6) */
export async function recomputeMissionStatus(missionId: string, tx: DbClient): Promise<MissionStatus> {
  const mRes = await tx.query<{ status: MissionStatus; owner_id: string; code: string; title: string }>(
    `SELECT status, owner_id, code, title FROM missions WHERE id = $1`,
    [missionId],
  );
  const mission = mRes.rows[0];
  if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");
  if (["DRAFT", "ON_HOLD", "CANCELLED", "COMPLETED"].includes(mission.status)) {
    return mission.status;
  }

  const evalRes = await evaluateMissionCompletion(missionId, tx);
  const tasksRes = await tx.query<{ status: TaskStatus }>(
    `SELECT status FROM tasks WHERE mission_id = $1 AND status <> 'CANCELLED'`,
    [missionId],
  );
  const tasks = tasksRes.rows;

  let nextStatus: MissionStatus = "ASSIGNED";
  if (evalRes.canComplete) {
    // Đủ điều kiện nhưng chưa bấm "Xác nhận hoàn thành" → chờ chốt (AWAITING_REVIEW hoặc AWAITING_PUBLICATION đã đạt)
    nextStatus = evalRes.allTasksComplete && !evalRes.allPublicationsComplete ? "AWAITING_PUBLICATION" : "AWAITING_REVIEW";
  } else if (evalRes.allTasksComplete && evalRes.requiredPublicationCount > 0 && !evalRes.allPublicationsComplete) {
    nextStatus = "AWAITING_PUBLICATION";
  } else if (tasks.length > 0 && tasks.every((t) => t.status === "SUBMITTED" || t.status === "COMPLETED")) {
    nextStatus = "AWAITING_REVIEW";
  } else if (tasks.some((t) => ["IN_PROGRESS", "SUBMITTED", "REVISION_REQUIRED", "COMPLETED"].includes(t.status))) {
    nextStatus = "IN_PROGRESS";
  } else {
    nextStatus = "ASSIGNED";
  }

  await tx.query(`UPDATE missions SET status = $1, updated_at = now() WHERE id = $2`, [nextStatus, missionId]);

  if (evalRes.canComplete) {
    await createNotification(
      {
        recipientId: mission.owner_id,
        eventType: "MISSION_READY_TO_COMPLETE",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} đã đủ điều kiện xác nhận hoàn thành`,
        message: `Nhiệm vụ "${mission.title}" đã đạt điều kiện hoàn thành. Vui lòng kiểm tra và bấm Xác nhận hoàn thành.`,
        link: `/missions/${missionId}`,
        dedupeKey: `mission_ready:${missionId}:${evalRes.completedTaskCount}:${evalRes.completedPublicationCount}`,
      },
      tx,
    );
  }
  return nextStatus;
}

/** Tạo mới nhiệm vụ (Lưu nháp hoặc Giao ngay trong 1 transaction) */
export async function createMission(actor: AuthActor, input: CreateMissionInput, requestId?: string) {
  requirePermission(actor, "mission.create", {}, "Chỉ cấp quản trị (Bậc 01, 02, 03) được tạo và giao nhiệm vụ.");

  const completionMode: CompletionMode =
    input.completionMode ??
    (input.publicationChannels && input.publicationChannels.length > 0
      ? "TASKS_AND_PUBLICATIONS"
      : "TASKS_ONLY");

  if (completionMode === "PUBLICATIONS_ONLY") {
    requirePermission(
      actor,
      "mission.publications_only_mode",
      {},
      "Chỉ Trưởng/Quyền Trưởng/Phó Ban Biên tập mới được chọn chế độ hoàn thành theo link đăng tải.",
    );
    if (!input.completionModeReason?.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Vui lòng ghi rõ lý do khi chọn chế độ hoàn thành theo link đăng tải.");
    }
    if (!input.publicationChannels || input.publicationChannels.filter((c) => c.required !== false).length === 0) {
      throw new AppError(400, "CHANNEL_REQUIRED", "Chế độ theo link đăng tải yêu cầu ít nhất 01 kênh đăng tải bắt buộc.");
    }
  }

  const now = new Date();
  const missionDeadline = new Date(input.deadline);
  if (Number.isNaN(missionDeadline.getTime())) {
    throw new AppError(400, "INVALID_DEADLINE", "Thời hạn nhiệm vụ không hợp lệ.");
  }
  if (!input.saveAsDraft && missionDeadline.getTime() <= now.getTime()) {
    throw new AppError(400, "DEADLINE_IN_PAST", "Thời hạn khi giao lần đầu phải nằm sau thời điểm hiện tại.");
  }

  const tasksInput: CreateTaskInput[] =
    input.tasks.length > 0
      ? input.tasks
      : [
          {
            tempKey: "t1",
            title: input.title,
            description: input.description,
            deliverable: input.expectedOutcome ?? "",
            ownerTeamId: input.teamIds?.[0] ?? actor.teamIds[0],
            ownerId: input.ownerId,
            deadline: input.deadline,
            weight: 1,
          },
        ];

  // Kiểm tra đồ thị phụ thuộc trước khi ghi DB
  const depEdges: Array<[string, string]> = [];
  for (const t of tasksInput) {
    if (t.tempKey && t.predecessorTempKeys) {
      for (const pred of t.predecessorTempKeys) {
        depEdges.push([t.tempKey, pred]);
      }
    }
  }
  assertNoDependencyCycle(depEdges);

  const suggested = suggestUrgency(now, missionDeadline);
  const finalUrgency = input.urgency ?? suggested;
  if (input.urgency && input.urgency !== suggested && !input.urgencyOverrideReason?.trim()) {
    // Cho phép đổi nhưng khuyến nghị lý do — ghi mặc định nếu trống trong draft, bắt buộc khi giao
    if (!input.saveAsDraft) {
      throw new AppError(400, "URGENCY_REASON_REQUIRED", "Vui lòng ghi lý do khi điều chỉnh cấp độ khẩn khác gợi ý tự động.");
    }
  }

  return withTransaction(async (tx) => {
    const groupRes = await tx.query<{ id: string; active: boolean }>(
      `SELECT id, active FROM task_groups WHERE id = $1`,
      [input.groupId],
    );
    if (!groupRes.rows[0] || !groupRes.rows[0].active) {
      throw new AppError(400, "INVALID_GROUP", "Khối nhiệm vụ không tồn tại hoặc đã ngừng hoạt động.");
    }

    // Xác minh quyền giao việc cho từng người được chỉ định
    const allAssigneeIds = [...new Set(tasksInput.flatMap((t) => t.assigneeIds ?? []))];
    const memberInfoMap = new Map<string, { role: MemberRole; teamIds: string[]; displayName: string; activityStatus: string; accessEnabled: boolean }>();
    if (allAssigneeIds.length > 0) {
      const mRows = await tx.query<{
        id: string;
        role: MemberRole;
        display_name: string;
        activity_status: string;
        access_enabled: boolean;
      }>(
        `SELECT id, role, display_name, activity_status, access_enabled FROM members WHERE id = ANY($1::uuid[])`,
        [allAssigneeIds],
      );
      const tmRows = await tx.query<{ member_id: string; team_id: string }>(
        `SELECT member_id, team_id FROM team_memberships WHERE member_id = ANY($1::uuid[]) AND effective_to IS NULL`,
        [allAssigneeIds],
      );
      const teamMap = new Map<string, string[]>();
      for (const r of tmRows.rows) {
        const arr = teamMap.get(r.member_id) ?? [];
        arr.push(r.team_id);
        teamMap.set(r.member_id, arr);
      }
      for (const m of mRows.rows) {
        memberInfoMap.set(m.id, {
          role: m.role,
          teamIds: teamMap.get(m.id) ?? [],
          displayName: m.display_name,
          activityStatus: m.activity_status,
          accessEnabled: m.access_enabled,
        });
      }
      for (const assigneeId of allAssigneeIds) {
        const target = memberInfoMap.get(assigneeId);
        if (!target || !target.accessEnabled || target.activityStatus !== "ACTIVE") {
          throw new AppError(400, "INACTIVE_ASSIGNEE", "Không thể giao việc cho thành viên đang tạm nghỉ hoặc đã ngừng hoạt động.");
        }
        if (!canAssignToMember(actor, { memberId: assigneeId, role: target.role, teamIds: target.teamIds })) {
          throw new AppError(
            403,
            "ASSIGN_SCOPE_FORBIDDEN",
            `Bạn không có quyền giao việc cho thành viên ${target.displayName}.`,
          );
        }
      }
    }

    const code = await generateMissionCode(tx);
    const missionStatus: MissionStatus = input.saveAsDraft ? "DRAFT" : "ASSIGNED";

    const mInserted = await tx.query<{ id: string }>(
      `INSERT INTO missions (
         code, group_id, title, description, expected_outcome, refs, directive_authorities, confidentiality,
         owner_id, creator_id, status, importance, urgency, urgency_override_reason, deadline_original, deadline_current,
         starts_at, assigned_at, completion_mode, completion_mode_reason, schedule_id, occurrence_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8,
         $9, $10, $11, $12, $13, $14, $15, $15,
         $16, $17, $18, $19, $20, $21
       ) RETURNING id`,
      [
        code,
        input.groupId,
        input.title.trim(),
        input.description.trim(),
        (input.expectedOutcome ?? "").trim(),
        JSON.stringify(input.refs ?? []),
        JSON.stringify([...new Set((input.directiveAuthorities ?? []).map((s) => s.trim()).filter(Boolean))]),
        input.confidentiality ?? "NORMAL",
        input.ownerId,
        actor.memberId,
        missionStatus,
        input.importance ?? "NORMAL",
        finalUrgency,
        input.urgencyOverrideReason ?? null,
        missionDeadline.toISOString(),
        input.startsAt ? new Date(input.startsAt).toISOString() : now.toISOString(),
        input.saveAsDraft ? null : now.toISOString(),
        completionMode,
        input.completionModeReason ?? null,
        input.scheduleId ?? null,
        input.occurrenceAt ? new Date(input.occurrenceAt).toISOString() : null,
      ],
    );
    const missionId = mInserted.rows[0].id;

    // Tổ tham gia mission
    const missionTeamIds = [...new Set([...(input.teamIds ?? []), ...tasksInput.map((t) => t.ownerTeamId)].filter(Boolean))];
    for (const tid of missionTeamIds) {
      await tx.query(`INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [missionId, tid]);
    }

    // Tạo các task
    const tempKeyToTaskId = new Map<string, string>();
    const notifyAssignees: { memberId: string; taskTitle: string }[] = [];
    const notifyTeamLeadsForDelegation: { teamId: string; taskTitle: string }[] = [];

    for (let i = 0; i < tasksInput.length; i++) {
      const t = tasksInput[i];
      const taskDeadline = new Date(t.deadline || input.deadline);
      if (Number.isNaN(taskDeadline.getTime())) {
        throw new AppError(400, "INVALID_TASK_DEADLINE", `Thời hạn của task "${t.title}" không hợp lệ.`);
      }
      if (!input.saveAsDraft && taskDeadline.getTime() > missionDeadline.getTime()) {
        throw new AppError(400, "TASK_DEADLINE_EXCEEDS_MISSION", `Thời hạn task "${t.title}" không được vượt quá hạn nhiệm vụ.`);
      }
      const taskCode = `${code}-T${i + 1}`;
      const taskStatus: TaskStatus = input.saveAsDraft ? "DRAFT" : "ASSIGNED";
      const taskWeight = Number(t.weight ?? 1);

      // Tự gợi ý reviewer mặc định là trưởng tổ phụ trách nếu chưa chọn
      let reviewerId = t.reviewerId ?? null;
      if (!reviewerId) {
        const leadRes = await tx.query<{ member_id: string }>(
          `SELECT tm.member_id FROM team_memberships tm
           JOIN members m ON m.id = tm.member_id
           WHERE tm.team_id = $1 AND tm.effective_to IS NULL
             AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
             AND m.access_enabled = true AND m.activity_status = 'ACTIVE'
           ORDER BY CASE WHEN tm.team_title = 'LEADER' THEN 1 ELSE 2 END
           LIMIT 1`,
          [t.ownerTeamId],
        );
        reviewerId = leadRes.rows[0]?.member_id ?? null;
      }

      const tInserted = await tx.query<{ id: string }>(
        `INSERT INTO tasks (
           mission_id, code, title, description, deliverable, requires_artifact,
           owner_team_id, owner_id, reviewer_id, sort_order, submission_mode, required,
           weight, urgency, importance, deadline_original, deadline_current, status,
           metric_enabled, metric_unit, metric_target, metric_points_per_unit
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $16, $17,
           $18, $19, $20, $21
         ) RETURNING id`,
        [
          missionId,
          taskCode,
          t.title.trim(),
          (t.description ?? "").trim(),
          (t.deliverable ?? "").trim(),
          t.requiresArtifact ?? true,
          t.ownerTeamId,
          t.ownerId || input.ownerId,
          reviewerId,
          i + 1,
          t.submissionMode ?? "INDIVIDUAL",
          t.required ?? true,
          taskWeight,
          t.urgency ?? finalUrgency,
          t.importance ?? input.importance ?? "NORMAL",
          taskDeadline.toISOString(),
          taskStatus,
          Boolean(t.metricEnabled),
          (t.metricUnit ?? "").trim(),
          t.metricTarget ?? null,
          t.metricPointsPerUnit ?? 1,
        ],
      );
      const taskId = tInserted.rows[0].id;
      if (t.tempKey) tempKeyToTaskId.set(t.tempKey, taskId);

      for (const supId of [...new Set(t.supervisorIds ?? [])]) {
        await tx.query(`INSERT INTO task_supervisors (task_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [taskId, supId]);
      }
      for (const colTeamId of [...new Set(t.collaboratingTeamIds ?? [])]) {
        if (colTeamId !== t.ownerTeamId) {
          await tx.query(`INSERT INTO task_collaborating_teams (task_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [taskId, colTeamId]);
        }
      }

      const assignees = [...new Set(t.assigneeIds ?? [])];
      if (assignees.length > 0) {
        const defaultShare = Number((taskWeight / assignees.length).toFixed(2));
        for (const memberId of assignees) {
          const w = t.assigneeWeights?.[memberId] ?? defaultShare;
          await tx.query(
            `INSERT INTO task_assignments (
               task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline, weight
             ) VALUES ($1, $2, $3, 'PENDING', $4, $4, $5)`,
            [taskId, memberId, actor.memberId, taskDeadline.toISOString(), Math.max(0.01, w)],
          );
          if (!input.saveAsDraft) {
            notifyAssignees.push({ memberId, taskTitle: t.title.trim() });
          }
        }
      } else if (!input.saveAsDraft) {
        // Không chỉ định người thực hiện trực tiếp → giao về Tổ trưởng / Phó tổ điều phối phân công xuống thành viên
        notifyTeamLeadsForDelegation.push({ teamId: t.ownerTeamId, taskTitle: t.title.trim() });
      }
    }

    // Lưu phụ thuộc task
    for (const t of tasksInput) {
      if (!t.tempKey || !t.predecessorTempKeys?.length) continue;
      const taskId = tempKeyToTaskId.get(t.tempKey);
      if (!taskId) continue;
      for (const predKey of t.predecessorTempKeys) {
        const predId = tempKeyToTaskId.get(predKey);
        if (predId && predId !== taskId) {
          await tx.query(
            `INSERT INTO task_dependencies (task_id, predecessor_task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [taskId, predId],
          );
        }
      }
    }

    // Kênh đăng tải (hỗ trợ nhiều trang tùy chỉnh khác nhau dưới kênh OTHER, loại trùng an toàn)
    const seenChannelKeys = new Set<string>();
    for (const ch of input.publicationChannels ?? []) {
      const customName = ch.customChannelName?.trim() || null;
      const dedupeKey = `${ch.channelId}::${(customName ?? "").toLowerCase()}`;
      if (seenChannelKeys.has(dedupeKey)) continue;
      seenChannelKeys.add(dedupeKey);
      await tx.query(
        `INSERT INTO mission_publication_requirements (mission_id, channel_id, custom_channel_name, required, required_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [missionId, ch.channelId, customName, ch.required ?? true, ch.requiredCount ?? 1],
      );
    }

    await writeActivity(
      {
        missionId,
        actorId: actor.memberId,
        action: input.saveAsDraft ? "MISSION_DRAFT_SAVED" : "MISSION_ASSIGNED",
        summary: input.saveAsDraft
          ? `${actor.displayName} đã lưu nháp nhiệm vụ ${code}.`
          : `${actor.displayName} đã giao nhiệm vụ ${code} với ${tasksInput.length} task.`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: input.saveAsDraft ? "MISSION_DRAFT_SAVED" : "MISSION_ASSIGNED",
        targetType: "MISSION",
        targetId: missionId,
        safeDiff: { code, taskCount: tasksInput.length, completionMode, urgency: finalUrgency },
        requestId,
      },
      tx,
    );

    if (!input.saveAsDraft) {
      for (const item of notifyAssignees) {
        await createNotification(
          {
            recipientId: item.memberId,
            eventType: "TASK_ASSIGNED",
            targetType: "MISSION",
            targetId: missionId,
            title: `Bạn được giao việc mới: ${code}`,
            message: `${actor.displayName} đã giao task "${item.taskTitle}" trong nhiệm vụ "${input.title.trim()}".`,
            link: `/missions/${missionId}`,
            dedupeKey: `assign:${missionId}:${item.memberId}:${item.taskTitle}`,
          },
          tx,
        );
      }

      // Thông báo Trưởng/Phó tổ tiếp nhận và phân công cho các task chưa chỉ định mem cụ thể
      for (const item of notifyTeamLeadsForDelegation) {
        const leads = await tx.query<{ member_id: string; team_name: string }>(
          `SELECT tm.member_id, t.name AS team_name
           FROM team_memberships tm
           JOIN teams t ON t.id = tm.team_id
           JOIN members m ON m.id = tm.member_id
           WHERE tm.team_id = $1 AND tm.effective_to IS NULL
             AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
             AND m.access_enabled = true AND m.activity_status = 'ACTIVE'`,
          [item.teamId],
        );
        for (const lead of leads.rows) {
          if (lead.member_id === actor.memberId) continue;
          await createNotification(
            {
              recipientId: lead.member_id,
              eventType: "TASK_AWAITING_DELEGATION",
              targetType: "MISSION",
              targetId: missionId,
              title: `Tổ bạn có việc mới chờ phân công: ${code}`,
              message: `${actor.displayName} đã giao task "${item.taskTitle}" cho ${lead.team_name}. Vui lòng tiếp nhận và phân công thành viên thực hiện.`,
              link: `/missions/${missionId}`,
              dedupeKey: `delegate:${missionId}:${lead.member_id}:${item.taskTitle}`,
            },
            tx,
          );
        }
      }
    }

    return { id: missionId, code, status: missionStatus, version: 1 };
  });
}

/** Giao nhiệm vụ từ trạng thái DRAFT → ASSIGNED */
export async function assignDraftMission(actor: AuthActor, missionId: string, requestId?: string) {
  return withTransaction(async (tx) => {
    const mRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: MissionStatus;
      creator_id: string;
      owner_id: string;
      deadline_current: Date;
    }>(`SELECT id, code, title, status, creator_id, owner_id, deadline_current FROM missions WHERE id = $1`, [missionId]);
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");
    if (mission.status !== "DRAFT") {
      throw new AppError(409, "INVALID_STATE", "Chỉ có thể giao nhiệm vụ đang ở trạng thái Nháp.");
    }

    const teamRows = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [missionId]);
    requirePermission(actor, "mission.manage", {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teamRows.rows.map((r) => r.team_id),
    });

    const taskCount = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM tasks WHERE mission_id = $1`, [missionId]);
    if (Number(taskCount.rows[0]?.c ?? 0) === 0) {
      throw new AppError(400, "NO_TASKS", "Nhiệm vụ cần tối thiểu 01 task trước khi giao.");
    }

    await tx.query(
      `UPDATE missions SET status = 'ASSIGNED', assigned_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
      [missionId],
    );
    await tx.query(
      `UPDATE tasks SET status = 'ASSIGNED', updated_at = now() WHERE mission_id = $1 AND status = 'DRAFT'`,
      [missionId],
    );

    const assignees = await tx.query<{ member_id: string; task_title: string }>(
      `SELECT ta.member_id, t.title AS task_title
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE t.mission_id = $1 AND ta.status = 'PENDING'`,
      [missionId],
    );

    for (const a of assignees.rows) {
      await createNotification(
        {
          recipientId: a.member_id,
          eventType: "TASK_ASSIGNED",
          targetType: "MISSION",
          targetId: missionId,
          title: `Bạn được giao việc mới: ${mission.code}`,
          message: `${actor.displayName} đã giao task "${a.task_title}" trong nhiệm vụ "${mission.title}".`,
          link: `/missions/${missionId}`,
        },
        tx,
      );
    }

    // Thông báo Trưởng/Phó tổ cho các task chưa có người thực hiện cụ thể
    const unassignedTasks = await tx.query<{ owner_team_id: string; title: string }>(
      `SELECT t.owner_team_id, t.title
       FROM tasks t
       WHERE t.mission_id = $1 AND t.status <> 'CANCELLED'
         AND NOT EXISTS (
           SELECT 1 FROM task_assignments ta
           WHERE ta.task_id = t.id AND ta.status NOT IN ('TRANSFERRED', 'CANCELLED', 'DECLINED')
         )`,
      [missionId],
    );
    for (const ut of unassignedTasks.rows) {
      const leads = await tx.query<{ member_id: string; team_name: string }>(
        `SELECT tm.member_id, tm2.name AS team_name
         FROM team_memberships tm
         JOIN teams tm2 ON tm2.id = tm.team_id
         JOIN members m ON m.id = tm.member_id
         WHERE tm.team_id = $1 AND tm.effective_to IS NULL
           AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
           AND m.access_enabled = true AND m.activity_status = 'ACTIVE'`,
        [ut.owner_team_id],
      );
      for (const lead of leads.rows) {
        if (lead.member_id === actor.memberId) continue;
        await createNotification(
          {
            recipientId: lead.member_id,
            eventType: "TASK_AWAITING_DELEGATION",
            targetType: "MISSION",
            targetId: missionId,
            title: `Tổ bạn có việc mới chờ phân công: ${mission.code}`,
            message: `${actor.displayName} đã giao task "${ut.title}" cho ${lead.team_name}. Vui lòng tiếp nhận và phân công thành viên thực hiện.`,
            link: `/missions/${missionId}`,
          },
          tx,
        );
      }
    }

    await writeActivity(
      { missionId, actorId: actor.memberId, action: "MISSION_ASSIGNED", summary: `${actor.displayName} đã giao nhiệm vụ ${mission.code}.` },
      tx,
    );
    await writeAudit(
      { actorId: actor.memberId, action: "MISSION_ASSIGNED", targetType: "MISSION", targetId: missionId, requestId },
      tx,
    );
    return { id: missionId, status: "ASSIGNED" as const };
  });
}

/** Danh sách nhiệm vụ có kiểm tra quyền & nhóm theo Khối nhiệm vụ (mục 2.2) */
export async function listMissions(
  actor: AuthActor,
  filters?: {
    groupId?: string;
    teamId?: string;
    status?: string;
    urgency?: string;
    importance?: string;
    search?: string;
    overdueOnly?: boolean;
    limit?: number;
    offset?: number;
  },
) {
  const params: unknown[] = [];
  const where: string[] = [];

  const scope = buildMissionScopeClause(actor, 1);
  where.push(scope.clause);
  params.push(...scope.params);

  // Thành viên Bậc 04 & CTV Bậc 05 không thấy bản nháp chưa giao
  if (isWorkerRole(actor.role)) {
    where.push(`m.status <> 'DRAFT'`);
  }
  if (filters?.groupId) {
    params.push(filters.groupId);
    where.push(`m.group_id = $${params.length}`);
  }
  if (filters?.teamId) {
    params.push(filters.teamId);
    where.push(`EXISTS (SELECT 1 FROM mission_teams mt WHERE mt.mission_id = m.id AND mt.team_id = $${params.length})`);
  }
  if (filters?.status) {
    params.push(filters.status);
    where.push(`m.status = $${params.length}`);
  }
  if (filters?.urgency) {
    params.push(filters.urgency);
    where.push(`m.urgency = $${params.length}`);
  }
  if (filters?.importance) {
    params.push(filters.importance);
    where.push(`m.importance = $${params.length}`);
  }
  if (filters?.search?.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    where.push(`(lower(m.title) LIKE $${params.length} OR lower(m.code) LIKE $${params.length})`);
  }
  if (filters?.overdueOnly) {
    where.push(`m.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED') AND m.deadline_current < now()`);
  }

  const limit = Math.min(100, Math.max(1, filters?.limit ?? 50));
  const offset = Math.max(0, filters?.offset ?? 0);
  params.push(limit, offset);

  const rows = await query<{
    id: string;
    code: string;
    group_id: string;
    group_name: string;
    group_sort: number;
    title: string;
    status: MissionStatus;
    importance: ImportanceLevel;
    urgency: UrgencyLevel;
    confidentiality: ConfidentialityLevel;
    directive_authorities: unknown;
    deadline_original: Date;
    deadline_current: Date;
    completion_mode: CompletionMode;
    owner_id: string;
    owner_name: string;
    creator_name: string;
    version: number;
    total_required_tasks: string | number;
    completed_required_tasks: string | number;
    team_names: string | null;
  }>(
    `SELECT m.id, m.code, m.group_id, tg.name AS group_name, tg.sort_order AS group_sort,
            m.title, m.status, m.importance, m.urgency, m.confidentiality, m.directive_authorities,
            m.deadline_original, m.deadline_current,
            m.completion_mode, m.owner_id, owner.display_name AS owner_name, creator.display_name AS creator_name,
            m.version,
            (SELECT count(*) FROM tasks t WHERE t.mission_id = m.id AND t.required = true AND t.status <> 'CANCELLED') AS total_required_tasks,
            (SELECT count(*) FROM tasks t WHERE t.mission_id = m.id AND t.required = true AND t.status = 'COMPLETED') AS completed_required_tasks,
            (SELECT string_agg(tm.name, ', ' ORDER BY tm.sort_order) FROM mission_teams mt JOIN teams tm ON tm.id = mt.team_id WHERE mt.mission_id = m.id) AS team_names
     FROM missions m
     JOIN task_groups tg ON tg.id = m.group_id
     JOIN members owner ON owner.id = m.owner_id
     JOIN members creator ON creator.id = m.creator_id
     WHERE ${where.join(" AND ")}
     ORDER BY
       tg.sort_order ASC,
       tg.name ASC,
       CASE WHEN m.status IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END ASC,
       m.deadline_current ASC,
       m.code ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const now = Date.now();
  const observer = isObserverRole(actor.role);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    groupId: r.group_id,
    groupName: r.group_name,
    title: r.title,
    status: r.status,
    importance: r.importance,
    urgency: r.urgency,
    confidentiality: r.confidentiality ?? "NORMAL",
    directiveAuthorities: Array.isArray(r.directive_authorities) ? (r.directive_authorities as string[]) : [],
    deadlineOriginal: new Date(r.deadline_original).toISOString(),
    deadlineCurrent: new Date(r.deadline_current).toISOString(),
    isOverdue: !["DRAFT", "COMPLETED", "CANCELLED"].includes(r.status) && new Date(r.deadline_current).getTime() < now,
    completionMode: r.completion_mode,
    ownerId: observer ? "" : r.owner_id,
    ownerName: observer ? "Ban Biên tập TNTH" : r.owner_name,
    creatorName: observer ? "Ban Biên tập TNTH" : r.creator_name,
    teamNames: observer ? "" : (r.team_names ?? ""),
    progress: {
      completed: Number(r.completed_required_tasks ?? 0),
      total: Number(r.total_required_tasks ?? 0),
    },
    version: r.version,
  }));
}

/** Chi tiết đầy đủ 1 nhiệm vụ kèm task, assignment, sản phẩm (hỗ trợ xem chéo sản phẩm trong cùng nhiệm vụ), kênh đăng tải, trao đổi, timeline */
export async function getMissionDetail(actor: AuthActor, missionId: string) {
  const mission = await queryOne<{
    id: string;
    code: string;
    group_id: string;
    group_name: string;
    title: string;
    description: string;
    expected_outcome: string;
    refs: unknown;
    directive_authorities: unknown;
    confidentiality: ConfidentialityLevel;
    owner_id: string;
    owner_name: string;
    creator_id: string;
    creator_name: string;
    status: MissionStatus;
    previous_status: string | null;
    importance: ImportanceLevel;
    urgency: UrgencyLevel;
    urgency_override_reason: string | null;
    deadline_original: Date;
    deadline_current: Date;
    starts_at: Date | null;
    assigned_at: Date | null;
    completion_mode: CompletionMode;
    completion_mode_reason: string | null;
    completed_at: Date | null;
    completed_by: string | null;
    hold_until: Date | null;
    hold_reason: string | null;
    cancel_reason: string | null;
    version: number;
    created_at: Date;
  }>(
    `SELECT m.*, tg.name AS group_name, owner.display_name AS owner_name, creator.display_name AS creator_name
     FROM missions m
     JOIN task_groups tg ON tg.id = m.group_id
     JOIN members owner ON owner.id = m.owner_id
     JOIN members creator ON creator.id = m.creator_id
     WHERE m.id = $1`,
    [missionId],
  );
  if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

  const teams = await query<{ id: string; code: string; name: string }>(
    `SELECT t.id, t.code, t.name FROM mission_teams mt JOIN teams t ON t.id = mt.team_id WHERE mt.mission_id = $1 ORDER BY t.sort_order`,
    [missionId],
  );

  const participants = await query<{ member_id: string }>(
    `SELECT DISTINCT member_id FROM (
       SELECT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.mission_id = $1
       UNION
       SELECT ts.member_id FROM task_supervisors ts JOIN tasks t ON t.id = ts.task_id WHERE t.mission_id = $1
       UNION
       SELECT t.owner_id AS member_id FROM tasks t WHERE t.mission_id = $1
       UNION
       SELECT t.reviewer_id AS member_id FROM tasks t WHERE t.mission_id = $1 AND t.reviewer_id IS NOT NULL
     ) p`,
    [missionId],
  );

  const policyRes = {
    missionCreatorId: mission.creator_id,
    missionOwnerId: mission.owner_id,
    missionTeamIds: teams.map((t) => t.id),
    missionParticipantIds: participants.map((p) => p.member_id),
    missionStatus: mission.status,
  };

  requirePermission(actor, "mission.view", policyRes, "Bạn không có quyền xem nhiệm vụ này.");
  if (mission.status === "DRAFT" && isWorkerRole(actor.role)) {
    throw new AppError(403, "FORBIDDEN", "Nhiệm vụ đang ở trạng thái nháp.");
  }
  const observer = isObserverRole(actor.role);
  if (observer && mission.status !== "COMPLETED") {
    throw new AppError(403, "FORBIDDEN", "Tài khoản Ngoại lệ (Bậc 06) chỉ được xem kết quả của nhiệm vụ đã hoàn thành.");
  }

  const tasks = await query<{
    id: string;
    code: string;
    title: string;
    description: string;
    deliverable: string;
    requires_artifact: boolean;
    owner_team_id: string;
    owner_team_name: string;
    owner_id: string;
    owner_name: string;
    reviewer_id: string | null;
    reviewer_name: string | null;
    sort_order: number;
    submission_mode: SubmissionMode;
    required: boolean;
    weight: string | number;
    urgency: UrgencyLevel;
    importance: ImportanceLevel;
    deadline_original: Date;
    deadline_current: Date;
    status: TaskStatus;
    hold_until: Date | null;
    hold_reason: string | null;
    completed_at: Date | null;
    version: number;
    metric_enabled: boolean;
    metric_unit: string;
    metric_target: string | number | null;
    metric_points_per_unit: string | number;
  }>(
    `SELECT t.*, tm.name AS owner_team_name, ow.display_name AS owner_name, rv.display_name AS reviewer_name
     FROM tasks t
     JOIN teams tm ON tm.id = t.owner_team_id
     JOIN members ow ON ow.id = t.owner_id
     LEFT JOIN members rv ON rv.id = t.reviewer_id
     WHERE t.mission_id = $1
     ORDER BY t.sort_order ASC, t.created_at ASC`,
    [missionId],
  );

  const taskIds = tasks.map((t) => t.id);

  const [assignments, supervisors, deps, submissions, pubReqs, comments, activities, deadlineHist, extensionReqs] = await Promise.all([
    taskIds.length > 0
      ? query<{
          id: string;
          task_id: string;
          member_id: string;
          member_name: string;
          member_role: MemberRole;
          status: string;
          accepted_at: Date | null;
          declined_at: Date | null;
          decline_reason: string | null;
          original_deadline: Date;
          evaluation_deadline: Date;
          late_against_original_deadline: boolean;
          weight: string | number;
          submitted_at: Date | null;
          effective_submitted_at: Date | null;
          reviewed_at: Date | null;
          transfer_reason: string | null;
          revision_count: number;
          needs_reassignment: boolean;
          version: number;
        }>(
          `SELECT ta.*, m.display_name AS member_name, m.role AS member_role
           FROM task_assignments ta
           JOIN members m ON m.id = ta.member_id
           WHERE ta.task_id = ANY($1::uuid[])
           ORDER BY ta.created_at ASC`,
          [taskIds],
        )
      : Promise.resolve([]),
    taskIds.length > 0
      ? query<{ task_id: string; member_id: string; display_name: string }>(
          `SELECT ts.task_id, ts.member_id, m.display_name FROM task_supervisors ts JOIN members m ON m.id = ts.member_id WHERE ts.task_id = ANY($1::uuid[])`,
          [taskIds],
        )
      : Promise.resolve([]),
    taskIds.length > 0
      ? query<{ task_id: string; predecessor_task_id: string; pred_code: string; pred_title: string; pred_status: TaskStatus }>(
          `SELECT td.task_id, td.predecessor_task_id, pt.code AS pred_code, pt.title AS pred_title, pt.status AS pred_status
           FROM task_dependencies td
           JOIN tasks pt ON pt.id = td.predecessor_task_id
           WHERE td.task_id = ANY($1::uuid[])`,
          [taskIds],
        )
      : Promise.resolve([]),
    taskIds.length > 0
      ? query<{
          submission_id: string;
          task_id: string;
          assignment_id: string | null;
          version_id: string;
          version_no: number;
          submission_type: string;
          note: string;
          text_content: string;
          links: unknown;
          submitted_at: Date;
          submitted_by: string;
          submitted_by_name: string;
          state: string;
          review_id: string | null;
          review_decision: string | null;
          review_note: string | null;
          reviewer_name: string | null;
          reviewed_at: Date | null;
        }>(
          `SELECT s.id AS submission_id, s.task_id, s.assignment_id,
                  sv.id AS version_id, sv.version_no, sv.submission_type, sv.note, sv.text_content,
                  sv.links, sv.submitted_at, sv.submitted_by, sub_m.display_name AS submitted_by_name, sv.state,
                  r.id AS review_id, r.decision AS review_decision, r.note AS review_note,
                  rev_m.display_name AS reviewer_name, r.reviewed_at
           FROM submissions s
           JOIN submission_versions sv ON sv.submission_id = s.id
           JOIN members sub_m ON sub_m.id = sv.submitted_by
           LEFT JOIN reviews r ON r.submission_version_id = sv.id
           LEFT JOIN members rev_m ON rev_m.id = r.reviewer_id
           WHERE s.task_id = ANY($1::uuid[])
           ORDER BY sv.submitted_at DESC`,
          [taskIds],
        )
      : Promise.resolve([]),
    query<{
      id: string;
      channel_id: string;
      channel_code: string;
      channel_name: string;
      custom_channel_name: string | null;
      required: boolean;
      required_count: number;
      confirmed_by: string | null;
      confirmed_by_name: string | null;
      confirmed_at: Date | null;
      note: string;
    }>(
      `SELECT r.*, pc.code AS channel_code, pc.name AS channel_name, cm.display_name AS confirmed_by_name
       FROM mission_publication_requirements r
       JOIN publication_channels pc ON pc.id = r.channel_id
       LEFT JOIN members cm ON cm.id = r.confirmed_by
       WHERE r.mission_id = $1
       ORDER BY pc.sort_order ASC`,
      [missionId],
    ),
    query<{
      id: string;
      task_id: string | null;
      author_id: string;
      author_name: string;
      author_role: MemberRole;
      body: string;
      created_at: Date;
      edited_at: Date | null;
    }>(
      `SELECT c.id, c.task_id, c.author_id, m.display_name AS author_name, m.role AS author_role, c.body, c.created_at, c.edited_at
       FROM comments c
       JOIN members m ON m.id = c.author_id
       WHERE c.mission_id = $1 AND c.hidden_at IS NULL
       ORDER BY c.created_at ASC`,
      [missionId],
    ),
    query<{
      id: string;
      task_id: string | null;
      action: string;
      summary: string;
      actor_name: string | null;
      created_at: Date;
    }>(
      `SELECT a.id, a.task_id, a.action, a.summary, m.display_name AS actor_name, a.created_at
       FROM activity_logs a
       LEFT JOIN members m ON m.id = a.actor_id
       WHERE a.mission_id = $1
       ORDER BY a.created_at DESC
       LIMIT 60`,
      [missionId],
    ),
    query<{
      id: string;
      task_id: string | null;
      assignment_id: string | null;
      old_deadline: Date;
      new_deadline: Date;
      reason: string;
      approved_exception: boolean;
      changed_by_name: string;
      assignee_name: string | null;
      changed_at: Date;
    }>(
      `SELECT dh.id, dh.task_id, dh.assignment_id, dh.old_deadline, dh.new_deadline, dh.reason, dh.approved_exception,
              m.display_name AS changed_by_name, am.display_name AS assignee_name, dh.changed_at
       FROM deadline_history dh
       JOIN members m ON m.id = dh.changed_by
       LEFT JOIN task_assignments ta ON ta.id = dh.assignment_id
       LEFT JOIN members am ON am.id = ta.member_id
       WHERE dh.mission_id = $1
       ORDER BY dh.changed_at DESC`,
      [missionId],
    ),
    query<{
      id: string;
      assignment_id: string;
      task_id: string;
      task_code: string;
      task_title: string;
      owner_team_id: string;
      requester_id: string;
      requester_name: string;
      current_deadline: Date;
      requested_deadline: Date;
      reason: string;
      status: string;
      approved_deadline: Date | null;
      resolver_id: string | null;
      resolver_name: string | null;
      resolver_note: string;
      resolved_at: Date | null;
      created_at: Date;
    }>(
      `SELECT der.*, t.code AS task_code, t.title AS task_title, t.owner_team_id,
              req_m.display_name AS requester_name, res_m.display_name AS resolver_name
       FROM deadline_extension_requests der
       JOIN tasks t ON t.id = der.task_id
       JOIN members req_m ON req_m.id = der.requester_id
       LEFT JOIN members res_m ON res_m.id = der.resolver_id
       WHERE der.mission_id = $1
       ORDER BY der.created_at DESC`,
      [missionId],
    ),
  ]);

  // Lấy file đính kèm theo từng submission_version
  const versionIds = submissions.map((s) => s.version_id);
  const subFiles =
    versionIds.length > 0
      ? await query<{
          submission_version_id: string;
          file_id: string;
          original_name: string;
          relative_path: string | null;
          safe_mime: string;
          size_bytes: string | number;
        }>(
          `SELECT fl.submission_version_id, f.id AS file_id, f.original_name, f.relative_path, f.safe_mime, f.size_bytes
           FROM file_links fl
           JOIN files f ON f.id = fl.file_id
           WHERE fl.submission_version_id = ANY($1::uuid[]) AND f.state = 'ACTIVE'`,
          [versionIds],
        )
      : [];

  const pubReqIds = pubReqs.map((p) => p.id);
  const pubLinks =
    pubReqIds.length > 0
      ? await query<{
          id: string;
          requirement_id: string;
          url: string;
          title: string;
          posted_at: Date | null;
          created_by_name: string;
          created_at: Date;
          note: string;
        }>(
          `SELECT pl.id, pl.requirement_id, pl.url, pl.title, pl.posted_at, m.display_name AS created_by_name, pl.created_at, pl.note
           FROM publication_links pl
           JOIN members m ON m.id = pl.created_by
           WHERE pl.requirement_id = ANY($1::uuid[]) AND pl.active = true
           ORDER BY pl.created_at DESC`,
          [pubReqIds],
        )
      : [];

  const completionEval = await evaluateMissionCompletion(missionId);
  const nowMs = Date.now();

  return {
    id: mission.id,
    code: mission.code,
    groupId: mission.group_id,
    groupName: mission.group_name,
    title: mission.title,
    description: mission.description,
    expectedOutcome: mission.expected_outcome,
    refs: observer ? [] : Array.isArray(mission.refs) ? mission.refs : [],
    directiveAuthorities: Array.isArray(mission.directive_authorities)
      ? (mission.directive_authorities as string[])
      : [],
    confidentiality: mission.confidentiality ?? "NORMAL",
    observerMode: observer,
    ownerId: observer ? "" : mission.owner_id,
    ownerName: observer ? "Ban Biên tập TNTH" : mission.owner_name,
    creatorId: observer ? "" : mission.creator_id,
    creatorName: observer ? "Ban Biên tập TNTH" : mission.creator_name,
    status: mission.status,
    previousStatus: observer ? null : mission.previous_status,
    importance: mission.importance,
    urgency: mission.urgency,
    urgencyOverrideReason: observer ? null : mission.urgency_override_reason,
    deadlineOriginal: new Date(mission.deadline_original).toISOString(),
    deadlineCurrent: new Date(mission.deadline_current).toISOString(),
    isOverdue: !["DRAFT", "COMPLETED", "CANCELLED"].includes(mission.status) && new Date(mission.deadline_current).getTime() < nowMs,
    startsAt: mission.starts_at ? new Date(mission.starts_at).toISOString() : null,
    assignedAt: mission.assigned_at ? new Date(mission.assigned_at).toISOString() : null,
    completionMode: mission.completion_mode,
    completionModeReason: observer ? null : mission.completion_mode_reason,
    completedAt: mission.completed_at ? new Date(mission.completed_at).toISOString() : null,
    holdUntil: observer ? null : mission.hold_until ? new Date(mission.hold_until).toISOString() : null,
    holdReason: observer ? null : mission.hold_reason,
    cancelReason: observer ? null : mission.cancel_reason,
    version: mission.version,
    teams: observer ? [] : teams,
    completion: completionEval,
    permissions: {
      canManage: !observer && can(actor, "mission.manage", policyRes),
      canComplete:
        !observer &&
        can(actor, "mission.complete", policyRes) &&
        completionEval.canComplete &&
        mission.status !== "COMPLETED" &&
        mission.status !== "CANCELLED" &&
        mission.status !== "DRAFT",
    },
    tasks: tasks.map((t) => {
      const tAssigns = observer ? [] : assignments.filter((a) => a.task_id === t.id);
      const tSubs = submissions
        .filter((s) => s.task_id === t.id)
        .filter((s) => (!observer ? true : s.state === "APPROVED"));
      const tDeps = observer ? [] : deps.filter((d) => d.task_id === t.id);
      const blockedBy = tDeps.filter((d) => d.pred_status !== "COMPLETED");
      return {
        id: t.id,
        code: t.code,
        title: t.title,
        description: observer ? "" : t.description,
        deliverable: t.deliverable,
        requiresArtifact: t.requires_artifact,
        ownerTeamId: observer ? "" : t.owner_team_id,
        ownerTeamName: observer ? "Ban Biên tập TNTH" : t.owner_team_name,
        ownerId: observer ? "" : t.owner_id,
        ownerName: observer ? "" : t.owner_name,
        reviewerId: observer ? null : t.reviewer_id,
        reviewerName: observer ? null : t.reviewer_name,
        sortOrder: t.sort_order,
        submissionMode: t.submission_mode,
        required: t.required,
        weight: Number(t.weight),
        urgency: t.urgency,
        importance: t.importance,
        deadlineOriginal: new Date(t.deadline_original).toISOString(),
        deadlineCurrent: new Date(t.deadline_current).toISOString(),
        isOverdue: !["DRAFT", "COMPLETED", "CANCELLED"].includes(t.status) && new Date(t.deadline_current).getTime() < nowMs,
        status: t.status,
        completedAt: t.completed_at ? new Date(t.completed_at).toISOString() : null,
        version: t.version,
        metricEnabled: Boolean(t.metric_enabled),
        metricUnit: t.metric_unit ?? "",
        metricTarget: t.metric_target !== null && t.metric_target !== undefined ? Number(t.metric_target) : null,
        metricPointsPerUnit: Number(t.metric_points_per_unit ?? 1),
        canManageTask:
          !observer &&
          (isBoardLeadership(actor.role) ||
            (isTeamLeadership(actor.role) &&
              (actor.leadTeamIds.includes(t.owner_team_id) || t.owner_id === actor.memberId || mission.creator_id === actor.memberId))),
        supervisors: observer
          ? []
          : supervisors
              .filter((s) => s.task_id === t.id)
              .map((s) => ({ memberId: s.member_id, displayName: s.display_name })),
        dependencies: tDeps.map((d) => ({
          taskId: d.predecessor_task_id,
          code: d.pred_code,
          title: d.pred_title,
          status: d.pred_status,
        })),
        isBlocked: blockedBy.length > 0,
        assignments: tAssigns.map((a) => {
          const aExts = extensionReqs.filter((er) => er.assignment_id === a.id);
          const pendingExt = aExts.find((er) => er.status === "PENDING") ?? null;
          const approvedCount = aExts.filter((er) => er.status === "APPROVED").length;
          return {
            id: a.id,
            memberId: a.member_id,
            memberName: a.member_name,
            memberRole: a.member_role,
            status: a.status,
            acceptedAt: a.accepted_at ? new Date(a.accepted_at).toISOString() : null,
            declinedAt: a.declined_at ? new Date(a.declined_at).toISOString() : null,
            declineReason: a.decline_reason,
            originalDeadline: new Date(a.original_deadline).toISOString(),
            evaluationDeadline: new Date(a.evaluation_deadline).toISOString(),
            lateAgainstOriginalDeadline: Boolean(a.late_against_original_deadline),
            extensionCount: approvedCount,
            revisionCount: Number(a.revision_count ?? 0),
            needsReassignment: Boolean(a.needs_reassignment),
            pendingExtension: pendingExt
              ? {
                  id: pendingExt.id,
                  requestedDeadline: new Date(pendingExt.requested_deadline).toISOString(),
                  reason: pendingExt.reason,
                  createdAt: new Date(pendingExt.created_at).toISOString(),
                }
              : null,
            weight: Number(a.weight),
            submittedAt: a.submitted_at ? new Date(a.submitted_at).toISOString() : null,
            effectiveSubmittedAt: a.effective_submitted_at ? new Date(a.effective_submitted_at).toISOString() : null,
            reviewedAt: a.reviewed_at ? new Date(a.reviewed_at).toISOString() : null,
            transferReason: a.transfer_reason,
            version: a.version,
          };
        }),
        submissions: tSubs.map((sv) => ({
          submissionId: sv.submission_id,
          assignmentId: observer ? null : sv.assignment_id,
          versionId: sv.version_id,
          versionNo: sv.version_no,
          submissionType: sv.submission_type,
          note: sv.note,
          textContent: sv.text_content,
          links: Array.isArray(sv.links) ? sv.links : [],
          submittedAt: new Date(sv.submitted_at).toISOString(),
          submittedBy: observer ? "" : sv.submitted_by,
          submittedByName: observer ? "Ban Biên tập TNTH" : sv.submitted_by_name,
          state: sv.state,
          canReview:
            !observer &&
            sv.state === "SUBMITTED" &&
            can(actor, "task.review", {
              ownerTeamId: t.owner_team_id,
              taskReviewerId: t.reviewer_id,
              taskSubmitterId: sv.submitted_by,
            }),
          review:
            !observer && sv.review_id
              ? {
                  id: sv.review_id,
                  decision: sv.review_decision,
                  note: sv.review_note,
                  reviewerName: sv.reviewer_name,
                  reviewedAt: sv.reviewed_at ? new Date(sv.reviewed_at).toISOString() : null,
                }
              : null,
          files: subFiles
            .filter((f) => f.submission_version_id === sv.version_id)
            .map((f) => ({
              id: f.file_id,
              originalName: f.original_name,
              relativePath: f.relative_path,
              safeMime: f.safe_mime,
              sizeBytes: Number(f.size_bytes),
            })),
        })),
      };
    }),
    publications: pubReqs.map((r) => ({
      id: r.id,
      channelId: r.channel_id,
      channelCode: r.channel_code,
      channelName: r.custom_channel_name ? `${r.channel_name}: ${r.custom_channel_name}` : r.channel_name,
      required: r.required,
      requiredCount: r.required_count,
      confirmedBy: observer ? null : r.confirmed_by,
      confirmedByName: observer ? null : r.confirmed_by_name,
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
      note: observer ? "" : r.note,
      links: pubLinks
        .filter((l) => l.requirement_id === r.id)
        .map((l) => ({
          id: l.id,
          url: l.url,
          title: l.title,
          postedAt: l.posted_at ? new Date(l.posted_at).toISOString() : null,
          createdByName: observer ? "Ban Biên tập TNTH" : l.created_by_name,
          createdAt: new Date(l.created_at).toISOString(),
          note: observer ? "" : l.note,
        })),
    })),
    comments: observer
      ? []
      : comments.map((c) => ({
          id: c.id,
          taskId: c.task_id,
          authorId: c.author_id,
          authorName: c.author_name,
          authorRole: c.author_role,
          body: c.body,
          createdAt: new Date(c.created_at).toISOString(),
          editedAt: c.edited_at ? new Date(c.edited_at).toISOString() : null,
        })),
    activities: observer
      ? []
      : activities.map((a) => ({
          id: a.id,
          taskId: a.task_id,
          action: a.action,
          summary: a.summary,
          actorName: a.actor_name,
          createdAt: new Date(a.created_at).toISOString(),
        })),
    deadlineHistory: observer
      ? []
      : deadlineHist.map((d) => ({
          id: d.id,
          taskId: d.task_id,
          assignmentId: d.assignment_id,
          assigneeName: d.assignee_name,
          approvedException: d.approved_exception,
          oldDeadline: new Date(d.old_deadline).toISOString(),
          newDeadline: new Date(d.new_deadline).toISOString(),
          reason: d.reason,
          changedByName: d.changed_by_name,
          changedAt: new Date(d.changed_at).toISOString(),
        })),
    extensionRequests: observer
      ? []
      : extensionReqs.map((er) => ({
          id: er.id,
          assignmentId: er.assignment_id,
          taskId: er.task_id,
          taskCode: er.task_code,
          taskTitle: er.task_title,
          ownerTeamId: er.owner_team_id,
          requesterId: er.requester_id,
          requesterName: er.requester_name,
          currentDeadline: new Date(er.current_deadline).toISOString(),
          requestedDeadline: new Date(er.requested_deadline).toISOString(),
          reason: er.reason,
          status: er.status,
          approvedDeadline: er.approved_deadline ? new Date(er.approved_deadline).toISOString() : null,
          resolverId: er.resolver_id,
          resolverName: er.resolver_name,
          resolverNote: er.resolver_note,
          resolvedAt: er.resolved_at ? new Date(er.resolved_at).toISOString() : null,
          createdAt: new Date(er.created_at).toISOString(),
          canResolve:
            er.status === "PENDING" &&
            er.requester_id !== actor.memberId &&
            (isBoardLeadership(actor.role) || (isTeamLeadership(actor.role) && actor.leadTeamIds.includes(er.owner_team_id))),
        })),
  };
}

/** Cập nhật thông tin nhiệm vụ + kiểm tra optimistic concurrency version (trả 409 nếu cũ) */
export async function updateMission(
  actor: AuthActor,
  missionId: string,
  input: {
    version: number;
    title?: string;
    description?: string;
    expectedOutcome?: string;
    refs?: { label: string; url: string }[];
    importance?: ImportanceLevel;
    urgency?: UrgencyLevel;
    deadline?: string;
    deadlineReason?: string;
  },
  requestId?: string,
) {
  return withTransaction(async (tx) => {
    const mRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: MissionStatus;
      creator_id: string;
      owner_id: string;
      deadline_current: Date;
      version: number;
    }>(`SELECT id, code, title, status, creator_id, owner_id, deadline_current, version FROM missions WHERE id = $1`, [missionId]);
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

    const teams = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [missionId]);
    requirePermission(actor, "mission.manage", {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teams.rows.map((t) => t.team_id),
    });

    if (mission.version !== input.version) {
      throw new AppError(409, "VERSION_CONFLICT", "Dữ liệu đã được cập nhật bởi người khác. Vui lòng tải lại.");
    }

    const oldDeadlineIso = new Date(mission.deadline_current).toISOString();
    const newDeadlineIso = input.deadline ? new Date(input.deadline).toISOString() : oldDeadlineIso;
    const deadlineChanged = input.deadline && newDeadlineIso !== oldDeadlineIso;

    if (deadlineChanged && !input.deadlineReason?.trim()) {
      throw new AppError(400, "DEADLINE_REASON_REQUIRED", "Vui lòng ghi rõ lý do khi thay đổi thời hạn nhiệm vụ.");
    }

    const upd = await tx.query<{ version: number }>(
      `UPDATE missions
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           expected_outcome = COALESCE($3, expected_outcome),
           refs = COALESCE($4::jsonb, refs),
           importance = COALESCE($5, importance),
           urgency = COALESCE($6, urgency),
           deadline_current = $7,
           version = version + 1,
           updated_at = now()
       WHERE id = $8 AND version = $9
       RETURNING version`,
      [
        input.title?.trim() ?? null,
        input.description?.trim() ?? null,
        input.expectedOutcome?.trim() ?? null,
        input.refs ? JSON.stringify(input.refs) : null,
        input.importance ?? null,
        input.urgency ?? null,
        newDeadlineIso,
        missionId,
        input.version,
      ],
    );
    if (!upd.rows[0]) {
      throw new AppError(409, "VERSION_CONFLICT", "Dữ liệu đã được cập nhật bởi người khác. Vui lòng tải lại.");
    }

    if (deadlineChanged) {
      await tx.query(
        `INSERT INTO deadline_history (mission_id, old_deadline, new_deadline, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [missionId, oldDeadlineIso, newDeadlineIso, input.deadlineReason!.trim(), actor.memberId],
      );
      const affected = await tx.query<{ member_id: string }>(
        `SELECT DISTINCT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id
         WHERE t.mission_id = $1 AND ta.status IN ('PENDING', 'ACCEPTED', 'REVISION_REQUIRED')`,
        [missionId],
      );
      await createNotifications(
        affected.rows.map((r) => r.member_id),
        {
          eventType: "DEADLINE_CHANGED",
          targetType: "MISSION",
          targetId: missionId,
          title: `Thay đổi thời hạn nhiệm vụ ${mission.code}`,
          message: `${actor.displayName} đã điều chỉnh thời hạn nhiệm vụ "${mission.title}". Lý do: ${input.deadlineReason!.trim()}`,
          link: `/missions/${missionId}`,
        },
        tx,
      );
    }

    await writeActivity(
      {
        missionId,
        actorId: actor.memberId,
        action: deadlineChanged ? "MISSION_DEADLINE_CHANGED" : "MISSION_UPDATED",
        summary: deadlineChanged
          ? `${actor.displayName} đã đổi deadline nhiệm vụ (${input.deadlineReason!.trim()}).`
          : `${actor.displayName} đã cập nhật thông tin nhiệm vụ.`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MISSION_UPDATED",
        targetType: "MISSION",
        targetId: missionId,
        safeDiff: { deadlineChanged, oldDeadlineIso, newDeadlineIso },
        requestId,
      },
      tx,
    );

    return { id: missionId, version: upd.rows[0].version };
  });
}

/** Hành động vòng đời nhiệm vụ: hold, resume, cancel, reopen, complete */
export async function missionLifecycleAction(
  actor: AuthActor,
  missionId: string,
  action: "hold" | "resume" | "cancel" | "reopen" | "complete",
  input: { reason?: string; holdUntil?: string; targetTaskId?: string },
  requestId?: string,
) {
  return withTransaction(async (tx) => {
    const mRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: MissionStatus;
      previous_status: MissionStatus | null;
      creator_id: string;
      owner_id: string;
    }>(`SELECT id, code, title, status, previous_status, creator_id, owner_id FROM missions WHERE id = $1`, [missionId]);
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

    const teams = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [missionId]);
    const resObj = {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teams.rows.map((t) => t.team_id),
    };
    requirePermission(actor, action === "complete" ? "mission.complete" : "mission.manage", resObj);

    const affected = await tx.query<{ member_id: string }>(
      `SELECT DISTINCT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.mission_id = $1`,
      [missionId],
    );
    const affectedIds = affected.rows.map((r) => r.member_id);

    if (action === "hold") {
      if (!input.reason?.trim() || !input.holdUntil) {
        throw new AppError(400, "HOLD_FIELDS_REQUIRED", "Hoãn nhiệm vụ bắt buộc ghi lý do và ngày dự kiến tiếp tục.");
      }
      if (["COMPLETED", "CANCELLED", "ON_HOLD"].includes(mission.status)) {
        throw new AppError(409, "INVALID_STATE", "Không thể hoãn nhiệm vụ ở trạng thái hiện tại.");
      }
      await tx.query(
        `UPDATE missions SET previous_status = status, status = 'ON_HOLD', hold_reason = $1, hold_until = $2, version = version + 1, updated_at = now() WHERE id = $3`,
        [input.reason.trim(), new Date(input.holdUntil).toISOString(), missionId],
      );
      await tx.query(
        `UPDATE tasks SET previous_status = status, status = 'ON_HOLD', hold_reason = $1, hold_until = $2, updated_at = now()
         WHERE mission_id = $3 AND status NOT IN ('COMPLETED', 'CANCELLED', 'ON_HOLD')`,
        [input.reason.trim(), new Date(input.holdUntil).toISOString(), missionId],
      );
      await createNotifications(affectedIds, {
        eventType: "MISSION_HELD",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} tạm hoãn`,
        message: `Lý do: ${input.reason.trim()}`,
        link: `/missions/${missionId}`,
      }, tx);
    } else if (action === "resume") {
      if (mission.status !== "ON_HOLD") {
        throw new AppError(409, "INVALID_STATE", "Chỉ có thể tiếp tục nhiệm vụ đang tạm hoãn.");
      }
      const restored = mission.previous_status || "IN_PROGRESS";
      await tx.query(
        `UPDATE missions SET status = $1, previous_status = NULL, hold_reason = NULL, hold_until = NULL, version = version + 1, updated_at = now() WHERE id = $2`,
        [restored, missionId],
      );
      await tx.query(
        `UPDATE tasks SET status = COALESCE(previous_status, 'IN_PROGRESS'), previous_status = NULL, hold_reason = NULL, hold_until = NULL, updated_at = now()
         WHERE mission_id = $1 AND status = 'ON_HOLD'`,
        [missionId],
      );
      await createNotifications(affectedIds, {
        eventType: "MISSION_RESUMED",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} đã tiếp tục triển khai`,
        message: `${actor.displayName} đã khôi phục nhiệm vụ "${mission.title}".`,
        link: `/missions/${missionId}`,
      }, tx);
    } else if (action === "cancel") {
      if (!input.reason?.trim()) {
        throw new AppError(400, "REASON_REQUIRED", "Hủy nhiệm vụ bắt buộc ghi lý do.");
      }
      if (mission.status === "CANCELLED") {
        throw new AppError(409, "INVALID_STATE", "Nhiệm vụ đã bị hủy trước đó.");
      }
      await tx.query(
        `UPDATE missions SET status = 'CANCELLED', cancel_reason = $1, version = version + 1, updated_at = now() WHERE id = $2`,
        [input.reason.trim(), missionId],
      );
      await tx.query(
        `UPDATE tasks SET status = 'CANCELLED', cancel_reason = $1, updated_at = now()
         WHERE mission_id = $2 AND status <> 'COMPLETED'`,
        [input.reason.trim(), missionId],
      );
      await tx.query(
        `UPDATE task_assignments ta SET status = 'CANCELLED', exclusion_reason = $1, updated_at = now()
         FROM tasks t WHERE ta.task_id = t.id AND t.mission_id = $2 AND ta.status NOT IN ('COMPLETED', 'TRANSFERRED')`,
        [`Hủy nhiệm vụ: ${input.reason.trim()}`, missionId],
      );
      await createNotifications(affectedIds, {
        eventType: "MISSION_CANCELLED",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} đã hủy`,
        message: `Lý do: ${input.reason.trim()}`,
        link: `/missions/${missionId}`,
      }, tx);
    } else if (action === "complete") {
      if (mission.status === "COMPLETED" || mission.status === "CANCELLED" || mission.status === "DRAFT") {
        throw new AppError(409, "INVALID_STATE", "Không thể xác nhận hoàn thành nhiệm vụ ở trạng thái này.");
      }
      const evalRes = await evaluateMissionCompletion(missionId, tx);
      if (!evalRes.canComplete) {
        throw new AppError(409, "COMPLETION_CRITERIA_NOT_MET", evalRes.reasons.join(" "));
      }
      await tx.query(
        `UPDATE missions SET status = 'COMPLETED', completed_at = now(), completed_by = $1, version = version + 1, updated_at = now() WHERE id = $2`,
        [actor.memberId, missionId],
      );
      await createNotifications(affectedIds, {
        eventType: "MISSION_COMPLETED",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} đã hoàn thành`,
        message: `${actor.displayName} đã xác nhận hoàn thành nhiệm vụ "${mission.title}".`,
        link: `/missions/${missionId}`,
      }, tx);
    } else if (action === "reopen") {
      if (mission.status !== "COMPLETED") {
        throw new AppError(409, "INVALID_STATE", "Chỉ mở lại được nhiệm vụ đã hoàn thành.");
      }
      if (!input.reason?.trim()) {
        throw new AppError(400, "REASON_REQUIRED", "Mở lại nhiệm vụ bắt buộc nhập lý do.");
      }
      await tx.query(
        `UPDATE missions SET status = 'IN_PROGRESS', completed_at = NULL, completed_by = NULL, version = version + 1, updated_at = now() WHERE id = $1`,
        [missionId],
      );
      if (input.targetTaskId) {
        await tx.query(
          `UPDATE tasks SET status = 'REVISION_REQUIRED', completed_at = NULL, updated_at = now() WHERE id = $1 AND mission_id = $2`,
          [input.targetTaskId, missionId],
        );
        await tx.query(
          `UPDATE task_assignments SET status = 'REVISION_REQUIRED', updated_at = now() WHERE task_id = $1 AND status = 'COMPLETED'`,
          [input.targetTaskId],
        );
      }
      await createNotifications(affectedIds, {
        eventType: "MISSION_REOPENED",
        targetType: "MISSION",
        targetId: missionId,
        title: `Nhiệm vụ ${mission.code} đã được mở lại`,
        message: `${actor.displayName} đã mở lại nhiệm vụ. Lý do: ${input.reason.trim()}`,
        link: `/missions/${missionId}`,
      }, tx);
    }

    await writeActivity(
      {
        missionId,
        actorId: actor.memberId,
        action: `MISSION_${action.toUpperCase()}`,
        summary: `${actor.displayName} thực hiện thao tác ${action.toUpperCase()} trên nhiệm vụ ${mission.code}${input.reason ? ` (${input.reason.trim()})` : ""}.`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: `MISSION_${action.toUpperCase()}`,
        targetType: "MISSION",
        targetId: missionId,
        safeDiff: { reason: input.reason ?? null, holdUntil: input.holdUntil ?? null },
        requestId,
      },
      tx,
    );

    const updated = await tx.query<{ status: MissionStatus; version: number }>(
      `SELECT status, version FROM missions WHERE id = $1`,
      [missionId],
    );
    return { id: missionId, status: updated.rows[0].status, version: updated.rows[0].version };
  });
}

/** Nhận việc (Accept), Từ chối kèm lý do (Decline), Chuyển giao (Transfer) */
export async function assignmentAction(
  actor: AuthActor,
  assignmentId: string,
  action: "accept" | "decline" | "transfer",
  input: { reason?: string; newMemberId?: string; weight?: number },
  requestId?: string,
) {
  return withTransaction(async (tx) => {
    const res = await tx.query<{
      id: string;
      task_id: string;
      member_id: string;
      assigned_by: string;
      status: string;
      original_deadline: Date;
      evaluation_deadline: Date;
      weight: string | number;
      mission_id: string;
      mission_code: string;
      task_title: string;
      owner_team_id: string;
      task_owner_id: string;
      mission_creator_id: string;
      mission_owner_id: string;
    }>(
      `SELECT ta.*, t.mission_id, m.code AS mission_code, t.title AS task_title, t.owner_team_id, t.owner_id AS task_owner_id,
              m.creator_id AS mission_creator_id, m.owner_id AS mission_owner_id
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN missions m ON m.id = t.mission_id
       WHERE ta.id = $1`,
      [assignmentId],
    );
    const a = res.rows[0];
    if (!a) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Không tìm thấy phân công.");

    if (action === "accept") {
      if (a.member_id !== actor.memberId) {
        throw new AppError(403, "FORBIDDEN", "Chỉ người được giao việc mới có thể bấm nhận việc.");
      }
      if (a.status !== "PENDING") {
        throw new AppError(409, "INVALID_STATE", "Phân công này không ở trạng thái chờ nhận việc.");
      }
      await tx.query(
        `UPDATE task_assignments SET status = 'ACCEPTED', accepted_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
        [assignmentId],
      );
      await recomputeTaskStatus(a.task_id, tx);
      await createNotification(
        {
          recipientId: a.assigned_by,
          eventType: "ASSIGNMENT_ACCEPTED",
          targetType: "MISSION",
          targetId: a.mission_id,
          title: `${actor.displayName} đã nhận task`,
          message: `Task "${a.task_title}" (${a.mission_code}) đã được tiếp nhận.`,
          link: `/missions/${a.mission_id}`,
        },
        tx,
      );
      await writeActivity(
        {
          missionId: a.mission_id,
          taskId: a.task_id,
          assignmentId,
          actorId: actor.memberId,
          action: "ASSIGNMENT_ACCEPTED",
          summary: `${actor.displayName} đã xác nhận nhận task "${a.task_title}".`,
        },
        tx,
      );
      return { id: assignmentId, status: "ACCEPTED" };
    }

    if (action === "decline") {
      if (a.member_id !== actor.memberId) {
        throw new AppError(403, "FORBIDDEN", "Chỉ người được giao việc mới có thể từ chối.");
      }
      if (a.status !== "PENDING") {
        throw new AppError(409, "INVALID_STATE", "Chỉ từ chối được khi phân công đang chờ nhận.");
      }
      if (!input.reason?.trim()) {
        throw new AppError(400, "REASON_REQUIRED", "Từ chối nhận nhiệm vụ bắt buộc ghi rõ lý do.");
      }
      await tx.query(
        `UPDATE task_assignments SET status = 'DECLINED', declined_at = now(), decline_reason = $1, version = version + 1, updated_at = now() WHERE id = $2`,
        [input.reason.trim(), assignmentId],
      );
      // Không reset assignment của người khác — chỉ recompute tổng hợp
      await recomputeTaskStatus(a.task_id, tx);

      // Thông báo người giao + trưởng tổ trực tiếp (mục 7.5 & quy trình gốc Bước 04.02)
      const teamLeads = await tx.query<{ member_id: string }>(
        `SELECT member_id FROM team_memberships WHERE team_id = $1 AND effective_to IS NULL AND team_title IN ('LEADER', 'DEPUTY_LEADER')`,
        [a.owner_team_id],
      );
      await createNotifications(
        [a.assigned_by, a.task_owner_id, ...teamLeads.rows.map((r) => r.member_id)],
        {
          eventType: "ASSIGNMENT_DECLINED",
          targetType: "MISSION",
          targetId: a.mission_id,
          title: `${actor.displayName} từ chối nhận việc (${a.mission_code})`,
          message: `Task "${a.task_title}" bị từ chối. Lý do: ${input.reason.trim()}. Vui lòng phân công lại.`,
          link: `/missions/${a.mission_id}`,
        },
        tx,
      );
      await writeActivity(
        {
          missionId: a.mission_id,
          taskId: a.task_id,
          assignmentId,
          actorId: actor.memberId,
          action: "ASSIGNMENT_DECLINED",
          summary: `${actor.displayName} từ chối task "${a.task_title}" — Lý do: ${input.reason.trim()}`,
        },
        tx,
      );
      await writeAudit(
        {
          actorId: actor.memberId,
          action: "ASSIGNMENT_DECLINED",
          targetType: "ASSIGNMENT",
          targetId: assignmentId,
          safeDiff: { reason: input.reason.trim() },
          requestId,
        },
        tx,
      );
      return { id: assignmentId, status: "DECLINED" };
    }

    // Transfer (chuyển giao)
    requirePermission(actor, "mission.manage", {
      missionCreatorId: a.mission_creator_id,
      missionOwnerId: a.mission_owner_id,
      missionTeamIds: [a.owner_team_id],
    });
    if (!input.newMemberId) {
      throw new AppError(400, "NEW_MEMBER_REQUIRED", "Vui lòng chọn thành viên nhận chuyển giao.");
    }
    if (!input.reason?.trim()) {
      throw new AppError(400, "REASON_REQUIRED", "Chuyển giao công việc bắt buộc ghi lý do.");
    }
    if (["COMPLETED", "CANCELLED", "TRANSFERRED"].includes(a.status)) {
      throw new AppError(409, "INVALID_STATE", "Không thể chuyển giao phân công đã kết thúc.");
    }

    const newMember = await tx.query<{ id: string; role: MemberRole; display_name: string; activity_status: string; access_enabled: boolean }>(
      `SELECT id, role, display_name, activity_status, access_enabled FROM members WHERE id = $1`,
      [input.newMemberId],
    );
    const nm = newMember.rows[0];
    if (!nm || !nm.access_enabled || nm.activity_status !== "ACTIVE") {
      throw new AppError(400, "INACTIVE_MEMBER", "Thành viên nhận chuyển giao không đang hoạt động.");
    }
    const nmTeams = await tx.query<{ team_id: string }>(
      `SELECT team_id FROM team_memberships WHERE member_id = $1 AND effective_to IS NULL`,
      [nm.id],
    );
    if (!canAssignToMember(actor, { memberId: nm.id, role: nm.role, teamIds: nmTeams.rows.map((t) => t.team_id) })) {
      throw new AppError(403, "FORBIDDEN", "Bạn không có quyền giao việc cho thành viên này.");
    }

    const transferWeight = input.weight ?? Number(a.weight);
    const newAssRes = await tx.query<{ id: string }>(
      `INSERT INTO task_assignments (
         task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline,
         weight, transfer_from, transfer_reason
       ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        a.task_id,
        nm.id,
        actor.memberId,
        new Date(a.original_deadline).toISOString(),
        new Date(a.evaluation_deadline).toISOString(),
        transferWeight,
        assignmentId,
        input.reason.trim(),
      ],
    );
    const newAssignmentId = newAssRes.rows[0].id;

    await tx.query(
      `UPDATE task_assignments
       SET status = 'TRANSFERRED', superseded_by = $1, transfer_reason = $2,
           exclusion_reason = $3, version = version + 1, updated_at = now()
       WHERE id = $4`,
      [newAssignmentId, input.reason.trim(), `Chuyển giao cho ${nm.display_name}: ${input.reason.trim()}`, assignmentId],
    );
    await tx.query(
      `UPDATE deadline_extension_requests
       SET status = 'CANCELLED', resolver_note = 'Tự đóng do phân công đã được chuyển giao', updated_at = now()
       WHERE assignment_id = $1 AND status = 'PENDING'`,
      [assignmentId],
    );
    await recomputeTaskStatus(a.task_id, tx);

    await createNotification(
      {
        recipientId: nm.id,
        eventType: "ASSIGNMENT_TRANSFERRED_IN",
        targetType: "MISSION",
        targetId: a.mission_id,
        title: `Bạn được chuyển giao task (${a.mission_code})`,
        message: `${actor.displayName} đã chuyển giao task "${a.task_title}" cho bạn. Lý do: ${input.reason.trim()}`,
        link: `/missions/${a.mission_id}`,
      },
      tx,
    );
    await createNotification(
      {
        recipientId: a.member_id,
        eventType: "ASSIGNMENT_TRANSFERRED_OUT",
        targetType: "MISSION",
        targetId: a.mission_id,
        title: `Task đã được chuyển giao (${a.mission_code})`,
        message: `Task "${a.task_title}" đã được chuyển cho ${nm.display_name}. Lý do: ${input.reason.trim()}`,
        link: `/missions/${a.mission_id}`,
      },
      tx,
    );
    await writeActivity(
      {
        missionId: a.mission_id,
        taskId: a.task_id,
        assignmentId: newAssignmentId,
        actorId: actor.memberId,
        action: "ASSIGNMENT_TRANSFERRED",
        summary: `${actor.displayName} đã chuyển giao task "${a.task_title}" cho ${nm.display_name} (${input.reason.trim()}).`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "ASSIGNMENT_TRANSFERRED",
        targetType: "ASSIGNMENT",
        targetId: assignmentId,
        safeDiff: { oldMemberId: a.member_id, newMemberId: nm.id, newAssignmentId, reason: input.reason.trim() },
        requestId,
      },
      tx,
    );

    return { oldAssignmentId: assignmentId, newAssignmentId, status: "PENDING" };
  });
}

/**
 * Phân công thêm thành viên (hoặc điều phối từ Tổ trưởng xuống các thành viên trong tổ) cho một task đã tồn tại.
 * - Bậc 01.01 / 01.02 / 02: phân công trong thẩm quyền canAssignToMember.
 * - Bậc 03 (Trưởng/Phó tổ): phân công thành viên trong tổ mình lãnh đạo đối với task của tổ mình.
 * - Hỗ trợ replaceAssignmentIds: khi Tổ trưởng được giao trực tiếp và muốn giao tiếp xuống 1 hoặc nhiều mem,
 *   assignment của Tổ trưởng sẽ tự động chuyển sang TRANSFERRED (không trừ KPI của Tổ trưởng).
 */
export async function assignTaskMembers(
  actor: AuthActor,
  taskId: string,
  input: {
    memberIds: string[];
    weights?: Record<string, number>;
    submissionMode?: SubmissionMode;
    replaceAssignmentIds?: string[];
    note?: string;
  },
  requestId?: string,
) {
  const uniqueMemberIds = [...new Set(input.memberIds ?? [])];
  if (uniqueMemberIds.length === 0) {
    throw new AppError(400, "MEMBERS_REQUIRED", "Vui lòng chọn ít nhất 01 thành viên để phân công.");
  }

  return withTransaction(async (tx) => {
    const taskRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      mission_id: string;
      mission_code: string;
      mission_title: string;
      mission_status: MissionStatus;
      mission_creator_id: string;
      mission_owner_id: string;
      owner_team_id: string;
      owner_id: string;
      weight: string | number;
      deadline_current: Date;
      status: TaskStatus;
    }>(
      `SELECT t.id, t.code, t.title, t.mission_id, m.code AS mission_code, m.title AS mission_title,
              m.status AS mission_status, m.creator_id AS mission_creator_id, m.owner_id AS mission_owner_id,
              t.owner_team_id, t.owner_id, t.weight, t.deadline_current, t.status
       FROM tasks t
       JOIN missions m ON m.id = t.mission_id
       WHERE t.id = $1`,
      [taskId],
    );
    const task = taskRes.rows[0];
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Không tìm thấy task.");

    if (["COMPLETED", "CANCELLED"].includes(task.mission_status) || ["COMPLETED", "CANCELLED"].includes(task.status)) {
      throw new AppError(409, "INVALID_STATE", "Không thể phân công thêm thành viên cho task/nhiệm vụ đã hoàn thành hoặc đã hủy.");
    }

    const canManageThisTask =
      isBoardLeadership(actor.role) ||
      (isTeamLeadership(actor.role) &&
        (actor.leadTeamIds.includes(task.owner_team_id) ||
          task.owner_id === actor.memberId ||
          task.mission_creator_id === actor.memberId));
    if (!canManageThisTask) {
      throw new AppError(403, "FORBIDDEN", "Bạn chỉ được phân công thành viên cho task thuộc tổ mình phụ trách.");
    }

    // Kiểm tra quyền giao việc cho từng thành viên đích
    const mRows = await tx.query<{
      id: string;
      role: MemberRole;
      display_name: string;
      activity_status: string;
      access_enabled: boolean;
    }>(
      `SELECT id, role, display_name, activity_status, access_enabled FROM members WHERE id = ANY($1::uuid[])`,
      [uniqueMemberIds],
    );
    const tmRows = await tx.query<{ member_id: string; team_id: string }>(
      `SELECT member_id, team_id FROM team_memberships WHERE member_id = ANY($1::uuid[]) AND effective_to IS NULL`,
      [uniqueMemberIds],
    );
    const teamMap = new Map<string, string[]>();
    for (const r of tmRows.rows) {
      const arr = teamMap.get(r.member_id) ?? [];
      arr.push(r.team_id);
      teamMap.set(r.member_id, arr);
    }
    const memberMap = new Map(mRows.rows.map((m) => [m.id, m]));

    for (const mid of uniqueMemberIds) {
      const target = memberMap.get(mid);
      if (!target || !target.access_enabled || target.activity_status !== "ACTIVE") {
        throw new AppError(400, "INACTIVE_ASSIGNEE", "Không thể phân công cho thành viên đang tạm nghỉ hoặc đã ngừng hoạt động.");
      }
      if (!canAssignToMember(actor, { memberId: mid, role: target.role, teamIds: teamMap.get(mid) ?? [] })) {
        throw new AppError(
          403,
          "ASSIGN_SCOPE_FORBIDDEN",
          `Bạn không có quyền giao việc cho thành viên ${target.display_name}.`,
        );
      }
    }

    // Lấy các assignment đang hiệu lực hiện có trên task
    const existingActive = await tx.query<{ id: string; member_id: string; status: string }>(
      `SELECT id, member_id, status FROM task_assignments
       WHERE task_id = $1 AND status NOT IN ('TRANSFERRED', 'CANCELLED', 'DECLINED')`,
      [taskId],
    );

    const replaceSet = new Set(input.replaceAssignmentIds ?? []);
    const toReplace = existingActive.rows.filter((a) => replaceSet.has(a.id));
    if (replaceSet.size > 0 && toReplace.length !== replaceSet.size) {
      throw new AppError(400, "INVALID_REPLACE_ASSIGNMENT", "Phân công cần điều phối không hợp lệ hoặc đã kết thúc.");
    }
    const replacingMemberIds = new Set(toReplace.map((a) => a.member_id));

    for (const mid of uniqueMemberIds) {
      if (replacingMemberIds.has(mid)) {
        const name = memberMap.get(mid)?.display_name ?? mid;
        throw new AppError(400, "DUPLICATE_ASSIGNEE", `Thành viên ${name} đang là người điều phối, không cần chọn lại.`);
      }
      const alreadyActive = existingActive.rows.find((a) => a.member_id === mid && !replaceSet.has(a.id));
      if (alreadyActive) {
        const name = memberMap.get(mid)?.display_name ?? mid;
        throw new AppError(409, "ALREADY_ASSIGNED", `Thành viên ${name} đã được phân công task này rồi.`);
      }
    }

    const remainingCount = existingActive.rows.length - toReplace.length;
    const totalAfter = remainingCount + uniqueMemberIds.length;
    const taskWeight = Number(task.weight);
    const defaultShare = Number((taskWeight / Math.max(1, totalAfter)).toFixed(2));
    const deadlineIso = new Date(task.deadline_current).toISOString();
    const reasonText = input.note?.trim() || "Trưởng tổ điều phối phân công xuống thành viên";

    const createdIds: string[] = [];
    for (const mid of uniqueMemberIds) {
      const w = input.weights?.[mid] ?? defaultShare;
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO task_assignments (
           task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline, weight,
           transfer_from, transfer_reason
         ) VALUES ($1, $2, $3, 'PENDING', $4, $4, $5, $6, $7)
         RETURNING id`,
        [
          taskId,
          mid,
          actor.memberId,
          deadlineIso,
          Math.max(0.01, w),
          toReplace[0]?.id ?? null,
          toReplace.length > 0 ? reasonText : null,
        ],
      );
      createdIds.push(ins.rows[0].id);
    }

    // Đánh dấu các phân công đầu mối (vd Trưởng tổ) đã được điều phối sang TRANSFERRED (loại khỏi mẫu số KPI)
    const assignedNames = uniqueMemberIds.map((id) => memberMap.get(id)?.display_name ?? id).join(", ");
    for (const oldA of toReplace) {
      await tx.query(
        `UPDATE task_assignments
         SET status = 'TRANSFERRED',
             superseded_by = $1,
             transfer_reason = $2,
             exclusion_reason = $3,
             version = version + 1,
             updated_at = now()
         WHERE id = $4`,
        [createdIds[0], reasonText, `Điều phối xuống ${assignedNames}: ${reasonText}`, oldA.id],
      );
      await tx.query(
        `UPDATE deadline_extension_requests
         SET status = 'CANCELLED', resolver_note = 'Tự đóng do phân công đã được điều phối lại', updated_at = now()
         WHERE assignment_id = $1 AND status = 'PENDING'`,
        [oldA.id],
      );
    }

    if (input.submissionMode && totalAfter > 1) {
      await tx.query(`UPDATE tasks SET submission_mode = $1, version = version + 1, updated_at = now() WHERE id = $2`, [
        input.submissionMode,
        taskId,
      ]);
    }

    await recomputeTaskStatus(taskId, tx);

    if (task.mission_status !== "DRAFT") {
      for (const mid of uniqueMemberIds) {
        await createNotification(
          {
            recipientId: mid,
            eventType: "TASK_ASSIGNED",
            targetType: "MISSION",
            targetId: task.mission_id,
            title: `Bạn được phân công việc mới: ${task.mission_code}`,
            message: `${actor.displayName} đã phân công task "${task.title}" (${task.code}) cho bạn${input.note?.trim() ? `. Ghi chú: ${input.note.trim()}` : ""}.`,
            link: `/missions/${task.mission_id}`,
          },
          tx,
        );
      }
    }

    await writeActivity(
      {
        missionId: task.mission_id,
        taskId,
        actorId: actor.memberId,
        action: toReplace.length > 0 ? "TASK_DELEGATED" : "TASK_MEMBERS_ASSIGNED",
        summary:
          toReplace.length > 0
            ? `${actor.displayName} đã điều phối task "${task.title}" xuống cho ${assignedNames}${input.note?.trim() ? ` (${input.note.trim()})` : ""}.`
            : `${actor.displayName} đã phân công task "${task.title}" cho ${assignedNames}.`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: toReplace.length > 0 ? "TASK_DELEGATED" : "TASK_MEMBERS_ASSIGNED",
        targetType: "TASK",
        targetId: taskId,
        safeDiff: {
          addedMemberIds: uniqueMemberIds,
          replacedAssignmentIds: toReplace.map((r) => r.id),
          submissionMode: input.submissionMode ?? null,
        },
        requestId,
      },
      tx,
    );

    return {
      taskId,
      createdAssignmentIds: createdIds,
      replacedAssignmentIds: toReplace.map((r) => r.id),
    };
  });
}

/**
 * Thêm / tách task mới vào một nhiệm vụ đã tồn tại (hỗ trợ Bậc 03 tách đầu việc trong tổ mình hoặc Bậc 01/02 bổ sung task).
 */
export async function addTaskToMission(
  actor: AuthActor,
  missionId: string,
  input: {
    title: string;
    description?: string;
    deliverable?: string;
    ownerTeamId: string;
    reviewerId?: string | null;
    supervisorIds?: string[];
    assigneeIds?: string[];
    submissionMode?: SubmissionMode;
    weight?: number;
    deadline: string;
  },
  requestId?: string,
) {
  return withTransaction(async (tx) => {
    const mRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: MissionStatus;
      creator_id: string;
      owner_id: string;
      urgency: UrgencyLevel;
      importance: ImportanceLevel;
      deadline_current: Date;
    }>(
      `SELECT id, code, title, status, creator_id, owner_id, urgency, importance, deadline_current
       FROM missions WHERE id = $1`,
      [missionId],
    );
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");
    if (["COMPLETED", "CANCELLED"].includes(mission.status)) {
      throw new AppError(409, "INVALID_STATE", "Không thể thêm task vào nhiệm vụ đã hoàn thành hoặc đã hủy.");
    }

    const teamRows = await tx.query<{ team_id: string }>(`SELECT team_id FROM mission_teams WHERE mission_id = $1`, [missionId]);
    requirePermission(actor, "mission.manage", {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teamRows.rows.map((r) => r.team_id),
    });

    if (isTeamLeadership(actor.role) && !actor.leadTeamIds.includes(input.ownerTeamId)) {
      throw new AppError(403, "FORBIDDEN", "Trưởng/Phó tổ chỉ được tách thêm task cho tổ mình phụ trách.");
    }

    const teamCheck = await tx.query<{ id: string; active: boolean; name: string }>(
      `SELECT id, active, name FROM teams WHERE id = $1`,
      [input.ownerTeamId],
    );
    if (!teamCheck.rows[0] || !teamCheck.rows[0].active) {
      throw new AppError(400, "INVALID_TEAM", "Tổ phụ trách không tồn tại hoặc đã ngừng hoạt động.");
    }

    const taskDeadline = new Date(input.deadline);
    if (Number.isNaN(taskDeadline.getTime())) {
      throw new AppError(400, "INVALID_TASK_DEADLINE", "Thời hạn task không hợp lệ.");
    }
    if (mission.status !== "DRAFT" && taskDeadline.getTime() > new Date(mission.deadline_current).getTime()) {
      throw new AppError(400, "TASK_DEADLINE_EXCEEDS_MISSION", "Thời hạn task không được vượt quá thời hạn hiện tại của nhiệm vụ.");
    }

    const assignees = [...new Set(input.assigneeIds ?? [])];
    if (assignees.length > 0) {
      const mRows = await tx.query<{ id: string; role: MemberRole; display_name: string; activity_status: string; access_enabled: boolean }>(
        `SELECT id, role, display_name, activity_status, access_enabled FROM members WHERE id = ANY($1::uuid[])`,
        [assignees],
      );
      const tmRows = await tx.query<{ member_id: string; team_id: string }>(
        `SELECT member_id, team_id FROM team_memberships WHERE member_id = ANY($1::uuid[]) AND effective_to IS NULL`,
        [assignees],
      );
      const teamMap = new Map<string, string[]>();
      for (const r of tmRows.rows) {
        const arr = teamMap.get(r.member_id) ?? [];
        arr.push(r.team_id);
        teamMap.set(r.member_id, arr);
      }
      const mMap = new Map(mRows.rows.map((m) => [m.id, m]));
      for (const mid of assignees) {
        const target = mMap.get(mid);
        if (!target || !target.access_enabled || target.activity_status !== "ACTIVE") {
          throw new AppError(400, "INACTIVE_ASSIGNEE", "Không thể giao việc cho thành viên đang tạm nghỉ hoặc đã ngừng hoạt động.");
        }
        if (!canAssignToMember(actor, { memberId: mid, role: target.role, teamIds: teamMap.get(mid) ?? [] })) {
          throw new AppError(403, "ASSIGN_SCOPE_FORBIDDEN", `Bạn không có quyền giao việc cho thành viên ${target.display_name}.`);
        }
      }
    }

    // Sinh mã task tiếp theo không trùng (NV-YYYY-XXXX-T{n})
    const existingTasks = await tx.query<{ code: string; sort_order: number }>(
      `SELECT code, sort_order FROM tasks WHERE mission_id = $1`,
      [missionId],
    );
    let maxNum = existingTasks.rows.length;
    let maxSort = 0;
    for (const et of existingTasks.rows) {
      if (et.sort_order > maxSort) maxSort = et.sort_order;
      const match = et.code.match(/-T(\d+)$/);
      if (match) {
        const n = Number(match[1]);
        if (n > maxNum) maxNum = n;
      }
    }
    const taskCode = `${mission.code}-T${maxNum + 1}`;
    const taskStatus: TaskStatus = mission.status === "DRAFT" ? "DRAFT" : mission.status === "ON_HOLD" ? "ON_HOLD" : "ASSIGNED";
    const taskWeight = Number(input.weight ?? 1);

    let reviewerId = input.reviewerId ?? null;
    if (!reviewerId) {
      const leadRes = await tx.query<{ member_id: string }>(
        `SELECT tm.member_id FROM team_memberships tm
         JOIN members m ON m.id = tm.member_id
         WHERE tm.team_id = $1 AND tm.effective_to IS NULL
           AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
           AND m.access_enabled = true AND m.activity_status = 'ACTIVE'
         ORDER BY CASE WHEN tm.team_title = 'LEADER' THEN 1 ELSE 2 END
         LIMIT 1`,
        [input.ownerTeamId],
      );
      reviewerId = leadRes.rows[0]?.member_id ?? null;
    }

    const tIns = await tx.query<{ id: string }>(
      `INSERT INTO tasks (
         mission_id, code, title, description, deliverable, requires_artifact,
         owner_team_id, owner_id, reviewer_id, sort_order, submission_mode, required,
         weight, urgency, importance, deadline_original, deadline_current, status
       ) VALUES (
         $1, $2, $3, $4, $5, true,
         $6, $7, $8, $9, $10, true,
         $11, $12, $13, $14, $14, $15
       ) RETURNING id`,
      [
        missionId,
        taskCode,
        input.title.trim(),
        (input.description ?? "").trim(),
        (input.deliverable ?? "").trim(),
        input.ownerTeamId,
        actor.memberId,
        reviewerId,
        maxSort + 1,
        assignees.length > 1 ? (input.submissionMode ?? "INDIVIDUAL") : "INDIVIDUAL",
        taskWeight,
        mission.urgency,
        mission.importance,
        taskDeadline.toISOString(),
        taskStatus,
      ],
    );
    const taskId = tIns.rows[0].id;

    await tx.query(`INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      missionId,
      input.ownerTeamId,
    ]);

    for (const supId of [...new Set(input.supervisorIds ?? [])]) {
      await tx.query(`INSERT INTO task_supervisors (task_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [taskId, supId]);
    }

    if (assignees.length > 0) {
      const share = Number((taskWeight / assignees.length).toFixed(2));
      for (const mid of assignees) {
        await tx.query(
          `INSERT INTO task_assignments (
             task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline, weight
           ) VALUES ($1, $2, $3, 'PENDING', $4, $4, $5)`,
          [taskId, mid, actor.memberId, taskDeadline.toISOString(), Math.max(0.01, share)],
        );
        if (mission.status !== "DRAFT") {
          await createNotification(
            {
              recipientId: mid,
              eventType: "TASK_ASSIGNED",
              targetType: "MISSION",
              targetId: missionId,
              title: `Bạn được giao task mới: ${taskCode}`,
              message: `${actor.displayName} đã tách task "${input.title.trim()}" trong nhiệm vụ "${mission.title}" cho bạn.`,
              link: `/missions/${missionId}`,
            },
            tx,
          );
        }
      }
    } else if (mission.status !== "DRAFT") {
      const leads = await tx.query<{ member_id: string }>(
        `SELECT tm.member_id FROM team_memberships tm
         JOIN members m ON m.id = tm.member_id
         WHERE tm.team_id = $1 AND tm.effective_to IS NULL
           AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
           AND m.access_enabled = true AND m.activity_status = 'ACTIVE'`,
        [input.ownerTeamId],
      );
      for (const lead of leads.rows) {
        if (lead.member_id === actor.memberId) continue;
        await createNotification(
          {
            recipientId: lead.member_id,
            eventType: "TASK_AWAITING_DELEGATION",
            targetType: "MISSION",
            targetId: missionId,
            title: `Tổ bạn có task mới chờ phân công: ${taskCode}`,
            message: `${actor.displayName} đã tạo task "${input.title.trim()}" cho ${teamCheck.rows[0].name}. Vui lòng phân công thành viên thực hiện.`,
            link: `/missions/${missionId}`,
          },
          tx,
        );
      }
    }

    await recomputeMissionStatus(missionId, tx);

    await writeActivity(
      {
        missionId,
        taskId,
        actorId: actor.memberId,
        action: "TASK_ADDED",
        summary: `${actor.displayName} đã thêm task ${taskCode} "${input.title.trim()}" (${teamCheck.rows[0].name}).`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "TASK_ADDED",
        targetType: "TASK",
        targetId: taskId,
        safeDiff: { missionId, taskCode, ownerTeamId: input.ownerTeamId, assigneeCount: assignees.length },
        requestId,
      },
      tx,
    );

    return { id: taskId, code: taskCode, status: taskStatus };
  });
}

/**
 * Thành viên đăng ký xin dời deadline cho phân công của chính mình (bắt buộc nhập lý do cụ thể + hạn mới đề xuất).
 * Gửi thông báo đến Trưởng/Phó tổ phụ trách, người giao và chủ trì nhiệm vụ.
 */
export async function requestDeadlineExtension(
  actor: AuthActor,
  assignmentId: string,
  input: { requestedDeadline: string; reason: string },
  requestId?: string,
) {
  const cleanReason = input.reason.trim();
  if (cleanReason.length < 5) {
    throw new AppError(400, "REASON_REQUIRED", "Vui lòng ghi rõ lý do xin dời deadline (tối thiểu 5 ký tự).");
  }
  const reqDate = new Date(input.requestedDeadline);
  if (Number.isNaN(reqDate.getTime())) {
    throw new AppError(400, "INVALID_DEADLINE", "Thời hạn đề xuất không hợp lệ.");
  }

  return withTransaction(async (tx) => {
    const res = await tx.query<{
      id: string;
      task_id: string;
      member_id: string;
      assigned_by: string;
      status: string;
      evaluation_deadline: Date;
      mission_id: string;
      mission_code: string;
      mission_status: MissionStatus;
      mission_owner_id: string;
      task_code: string;
      task_title: string;
      task_status: TaskStatus;
      owner_team_id: string;
    }>(
      `SELECT ta.id, ta.task_id, ta.member_id, ta.assigned_by, ta.status, ta.evaluation_deadline,
              t.mission_id, m.code AS mission_code, m.status AS mission_status, m.owner_id AS mission_owner_id,
              t.code AS task_code, t.title AS task_title, t.status AS task_status, t.owner_team_id
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       JOIN missions m ON m.id = t.mission_id
       WHERE ta.id = $1`,
      [assignmentId],
    );
    const a = res.rows[0];
    if (!a) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Không tìm thấy phân công.");
    if (a.member_id !== actor.memberId) {
      throw new AppError(403, "FORBIDDEN", "Chỉ thành viên trực tiếp thực hiện mới được gửi đơn xin dời deadline.");
    }
    if (!["PENDING", "ACCEPTED", "REVISION_REQUIRED"].includes(a.status)) {
      throw new AppError(409, "INVALID_STATE", "Không thể xin dời deadline cho phân công đã nộp, hoàn thành hoặc đã kết thúc.");
    }
    if (["DRAFT", "COMPLETED", "CANCELLED", "ON_HOLD"].includes(a.mission_status) || ["DRAFT", "COMPLETED", "CANCELLED", "ON_HOLD"].includes(a.task_status)) {
      throw new AppError(409, "INVALID_STATE", "Nhiệm vụ/task hiện không ở trạng thái cho phép xin dời deadline.");
    }

    const currentDueMs = new Date(a.evaluation_deadline).getTime();
    if (reqDate.getTime() <= currentDueMs || reqDate.getTime() <= Date.now()) {
      throw new AppError(
        400,
        "INVALID_REQUESTED_DEADLINE",
        "Hạn đề xuất xin dời phải nằm sau cả thời hạn hiện tại lẫn thời điểm hiện nay.",
      );
    }

    const existingPending = await tx.query<{ id: string }>(
      `SELECT id FROM deadline_extension_requests WHERE assignment_id = $1 AND status = 'PENDING'`,
      [assignmentId],
    );
    if (existingPending.rows[0]) {
      throw new AppError(409, "EXTENSION_ALREADY_PENDING", "Bạn đang có 01 yêu cầu xin dời deadline chờ duyệt cho task này.");
    }

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO deadline_extension_requests (
         assignment_id, task_id, mission_id, requester_id, current_deadline, requested_deadline, reason, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
       RETURNING id`,
      [
        assignmentId,
        a.task_id,
        a.mission_id,
        actor.memberId,
        new Date(a.evaluation_deadline).toISOString(),
        reqDate.toISOString(),
        cleanReason,
      ],
    );
    const extId = inserted.rows[0].id;

    // Thông báo Trưởng/Phó tổ phụ trách + người giao + chủ trì nhiệm vụ
    const teamLeads = await tx.query<{ member_id: string }>(
      `SELECT tm.member_id
       FROM team_memberships tm
       JOIN members m ON m.id = tm.member_id
       WHERE tm.team_id = $1 AND tm.effective_to IS NULL
         AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
         AND m.access_enabled = true AND m.activity_status = 'ACTIVE'`,
      [a.owner_team_id],
    );
    const recipients = [
      ...new Set([a.assigned_by, a.mission_owner_id, ...teamLeads.rows.map((r) => r.member_id)]),
    ].filter((id) => id !== actor.memberId);

    await createNotifications(
      recipients,
      {
        eventType: "DEADLINE_EXTENSION_REQUESTED",
        targetType: "MISSION",
        targetId: a.mission_id,
        title: `${actor.displayName} xin dời deadline (${a.task_code})`,
        message: `Lý do: ${cleanReason}. Vui lòng duyệt dời hạn hoặc từ chối để phân công người khác.`,
        link: `/missions/${a.mission_id}`,
      },
      tx,
    );

    await writeActivity(
      {
        missionId: a.mission_id,
        taskId: a.task_id,
        assignmentId,
        actorId: actor.memberId,
        action: "DEADLINE_EXTENSION_REQUESTED",
        summary: `${actor.displayName} đăng ký xin dời deadline task "${a.task_title}" — Lý do: ${cleanReason}`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "DEADLINE_EXTENSION_REQUESTED",
        targetType: "DEADLINE_EXTENSION",
        targetId: extId,
        safeDiff: {
          assignmentId,
          oldDeadline: new Date(a.evaluation_deadline).toISOString(),
          requestedDeadline: reqDate.toISOString(),
          reason: cleanReason,
        },
        requestId,
      },
      tx,
    );

    return {
      id: extId,
      assignmentId,
      status: "PENDING" as const,
      requestedDeadline: reqDate.toISOString(),
    };
  });
}

/**
 * Cấp trên duyệt hoặc từ chối yêu cầu xin dời deadline:
 * - Đồng ý (approve): cập nhật deadline_override + evaluation_deadline, giữ nguyên original_deadline,
 *   bật dấu vết late_against_original_deadline = true, ghi đầy đủ deadline_history + activity + audit.
 * - Từ chối (reject): lưu lý do từ chối và thông báo mem; UI sẽ gợi ý/mở ngay modal chuyển giao cho người khác.
 */
export async function resolveDeadlineExtension(
  actor: AuthActor,
  extensionRequestId: string,
  action: "approve" | "reject",
  input: { note?: string; approvedDeadline?: string; syncMissionDeadline?: boolean },
  requestId?: string,
) {
  return withTransaction(async (tx) => {
    const res = await tx.query<{
      id: string;
      assignment_id: string;
      task_id: string;
      mission_id: string;
      requester_id: string;
      requester_name: string;
      current_deadline: Date;
      requested_deadline: Date;
      reason: string;
      status: string;
      original_deadline: Date;
      task_code: string;
      task_title: string;
      task_deadline_current: Date;
      owner_team_id: string;
      mission_code: string;
      mission_deadline_current: Date;
    }>(
      `SELECT der.*, req_m.display_name AS requester_name,
              ta.original_deadline,
              t.code AS task_code, t.title AS task_title, t.deadline_current AS task_deadline_current, t.owner_team_id,
              m.code AS mission_code, m.deadline_current AS mission_deadline_current
       FROM deadline_extension_requests der
       JOIN members req_m ON req_m.id = der.requester_id
       JOIN task_assignments ta ON ta.id = der.assignment_id
       JOIN tasks t ON t.id = der.task_id
       JOIN missions m ON m.id = der.mission_id
       WHERE der.id = $1`,
      [extensionRequestId],
    );
    const req = res.rows[0];
    if (!req) throw new AppError(404, "EXTENSION_REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu xin dời deadline.");
    if (req.status !== "PENDING") {
      throw new AppError(409, "INVALID_STATE", "Yêu cầu xin dời deadline này đã được xử lý trước đó.");
    }
    if (req.requester_id === actor.memberId) {
      throw new AppError(403, "SELF_APPROVAL_FORBIDDEN", "Bạn không thể tự duyệt yêu cầu xin dời deadline của chính mình.");
    }

    const canResolve =
      isBoardLeadership(actor.role) ||
      (isTeamLeadership(actor.role) && actor.leadTeamIds.includes(req.owner_team_id));
    if (!canResolve) {
      throw new AppError(403, "FORBIDDEN", "Chỉ Trưởng/Phó tổ phụ trách hoặc Lãnh đạo Ban mới có quyền duyệt yêu cầu xin dời hạn.");
    }

    const resolverNote = (input.note ?? "").trim();

    if (action === "approve") {
      const finalDue = input.approvedDeadline ? new Date(input.approvedDeadline) : new Date(req.requested_deadline);
      if (Number.isNaN(finalDue.getTime())) {
        throw new AppError(400, "INVALID_DEADLINE", "Thời hạn chốt mới không hợp lệ.");
      }
      if (finalDue.getTime() <= new Date(req.current_deadline).getTime()) {
        throw new AppError(400, "INVALID_DEADLINE", "Thời hạn duyệt dời phải lớn hơn thời hạn hiện tại.");
      }

      const finalDueIso = finalDue.toISOString();
      const oldDueIso = new Date(req.current_deadline).toISOString();
      const isBeyondOriginal = finalDue.getTime() > new Date(req.original_deadline).getTime();

      // 1. Cập nhật assignment (giữ nguyên original_deadline bất biến, bật cờ late_against_original_deadline)
      await tx.query(
        `UPDATE task_assignments
         SET deadline_override = $1,
             evaluation_deadline = $1,
             late_against_original_deadline = $2,
             version = version + 1,
             updated_at = now()
         WHERE id = $3`,
        [finalDueIso, isBeyondOriginal, req.assignment_id],
      );

      // 2. Lưu dấu vết đầy đủ vào deadline_history
      const historyReason = resolverNote
        ? `[Duyệt xin dời hạn] Lý do mem: ${req.reason} | Ghi chú duyệt: ${resolverNote}`
        : `[Duyệt xin dời hạn] Lý do mem: ${req.reason}`;
      await tx.query(
        `INSERT INTO deadline_history (
           mission_id, task_id, assignment_id, old_deadline, new_deadline, previous_evaluation_deadline,
           reason, approved_exception, changed_by
         ) VALUES ($1, $2, $3, $4, $5, $4, $6, true, $7)`,
        [req.mission_id, req.task_id, req.assignment_id, oldDueIso, finalDueIso, historyReason, actor.memberId],
      );

      // 3. Nếu hạn mới vượt hạn task hiện tại (và vẫn <= hạn mission, hoặc lãnh đạo Ban đồng ý nới cả mission)
      const taskDueMs = new Date(req.task_deadline_current).getTime();
      const missionDueMs = new Date(req.mission_deadline_current).getTime();
      if (finalDue.getTime() > taskDueMs) {
        if (finalDue.getTime() <= missionDueMs) {
          await tx.query(`UPDATE tasks SET deadline_current = $1, version = version + 1, updated_at = now() WHERE id = $2`, [
            finalDueIso,
            req.task_id,
          ]);
        } else if (input.syncMissionDeadline && isBoardLeadership(actor.role)) {
          await tx.query(`UPDATE tasks SET deadline_current = $1, version = version + 1, updated_at = now() WHERE id = $2`, [
            finalDueIso,
            req.task_id,
          ]);
          await tx.query(`UPDATE missions SET deadline_current = $1, version = version + 1, updated_at = now() WHERE id = $2`, [
            finalDueIso,
            req.mission_id,
          ]);
          await tx.query(
            `INSERT INTO deadline_history (mission_id, old_deadline, new_deadline, reason, approved_exception, changed_by)
             VALUES ($1, $2, $3, $4, true, $5)`,
            [
              req.mission_id,
              new Date(req.mission_deadline_current).toISOString(),
              finalDueIso,
              `Đồng bộ hạn nhiệm vụ theo yêu cầu xin dời hạn của ${req.requester_name}: ${req.reason}`,
              actor.memberId,
            ],
          );
        }
      }

      await tx.query(
        `UPDATE deadline_extension_requests
         SET status = 'APPROVED',
             approved_deadline = $1,
             resolver_id = $2,
             resolver_note = $3,
             resolved_at = now(),
             updated_at = now()
         WHERE id = $4`,
        [finalDueIso, actor.memberId, resolverNote, extensionRequestId],
      );

      await createNotification(
        {
          recipientId: req.requester_id,
          eventType: "DEADLINE_EXTENSION_APPROVED",
          targetType: "MISSION",
          targetId: req.mission_id,
          title: `Đã duyệt xin dời deadline (${req.task_code})`,
          message: `${actor.displayName} đã đồng ý gia hạn cho task "${req.task_title}"${resolverNote ? `. Ghi chú: ${resolverNote}` : ""}.`,
          link: `/missions/${req.mission_id}`,
        },
        tx,
      );

      await writeActivity(
        {
          missionId: req.mission_id,
          taskId: req.task_id,
          assignmentId: req.assignment_id,
          actorId: actor.memberId,
          action: "DEADLINE_EXTENSION_APPROVED",
          summary: `${actor.displayName} đã duyệt dời deadline cho ${req.requester_name} (task "${req.task_title}") — Lý do gốc: ${req.reason}${resolverNote ? ` | Ghi chú: ${resolverNote}` : ""}.`,
        },
        tx,
      );

      await writeAudit(
        {
          actorId: actor.memberId,
          action: "DEADLINE_EXTENSION_APPROVED",
          targetType: "DEADLINE_EXTENSION",
          targetId: extensionRequestId,
          safeDiff: {
            assignmentId: req.assignment_id,
            oldDeadline: oldDueIso,
            approvedDeadline: finalDueIso,
            originalDeadline: new Date(req.original_deadline).toISOString(),
            resolverNote,
          },
          requestId,
        },
        tx,
      );

      return {
        id: extensionRequestId,
        status: "APPROVED" as const,
        assignmentId: req.assignment_id,
        taskId: req.task_id,
        missionId: req.mission_id,
        approvedDeadline: finalDueIso,
      };
    }

    // Reject (từ chối xin dời → gợi ý cấp trên phân công người khác)
    if (resolverNote.length < 3) {
      throw new AppError(400, "REASON_REQUIRED", "Vui lòng nhập lý do từ chối xin dời deadline.");
    }

    await tx.query(
      `UPDATE deadline_extension_requests
       SET status = 'REJECTED',
           resolver_id = $1,
           resolver_note = $2,
           resolved_at = now(),
           updated_at = now()
       WHERE id = $3`,
      [actor.memberId, resolverNote, extensionRequestId],
    );

    await createNotification(
      {
        recipientId: req.requester_id,
        eventType: "DEADLINE_EXTENSION_REJECTED",
        targetType: "MISSION",
        targetId: req.mission_id,
        title: `Từ chối xin dời deadline (${req.task_code})`,
        message: `${actor.displayName} không đồng ý dời hạn task "${req.task_title}". Lý do: ${resolverNote}. Cấp trên sẽ giữ hạn cũ hoặc chuyển giao cho thành viên khác.`,
        link: `/missions/${req.mission_id}`,
      },
      tx,
    );

    await writeActivity(
      {
        missionId: req.mission_id,
        taskId: req.task_id,
        assignmentId: req.assignment_id,
        actorId: actor.memberId,
        action: "DEADLINE_EXTENSION_REJECTED",
        summary: `${actor.displayName} đã từ chối đơn xin dời hạn của ${req.requester_name} (task "${req.task_title}") — Lý do: ${resolverNote}`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "DEADLINE_EXTENSION_REJECTED",
        targetType: "DEADLINE_EXTENSION",
        targetId: extensionRequestId,
        safeDiff: { assignmentId: req.assignment_id, resolverNote },
        requestId,
      },
      tx,
    );

    return {
      id: extensionRequestId,
      status: "REJECTED" as const,
      assignmentId: req.assignment_id,
      taskId: req.task_id,
      missionId: req.mission_id,
    };
  });
}

/** Danh sách Việc của tôi (mục 2.1 & 2.3) */
export async function getMyWork(actor: AuthActor) {
  if (isObserverRole(actor.role)) {
    return { assignments: [], reviewQueue: [], delegationQueue: [], extensionQueue: [] };
  }
  const rows = await query<{
    assignment_id: string;
    task_id: string;
    task_code: string;
    task_title: string;
    task_deliverable: string;
    submission_mode: SubmissionMode;
    mission_id: string;
    mission_code: string;
    mission_title: string;
    group_name: string;
    team_name: string;
    urgency: UrgencyLevel;
    importance: ImportanceLevel;
    status: string;
    original_deadline: Date;
    evaluation_deadline: Date;
    late_against_original_deadline: boolean;
    weight: string | number;
    decline_reason: string | null;
    submitted_at: Date | null;
    pending_ext_id: string | null;
    pending_ext_deadline: Date | null;
  }>(
    `SELECT ta.id AS assignment_id, t.id AS task_id, t.code AS task_code, t.title AS task_title,
            t.deliverable AS task_deliverable, t.submission_mode,
            m.id AS mission_id, m.code AS mission_code, m.title AS mission_title,
            tg.name AS group_name, tm.name AS team_name,
            t.urgency, t.importance, ta.status, ta.original_deadline, ta.evaluation_deadline,
            ta.late_against_original_deadline, ta.weight,
            ta.decline_reason, ta.submitted_at,
            der.id AS pending_ext_id, der.requested_deadline AS pending_ext_deadline
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN missions m ON m.id = t.mission_id
     JOIN task_groups tg ON tg.id = m.group_id
     JOIN teams tm ON tm.id = t.owner_team_id
     LEFT JOIN deadline_extension_requests der ON der.assignment_id = ta.id AND der.status = 'PENDING'
     WHERE ta.member_id = $1 AND m.status <> 'DRAFT' AND ta.status NOT IN ('TRANSFERRED', 'CANCELLED')
     ORDER BY
       CASE ta.status
         WHEN 'REVISION_REQUIRED' THEN 1
         WHEN 'PENDING' THEN 2
         WHEN 'ACCEPTED' THEN 3
         WHEN 'SUBMITTED' THEN 4
         WHEN 'COMPLETED' THEN 5
         ELSE 6
       END,
       ta.evaluation_deadline ASC`,
    [actor.memberId],
  );

  // Việc chờ duyệt nếu là lãnh đạo tổ / Ban
  const reviewQueue =
    isManagerRole(actor.role)
      ? await query<{
          version_id: string;
          version_no: number;
          task_id: string;
          task_code: string;
          task_title: string;
          mission_id: string;
          mission_code: string;
          mission_title: string;
          submitted_by_name: string;
          submitted_at: Date;
          deadline_current: Date;
          urgency: UrgencyLevel;
        }>(
          `SELECT sv.id AS version_id, sv.version_no, t.id AS task_id, t.code AS task_code, t.title AS task_title,
                  m.id AS mission_id, m.code AS mission_code, m.title AS mission_title,
                  sub_m.display_name AS submitted_by_name, sv.submitted_at, t.deadline_current, t.urgency
           FROM submission_versions sv
           JOIN submissions s ON s.id = sv.submission_id
           JOIN tasks t ON t.id = s.task_id
           JOIN missions m ON m.id = t.mission_id
           JOIN members sub_m ON sub_m.id = sv.submitted_by
           WHERE sv.state = 'SUBMITTED'
             AND sv.submitted_by <> $1
             AND (
               $2::boolean = true
               OR t.reviewer_id = $1
               OR t.owner_team_id = ANY($3::uuid[])
             )
           ORDER BY sv.submitted_at ASC`,
          [actor.memberId, isBoardLeadership(actor.role), actor.leadTeamIds],
        )
      : [];

  // Hàng chờ phân công cho Tổ trưởng / Ban: các task đang mở nhưng chưa có ai thực hiện (hoặc tất cả đã từ chối)
  const delegationQueue =
    isManagerRole(actor.role)
      ? await query<{
          task_id: string;
          task_code: string;
          task_title: string;
          deliverable: string;
          mission_id: string;
          mission_code: string;
          mission_title: string;
          owner_team_id: string;
          team_name: string;
          creator_name: string;
          deadline_current: Date;
          urgency: UrgencyLevel;
          weight: string | number;
          declined_count: string | number;
        }>(
          `SELECT t.id AS task_id, t.code AS task_code, t.title AS task_title, t.deliverable,
                  m.id AS mission_id, m.code AS mission_code, m.title AS mission_title,
                  t.owner_team_id, tm.name AS team_name, cr.display_name AS creator_name,
                  t.deadline_current, t.urgency, t.weight,
                  (SELECT count(*) FROM task_assignments ta2 WHERE ta2.task_id = t.id AND ta2.status = 'DECLINED') AS declined_count
           FROM tasks t
           JOIN missions m ON m.id = t.mission_id
           JOIN teams tm ON tm.id = t.owner_team_id
           JOIN members cr ON cr.id = m.creator_id
           WHERE m.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD')
             AND t.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD')
             AND NOT EXISTS (
               SELECT 1 FROM task_assignments ta
               WHERE ta.task_id = t.id AND ta.status NOT IN ('TRANSFERRED', 'CANCELLED', 'DECLINED')
             )
             AND (
               $1::boolean = true
               OR t.owner_team_id = ANY($2::uuid[])
             )
           ORDER BY t.deadline_current ASC`,
          [isBoardLeadership(actor.role), actor.leadTeamIds],
        )
      : [];

  // Hàng chờ duyệt yêu cầu xin dời deadline cho Tổ trưởng / Ban
  const extensionQueue =
    isManagerRole(actor.role)
      ? await query<{
          id: string;
          assignment_id: string;
          task_id: string;
          task_code: string;
          task_title: string;
          mission_id: string;
          mission_code: string;
          team_name: string;
          requester_name: string;
          current_deadline: Date;
          requested_deadline: Date;
          reason: string;
          urgency: UrgencyLevel;
          created_at: Date;
        }>(
          `SELECT der.id, der.assignment_id, t.id AS task_id, t.code AS task_code, t.title AS task_title,
                  m.id AS mission_id, m.code AS mission_code, tm.name AS team_name,
                  req_m.display_name AS requester_name, der.current_deadline, der.requested_deadline,
                  der.reason, t.urgency, der.created_at
           FROM deadline_extension_requests der
           JOIN tasks t ON t.id = der.task_id
           JOIN missions m ON m.id = der.mission_id
           JOIN teams tm ON tm.id = t.owner_team_id
           JOIN members req_m ON req_m.id = der.requester_id
           WHERE der.status = 'PENDING'
             AND der.requester_id <> $1
             AND ($2::boolean = true OR t.owner_team_id = ANY($3::uuid[]))
           ORDER BY der.created_at ASC`,
          [actor.memberId, isBoardLeadership(actor.role), actor.leadTeamIds],
        )
      : [];

  const now = Date.now();
  return {
    assignments: rows.map((r) => ({
      assignmentId: r.assignment_id,
      taskId: r.task_id,
      taskCode: r.task_code,
      taskTitle: r.task_title,
      deliverable: r.task_deliverable,
      submissionMode: r.submission_mode,
      missionId: r.mission_id,
      missionCode: r.mission_code,
      missionTitle: r.mission_title,
      groupName: r.group_name,
      teamName: r.team_name,
      urgency: r.urgency,
      importance: r.importance,
      status: r.status,
      originalDeadline: new Date(r.original_deadline).toISOString(),
      deadline: new Date(r.evaluation_deadline).toISOString(),
      lateAgainstOriginalDeadline: Boolean(r.late_against_original_deadline),
      pendingExtension: r.pending_ext_id
        ? {
            id: r.pending_ext_id,
            requestedDeadline: new Date(r.pending_ext_deadline!).toISOString(),
          }
        : null,
      isOverdue: !["COMPLETED", "DECLINED"].includes(r.status) && new Date(r.evaluation_deadline).getTime() < now,
      weight: Number(r.weight),
      declineReason: r.decline_reason,
      submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : null,
    })),
    reviewQueue: reviewQueue.map((q) => ({
      versionId: q.version_id,
      versionNo: q.version_no,
      taskId: q.task_id,
      taskCode: q.task_code,
      taskTitle: q.task_title,
      missionId: q.mission_id,
      missionCode: q.mission_code,
      missionTitle: q.mission_title,
      submittedByName: q.submitted_by_name,
      submittedAt: new Date(q.submitted_at).toISOString(),
      deadline: new Date(q.deadline_current).toISOString(),
      urgency: q.urgency,
    })),
    delegationQueue: delegationQueue.map((d) => ({
      taskId: d.task_id,
      taskCode: d.task_code,
      taskTitle: d.task_title,
      deliverable: d.deliverable,
      missionId: d.mission_id,
      missionCode: d.mission_code,
      missionTitle: d.mission_title,
      ownerTeamId: d.owner_team_id,
      teamName: d.team_name,
      creatorName: d.creator_name,
      deadline: new Date(d.deadline_current).toISOString(),
      isOverdue: new Date(d.deadline_current).getTime() < now,
      urgency: d.urgency,
      weight: Number(d.weight),
      declinedCount: Number(d.declined_count ?? 0),
    })),
    extensionQueue: extensionQueue.map((e) => ({
      id: e.id,
      assignmentId: e.assignment_id,
      taskId: e.task_id,
      taskCode: e.task_code,
      taskTitle: e.task_title,
      missionId: e.mission_id,
      missionCode: e.mission_code,
      teamName: e.team_name,
      requesterName: e.requester_name,
      currentDeadline: new Date(e.current_deadline).toISOString(),
      requestedDeadline: new Date(e.requested_deadline).toISOString(),
      reason: e.reason,
      urgency: e.urgency,
      createdAt: new Date(e.created_at).toISOString(),
    })),
  };
}
