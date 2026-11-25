import { query, withTransaction } from "@/server/db";
import { createNotification, createNotifications } from "@/server/notifications/service";
import { loadActorByMemberId } from "@/server/auth/session";
import { createMission, type CreateTaskInput } from "@/server/missions/workflow";
import { DEFAULT_REMINDER_OFFSETS_MINUTES, type CompletionMode, type ImportanceLevel, type UrgencyLevel } from "@/lib/constants";
import { computeNextOccurrence } from "@/lib/date";

export interface JobRunReport {
  remindersCreated: number;
  overdueAlertsCreated: number;
  recurringMissionsCreated: number;
  recurringMissedMarked: number;
  errors: string[];
}

/**
 * Job runner chạy định kỳ (cron mỗi phút hoặc gọi tay qua `npm run jobs:run`):
 * 1. Quét mốc nhắc deadline theo độ khẩn (Hỏa tốc 30/10p, Thượng khẩn 120/30p, Khẩn 360/60p, Thông thường 1440/120p), dedupe tuyệt đối.
 * 2. Quét quá hạn (tối đa 1 thông báo mỗi ngày mỗi assignment, không spam, bỏ qua việc đã hoàn thành/hủy/hoãn).
 * 3. Sinh nhiệm vụ định kỳ (tuần/tháng/năm/ngày) có unique `(schedule_id, occurrence_at)` chống trùng khi restart và catch-up giới hạn.
 */
