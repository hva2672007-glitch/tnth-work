import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { getDashboardSummary } from "@/server/reports/dashboard";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const data = await getDashboardSummary(actor, {
      periodKey: url.searchParams.get("periodKey") ?? undefined,
      allTime: url.searchParams.get("allTime") === "true",
      teamId: url.searchParams.get("teamId") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
      urgency: url.searchParams.get("urgency") ?? undefined,
      importance: url.searchParams.get("importance") ?? undefined,
    });
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}
