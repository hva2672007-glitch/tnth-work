import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { reviewInitiative } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reviewNote: z.string().optional(),
  pointsLead: z.number().positive().max(20).optional(),
  pointsParticipant: z.number().positive().max(20).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = ReviewSchema.parse(await request.json());
    const res = await reviewInitiative(actor, id, input);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
