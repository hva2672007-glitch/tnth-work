import { query, queryOne, withTransaction } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { revokeAllSessionsForMember } from "@/server/auth/session";
import { can, requirePermission } from "@/server/authorization/policy";
import { getPortalProvider } from "@/server/auth/portal-adapter";
import { writeAudit } from "@/server/audit/service";
import { createNotification } from "@/server/notifications/service";
import { AppError } from "@/server/errors";
import type { ActivityStatus, MemberRole, TeamTitle } from "@/lib/constants";

export interface MemberDirectoryItem {
  id: string;
  memberCode: string;
  externalAccountId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  accessEnabled: boolean;
  activityStatus: ActivityStatus;
  avatarFileId: string | null;
  primaryTeam: { id: string; code: string; name: string; title: TeamTitle } | null;
  teams: { id: string; code: string; name: string; isPrimary: boolean; title: TeamTitle }[];
  canViewDetail: boolean;
  canEdit: boolean;
  canRevoke: boolean;
}

export async function listMembersDirectory(
  actor: AuthActor,
  filters?: { search?: string; teamId?: string; role?: string; activityStatus?: string; includeRevoked?: boolean },
): Promise<MemberDirectoryItem[]> {
  requirePermission(actor, "member.directory.view");

  const where: string[] = ["m.archived_at IS NULL"];
  const params: unknown[] = [];
  if (!filters?.includeRevoked) {
    where.push("m.access_enabled = true");
  }
  if (filters?.role) {
    params.push(filters.role);
    where.push(`m.role = $${params.length}`);
  }
  if (filters?.activityStatus) {
    params.push(filters.activityStatus);
    where.push(`m.activity_status = $${params.length}`);
  }
  if (filters?.search?.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    where.push(`(lower(m.display_name) LIKE $${params.length} OR lower(m.username) LIKE $${params.length} OR lower(m.member_code) LIKE $${params.length})`);
  }
  if (filters?.teamId) {
    params.push(filters.teamId);
    where.push(`EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.member_id = m.id AND tm.team_id = $${params.length} AND tm.effective_to IS NULL)`);
  }

  const members = await query<{
    id: string;
    member_code: string;
    external_account_id: string;
    username: string;
    display_name: string;
    role: MemberRole;
    access_enabled: boolean;
    activity_status: ActivityStatus;
    avatar_file_id: string | null;
  }>(
    `SELECT m.id, m.member_code, m.external_account_id, m.username, m.display_name, m.role,
            m.access_enabled, m.activity_status, mp.avatar_file_id
     FROM members m
     LEFT JOIN member_profiles mp ON mp.member_id = m.id
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE m.role
         WHEN 'HEAD' THEN 1
         WHEN 'ACTING_HEAD' THEN 2
         WHEN 'DEPUTY' THEN 3
         WHEN 'TEAM_LEAD' THEN 4
         ELSE 5
       END,
       m.display_name ASC`,
    params,
  );

  const memberships = await query<{
    member_id: string;
    team_id: string;
    team_code: string;
    team_name: string;
    is_primary: boolean;
    team_title: TeamTitle;
  }>(
    `SELECT tm.member_id, tm.team_id, t.code AS team_code, t.name AS team_name, tm.is_primary, tm.team_title
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.effective_to IS NULL
     ORDER BY tm.is_primary DESC, t.sort_order ASC`,
  );

  const byMember = new Map<string, typeof memberships>();
  for (const row of memberships) {
    const list = byMember.get(row.member_id) ?? [];
    list.push(row);
    byMember.set(row.member_id, list);
  }

  return members.map((m) => {
    const mTeams = (byMember.get(m.id) ?? []).map((t) => ({
      id: t.team_id,
      code: t.team_code,
      name: t.team_name,
      isPrimary: t.is_primary,
      title: t.team_title,
    }));
    const teamIds = mTeams.map((t) => t.id);
    const primary = mTeams.find((t) => t.isPrimary) ?? null;

    const resource = { targetMemberId: m.id, targetRole: m.role, targetTeamIds: teamIds };
    return {
      id: m.id,
      memberCode: m.member_code,
      externalAccountId: m.external_account_id,
      username: m.username,
      displayName: m.display_name,
      role: m.role,
      accessEnabled: m.access_enabled,
      activityStatus: m.activity_status,
      avatarFileId: m.avatar_file_id,
      primaryTeam: primary ? { id: primary.id, code: primary.code, name: primary.name, title: primary.title } : null,
      teams: mTeams,
      canViewDetail: can(actor, "member.profile.view", resource),
      canEdit: can(actor, "member.profile.edit", resource),
      canRevoke: can(actor, "member.access.revoke", resource),
    };
  });
}

