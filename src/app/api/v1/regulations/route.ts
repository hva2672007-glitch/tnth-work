import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { proposeRegulationAmendment } from "@/server/approvals/service";
import { query } from "@/server/db";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ProposeRegSchema = z.object({
  title: z.string().min(5, "Tiêu đề tối thiểu 5 ký tự.").max(240),
  body: z.string().min(10, "Nội dung quy chế tối thiểu 10 ký tự.").max(50000),
  reason: z.string().min(5, "Vui lòng ghi rõ lý do sửa đổi quy chế.").max(1000),
  effectiveAt: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const canSeeProposals = actor.role !== "MEMBER";

    const rows = await query<{
      id: string;
      version_code: string;
      title: string;
      body: string;
      reason: string;
      previous_id: string | null;
      status: string;
      effective_at: Date;
      created_by_name: string;
      created_at: Date;
      approved_at: Date | null;
    }>(
      `SELECT rv.*, m.display_name AS created_by_name
       FROM regulation_versions rv
       JOIN members m ON m.id = rv.created_by
       ${canSeeProposals ? "" : "WHERE rv.status IN ('APPROVED', 'SUPERSEDED')"}
       ORDER BY rv.created_at DESC`,
    );

    const mapped = rows.map((r) => ({
      id: r.id,
      versionCode: r.version_code,
      title: r.title,
      body: r.body,
      reason: r.reason,
      previousId: r.previous_id,
      status: r.status,
      effectiveAt: new Date(r.effective_at).toISOString(),
      createdByName: r.created_by_name,
      createdAt: new Date(r.created_at).toISOString(),
      approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    }));

    const current = mapped.find((r) => r.status === "APPROVED") ?? null;
    return okJson({ current, versions: mapped });
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const input = ProposeRegSchema.parse(await request.json());
    const result = await proposeRegulationAmendment(actor, input);
    return okJson(result, 201);
  } catch (err) {
    return errorJson(err);
  }
}
