import { query } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { buildMissionScopeClause, isObserverRole, isWorkerRole } from "@/server/authorization/policy";
import { detectBottlenecks } from "@/server/reports/bottlenecks";
import { currentVnYearMonth, vnMonthRange } from "@/lib/date";

export async function getDashboardSummary(
  actor: AuthActor,
  filters?: {
    periodKey?: string;
    allTime?: boolean;
    teamId?: string;
    groupId?: string;
    urgency?: string;
    importance?: string;
  },
) {
  const { year, month } = currentVnYearMonth();
  let range = vnMonthRange(year, month);
  if (filters?.periodKey && /^\d{4}-\d{2}$/.test(filters.periodKey)) {
    const [y, m] = filters.periodKey.split("-").map(Number);
    range = vnMonthRange(y, m);
  }

  const scope = buildMissionScopeClause(actor, 1);
  const params: unknown[] = [...scope.params];
  const where: string[] = [scope.clause];

  if (isWorkerRole(actor.role)) {
    where.push(`m.status <> 'DRAFT'`);
  }
  if (!filters?.allTime) {
    params.push(range.start.toISOString(), range.end.toISOString());
    where.push(`m.deadline_current >= $${params.length - 1} AND m.deadline_current < $${params.length}`);
  }
  if (filters?.teamId) {
    params.push(filters.teamId);
    where.push(`EXISTS (SELECT 1 FROM mission_teams mt WHERE mt.mission_id = m.id AND mt.team_id = $${params.length})`);
  }
  if (filters?.groupId) {
    params.push(filters.groupId);
    where.push(`m.group_id = $${params.length}`);
  }
  if (filters?.urgency) {
    params.push(filters.urgency);
    where.push(`m.urgency = $${params.length}`);
  }
  if (filters?.importance) {
    params.push(filters.importance);
    where.push(`m.importance = $${params.length}`);
  }

  const whereSql = where.join(" AND ");

  const missions = await query<{
    id: string;
    code: string;
    title: string;
    status: string;
    urgency: string;
    importance: string;
    deadline_current: Date;
    group_name: string;
    owner_name: string;
  }>(
    `SELECT m.id, m.code, m.title, m.status, m.urgency, m.importance, m.deadline_current,
            tg.name AS group_name, ow.display_name AS owner_name
     FROM missions m
     JOIN task_groups tg ON tg.id = m.group_id
     JOIN members ow ON ow.id = m.owner_id
     WHERE ${whereSql}
     ORDER BY m.deadline_current ASC`,
    params,
  );

  const tasks = await query<{
    id: string;
    code: string;
    title: string;
    status: string;
    urgency: string;
    deadline_current: Date;
    mission_id: string;
    mission_code: string;
    owner_team_name: string;
  }>(
    `SELECT t.id, t.code, t.title, t.status, t.urgency, t.deadline_current,
            m.id AS mission_id, m.code AS mission_code, tm.name AS owner_team_name
     FROM tasks t
     JOIN missions m ON m.id = t.mission_id
     JOIN teams tm ON tm.id = t.owner_team_id
     WHERE ${whereSql}
     ORDER BY t.deadline_current ASC`,
    params,
  );

  const now = Date.now();
  const in48h = now + 48 * 3600 * 1000;

  const missionCounts = {
    total: missions.length,
    draft: 0,
    notStarted: 0,
    inProgress: 0,
    awaitingReview: 0,
    awaitingPublication: 0,
    overdue: 0,
    completed: 0,
    onHold: 0,
    cancelled: 0,
  };

  for (const m of missions) {
    if (m.status === "DRAFT") missionCounts.draft++;
    else if (m.status === "ASSIGNED") missionCounts.notStarted++;
    else if (m.status === "IN_PROGRESS") missionCounts.inProgress++;
    else if (m.status === "AWAITING_REVIEW") missionCounts.awaitingReview++;
    else if (m.status === "AWAITING_PUBLICATION") missionCounts.awaitingPublication++;
    else if (m.status === "COMPLETED") missionCounts.completed++;
    else if (m.status === "ON_HOLD") missionCounts.onHold++;
    else if (m.status === "CANCELLED") missionCounts.cancelled++;

    if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(m.status) && new Date(m.deadline_current).getTime() < now) {
      missionCounts.overdue++;
    }
  }

  const taskCounts = {
    total: tasks.length,
    draft: 0,
    notStarted: 0,
    inProgress: 0,
    awaitingReview: 0,
    revisionRequired: 0,
    overdue: 0,
    completed: 0,
    onHold: 0,
    cancelled: 0,
  };

  for (const t of tasks) {
    if (t.status === "DRAFT") taskCounts.draft++;
    else if (t.status === "ASSIGNED") taskCounts.notStarted++;
    else if (t.status === "IN_PROGRESS") taskCounts.inProgress++;
    else if (t.status === "SUBMITTED") taskCounts.awaitingReview++;
    else if (t.status === "REVISION_REQUIRED") taskCounts.revisionRequired++;
    else if (t.status === "COMPLETED") taskCounts.completed++;
    else if (t.status === "ON_HOLD") taskCounts.onHold++;
    else if (t.status === "CANCELLED") taskCounts.cancelled++;

    if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(t.status) && new Date(t.deadline_current).getTime() < now) {
      taskCounts.overdue++;
    }
  }

  const upcomingDeadlines = tasks
    .filter((t) => !["DRAFT", "COMPLETED", "CANCELLED"].includes(t.status))
    .filter((t) => {
      const due = new Date(t.deadline_current).getTime();
      return due <= in48h;
    })
    .slice(0, 12)
    .map((t) => ({
      taskId: t.id,
      taskCode: t.code,
      taskTitle: t.title,
      missionId: t.mission_id,
      missionCode: t.mission_code,
      teamName: t.owner_team_name,
      status: t.status,
      urgency: t.urgency,
      deadline: new Date(t.deadline_current).toISOString(),
      isOverdue: new Date(t.deadline_current).getTime() < now,
    }));

  const bottlenecks = isObserverRole(actor.role)
    ? { items: [], countsByCode: {} }
    : await detectBottlenecks(actor, { teamId: filters?.teamId, groupId: filters?.groupId });

  return {
    period: {
      periodKey: range.periodKey,
      label: filters?.allTime ? "Toàn thời gian" : range.label,
      allTime: Boolean(filters?.allTime),
    },
    missions: missionCounts,
    tasks: taskCounts,
    upcomingDeadlines,
    bottlenecks: {
      total: bottlenecks.items.length,
      countsByCode: bottlenecks.countsByCode,
      items: bottlenecks.items.slice(0, 20),
    },
    refreshedAt: new Date().toISOString(),
  };
}
