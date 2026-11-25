import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { runScheduledJobs } from "@/server/jobs/runner";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateScheduleSchema = z.object({
  name: z.string().min(3).max(200),
  groupId: z.string().uuid(),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  intervalCount: z.number().int().min(1).max(12).default(1),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  monthOfYear: z.number().int().min(1).max(12).nullable().optional(),
  runTime: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  deadlineOffsetHours: z.number().int().min(1).max(720).default(48),
  autoAssign: z.boolean().default(false),
  startsAt: z.string().min(1),
  endsAt: z.string().nullable().optional(),
  template: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    expectedOutcome: z.string().max(2000).optional(),
    ownerId: z.string().uuid(),
    importance: z.enum(["KEY", "NORMAL"]).default("NORMAL"),
    completionMode: z.enum(["TASKS_ONLY", "TASKS_AND_PUBLICATIONS", "PUBLICATIONS_ONLY"]).default("TASKS_ONLY"),
    tasks: z
      .array(
        z.object({
          title: z.string().min(2),
          ownerTeamId: z.string().uuid(),
          ownerId: z.string().uuid().optional(),
          reviewerId: z.string().uuid().nullable().optional(),
          weight: z.number().positive().default(1),
          assigneeIds: z.array(z.string().uuid()).default([]),
        }),
      )
      .min(1),
  }),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    requirePermission(actor, "mission.create");
    const rows = await query<{
      id: string;
      name: string;
      group_id: string;
      group_name: string;
      template: unknown;
      frequency: string;
      interval_count: number;
      day_of_week: number | null;
      day_of_month: number | null;
      month_of_year: number | null;
      run_time: string;
      deadline_offset_hours: number;
      auto_assign: boolean;
      starts_at: Date;
      ends_at: Date | null;
      next_run_at: Date | null;
      last_run_at: Date | null;
      missed_count: number;
      enabled: boolean;
      creator_name: string;
    }>(
      `SELECT rs.*, tg.name AS group_name, m.display_name AS creator_name
       FROM recurring_schedules rs
       JOIN task_groups tg ON tg.id = rs.group_id
       JOIN members m ON m.id = rs.creator_id
       ORDER BY rs.created_at DESC`,
    );
    return okJson(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        groupId: r.group_id,
        groupName: r.group_name,
        template: r.template,
        frequency: r.frequency,
        intervalCount: r.interval_count,
        dayOfWeek: r.day_of_week,
        dayOfMonth: r.day_of_month,
        monthOfYear: r.month_of_year,
        runTime: r.run_time,
        deadlineOffsetHours: r.deadline_offset_hours,
        autoAssign: r.auto_assign,
        startsAt: new Date(r.starts_at).toISOString(),
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        nextRunAt: r.next_run_at ? new Date(r.next_run_at).toISOString() : null,
        lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
        missedCount: r.missed_count,
        enabled: r.enabled,
        creatorName: r.creator_name,
      })),
    );
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    requirePermission(actor, "mission.create");

    const raw = await request.json();
    if (raw && raw.action === "RUN_JOBS_NOW") {
      requirePermission(actor, "settings.manage");
      const report = await runScheduledJobs();
      return okJson(report);
    }

    const input = CreateScheduleSchema.parse(raw);
    const startDate = new Date(input.startsAt);
    const ins = await query<{ id: string }>(
      `INSERT INTO recurring_schedules (
         name, group_id, template, frequency, interval_count, day_of_week, day_of_month, month_of_year,
         run_time, deadline_offset_hours, auto_assign, starts_at, ends_at, next_run_at, creator_id
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $14)
       RETURNING id`,
      [
        input.name.trim(),
        input.groupId,
        JSON.stringify(input.template),
        input.frequency,
        input.intervalCount,
        input.dayOfWeek ?? null,
        input.dayOfMonth ?? null,
        input.monthOfYear ?? null,
        input.runTime,
        input.deadlineOffsetHours,
        input.autoAssign,
        startDate.toISOString(),
        input.endsAt ? new Date(input.endsAt).toISOString() : null,
        actor.memberId,
      ],
    );

    await writeAudit({
      actorId: actor.memberId,
      action: "RECURRING_SCHEDULE_CREATED",
      targetType: "RECURRING_SCHEDULE",
      targetId: ins[0].id,
      safeDiff: { name: input.name, frequency: input.frequency, autoAssign: input.autoAssign },
    });

    return okJson({ id: ins[0].id }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
