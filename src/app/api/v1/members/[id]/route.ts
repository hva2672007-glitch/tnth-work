import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { getMemberDetail } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const detail = await getMemberDetail(actor, id);
    return okJson(detail);
  } catch (err) {
    return errorJson(err);
  }
}
