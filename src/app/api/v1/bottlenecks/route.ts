import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { detectBottlenecks } from "@/server/reports/bottlenecks";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const data = await detectBottlenecks(actor, {
      teamId: url.searchParams.get("teamId") ?? undefined,
      groupId: url.searchParams.get("groupId") ?? undefined,
    });
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}
