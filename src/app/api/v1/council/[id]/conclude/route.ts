import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { concludeCouncilItem } from "@/server/governance/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ConcludeSchema = z.object({
  meetingConclusion: z.string().min(5, "Nội dung kết luận cuộc họp tối thiểu 5 ký tự."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const { meetingConclusion } = ConcludeSchema.parse(await request.json());
    const res = await concludeCouncilItem(actor, id, meetingConclusion);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
