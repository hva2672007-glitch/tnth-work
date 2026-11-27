import type { NextRequest } from "next/server";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { deleteGraphicAsset } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const res = await deleteGraphicAsset(actor, id);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
