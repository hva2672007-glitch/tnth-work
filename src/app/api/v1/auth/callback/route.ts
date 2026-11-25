import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getConfig } from "@/server/config";
import { getPortalProvider } from "@/server/auth/portal-adapter";
import { buildSessionCookieOptions, createSessionForMember, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson } from "@/server/errors";

export const runtime = "nodejs";

/** GET /api/v1/auth/callback?code=...&state=... — đổi authorization code 1 lần qua kênh server-to-server */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code")?.trim();
    const verifier = request.cookies.get("tnth_work_pkce")?.value;
    if (!code) {
      throw new AppError(400, "MISSING_CODE", "Thiếu mã xác thực từ cổng thông tin.");
    }

    const portal = getPortalProvider();
    const identity = await portal.exchangeCode(code, verifier);
    if (identity.status !== "ACTIVE") {
      throw new AppError(403, "PORTAL_ACCOUNT_NOT_ACTIVE", "Tài khoản nguồn không ở trạng thái hoạt động.");
    }

    const member = await queryOne<{ id: string; access_enabled: boolean; activity_status: string }>(
      `SELECT id, access_enabled, activity_status FROM members
       WHERE provider = $1 AND external_account_id = $2 AND archived_at IS NULL`,
      [identity.provider, identity.externalAccountId],
    );

    const cfg = getConfig();
    if (!member || !member.access_enabled || member.activity_status === "INACTIVE") {
      return NextResponse.redirect(new URL("/login?error=access_not_granted", cfg.appUrl));
    }

    await query(`UPDATE members SET identity_checked_at = now(), updated_at = now() WHERE id = $1`, [member.id]);
    const token = await createSessionForMember(member.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-client-ip"),
    });

    await writeAudit({
      actorId: member.id,
      action: "AUTH_LOGIN_SUCCESS",
      targetType: "SESSION",
      targetId: member.id,
      safeDiff: { mode: portal.mode },
    });

    const isHttps = cfg.appUrl.startsWith("https://");
    const res = NextResponse.redirect(new URL("/", cfg.appUrl));
    res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(isHttps));
    res.cookies.delete("tnth_work_pkce");
    return res;
  } catch (err) {
    return errorJson(err);
  }
}
