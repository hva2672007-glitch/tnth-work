import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getConfig } from "@/server/config";
import { query, queryOne } from "@/server/db";
import { AppError } from "@/server/errors";
import { getPortalProvider } from "@/server/auth/portal-adapter";
import type { ActivityStatus, MemberRole, TeamTitle } from "@/lib/constants";

export const SESSION_COOKIE_NAME = "tnth_work_session";

export interface TeamMembershipInfo {
  teamId: string;
  teamCode: string;
  teamName: string;
  isPrimary: boolean;
  teamTitle: TeamTitle;
}

export interface AuthActor {
  memberId: string;
  memberCode: string;
  externalAccountId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  accessEnabled: boolean;
  activityStatus: ActivityStatus;
  identityCheckedAt: string;
  roleVersion: number;
  memberships: TeamMembershipInfo[];
  leadTeamIds: string[];
  teamIds: string[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildSessionCookieOptions(isHttps: boolean) {
  const cfg = getConfig();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cfg.appEnv === "production" ? true : isHttps,
    maxAge: cfg.sessionTtlSeconds,
    path: "/",
    // Không đặt domain=.thanhnientruonghoc.io.vn — giữ host-only cookie theo mục 4.2
  };
}

export async function createSessionForMember(
  memberId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null },
): Promise<string> {
  const cfg = getConfig();
  const rawToken = randomBytes(32).toString("hex");
  const digest = hashToken(rawToken);
  await query(
    `INSERT INTO sessions (token_hash, member_id, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
    [digest, memberId, meta?.userAgent ?? null, meta?.ipAddress ?? null, String(cfg.sessionTtlSeconds)],
  );
  return rawToken;
}

export async function revokeSessionByToken(rawToken: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(rawToken)],
  );
}

export async function revokeAllSessionsForMember(memberId: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL`,
    [memberId],
  );
}

export async function loadActorByMemberId(memberId: string): Promise<AuthActor | null> {
  const row = await queryOne<{
    id: string;
    member_code: string;
    external_account_id: string;
    username: string;
    display_name: string;
    role: MemberRole;
    access_enabled: boolean;
    activity_status: ActivityStatus;
    identity_checked_at: Date;
    role_version: number;
    archived_at: Date | null;
  }>(
    `SELECT id, member_code, external_account_id, username, display_name, role,
            access_enabled, activity_status, identity_checked_at, role_version, archived_at
     FROM members
     WHERE id = $1`,
    [memberId],
  );
  if (!row || row.archived_at) return null;

  const memberships = await query<{
    team_id: string;
    team_code: string;
    team_name: string;
    is_primary: boolean;
    team_title: TeamTitle;
  }>(
    `SELECT tm.team_id, t.code AS team_code, t.name AS team_name, tm.is_primary, tm.team_title
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.member_id = $1 AND tm.effective_to IS NULL
     ORDER BY tm.is_primary DESC, t.sort_order ASC`,
    [memberId],
  );

  const mapped: TeamMembershipInfo[] = memberships.map((m) => ({
    teamId: m.team_id,
    teamCode: m.team_code,
    teamName: m.team_name,
    isPrimary: m.is_primary,
    teamTitle: m.team_title,
  }));

  return {
    memberId: row.id,
    memberCode: row.member_code,
    externalAccountId: row.external_account_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    accessEnabled: row.access_enabled,
    activityStatus: row.activity_status,
    identityCheckedAt: new Date(row.identity_checked_at).toISOString(),
    roleVersion: row.role_version,
    memberships: mapped,
    leadTeamIds: mapped
      .filter((m) => m.teamTitle === "LEADER" || m.teamTitle === "DEPUTY_LEADER")
      .map((m) => m.teamId),
    teamIds: mapped.map((m) => m.teamId),
  };
}

/**
 * Xác thực phiên từ cookie token kèm kiểm tra thu hồi quyền nội bộ & tái kiểm tra trạng thái nguồn (mục 4.4):
 * - Thu hồi quyền nội bộ có hiệu lực ngay ở request tiếp theo.
 * - Trạng thái nguồn được kiểm tra tối đa mỗi 5 phút (IDENTITY_RECHECK_SECONDS); thao tác nhạy cảm bắt buộc recheck ngay.
 * - Nếu nguồn mất kết nối: cho phép xem trong cửa sổ 5 phút từ lần kiểm tra thành công gần nhất; quá 5 phút fail closed.
 */
export async function resolveSessionActor(
  rawToken: string | undefined,
  options?: { forceRecheck?: boolean },
): Promise<AuthActor | null> {
  if (!rawToken) return null;
  const sessionRow = await queryOne<{ id: string; member_id: string }>(
    `SELECT id, member_id FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashToken(rawToken)],
  );
  if (!sessionRow) return null;

  const actor = await loadActorByMemberId(sessionRow.member_id);
  if (!actor || !actor.accessEnabled || actor.activityStatus === "INACTIVE") {
    return null;
  }

  const cfg = getConfig();
  const lastCheckedMs = new Date(actor.identityCheckedAt).getTime();
  const ageSeconds = (Date.now() - lastCheckedMs) / 1000;
  const needsRecheck = options?.forceRecheck || ageSeconds >= cfg.identityRecheckSeconds;

  if (needsRecheck) {
    try {
      const portal = getPortalProvider();
      const identity = await portal.getAccountStatus(actor.externalAccountId);
      if (identity.status !== "ACTIVE") {
        // Không kế thừa logic tự mở khóa từ nguồn: LOCKED/DISABLED/PENDING/UNKNOWN đều bị từ chối!
        await revokeAllSessionsForMember(actor.memberId);
        return null;
      }
      await query(
        `UPDATE members SET identity_checked_at = now(), updated_at = now() WHERE id = $1`,
        [actor.memberId],
      );
      actor.identityCheckedAt = new Date().toISOString();
    } catch {
      // Nguồn mất kết nối: thao tác nhạy cảm hoặc đã quá 5 phút thì fail closed
      if (options?.forceRecheck || ageSeconds >= cfg.identityRecheckSeconds) {
        throw new AppError(
          503,
          "PORTAL_RECHECK_FAILED",
          "Không thể xác minh trạng thái tài khoản với cổng thông tin nguồn. Vui lòng thử lại sau.",
        );
      }
    }
  }

  await query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionRow.id]).catch(() => {});
  return actor;
}

export async function getRequestActor(
  request: NextRequest,
  options?: { forceRecheck?: boolean },
): Promise<AuthActor | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return resolveSessionActor(token, options);
}

export async function requireRequestActor(
  request: NextRequest,
  options?: { forceRecheck?: boolean },
): Promise<AuthActor> {
  const actor = await getRequestActor(request, options);
  if (!actor) {
    throw new AppError(401, "UNAUTHORIZED", "Phiên đăng nhập không hợp lệ hoặc bạn chưa được cấp quyền truy cập.");
  }
  return actor;
}

export async function getServerActor(): Promise<AuthActor | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  try {
    return await resolveSessionActor(token);
  } catch {
    return null;
  }
}

/** Kiểm tra Origin/Referer chống CSRF cho các request mutation dùng cookie (mục 14.1) */
export function assertSameOrigin(request: NextRequest): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  if (!origin) return; // Server-to-server / curl / same-site fetch không gửi Origin khi cùng origin cũ
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!host) return;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host) {
      throw new AppError(403, "CSRF_ORIGIN_MISMATCH", "Nguồn gửi yêu cầu không hợp lệ.");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(403, "CSRF_ORIGIN_INVALID", "Header Origin không hợp lệ.");
  }
}