export async function getMemberDetail(actor: AuthActor, targetMemberId: string) {
  const member = await queryOne<{
    id: string;
    member_code: string;
    provider: string;
    external_account_id: string;
    username: string;
    display_name: string;
    role: MemberRole;
    access_enabled: boolean;
    activity_status: ActivityStatus;
    identity_checked_at: Date;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, member_code, provider, external_account_id, username, display_name,
            role, access_enabled, activity_status, identity_checked_at, created_at, updated_at
     FROM members WHERE id = $1 AND archived_at IS NULL`,
    [targetMemberId],
  );
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");
  }

  const memberships = await query<{
    id: string;
    team_id: string;
    team_code: string;
    team_name: string;
    is_primary: boolean;
    team_title: TeamTitle;
    effective_from: Date;
  }>(
    `SELECT tm.id, tm.team_id, t.code AS team_code, t.name AS team_name, tm.is_primary, tm.team_title, tm.effective_from
     FROM team_memberships tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.member_id = $1 AND tm.effective_to IS NULL
     ORDER BY tm.is_primary DESC, t.sort_order ASC`,
    [targetMemberId],
  );

  const teamIds = memberships.map((m) => m.team_id);
  const resource = { targetMemberId: member.id, targetRole: member.role, targetTeamIds: teamIds };
  requirePermission(actor, "member.profile.view", resource, "Bạn không có quyền xem hồ sơ chi tiết thành viên này.");

  const profile = await queryOne<{
    full_name: string;
    avatar_file_id: string | null;
    dob: string | null;
    birthplace: string;
    hometown: string;
    email: string;
    phone: string;
    social_links: unknown;
    current_org: string;
    education: unknown;
    academic_achievements: string;
    youth_achievements: string;
    joined_on: string | null;
    profile_complete_at: Date | null;
    updated_at: Date;
  }>(`SELECT * FROM member_profiles WHERE member_id = $1`, [targetMemberId]);

  const roleHistory = await query<{
    id: string;
    old_role: string | null;
    new_role: string;
    reason: string;
    created_at: Date;
    changed_by_name: string | null;
  }>(
    `SELECT h.id, h.old_role, h.new_role, h.reason, h.created_at, m.display_name AS changed_by_name
     FROM member_role_history h
     LEFT JOIN members m ON m.id = h.changed_by
     WHERE h.member_id = $1
     ORDER BY h.created_at DESC
     LIMIT 20`,
    [targetMemberId],
  );

  const openAssignments = await query<{
    id: string;
    task_id: string;
    task_title: string;
    mission_id: string;
    mission_code: string;
    status: string;
    evaluation_deadline: Date;
  }>(
    `SELECT ta.id, ta.task_id, t.title AS task_title, t.mission_id, m.code AS mission_code, ta.status, ta.evaluation_deadline
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     JOIN missions m ON m.id = t.mission_id
     WHERE ta.member_id = $1 AND ta.status IN ('PENDING', 'ACCEPTED', 'SUBMITTED', 'REVISION_REQUIRED')
     ORDER BY ta.evaluation_deadline ASC`,
    [targetMemberId],
  );

  return {
    id: member.id,
    memberCode: member.member_code,
    provider: member.provider,
    externalAccountId: member.external_account_id,
    username: member.username,
    displayName: member.display_name,
    role: member.role,
    accessEnabled: member.access_enabled,
    activityStatus: member.activity_status,
    identityCheckedAt: new Date(member.identity_checked_at).toISOString(),
    createdAt: new Date(member.created_at).toISOString(),
    teams: memberships.map((tm) => ({
      id: tm.team_id,
      code: tm.team_code,
      name: tm.team_name,
      isPrimary: tm.is_primary,
      title: tm.team_title,
      effectiveFrom: new Date(tm.effective_from).toISOString(),
    })),
    profile: profile
      ? {
          fullName: profile.full_name,
          avatarFileId: profile.avatar_file_id,
          dob: profile.dob ? String(profile.dob).slice(0, 10) : "",
          birthplace: profile.birthplace,
          hometown: profile.hometown,
          email: profile.email,
          phone: profile.phone,
          socialLinks: Array.isArray(profile.social_links) ? profile.social_links : [],
          currentOrg: profile.current_org,
          education: Array.isArray(profile.education) ? profile.education : [],
          academicAchievements: profile.academic_achievements,
          youthAchievements: profile.youth_achievements,
          joinedOn: profile.joined_on ? String(profile.joined_on).slice(0, 10) : "",
          profileCompleteAt: profile.profile_complete_at ? new Date(profile.profile_complete_at).toISOString() : null,
          updatedAt: new Date(profile.updated_at).toISOString(),
        }
      : null,
    roleHistory: roleHistory.map((h) => ({
      id: h.id,
      oldRole: h.old_role,
      newRole: h.new_role,
      reason: h.reason,
      changedByName: h.changed_by_name,
      createdAt: new Date(h.created_at).toISOString(),
    })),
    openAssignments: openAssignments.map((a) => ({
      id: a.id,
      taskId: a.task_id,
      taskTitle: a.task_title,
      missionId: a.mission_id,
      missionCode: a.mission_code,
      status: a.status,
      deadline: new Date(a.evaluation_deadline).toISOString(),
    })),
    permissions: {
      canEdit: can(actor, "member.profile.edit", resource),
      canRevoke: can(actor, "member.access.revoke", resource),
      canChangeStatus: actor.memberId !== member.id && can(actor, "member.profile.edit", resource),
    },
  };
}

/** Cấp quyền truy cập cho một tài khoản cổng thông tin nguồn (Bậc 01.01 cấp từ 01.02 trở xuống) */
export async function grantMemberAccess(
  actor: AuthActor,
  input: {
    externalAccountId: string;
    role: MemberRole;
    primaryTeamId: string;
    primaryTeamTitle?: TeamTitle;
    secondaryTeamIds?: string[];
  },
  requestId?: string,
) {
  requirePermission(
    actor,
    "member.access.grant",
    { grantRole: input.role },
    "Chỉ Trưởng Ban Biên tập (01.01) được cấp quyền truy cập từ Bậc 01.02 trở xuống.",
  );

  const portal = getPortalProvider();
  const identity = await portal.getAccountStatus(input.externalAccountId);
  if (identity.status !== "ACTIVE") {
    throw new AppError(
      400,
      "PORTAL_ACCOUNT_NOT_ACTIVE",
      `Tài khoản cổng thông tin đang ở trạng thái ${identity.status}, chỉ có thể cấp quyền cho tài khoản ACTIVE.`,
    );
  }

  return withTransaction(async (tx) => {
    const teamCheck = await tx.query<{ id: string }>(
      "SELECT id FROM teams WHERE id = $1 AND active = true",
      [input.primaryTeamId],
    );
    if (!teamCheck.rows[0]) {
      throw new AppError(400, "INVALID_TEAM", "Tổ chuyên môn chính không tồn tại hoặc đã ngừng hoạt động.");
    }

    const existing = await tx.query<{ id: string; role: MemberRole }>(
      "SELECT id, role FROM members WHERE provider = $1 AND external_account_id = $2",
      [identity.provider, identity.externalAccountId],
    );

    let memberId: string;
    const teamTitle: TeamTitle =
      input.role === "TEAM_LEAD" ? input.primaryTeamTitle ?? "LEADER" : "MEMBER";

    if (existing.rows[0]) {
      memberId = existing.rows[0].id;
      const oldRole = existing.rows[0].role;
      await tx.query(
        `UPDATE members
         SET role = $1, access_enabled = true, activity_status = 'ACTIVE',
             username = $2, display_name = $3, identity_checked_at = now(),
             role_version = role_version + 1, archived_at = NULL, updated_at = now()
         WHERE id = $4`,
        [input.role, identity.username, identity.displayName, memberId],
      );
      await tx.query(
        `INSERT INTO member_role_history (member_id, old_role, new_role, reason, changed_by)
         VALUES ($1, $2, $3, 'Cấp lại quyền truy cập nội bộ', $4)`,
        [memberId, oldRole, input.role, actor.memberId],
      );
      await tx.query(
        `UPDATE team_memberships SET effective_to = now() WHERE member_id = $1 AND effective_to IS NULL`,
        [memberId],
      );
    } else {
      const countRes = await tx.query<{ c: string }>("SELECT count(*)::text AS c FROM members");
      const seq = Number(countRes.rows[0]?.c ?? 0) + 1;
      const memberCode = `BBT-${String(seq).padStart(3, "0")}`;
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO members (member_code, provider, external_account_id, username, display_name, role, access_enabled, activity_status, identity_checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'ACTIVE', now())
         RETURNING id`,
        [memberCode, identity.provider, identity.externalAccountId, identity.username, identity.displayName, input.role],
      );
      memberId = inserted.rows[0].id;

      await tx.query(
        `INSERT INTO member_profiles (member_id, full_name, email, joined_on)
         VALUES ($1, $2, $3, CURRENT_DATE)`,
        [memberId, identity.displayName, identity.email ?? ""],
      );
      await tx.query(
        `INSERT INTO member_role_history (member_id, old_role, new_role, reason, changed_by)
         VALUES ($1, NULL, $2, 'Cấp quyền truy cập Ban Biên tập lần đầu', $3)`,
        [memberId, input.role, actor.memberId],
      );
    }

    await tx.query(
      `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title, created_by)
       VALUES ($1, $2, true, $3, $4)`,
      [memberId, input.primaryTeamId, teamTitle, actor.memberId],
    );

    const secondaryIds = [...new Set((input.secondaryTeamIds ?? []).filter((id) => id !== input.primaryTeamId))];
    for (const secId of secondaryIds) {
      await tx.query(
        `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title, created_by)
         VALUES ($1, $2, false, 'MEMBER', $3)`,
        [memberId, secId, actor.memberId],
      );
    }

    await createNotification(
      {
        recipientId: memberId,
        eventType: "ACCESS_GRANTED",
        targetType: "MEMBER",
        targetId: memberId,
        title: "Bạn đã được cấp quyền vào Web Phân công Ban Biên tập",
        message: "Vui lòng cập nhật đầy đủ hồ sơ cá nhân trong phần Cài đặt > Hồ sơ cá nhân.",
        link: "/settings/profile",
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MEMBER_ACCESS_GRANTED",
        targetType: "MEMBER",
        targetId: memberId,
        safeDiff: { externalAccountId: identity.externalAccountId, role: input.role, primaryTeamId: input.primaryTeamId },
        requestId,
      },
      tx,
    );

    return { memberId, username: identity.username, role: input.role };
  });
}

