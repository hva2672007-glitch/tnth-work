import type { NextRequest } from "next/server";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { query } from "@/server/db";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    await query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND recipient_id = $2`,
      [id, actor.memberId],
    );
    return okJson({ id, read: true });
  } catch (err) {
    return errorJson(err);
  }
}
