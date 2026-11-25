import type { NextRequest } from "next/server";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { confirmPublicationRequirement } from "@/server/submissions/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const res = await confirmPublicationRequirement(actor, id);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
