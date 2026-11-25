import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { isBoardLeadership, requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    requirePermission(actor, "audit.view", {}, "Bạn không có quyền xem nhật ký hệ thống.");

    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));

    // TEAM_LEAD chỉ xem nhật ký nghiệp vụ của chính mình hoặc thành viên tổ mình; 01/02 xem toàn Ban
    const rows = isBoardLeadership(actor.role)
      ? await query<{
          id: string;
          actor_id: string | null;
          actor_name: string | null;
          action: string;
          target_type: string;
          target_id: string | null;
          safe_diff: unknown;
          created_at: Date;
        }>(
          `SELECT al.*, m.display_name AS actor_name
           FROM audit_logs al
           LEFT JOIN members m ON m.id = al.actor_id
           ORDER BY al.created_at DESC
           LIMIT $1`,
          [limit],
        )
      : await query<{
          id: string;
          actor_id: string | null;
          actor_name: string | null;
          action: string;
          target_type: string;
          target_id: string | null;
          safe_diff: unknown;
          created_at: Date;
        }>(
          `SELECT al.*, m.display_name AS actor_name
           FROM audit_logs al
           LEFT JOIN members m ON m.id = al.actor_id
           WHERE al.actor_id = $1
              OR EXISTS (
                SELECT 1 FROM team_memberships tm
                WHERE tm.member_id = al.actor_id AND tm.effective_to IS NULL AND tm.team_id = ANY($2::uuid[])
              )
           ORDER BY al.created_at DESC
           LIMIT $3`,
          [actor.memberId, actor.leadTeamIds, limit],
        );

    return okJson(
      rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name ?? "Hệ thống",
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        safeDiff: r.safe_diff,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    );
  } catch (err) {
    return errorJson(err);
  }
}
