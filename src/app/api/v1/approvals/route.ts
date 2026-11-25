import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { listApprovals, proposePromoteActingHead } from "@/server/approvals/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PromoteHeadSchema = z.object({
  type: z.literal("ROLE_PROMOTION_HEAD"),
  targetMemberId: z.string().uuid(),
  reason: z.string().min(5, "Vui lòng ghi rõ lý do đề xuất nâng Bậc 01.02 lên Bậc 01.01."),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const items = await listApprovals(actor);
    return okJson(items);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const input = PromoteHeadSchema.parse(await request.json());
    const res = await proposePromoteActingHead(actor, {
      targetMemberId: input.targetMemberId,
      reason: input.reason,
    });
    return okJson(res, 201);
  } catch (err) {
    return errorJson(err);
  }
}
