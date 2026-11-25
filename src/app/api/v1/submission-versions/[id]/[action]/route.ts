import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { reviewSubmissionVersion } from "@/server/submissions/service";
import { checkIdempotency, saveIdempotency } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ReviewSchema = z.object({
  note: z.string().max(2000).optional(),
  overrideReason: z.string().max(500).optional(),
  confirmedContributorIds: z.array(z.string().uuid()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id, action } = await params;
    if (action !== "approve" && action !== "request-revision") {
      throw new AppError(404, "UNKNOWN_ACTION", `Thao tác không hỗ trợ: ${action}`);
    }

    const raw = await request.json().catch(() => ({}));
    const idemKey = request.headers.get("idempotency-key");
    const idem = await checkIdempotency(actor.memberId, `review:${id}:${action}`, idemKey, raw);
    if (idem.hit) {
      return NextResponse.json(idem.body, { status: idem.status });
    }

    const body = ReviewSchema.parse(raw);
    const decision = action === "approve" ? "APPROVED" : "REVISION_REQUIRED";
    const result = await reviewSubmissionVersion(actor, id, decision, body);
    const responseBody = { data: result };
    await saveIdempotency(actor.memberId, `review:${id}:${action}`, idemKey, idem.hash, 200, responseBody);
    return okJson(result);
  } catch (err) {
    return errorJson(err);
  }
}
