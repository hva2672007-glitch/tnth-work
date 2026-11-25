import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { revokeMemberAccess } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const RevokeSchema = z.object({
  reason: z.string().min(3, "Vui lòng nhập lý do thu hồi quyền truy cập."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id } = await params;
    const input = RevokeSchema.parse(await request.json());
    const result = await revokeMemberAccess(actor, id, input.reason);
    return okJson(result);
  } catch (err) {
    return errorJson(err);
  }
}
