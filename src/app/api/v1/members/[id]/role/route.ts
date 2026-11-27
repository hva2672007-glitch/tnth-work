import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { changeMemberRole } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ChangeRoleSchema = z.object({
  newRole: z.enum([
    "ACTING_HEAD",
    "DEPUTY_INSPECTOR",
    "DEPUTY",
    "TEAM_LEAD",
    "TEAM_DEPUTY",
    "MEMBER",
    "COLLABORATOR",
    "OBSERVER",
  ]),
  reason: z.string().trim().min(3, "Vui lòng nhập lý do thay đổi cấp bậc (tối thiểu 3 ký tự).").max(500),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id } = await params;
    const input = ChangeRoleSchema.parse(await request.json());
    const res = await changeMemberRole(actor, id, input.newRole, input.reason);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
