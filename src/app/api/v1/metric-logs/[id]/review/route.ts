import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { reviewMetricLog } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ReviewMetricSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const { decision, note } = ReviewMetricSchema.parse(await request.json());
    const res = await reviewMetricLog(actor, id, decision, note);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
