import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { updateMemberTeams } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const TeamsSchema = z.object({
  memberships: z
    .array(
      z.object({
        teamId: z.string().uuid(),
        isPrimary: z.boolean(),
        teamTitle: z.enum(["MEMBER", "LEADER", "DEPUTY_LEADER"]),
      }),
    )
    .min(1),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = TeamsSchema.parse(await request.json());
    const result = await updateMemberTeams(actor, id, input.memberships);
    return okJson(result);
  } catch (err) {
    return errorJson(err);
  }
}
