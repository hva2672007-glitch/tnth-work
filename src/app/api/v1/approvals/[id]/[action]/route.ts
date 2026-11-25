import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { applyApprovalRequest, castApprovalVote } from "@/server/approvals/service";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const VoteSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id, action } = await params;

    if (action === "vote") {
      const input = VoteSchema.parse(await request.json());
      const res = await castApprovalVote(actor, id, input);
      return okJson(res);
    }
    if (action === "apply") {
      const res = await applyApprovalRequest(actor, id);
      return okJson(res);
    }
    if (action === "cancel") {
      const req = await queryOne<{ id: string; proposer_id: string; status: string; type: string; target_id: string }>(
        `SELECT id, proposer_id, status, type, target_id FROM approval_requests WHERE id = $1`,
        [id],
      );
      if (!req) throw new AppError(404, "APPROVAL_NOT_FOUND", "Không tìm thấy yêu cầu.");
      if (req.proposer_id !== actor.memberId && actor.role !== "HEAD") {
        throw new AppError(403, "FORBIDDEN", "Chỉ người đề xuất hoặc Trưởng Ban mới được hủy yêu cầu.");
      }
      if (!["PENDING", "READY_TO_APPLY"].includes(req.status)) {
        throw new AppError(409, "INVALID_STATE", "Không thể hủy yêu cầu đã kết thúc.");
      }
      await query(`UPDATE approval_requests SET status = 'CANCELLED', resolved_at = now() WHERE id = $1`, [id]);
      if (req.type === "REGULATION_AMENDMENT") {
        await query(`UPDATE regulation_versions SET status = 'CANCELLED' WHERE id = $1`, [req.target_id]);
      }
      await writeAudit({ actorId: actor.memberId, action: "APPROVAL_CANCELLED", targetType: "APPROVAL_REQUEST", targetId: id });
      return okJson({ id, status: "CANCELLED" });
    }

    throw new AppError(404, "UNKNOWN_ACTION", `Thao tác không hỗ trợ: ${action}`);
  } catch (err) {
    return errorJson(err);
  }
}
