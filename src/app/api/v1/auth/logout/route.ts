import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertSameOrigin, getRequestActor, revokeSessionByToken, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { writeAudit } from "@/server/audit/service";
import { errorJson } from "@/server/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const actor = await getRequestActor(request).catch(() => null);
    if (token) {
      await revokeSessionByToken(token);
    }
    if (actor) {
      await writeAudit({
        actorId: actor.memberId,
        action: "AUTH_LOGOUT",
        targetType: "SESSION",
        targetId: actor.memberId,
      });
    }
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  } catch (err) {
    return errorJson(err);
  }
}
