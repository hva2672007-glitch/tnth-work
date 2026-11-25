import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PatchScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  autoAssign: z.boolean().optional(),
  name: z.string().min(3).max(200).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    requirePermission(actor, "mission.create");
    const { id } = await params;
    const input = PatchScheduleSchema.parse(await request.json());

    const rows = await query<{ id: string }>(
      `UPDATE recurring_schedules
       SET enabled = COALESCE($1, enabled),
           auto_assign = COALESCE($2, auto_assign),
           name = COALESCE($3, name),
           version = version + 1,
           updated_at = now()
       WHERE id = $4 RETURNING id`,
      [input.enabled ?? null, input.autoAssign ?? null, input.name?.trim() ?? null, id],
    );
    if (!rows[0]) throw new AppError(404, "SCHEDULE_NOT_FOUND", "Không tìm thấy lịch nhiệm vụ định kỳ.");
    await writeAudit({ actorId: actor.memberId, action: "RECURRING_SCHEDULE_UPDATED", targetType: "RECURRING_SCHEDULE", targetId: id, safeDiff: input });
    return okJson({ id, updated: true });
  } catch (err) {
    return errorJson(err);
  }
}