export async function updateMemberProfile(
  actor: AuthActor,
  targetMemberId: string,
  input: {
    fullName?: string;
    avatarFileId?: string | null;
    dob?: string | null;
    birthplace?: string;
    hometown?: string;
    email?: string;
    phone?: string;
    socialLinks?: { platform: string; handle: string }[];
    currentOrg?: string;
    education?: { period: string; school: string; major?: string }[];
    academicAchievements?: string;
    youthAchievements?: string;
    joinedOn?: string | null;
  },
  requestId?: string,
) {
  const target = await queryOne<{ id: string; role: MemberRole }>(
    "SELECT id, role FROM members WHERE id = $1 AND archived_at IS NULL",
    [targetMemberId],
  );
  if (!target) throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");

  const teamRows = await query<{ team_id: string }>(
    "SELECT team_id FROM team_memberships WHERE member_id = $1 AND effective_to IS NULL",
    [targetMemberId],
  );

  requirePermission(actor, "member.profile.edit", {
    targetMemberId,
    targetRole: target.role,
    targetTeamIds: teamRows.map((t) => t.team_id),
  });

  if (input.dob && input.joinedOn && input.dob >= input.joinedOn) {
    throw new AppError(400, "INVALID_DATES", "Ngày bắt đầu công tác tại Ban phải sau ngày sinh.");
  }

  await withTransaction(async (tx) => {
    const current = await tx.query<Record<string, unknown>>(
      "SELECT * FROM member_profiles WHERE member_id = $1",
      [targetMemberId],
    );
    const cur = current.rows[0] ?? {};

    const fullName = input.fullName?.trim() || String(cur.full_name ?? "");
    const dob = input.dob !== undefined ? (input.dob || null) : (cur.dob ? String(cur.dob).slice(0, 10) : null);
    const birthplace = input.birthplace !== undefined ? input.birthplace.trim() : String(cur.birthplace ?? "");
    const hometown = input.hometown !== undefined ? input.hometown.trim() : String(cur.hometown ?? "");
    const email = input.email !== undefined ? input.email.trim() : String(cur.email ?? "");
    const phone = input.phone !== undefined ? input.phone.trim() : String(cur.phone ?? "");
    const socialLinks = input.socialLinks !== undefined ? input.socialLinks : (cur.social_links ?? []);
    const currentOrg = input.currentOrg !== undefined ? input.currentOrg.trim() : String(cur.current_org ?? "");
    const education = input.education !== undefined ? input.education : (cur.education ?? []);
    const academicAchievements =
      input.academicAchievements !== undefined
        ? (input.academicAchievements.trim() || "Chưa có")
        : String(cur.academic_achievements ?? "Chưa có");
    const youthAchievements =
      input.youthAchievements !== undefined
        ? (input.youthAchievements.trim() || "Chưa có")
        : String(cur.youth_achievements ?? "Chưa có");
    const joinedOn =
      input.joinedOn !== undefined
        ? (input.joinedOn || null)
        : (cur.joined_on ? String(cur.joined_on).slice(0, 10) : null);
    const avatarFileId = input.avatarFileId !== undefined ? input.avatarFileId : (cur.avatar_file_id as string | null ?? null);

    const isComplete = Boolean(fullName && dob && birthplace && hometown && (email || phone) && currentOrg && joinedOn);

    await tx.query(
      `INSERT INTO member_profiles (
         member_id, full_name, avatar_file_id, dob, birthplace, hometown, email, phone,
         social_links, current_org, education, academic_achievements, youth_achievements,
         joined_on, profile_complete_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15, now())
       ON CONFLICT (member_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         avatar_file_id = EXCLUDED.avatar_file_id,
         dob = EXCLUDED.dob,
         birthplace = EXCLUDED.birthplace,
         hometown = EXCLUDED.hometown,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         social_links = EXCLUDED.social_links,
         current_org = EXCLUDED.current_org,
         education = EXCLUDED.education,
         academic_achievements = EXCLUDED.academic_achievements,
         youth_achievements = EXCLUDED.youth_achievements,
         joined_on = EXCLUDED.joined_on,
         profile_complete_at = COALESCE(member_profiles.profile_complete_at, EXCLUDED.profile_complete_at),
         updated_at = now()`,
      [
        targetMemberId,
        fullName,
        avatarFileId,
        dob,
        birthplace,
        hometown,
        email,
        phone,
        JSON.stringify(socialLinks),
        currentOrg,
        JSON.stringify(education),
        academicAchievements,
        youthAchievements,
        joinedOn,
        isComplete ? new Date().toISOString() : null,
      ],
    );

    if (fullName) {
      await tx.query(`UPDATE members SET display_name = $1, updated_at = now() WHERE id = $2`, [fullName, targetMemberId]);
    }

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MEMBER_PROFILE_UPDATED",
        targetType: "MEMBER",
        targetId: targetMemberId,
        safeDiff: { fieldsUpdated: Object.keys(input) },
        requestId,
      },
      tx,
    );
  });

  return getMemberDetail(actor, targetMemberId);
}

