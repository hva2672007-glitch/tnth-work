import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/server/auth/password";
import {
  assertSameOrigin,
  buildSessionCookieOptions,
  createSessionForMember,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session";
import { query, queryOne } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson } from "@/server/errors";

export const runtime = "nodejs";

const LocalLoginSchema = z.object({
  username: z.string().trim().min(2, "Vui lòng nhập tên đăng nhập."),
  password: z.string().min(1, "Vui lòng nhập mật khẩu."),
});

/**
 * Đăng nhập cho tài khoản nội bộ trực tiếp (provider = 'local')
 * dành cho cộng tác viên / thành viên Ban Biên tập không còn thuộc Đoàn trực thuộc trên cổng thông tin.
 */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = LocalLoginSchema.parse(await request.json());
    const normalizedUsername = input.username.toLowerCase();

    const row = await queryOne<{
      id: string;
      display_name: string;
      role: string;
      access_enabled: boolean;
      activity_status: string;
      password_hash: string;
      must_change_password: boolean;
    }>(
      `SELECT m.id, m.display_name, m.role, m.access_enabled, m.activity_status,
              lc.password_hash, lc.must_change_password
       FROM members m
       JOIN local_credentials lc ON lc.member_id = m.id
       WHERE m.provider = 'local'
         AND lower(m.username) = $1
         AND m.archived_at IS NULL`,
      [normalizedUsername],
    );

    if (!row || !verifyPassword(input.password, row.password_hash)) {
      await writeAudit({
        actorId: row?.id ?? null,
        action: "AUTH_LOCAL_LOGIN_FAILED",
        targetType: "MEMBER",
        targetId: row?.id ?? normalizedUsername,
      });
      throw new AppError(401, "INVALID_CREDENTIALS", "Tên đăng nhập hoặc mật khẩu không đúng.");
    }

    if (!row.access_enabled || row.activity_status === "INACTIVE") {
      await writeAudit({
        actorId: row.id,
        action: "AUTH_LOCAL_LOGIN_DENIED_REVOKED",
        targetType: "MEMBER",
        targetId: row.id,
      });
      throw new AppError(
        403,
        "ACCESS_REVOKED",
        "Tài khoản nội bộ của bạn hiện đã bị tạm khóa hoặc thu hồi quyền truy cập. Vui lòng liên hệ Trưởng Ban Biên tập.",
      );
    }

    await query(`UPDATE members SET identity_checked_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
    const token = await createSessionForMember(row.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: request.headers.get("x-client-ip"),
    });

    await writeAudit({
      actorId: row.id,
      action: "AUTH_LOCAL_LOGIN_SUCCESS",
      targetType: "SESSION",
      targetId: row.id,
      safeDiff: { username: normalizedUsername },
    });

    const isHttps =
      request.headers.get("x-forwarded-proto")?.includes("https") ||
      new URL(request.url).protocol === "https:";
    const res = NextResponse.json({
      data: {
        ok: true,
        memberId: row.id,
        displayName: row.display_name,
        role: row.role,
        mustChangePassword: row.must_change_password,
      },
    });
    res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(isHttps));
    return res;
  } catch (err) {
    return errorJson(err);
  }
}
