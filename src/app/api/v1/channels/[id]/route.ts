import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PatchChannelSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    requirePermission(actor, "channel.manage");
    const { id } = await params;
    const input = PatchChannelSchema.parse(await request.json());

    const rows = await query<{ id: string }>(
      `UPDATE publication_channels
       SET name = COALESCE($1, name), active = COALESCE($2, active), sort_order = COALESCE($3, sort_order), updated_at = now()
       WHERE id = $4 RETURNING id`,
      [input.name?.trim() ?? null, input.active ?? null, input.sortOrder ?? null, id],
    );
    if (!rows[0]) throw new AppError(404, "CHANNEL_NOT_FOUND", "Không tìm thấy kênh đăng tải.");
    await writeAudit({ actorId: actor.memberId, action: "CHANNEL_UPDATED", targetType: "CHANNEL", targetId: id, safeDiff: input });
    return okJson({ id, updated: true });
  } catch (err) {
    return errorJson(err);
  }
}
