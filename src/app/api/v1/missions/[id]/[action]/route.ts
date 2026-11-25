import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { assignDraftMission, missionLifecycleAction } from "@/server/missions/workflow";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ActionBodySchema = z.object({
  reason: z.string().max(1000).optional(),
  holdUntil: z.string().optional(),
  targetTaskId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id, action } = await params;
    const raw = await request.json().catch(() => ({}));
    const body = ActionBodySchema.parse(raw);

    if (action === "assign") {
      const res = await assignDraftMission(actor, id);
      return okJson(res);
    }
    if (["hold", "resume", "cancel", "reopen", "complete"].includes(action)) {
      const res = await missionLifecycleAction(
        actor,
        id,
        action as "hold" | "resume" | "cancel" | "reopen" | "complete",
        body,
      );
      return okJson(res);
    }
    throw new AppError(404, "UNKNOWN_ACTION", `Thao tác không hỗ trợ: ${action}`);
  } catch (err) {
    return errorJson(err);
  }
}
