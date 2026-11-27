import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { grantMemberAccess } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const GrantAccessSchema = z.object({
  externalAccountId: z.string().min(1),
  role: z.enum([
    "ACTING_HEAD",
    "DEPUTY_INSPECTOR",
    "DEPUTY",
    "TEAM_LEAD",
    "TEAM_DEPUTY",
    "MEMBER",
    "COLLABORATOR",
    "OBSERVER",
  ]),
  primaryTeamId: z.string().uuid(),
  primaryTeamTitle: z.enum(["MEMBER", "LEADER", "DEPUTY_LEADER"]).optional(),
  secondaryTeamIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const input = GrantAccessSchema.parse(await request.json());
    const result = await grantMemberAccess(actor, input);
    return okJson(result, 201);
  } catch (err) {
    return errorJson(err);
  }
}
