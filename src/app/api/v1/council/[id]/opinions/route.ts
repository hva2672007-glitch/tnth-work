import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { submitCouncilOpinion } from "@/server/governance/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const OpinionSchema = z.object({
  choice: z.enum(["AGREE", "DISAGREE", "OTHER", "COMMENT"]).optional(),
  opinionText: z.string().min(3, "Nội dung góp ý tối thiểu 3 ký tự."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = OpinionSchema.parse(await request.json());
    const res = await submitCouncilOpinion(actor, id, input);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