/** Thu hồi quyền truy cập / xóa tên thành viên khỏi danh sách hoạt động (không xóa lịch sử!) */
export async function revokeMemberAccess(
  actor: AuthActor,
  targetMemberId: string,
  reason: string,
  requestId?: string,
) {
  const target = await queryOne<{ id: string; role: MemberRole; display_name: string }>(
    "SELECT id, role, display_name FROM members WHERE id = $1 AND archived_at IS NULL",
    [targetMemberId],
  );
  if (!target) throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");

  const teamRows = await query<{ team_id: string }>(
    "SELECT team_id FROM team_memberships WHERE member_id = $1 AND effective_to IS NULL",
    [targetMemberId],
  );

  requirePermission(
    actor,
    "member.access.revoke",
    {
      targetMemberId,
      targetRole: target.role,
      targetTeamIds: teamRows.map((t) => t.team_id),
    },
    "Bạn không có quyền thu hồi quyền truy cập của thành viên cấp bậc này.",
  );

  const openAssignments = await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE members
       SET access_enabled = false, activity_status = 'INACTIVE', role_version = role_version + 1, updated_at = now()
       WHERE id = $1`,
      [targetMemberId],
    );
    await tx.query(
      `UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL`,
      [targetMemberId],
    );
    const open = await tx.query<{ id: string; task_id: string; status: string }>(
      `SELECT id, task_id, status FROM task_assignments
       WHERE member_id = $1 AND status IN ('PENDING', 'ACCEPTED', 'REVISION_REQUIRED')`,
      [targetMemberId],
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MEMBER_ACCESS_REVOKED",
        targetType: "MEMBER",
        targetId: targetMemberId,
        safeDiff: { targetRole: target.role, reason, openAssignmentCount: open.rows.length },
        requestId,
      },
      tx,
    );
    return open.rows;
  });

  return {
    revoked: true,
    memberId: targetMemberId,
    openAssignmentsRequiringTransfer: openAssignments,
  };
}

/** Đổi tình trạng hoạt động (ACTIVE / ON_LEAVE / INACTIVE). Bậc 04 không tự đổi được. */
export async function updateMemberActivityStatus(
  actor: AuthActor,
  targetMemberId: string,
  activityStatus: ActivityStatus,
  reason: string,
  requestId?: string,
) {
  if (actor.memberId === targetMemberId && actor.role === "MEMBER") {
    throw new AppError(403, "FORBIDDEN", "Thành viên Bậc 04 không được tự sửa tình trạng hoạt động.");
  }

  const target = await queryOne<{ id: string; role: MemberRole; activity_status: ActivityStatus }>(
    "SELECT id, role, activity_status FROM members WHERE id = $1 AND archived_at IS NULL",
    [targetMemberId],
  );
  if (!target) throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên.");

  const teamRows = await query<{ team_id: string }>(
    "SELECT team_id FROM team_memberships WHERE member_id = $1 AND effective_to IS NULL",
    [targetMemberId],
  );
  requirePermission(actor, "member.profile.edit", {
    targetMemberId,
    targetRole: target.role,
    targetTeamIds: teamRows.map((t) => t.team_id),
  });
  if (actor.memberId === targetMemberId && actor.role !== "HEAD") {
    throw new AppError(403, "FORBIDDEN", "Không được tự thay đổi tình trạng hoạt động của chính mình.");
  }

  await withTransaction(async (tx) => {
    const accessEnabled = activityStatus === "INACTIVE" ? false : true;
    await tx.query(
      `UPDATE members SET activity_status = $1, access_enabled = $2, updated_at = now() WHERE id = $3`,
      [activityStatus, accessEnabled, targetMemberId],
    );
    if (!accessEnabled) {
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL`, [targetMemberId]);
    }
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MEMBER_ACTIVITY_UPDATED",
        targetType: "MEMBER",
        targetId: targetMemberId,
        safeDiff: { oldStatus: target.activity_status, newStatus: activityStatus, reason },
        requestId,
      },
      tx,
    );
  });

  if (activityStatus === "INACTIVE") {
    await revokeAllSessionsForMember(targetMemberId);
  }

  return getMemberDetail(actor, targetMemberId);
}

