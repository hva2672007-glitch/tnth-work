import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { assignmentAction } from "@/server/missions/workflow";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const AssignmentBodySchema = z.object({
  reason: z.string().max(1000).optional(),
  newMemberId: z.string().uuid().optional(),
  weight: z.number().positive().max(20).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id, action } = await params;
    if (!["accept", "decline", "transfer"].includes(action)) {
      throw new AppError(404, "UNKNOWN_ACTION", `Thao tác không hỗ trợ: ${action}`);
    }
    const raw = await request.json().catch(() => ({}));
    const body = AssignmentBodySchema.parse(raw);
    const res = await assignmentAction(actor, id, action as "accept" | "decline" | "transfer", body);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