export async function runScheduledJobs(now: Date = new Date()): Promise<JobRunReport> {
  const report: JobRunReport = {
    remindersCreated: 0,
    overdueAlertsCreated: 0,
    recurringMissionsCreated: 0,
    recurringMissedMarked: 0,
    errors: [],
  };

  // 1 & 2: Quét các assignment đang mở trên mission/task đang hoạt động
  const openAssignments = await query<{
    assignment_id: string;
    member_id: string;
    assigned_by: string;
    status: string;
    assigned_at: Date;
    evaluation_deadline: Date;
    version: number;
    task_id: string;
    task_code: string;
    task_title: string;
    urgency: UrgencyLevel;
    mission_id: string;
    mission_code: string;
    owner_team_id: string;
  }>(
    `SELECT ta.id AS assignment_id, ta.member_id, ta.assigned_by, ta.status,
            ta.assigned_at, ta.evaluation_deadline, ta.version,
            t.id AS task_id, t.code AS task_code, t.title AS task_title, t.urgency,
            m.id AS mission_id, m.code AS mission_code, t.owner_team_id
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN missions m ON m.id = t.mission_id
     WHERE ta.status IN ('PENDING', 'ACCEPTED', 'REVISION_REQUIRED')
       AND t.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD')
       AND m.status NOT IN ('DRAFT', 'COMPLETED', 'CANCELLED', 'ON_HOLD')`,
  );

  const nowMs = now.getTime();
  const dayKey = now.toISOString().slice(0, 10);

  for (const a of openAssignments) {
    const dueMs = new Date(a.evaluation_deadline).getTime();
    const assignedMs = new Date(a.assigned_at).getTime();
    const minutesLeft = (dueMs - nowMs) / 60_000;
    const dueVersionKey = new Date(a.evaluation_deadline).toISOString();

    if (minutesLeft > 0) {
      const offsets = DEFAULT_REMINDER_OFFSETS_MINUTES[a.urgency] ?? [1440, 120];
      for (const offset of offsets) {
        const triggerMs = dueMs - offset * 60_000;
        // Bỏ mốc đã qua trước lúc giao việc (mục 9)
        if (triggerMs <= assignedMs) continue;
        if (nowMs >= triggerMs && nowMs < dueMs) {
          const dedupeKey = `rem:${a.assignment_id}:${dueVersionKey}:${offset}`;
          const before = await query<{ id: string }>(
            `SELECT id FROM notifications WHERE recipient_id = $1 AND dedupe_key = $2`,
            [a.member_id, dedupeKey],
          );
          if (!before[0]) {
            await createNotification({
              recipientId: a.member_id,
              eventType: "DEADLINE_APPROACHING",
              targetType: "MISSION",
              targetId: a.mission_id,
              title: `Sắp đến hạn (${a.task_code}) — còn dưới ${offset >= 60 ? `${offset / 60} giờ` : `${offset} phút`}`,
              message: `Task "${a.task_title}" (${a.mission_code}) sắp đến hạn nộp sản phẩm.`,
              link: `/missions/${a.mission_id}`,
              dedupeKey,
            });
            report.remindersCreated++;
          }
        }
      }
    } else {
      // Đã quá hạn: tối đa 1 nhắc mỗi ngày cho người thực hiện + quản lý
      const dedupeKey = `overdue:${a.assignment_id}:${dayKey}`;
      const before = await query<{ id: string }>(
        `SELECT id FROM notifications WHERE recipient_id = $1 AND dedupe_key = $2`,
        [a.member_id, dedupeKey],
      );
      if (!before[0]) {
        await createNotifications([a.member_id, a.assigned_by], {
          eventType: "DEADLINE_OVERDUE",
          targetType: "MISSION",
          targetId: a.mission_id,
          title: `Quá hạn nộp sản phẩm (${a.task_code})`,
          message: `Task "${a.task_title}" (${a.mission_code}) đã quá thời hạn.`,
          link: `/missions/${a.mission_id}`,
          dedupeKey,
        });
        report.overdueAlertsCreated++;
      }
    }
  }

  // 3: Nhiệm vụ định kỳ (catch-up giới hạn tối đa 1 kỳ gần nhất mỗi lần chạy; kỳ cũ hơn đánh dấu missed)
  const dueSchedules = await query<{
    id: string;
    name: string;
    group_id: string;
    template: {
      title: string;
      description?: string;
      expectedOutcome?: string;
      ownerId: string;
      importance?: ImportanceLevel;
      completionMode?: CompletionMode;
      tasks: Array<{
        title: string;
        ownerTeamId: string;
        ownerId?: string;
        reviewerId?: string | null;
        weight?: number;
        assigneeIds?: string[];
      }>;
    };
    frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    interval_count: number;
    day_of_month: number | null;
    month_of_year: number | null;
    run_time: string;
    deadline_offset_hours: number;
    auto_assign: boolean;
    ends_at: Date | null;
    next_run_at: Date;
    creator_id: string;
  }>(
    `SELECT * FROM recurring_schedules
     WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= $1
       AND (ends_at IS NULL OR next_run_at <= ends_at)`,
    [now.toISOString()],
  );

  for (const s of dueSchedules) {
    try {
      const occurrence = new Date(s.next_run_at);
      // Kiểm tra idempotent: đã tạo mission cho (schedule_id, occurrence_at) chưa?
      const exists = await query<{ id: string }>(
        `SELECT id FROM missions WHERE schedule_id = $1 AND occurrence_at = $2`,
        [s.id, occurrence.toISOString()],
      );

      if (!exists[0]) {
        const creator = await loadActorByMemberId(s.creator_id);
        if (!creator || !creator.accessEnabled) {
          report.errors.push(`Lịch ${s.name}: người tạo không còn quyền hoạt động.`);
          continue;
        }
        const deadline = new Date(occurrence.getTime() + s.deadline_offset_hours * 3600 * 1000);
        const occurrenceLabel = occurrence.toISOString().slice(0, 10);
        const tasks: CreateTaskInput[] = (s.template.tasks ?? []).map((t, idx) => ({
          tempKey: `rt-${idx}`,
          title: t.title,
          ownerTeamId: t.ownerTeamId,
          ownerId: t.ownerId ?? s.template.ownerId,
          reviewerId: t.reviewerId ?? null,
          weight: t.weight ?? 1,
          deadline: deadline.toISOString(),
          assigneeIds: t.assigneeIds ?? [],
        }));

        await createMission(creator, {
          groupId: s.group_id,
          title: `${s.template.title} (${occurrenceLabel})`,
          description: s.template.description ?? `Nhiệm vụ định kỳ sinh tự động từ lịch "${s.name}".`,
          expectedOutcome: s.template.expectedOutcome ?? "",
          ownerId: s.template.ownerId,
          importance: s.template.importance ?? "NORMAL",
          deadline: deadline.toISOString(),
          completionMode: s.template.completionMode ?? "TASKS_ONLY",
          tasks,
          saveAsDraft: !s.auto_assign, // Mặc định tạo nháp để quản lý rà soát (mục 7.7)
          scheduleId: s.id,
          occurrenceAt: occurrence.toISOString(),
        });
        report.recurringMissionsCreated++;
      }

      // Tính mốc kế tiếp; nếu downtime dài khiến nhiều mốc bị bỏ lỡ, nhảy tới mốc > now và ghi missed_count
      let next = computeNextOccurrence({
        frequency: s.frequency,
        intervalCount: s.interval_count,
        dayOfMonth: s.day_of_month,
        monthOfYear: s.month_of_year,
        runTime: s.run_time,
        from: occurrence,
      });
      let missed = 0;
      while (next.getTime() <= nowMs && missed < 100) {
        missed++;
        next = computeNextOccurrence({
          frequency: s.frequency,
          intervalCount: s.interval_count,
          dayOfMonth: s.day_of_month,
          monthOfYear: s.month_of_year,
          runTime: s.run_time,
          from: next,
        });
      }
      report.recurringMissedMarked += missed;

      await withTransaction(async (tx) => {
        await tx.query(
          `UPDATE recurring_schedules
           SET last_run_at = $1, next_run_at = $2, missed_count = missed_count + $3, updated_at = now()
           WHERE id = $4`,
          [occurrence.toISOString(), next.toISOString(), missed, s.id],
        );
      });
    } catch (err) {
      report.errors.push(`Lịch ${s.name}: ${err instanceof Error ? err.message : "Lỗi không xác định"}`);
    }
  }

  return report;
}
