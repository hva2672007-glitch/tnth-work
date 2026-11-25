import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { updateMemberActivityStatus } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ActivitySchema = z.object({
  activityStatus: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]),
  reason: z.string().min(2, "Vui lòng ghi lý do thay đổi tình trạng hoạt động."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id } = await params;
    const input = ActivitySchema.parse(await request.json());
    const result = await updateMemberActivityStatus(actor, id, input.activityStatus, input.reason);
    return okJson(result);
  } catch (err) {
    return errorJson(err);
  }
}
