import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { getMyWork } from "@/server/missions/workflow";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const data = await getMyWork(actor);
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}
