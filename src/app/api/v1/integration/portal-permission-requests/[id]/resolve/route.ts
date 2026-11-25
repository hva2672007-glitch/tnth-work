import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ResolveSchema = z.object({
  status: z.enum(["APPLIED", "REJECTED", "REVOKED"]),
  evidence: z.string().min(3, "Vui lòng ghi rõ bằng chứng/ghi chú xác nhận từ quản trị viên cổng thông tin."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    requirePermission(actor, "portal.permissions.request");

    const { id } = await params;
    const input = ResolveSchema.parse(await request.json());

    const existing = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM portal_permission_requests WHERE id = $1`,
      [id],
    );
    if (!existing) throw new AppError(404, "NOT_FOUND", "Không tìm thấy yêu cầu phân quyền cổng thông tin.");

    await query(
      `UPDATE portal_permission_requests
       SET status = $1, evidence = $2, resolved_by = $3, resolved_at = now(), updated_at = now()
       WHERE id = $4`,
      [input.status, input.evidence.trim(), actor.memberId, id],
    );

    await writeAudit({
      actorId: actor.memberId,
      action: "PORTAL_PERMISSION_REQUEST_RESOLVED",
      targetType: "PORTAL_PERMISSION_REQUEST",
      targetId: id,
      safeDiff: { oldStatus: existing.status, newStatus: input.status, evidence: input.evidence.trim() },
    });

    return okJson({ id, status: input.status });
  } catch (err) {
    return errorJson(err);
  }
}
