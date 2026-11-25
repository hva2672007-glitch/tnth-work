import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PatchGroupSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  description: z.string().max(400).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    requirePermission(actor, "group.manage", {}, "Chỉ Trưởng Ban (01.01) và Phó Ban (02) mới được chỉnh sửa hoặc ngừng khối nhiệm vụ.");
    const { id } = await params;
    const input = PatchGroupSchema.parse(await request.json());

    const rows = await query<{ id: string }>(
      `UPDATE task_groups
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           active = COALESCE($3, active),
           sort_order = COALESCE($4, sort_order),
           updated_at = now()
       WHERE id = $5
       RETURNING id`,
      [input.name?.trim() ?? null, input.description?.trim() ?? null, input.active ?? null, input.sortOrder ?? null, id],
    );
    if (!rows[0]) throw new AppError(404, "GROUP_NOT_FOUND", "Không tìm thấy khối nhiệm vụ.");
    await writeAudit({ actorId: actor.memberId, action: "TASK_GROUP_UPDATED", targetType: "TASK_GROUP", targetId: id, safeDiff: input });
    return okJson({ id, updated: true });
  } catch (err) {
    return errorJson(err);
  }
}
