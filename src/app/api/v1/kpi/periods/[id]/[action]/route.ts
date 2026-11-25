import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { finalizeKpiPeriod, reopenKpiPeriod } from "@/server/reports/kpi";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const FinalizeSchema = z.object({
  allowPendingReviews: z.boolean().optional(),
  exceptionReason: z.string().max(1000).optional(),
  reason: z.string().max(1000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id, action } = await params;
    const body = FinalizeSchema.parse(await request.json().catch(() => ({})));

    if (action === "finalize") {
      const res = await finalizeKpiPeriod(actor, id, {
        allowPendingReviews: body.allowPendingReviews,
        exceptionReason: body.exceptionReason,
      });
      return okJson(res);
    }
    if (action === "reopen") {
      const res = await reopenKpiPeriod(actor, id, body.reason ?? "");
      return okJson(res);
    }
    throw new AppError(404, "UNKNOWN_ACTION", `Thao tác không hỗ trợ: ${action}`);
  } catch (err) {
    return errorJson(err);
  }
}
