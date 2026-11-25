import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { getMembersWorkload } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const data = await getMembersWorkload(actor, {
      teamId: url.searchParams.get("teamId") ?? undefined,
      search: url.searchParams.get("q") ?? undefined,
      onlyOverdue: url.searchParams.get("onlyOverdue") === "true",
      onlyFree: url.searchParams.get("onlyFree") === "true",
    });
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}
