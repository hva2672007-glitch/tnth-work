import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/server/config";
import { getPortalProvider, listMockPortalAccounts } from "@/server/auth/portal-adapter";
import {
  assertSameOrigin,
  buildSessionCookieOptions,
  createSessionForMember,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const MockLoginSchema = z.object({
  externalAccountId: z.string().min(1),
});

/** GET: Liệt kê tài khoản mock (CHỈ bật khi PORTAL_AUTH_MODE=mock ở dev/test) */
export async function GET() {
  try {
    const cfg = getConfig();
    if (cfg.portalAuthMode !== "mock" || cfg.appEnv === "production") {
      throw new AppError(404, "NOT_FOUND", "Endpoint không khả dụng.");
    }
    const grantedRows = await query<{ external_account_id: string; role: string; access_enabled: boolean; activity_status: string }>(
      `SELECT external_account_id, role, access_enabled, activity_status FROM members WHERE archived_at IS NULL`,
    );
    const grantedMap = new Map(grantedRows.map((r) => [r.external_account_id, r]));
    const accounts = listMockPortalAccounts().map((a) => {
      const m = grantedMap.get(a.externalAccountId);
      return {
        ...a,
        hasWorkAccess: Boolean(m && m.access_enabled && m.activity_status !== "INACTIVE"),
        workRole: m?.role ?? null,
      };
    });
    return okJson({ accounts });
  } catch (err) {
    return errorJson(err);
  }
}

/** POST: Đăng nhập qua Mock Portal Adapter ở dev/test (kiểm tra trạng thái nguồn + whitelist nội bộ như thật) */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const cfg = getConfig();
    if (cfg.portalAuthMode !== "mock" || cfg.appEnv === "production") {
      throw new AppError(404, "NOT_FOUND", "Endpoint không khả dụng.");
    }

    const body = MockLoginSchema.parse(await request.json());
    const portal = getPortalProvider();
    const identity = await portal.exchangeCode(`mock:${body.externalAccountId}`);

    if (identity.status !== "ACTIVE") {
      await writeAudit({
        actorId: null,
        action: "AUTH_LOGIN_DENIED_PORTAL_STATUS",
        targetType: "PORTAL_ACCOUNT",
        targetId: identity.externalAccountId,
        safeDiff: { status: identity.status },
      });
      throw new AppError(
        403,
        "PORTAL_ACCOUNT_NOT_ACTIVE",
        `Tài khoản trên cổng thông tin đang ở trạng thái ${identity.status}, không thể đăng nhập.`,
      );
    }

    const member = await queryOne<{
      id: string;
      display_name: string;
      role: string;
      access_enabled: boolean;
      activity_status: string;
    }>(
      `SELECT id, display_name, role, access_enabled, activity_status
       FROM members
       WHERE provider = $1 AND external_account_id = $2 AND archived_at IS NULL`,
      [identity.provider, identity.externalAccountId],
    );

    if (!member || !member.access_enabled || member.activity_status === "INACTIVE") {
      await writeAudit({
        actorId: member?.id ?? null,
        action: "AUTH_LOGIN_DENIED_NO_ACCESS",
        targetType: "PORTAL_ACCOUNT",
        targetId: identity.externalAccountId,
      });
      throw new AppError(
        403,
        "ACCESS_NOT_GRANTED",
        "Bạn chưa được cấp quyền truy cập Web Phân công Ban Biên tập. Vui lòng liên hệ Trưởng Ban Biên tập.",
      );
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
      safeDiff: { mode: "mock", externalAccountId: identity.externalAccountId },
    });

    const isHttps =
      request.headers.get("x-forwarded-proto")?.includes("https") ||
      new URL(request.url).protocol === "https:";
    const res = NextResponse.json({ data: { ok: true, memberId: member.id, displayName: member.display_name, role: member.role } });
    res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(isHttps));
    return res;
  } catch (err) {
    return errorJson(err);
  }
}
