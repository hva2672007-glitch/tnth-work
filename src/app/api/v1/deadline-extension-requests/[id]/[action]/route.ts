import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { resolveDeadlineExtension } from "@/server/missions/workflow";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ResolveExtensionSchema = z.object({
  note: z.string().max(1000).optional(),
  approvedDeadline: z.string().optional(),
  syncMissionDeadline: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id, action } = await params;
    if (action !== "approve" && action !== "reject") {
      throw new AppError(400, "INVALID_ACTION", "Thao tác không hợp lệ (chỉ chấp nhận approve hoặc reject).");
    }
    const raw = await request.json().catch(() => ({}));
    const input = ResolveExtensionSchema.parse(raw);
    const res = await resolveDeadlineExtension(actor, id, action, input);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
