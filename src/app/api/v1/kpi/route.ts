import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { getKpiReport } from "@/server/reports/kpi";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const data = await getKpiReport(actor, {
      periodKey: url.searchParams.get("periodKey") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
      memberId: url.searchParams.get("memberId") ?? undefined,
    });
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}
