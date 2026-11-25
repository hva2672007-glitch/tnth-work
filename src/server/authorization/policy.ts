import type { AuthActor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import type { MemberRole } from "@/lib/constants";

export type PolicyAction =
  | "member.directory.view"
  | "member.profile.view"
  | "member.profile.edit"
  | "member.access.grant"
  | "member.access.revoke"
  | "member.role.promote_head"
  | "team.manage"
  | "group.manage"
  | "channel.manage"
  | "mission.create"
  | "mission.view"
  | "mission.manage"
  | "mission.complete"
  | "mission.publications_only_mode"
  | "task.review"
  | "kpi.view_member"
  | "kpi.finalize"
  | "report.export"
  | "regulation.propose"
  | "portal.accounts.search"
  | "portal.permissions.request"
  | "audit.view"
  | "settings.manage";

export interface PolicyResource {
  targetMemberId?: string;
  targetRole?: MemberRole;
  targetTeamIds?: string[];
  ownerTeamId?: string;
  missionTeamIds?: string[];
  missionCreatorId?: string;
  missionOwnerId?: string;
  missionParticipantIds?: string[];
  taskSubmitterId?: string;
  taskReviewerId?: string | null;
  grantRole?: MemberRole;
}

const BOARD_ROLES: MemberRole[] = ["HEAD", "ACTING_HEAD", "DEPUTY"];

export function isBoardLeadership(role: MemberRole): boolean {
  return BOARD_ROLES.includes(role);
}

export function isManagerRole(role: MemberRole): boolean {
  return role === "HEAD" || role === "ACTING_HEAD" || role === "DEPUTY" || role === "TEAM_LEAD";
}

function sharesLeadTeam(actor: AuthActor, teamIds?: string[]): boolean {
  if (!teamIds || teamIds.length === 0) return false;
  return teamIds.some((id) => actor.leadTeamIds.includes(id));
}

/**
 * Hàm policy tập trung theo Ma trận quyền mục 5.2 & 5.3 của WEB_PHAN_CONG_SPEC.md.
 * Mặc định từ chối (deny-by-default) khi không khớp điều kiện.
 */
export function can(actor: AuthActor, action: PolicyAction, resource: PolicyResource = {}): boolean {
  if (!actor.accessEnabled || actor.activityStatus === "INACTIVE") return false;

  switch (action) {
    case "member.directory.view":
      return true;

    case "member.profile.view": {
      if (resource.targetMemberId && resource.targetMemberId === actor.memberId) return true;
      if (isBoardLeadership(actor.role)) return true;
      if (actor.role === "TEAM_LEAD") {
        // Bậc 03 chỉ xem hồ sơ chi tiết thành viên trong tổ mình lãnh đạo (không xem hồ sơ cấp trên 01/02)
        if (resource.targetRole && isBoardLeadership(resource.targetRole)) return false;
        return sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "member.profile.edit": {
      if (resource.targetMemberId && resource.targetMemberId === actor.memberId) return true;
      // 01.02 chỉ read-only danh sách & hồ sơ người khác
      if (actor.role === "ACTING_HEAD") return false;
      if (actor.role === "HEAD") {
        return resource.targetRole !== "HEAD";
      }
      if (actor.role === "DEPUTY") {
        return resource.targetRole === "TEAM_LEAD" || resource.targetRole === "MEMBER";
      }
      if (actor.role === "TEAM_LEAD") {
        return resource.targetRole === "MEMBER" && sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "member.access.grant": {
      if (actor.role === "HEAD") {
        // Bậc 01.01 cấp quyền từ Bậc 01.02 trở xuống
        return !resource.grantRole || resource.grantRole !== "HEAD";
      }
      return false;
    }

    case "member.access.revoke": {
      if (resource.targetMemberId === actor.memberId) return false;
      if (actor.role === "HEAD") {
        // Bậc 01.01 xóa/thu hồi Bậc 02, 03, 04 (không tự thu hồi 01.02 qua nút xóa thường theo mục 5.2)
        return (
          resource.targetRole === "DEPUTY" ||
          resource.targetRole === "TEAM_LEAD" ||
          resource.targetRole === "MEMBER"
        );
      }
      if (actor.role === "DEPUTY") {
        return resource.targetRole === "TEAM_LEAD" || resource.targetRole === "MEMBER";
      }
      if (actor.role === "TEAM_LEAD") {
        return resource.targetRole === "MEMBER" && sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "member.role.promote_head":
      return actor.role === "DEPUTY";

    case "team.manage":
    case "group.manage":
    case "channel.manage":
      // 01.01 và 02 thêm/bỏ khối, quản lý tổ & kênh; 01.02 và 03 không có quyền mặc định
      return actor.role === "HEAD" || actor.role === "DEPUTY";

    case "mission.create":
      return isManagerRole(actor.role);

    case "mission.view": {
      if (isBoardLeadership(actor.role)) return true;
      if (resource.missionCreatorId === actor.memberId || resource.missionOwnerId === actor.memberId) {
        return true;
      }
      if (resource.missionParticipantIds?.includes(actor.memberId)) return true;
      if (actor.role === "TEAM_LEAD" && sharesLeadTeam(actor, resource.missionTeamIds)) return true;
      return false;
    }

    case "mission.manage":
    case "mission.complete": {
      if (actor.role === "HEAD") return true;
      if (actor.role === "ACTING_HEAD" || actor.role === "DEPUTY") return true;
      if (actor.role === "TEAM_LEAD") {
        if (resource.missionCreatorId === actor.memberId || resource.missionOwnerId === actor.memberId) {
          return true;
        }
        return sharesLeadTeam(actor, resource.missionTeamIds);
      }
      return false;
    }

    case "mission.publications_only_mode":
      return isBoardLeadership(actor.role);

    case "task.review": {
      // Quy tắc chống xung đột lợi ích (mục 5.3): người nộp KHÔNG BAO GIỜ được tự nghiệm thu sản phẩm của mình
      if (resource.taskSubmitterId && resource.taskSubmitterId === actor.memberId) {
        return false;
      }
      if (actor.role === "MEMBER") return false;
      // Nếu là lãnh đạo của tổ phụ trách chính của task → reviewer mặc định theo nguồn gốc
      if (resource.ownerTeamId && actor.leadTeamIds.includes(resource.ownerTeamId)) {
        return true;
      }
      // Nếu được chỉ định rõ là reviewer chính (và thuộc bậc quản trị 01/02/03)
      if (resource.taskReviewerId && resource.taskReviewerId === actor.memberId) {
        return true;
      }
      // 01.01 / 01.02 / 02 có thể duyệt thay trong phạm vi quản trị (ghi override_reason nếu không phải reviewer tổ)
      if (isBoardLeadership(actor.role)) {
        return true;
      }
      return false;
    }

    case "kpi.view_member": {
      if (resource.targetMemberId === actor.memberId) return true;
      if (isBoardLeadership(actor.role)) return true;
      if (actor.role === "TEAM_LEAD") {
        if (resource.targetRole && isBoardLeadership(resource.targetRole)) return false;
        return sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "kpi.finalize":
      return actor.role === "HEAD" || actor.role === "DEPUTY";

    case "report.export":
      // 01/02 toàn Ban, 03 tổ, 04 chỉ dữ liệu cá nhân (lọc chặt tại query)
      return true;

    case "regulation.propose":
      return actor.role === "HEAD" || actor.role === "ACTING_HEAD" || actor.role === "DEPUTY";

    case "portal.accounts.search":
      return actor.role === "HEAD" || actor.role === "DEPUTY";

    case "portal.permissions.request":
      return actor.role === "HEAD" || actor.role === "DEPUTY";

    case "audit.view":
      return actor.role === "HEAD" || actor.role === "ACTING_HEAD" || actor.role === "DEPUTY" || actor.role === "TEAM_LEAD";

    case "settings.manage":
      return actor.role === "HEAD" || actor.role === "DEPUTY";

    default:
      return false;
  }
}

/**
 * Kiểm tra quyền giao việc cho một đối tượng cụ thể (mục 5.2):
 * - HEAD (01.01): toàn Ban, self
 * - ACTING_HEAD (01.02) & DEPUTY (02): cấp dưới, self (không giao cho HEAD; 02 không giao cho 01.01)
 * - TEAM_LEAD (03): thành viên trong tổ mình quản lý, self, VÀ ngoại lệ gốc: giao cho bậc 01/02
 * - MEMBER (04): không được giao việc
 */
export function canAssignToMember(
  actor: AuthActor,
  target: { memberId: string; role: MemberRole; teamIds: string[] },
): boolean {
  if (actor.role === "MEMBER") return false;
  if (target.memberId === actor.memberId) return true;
  if (actor.role === "HEAD") return true;
  if (actor.role === "ACTING_HEAD") {
    return target.role !== "HEAD";
  }
  if (actor.role === "DEPUTY") {
    return target.role === "TEAM_LEAD" || target.role === "MEMBER" || target.role === "DEPUTY";
  }
  if (actor.role === "TEAM_LEAD") {
    // Ngoại lệ gốc trong Word: Bậc 03 có thể giao nhiệm vụ cho các bậc 01, 02
    if (target.role === "HEAD" || target.role === "ACTING_HEAD" || target.role === "DEPUTY") {
      return true;
    }
    return sharesLeadTeam(actor, target.teamIds);
  }
  return false;
}

export function requirePermission(
  actor: AuthActor,
  action: PolicyAction,
  resource: PolicyResource = {},
  message = "Bạn không có quyền thực hiện thao tác này.",
): void {
  if (!can(actor, action, resource)) {
    throw new AppError(403, "FORBIDDEN", message);
  }
}

/** Xây điều kiện SQL scope cho danh sách missions theo quyền của actor */
export function buildMissionScopeClause(actor: AuthActor, paramStartIndex: number): {
  clause: string;
  params: unknown[];
} {
  if (isBoardLeadership(actor.role)) {
    return { clause: "TRUE", params: [] };
  }
  if (actor.role === "TEAM_LEAD") {
    const pMember = `$${paramStartIndex}`;
    const pTeams = `$${paramStartIndex + 1}`;
    return {
      clause: `(
        m.creator_id = ${pMember}
        OR m.owner_id = ${pMember}
        OR EXISTS (SELECT 1 FROM mission_teams mt WHERE mt.mission_id = m.id AND mt.team_id = ANY(${pTeams}::uuid[]))
        OR EXISTS (SELECT 1 FROM tasks t WHERE t.mission_id = m.id AND (t.owner_team_id = ANY(${pTeams}::uuid[]) OR t.owner_id = ${pMember} OR t.reviewer_id = ${pMember}))
        OR EXISTS (SELECT 1 FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id WHERE t.mission_id = m.id AND ta.member_id = ${pMember})
        OR EXISTS (SELECT 1 FROM tasks t JOIN task_supervisors ts ON ts.task_id = t.id WHERE t.mission_id = m.id AND ts.member_id = ${pMember})
      )`,
      params: [actor.memberId, actor.leadTeamIds],
    };
  }
  // MEMBER: chỉ xem nhiệm vụ mình có tham gia / được giao / phụ trách
  const pMember = `$${paramStartIndex}`;
  return {
    clause: `(
      m.owner_id = ${pMember}
      OR EXISTS (SELECT 1 FROM tasks t JOIN task_assignments ta ON ta.task_id = t.id WHERE t.mission_id = m.id AND ta.member_id = ${pMember})
      OR EXISTS (SELECT 1 FROM tasks t JOIN task_supervisors ts ON ts.task_id = t.id WHERE t.mission_id = m.id AND ts.member_id = ${pMember})
    )`,
    params: [actor.memberId],
  };
}
