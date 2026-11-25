import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { listMembersDirectory } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const members = await listMembersDirectory(actor, {
      search: url.searchParams.get("q") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      activityStatus: url.searchParams.get("activityStatus") ?? undefined,
      includeRevoked: url.searchParams.get("includeRevoked") === "true",
      includeWorkload: url.searchParams.get("includeWorkload") === "true",
    });
    return okJson(members);
  } catch (err) {
    return errorJson(err);
  }
}
