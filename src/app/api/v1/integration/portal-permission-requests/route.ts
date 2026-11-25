import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { getPortalProvider } from "@/server/auth/portal-adapter";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreatePortalPermSchema = z.object({
  targetMemberId: z.string().uuid(),
  requestedPermissions: z.array(z.string().min(1)).min(1, "Chọn ít nhất 01 nhóm quyền đề xuất."),
  reason: z.string().min(5, "Vui lòng ghi rõ lý do phân công quản trị cổng thông tin."),
  expiresAt: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    requirePermission(actor, "portal.permissions.request");

    const rows = await query<{
      id: string;
      target_member_id: string;
      target_name: string;
      target_ext_id: string;
      requested_permissions: string[];
      reason: string;
      expires_at: Date | null;
      requested_by_name: string;
      status: string;
      resolved_by_name: string | null;
      resolved_at: Date | null;
      evidence: string;
      created_at: Date;
    }>(
      `SELECT r.*, tm.display_name AS target_name, tm.external_account_id AS target_ext_id,
              rm.display_name AS requested_by_name, resm.display_name AS resolved_by_name
       FROM portal_permission_requests r
       JOIN members tm ON tm.id = r.target_member_id
       JOIN members rm ON rm.id = r.requested_by
       LEFT JOIN members resm ON resm.id = r.resolved_by
       ORDER BY r.created_at DESC
       LIMIT 100`,
    );

    return okJson(
      rows.map((r) => ({
        id: r.id,
        targetMemberId: r.target_member_id,
        targetName: r.target_name,
        targetExternalAccountId: r.target_ext_id,
        requestedPermissions: r.requested_permissions,
        reason: r.reason,
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        requestedByName: r.requested_by_name,
        status: r.status,
        resolvedByName: r.resolved_by_name,
        resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
        evidence: r.evidence,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    );
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    requirePermission(actor, "portal.permissions.request");

    const input = CreatePortalPermSchema.parse(await request.json());
    const target = await queryOne<{ id: string; external_account_id: string; display_name: string }>(
      `SELECT id, external_account_id, display_name FROM members WHERE id = $1 AND archived_at IS NULL`,
      [input.targetMemberId],
    );
    if (!target) throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");

    const portal = getPortalProvider();
    let externalId: string | null = null;
    let initialStatus: "PENDING" | "APPLIED" | "FAILED" = "PENDING";
    let evidence = "Chờ quản trị viên cổng thông tin xác nhận thực thi (không tự ghi đè account_permissions).";

    if (portal.requestPortalPermissionChange) {
      const res = await portal.requestPortalPermissionChange({
        externalAccountId: target.external_account_id,
        requestedPermissions: input.requestedPermissions,
        reason: input.reason,
        expiresAt: input.expiresAt,
      });
      externalId = res.externalRequestId ?? null;
      initialStatus = res.status === "APPLIED" ? "APPLIED" : res.status === "FAILED" ? "FAILED" : "PENDING";
      evidence = res.message;
    }

    const ins = await query<{ id: string }>(
      `INSERT INTO portal_permission_requests (
         target_member_id, requested_permissions, reason, expires_at, requested_by, external_request_id, status, evidence
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        target.id,
        JSON.stringify(input.requestedPermissions),
        input.reason.trim(),
        input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
        actor.memberId,
        externalId,
        initialStatus,
        evidence,
      ],
    );

    await writeAudit({
      actorId: actor.memberId,
      action: "PORTAL_PERMISSION_REQUEST_CREATED",
      targetType: "PORTAL_PERMISSION_REQUEST",
      targetId: ins[0].id,
      safeDiff: { targetMemberId: target.id, requestedPermissions: input.requestedPermissions, status: initialStatus },
    });

    return okJson({ id: ins[0].id, status: initialStatus, evidence }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