/** Cập nhật phân tổ (1 tổ chính + nhiều tổ phụ) trong transaction */
export async function updateMemberTeams(
  actor: AuthActor,
  targetMemberId: string,
  memberships: { teamId: string; isPrimary: boolean; teamTitle: TeamTitle }[],
  requestId?: string,
) {
  requirePermission(actor, "team.manage", {}, "Chỉ Trưởng Ban (01.01) hoặc Phó Ban (02) mới được điều chỉnh tổ chuyên môn.");

  const primaries = memberships.filter((m) => m.isPrimary);
  if (primaries.length !== 1) {
    throw new AppError(400, "INVALID_PRIMARY_TEAM", "Mỗi thành viên phải có đúng 01 tổ chính.");
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE team_memberships SET effective_to = now() WHERE member_id = $1 AND effective_to IS NULL`,
      [targetMemberId],
    );
    for (const item of memberships) {
      await tx.query(
        `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetMemberId, item.teamId, item.isPrimary, item.teamTitle, actor.memberId],
      );
    }
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "MEMBER_TEAMS_UPDATED",
        targetType: "MEMBER",
        targetId: targetMemberId,
        safeDiff: { memberships },
        requestId,
      },
      tx,
    );
  });

  return getMemberDetail(actor, targetMemberId);
}
