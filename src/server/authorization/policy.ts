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
  | "member.role.change"
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
  | "settings.manage"
  | "conduct.create"
  | "conduct.view_all"
  | "conduct.submit_dossier"
  | "council.access"
  | "council.conclude"
  | "initiative.submit"
  | "initiative.review"
  | "graphics.view"
  | "graphics.manage";

export interface PolicyResource {
  targetMemberId?: string;
  targetRole?: MemberRole;
  targetTeamIds?: string[];
  ownerTeamId?: string;
  missionTeamIds?: string[];
  missionCreatorId?: string;
  missionOwnerId?: string;
  missionParticipantIds?: string[];
  missionStatus?: string;
  taskSubmitterId?: string;
  taskReviewerId?: string | null;
  grantRole?: MemberRole;
  newRole?: MemberRole;
}

const BOARD_ROLES: MemberRole[] = ["HEAD", "ACTING_HEAD", "DEPUTY_INSPECTOR", "DEPUTY"];
const DEPUTY_ROLES: MemberRole[] = ["DEPUTY_INSPECTOR", "DEPUTY"];
const TEAM_LEADERSHIP_ROLES: MemberRole[] = ["TEAM_LEAD", "TEAM_DEPUTY"];
const COUNCIL_ROLES: MemberRole[] = ["HEAD", "ACTING_HEAD", "DEPUTY_INSPECTOR", "DEPUTY", "TEAM_LEAD", "TEAM_DEPUTY"];
const WORKER_ROLES: MemberRole[] = ["MEMBER", "COLLABORATOR"];

export function isBoardLeadership(role: MemberRole): boolean {
  return BOARD_ROLES.includes(role);
}

export function isDeputyRole(role: MemberRole): boolean {
  return DEPUTY_ROLES.includes(role);
}

export function isTeamLeadership(role: MemberRole): boolean {
  return TEAM_LEADERSHIP_ROLES.includes(role);
}

export function isManagerRole(role: MemberRole): boolean {
  return COUNCIL_ROLES.includes(role);
}

export function isCouncilRole(role: MemberRole): boolean {
  return COUNCIL_ROLES.includes(role);
}

export function isWorkerRole(role: MemberRole): boolean {
  return WORKER_ROLES.includes(role);
}

export function isObserverRole(role: MemberRole): boolean {
  return role === "OBSERVER";
}

export function isInspectorTeamMember(actor: AuthActor): boolean {
  return actor.memberships.some((m) => m.teamCode === "THAM_TRA");
}

function sharesLeadTeam(actor: AuthActor, teamIds?: string[]): boolean {
  if (!teamIds || teamIds.length === 0) return false;
  return teamIds.some((id) => actor.leadTeamIds.includes(id));
}

/**
 * Kiểm tra quyền thay đổi cấp bậc (hạ cấp / nâng 05 → 04) theo bảng cơ cấu tổ chức mới:
 * - Bậc 01.01 (HEAD): hạ 02.01/02.02 → 03.01/03.02/04; hạ 03.01/03.02 → 04; chuyển 05 → 04
 * - Bậc 02.01 (DEPUTY_INSPECTOR): hạ 03.01/03.02 → 04; chuyển 05 → 04
 * - Bậc 02.02 (DEPUTY): chuyển 05 → 04
 * - Bậc 03.01 (TEAM_LEAD): chuyển 05 → 04 (trong tổ mình quản lý)
 */
export function canChangeMemberRole(
  actor: AuthActor,
  target: { targetMemberId: string; targetRole: MemberRole; targetTeamIds: string[] },
  newRole: MemberRole,
): boolean {
  if (target.targetMemberId === actor.memberId) return false;
  if (target.targetRole === newRole) return false;

  if (actor.role === "HEAD") {
    if (isDeputyRole(target.targetRole) && (isTeamLeadership(newRole) || newRole === "MEMBER")) {
      return true;
    }
    if (isTeamLeadership(target.targetRole) && newRole === "MEMBER") {
      return true;
    }
    if (target.targetRole === "COLLABORATOR" && newRole === "MEMBER") {
      return true;
    }
    // HEAD cũng có thể điều chỉnh linh hoạt các bậc dưới (trừ tự thay thế HEAD)
    if (target.targetRole !== "HEAD" && newRole !== "HEAD") {
      return true;
    }
    return false;
  }

  if (actor.role === "DEPUTY_INSPECTOR") {
    if (isTeamLeadership(target.targetRole) && newRole === "MEMBER") return true;
    if (target.targetRole === "COLLABORATOR" && newRole === "MEMBER") return true;
    return false;
  }

  if (actor.role === "DEPUTY") {
    return target.targetRole === "COLLABORATOR" && newRole === "MEMBER";
  }

  if (actor.role === "TEAM_LEAD") {
    return (
      target.targetRole === "COLLABORATOR" &&
      newRole === "MEMBER" &&
      sharesLeadTeam(actor, target.targetTeamIds)
    );
  }

  return false;
}

/**
 * Hàm policy tập trung theo Cơ cấu 9 cấp bậc mới (01.01 .. 06).
 * Mặc định từ chối (deny-by-default) khi không khớp điều kiện.
 */
export function can(actor: AuthActor, action: PolicyAction, resource: PolicyResource = {}): boolean {
  if (!actor.accessEnabled || actor.activityStatus === "INACTIVE") return false;

  // Bậc 06 (Ngoại lệ - Chuyên viên TW Đoàn): CHỈ được xem & tải kết quả nhiệm vụ ĐÃ HOÀN THÀNH
  if (actor.role === "OBSERVER") {
    if (action === "mission.view") {
      return !resource.missionStatus || resource.missionStatus === "COMPLETED";
    }
    return false;
  }

  switch (action) {
    case "member.directory.view":
      return true;

    case "member.profile.view": {
      if (resource.targetMemberId && resource.targetMemberId === actor.memberId) return true;
      if (isBoardLeadership(actor.role)) return true;
      if (isTeamLeadership(actor.role)) {
        if (resource.targetRole && isBoardLeadership(resource.targetRole)) return false;
        return sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "member.profile.edit": {
      if (resource.targetMemberId && resource.targetMemberId === actor.memberId) return true;
      if (actor.role === "ACTING_HEAD") return false;
      if (actor.role === "HEAD") {
        return resource.targetRole !== "HEAD";
      }
      if (isDeputyRole(actor.role)) {
        return (
          isTeamLeadership(resource.targetRole as MemberRole) ||
          isWorkerRole(resource.targetRole as MemberRole)
        );
      }
      if (isTeamLeadership(actor.role)) {
        return isWorkerRole(resource.targetRole as MemberRole) && sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "member.access.grant": {
      if (actor.role === "HEAD") {
        return !resource.grantRole || resource.grantRole !== "HEAD";
      }
      // Bậc 03.02 (Tổ phó Tổ chuyên môn): cấp tài khoản cho Bậc 05 (Cộng tác viên)
      if (actor.role === "TEAM_DEPUTY") {
        return !resource.grantRole || resource.grantRole === "COLLABORATOR";
      }
      return false;
    }

    case "member.access.revoke": {
      if (resource.targetMemberId === actor.memberId) return false;
      if (actor.role === "HEAD") {
        return Boolean(resource.targetRole && resource.targetRole !== "HEAD" && resource.targetRole !== "ACTING_HEAD");
      }
      if (isDeputyRole(actor.role)) {
        return Boolean(
          resource.targetRole &&
            (isTeamLeadership(resource.targetRole) || isWorkerRole(resource.targetRole)),
        );
      }
      if (actor.role === "TEAM_LEAD") {
        return Boolean(
          resource.targetRole &&
            isWorkerRole(resource.targetRole) &&
            sharesLeadTeam(actor, resource.targetTeamIds),
        );
      }
      return false;
    }

    case "member.role.promote_head":
      return isDeputyRole(actor.role);

    case "member.role.change": {
      if (!resource.targetMemberId || !resource.targetRole || !resource.newRole) return false;
      return canChangeMemberRole(
        actor,
        {
          targetMemberId: resource.targetMemberId,
          targetRole: resource.targetRole,
          targetTeamIds: resource.targetTeamIds ?? [],
        },
        resource.newRole,
      );
    }

    case "team.manage":
    case "group.manage":
    case "channel.manage":
      return actor.role === "HEAD" || isDeputyRole(actor.role);

    case "mission.create":
      return isManagerRole(actor.role);

    case "mission.view": {
      if (isBoardLeadership(actor.role)) return true;
      if (resource.missionCreatorId === actor.memberId || resource.missionOwnerId === actor.memberId) {
        return true;
      }
      if (resource.missionParticipantIds?.includes(actor.memberId)) return true;
      if (isTeamLeadership(actor.role) && sharesLeadTeam(actor, resource.missionTeamIds)) return true;
      return false;
    }

    case "mission.manage":
    case "mission.complete": {
      if (isBoardLeadership(actor.role)) return true;
      if (isTeamLeadership(actor.role)) {
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
      if (resource.taskSubmitterId && resource.taskSubmitterId === actor.memberId) {
        return false;
      }
      if (!isManagerRole(actor.role)) return false;
      if (resource.ownerTeamId && actor.leadTeamIds.includes(resource.ownerTeamId)) {
        return true;
      }
      if (resource.taskReviewerId && resource.taskReviewerId === actor.memberId) {
        return true;
      }
      if (isBoardLeadership(actor.role)) {
        return true;
      }
      return false;
    }

    case "kpi.view_member": {
      if (resource.targetMemberId === actor.memberId) return true;
      if (isBoardLeadership(actor.role)) return true;
      if (isTeamLeadership(actor.role)) {
        if (resource.targetRole && isBoardLeadership(resource.targetRole)) return false;
        return sharesLeadTeam(actor, resource.targetTeamIds);
      }
      return false;
    }

    case "kpi.finalize":
      return actor.role === "HEAD" || isDeputyRole(actor.role);

    case "report.export":
      return true;

    case "regulation.propose":
      return isBoardLeadership(actor.role);

    case "portal.accounts.search":
      return actor.role === "HEAD" || isDeputyRole(actor.role) || actor.role === "TEAM_DEPUTY";

    case "portal.permissions.request":
      return actor.role === "HEAD" || isDeputyRole(actor.role);

    case "audit.view":
      return isManagerRole(actor.role);

    case "settings.manage":
      return actor.role === "HEAD" || isDeputyRole(actor.role);

    // Ghi nhận thái độ (Tổ Thẩm tra - Giám sát)
    case "conduct.create":
      return isCouncilRole(actor.role) || (actor.role === "MEMBER" && isInspectorTeamMember(actor));

    case "conduct.view_all":
      return actor.role === "HEAD" || actor.role === "ACTING_HEAD" || actor.role === "DEPUTY_INSPECTOR";

    case "conduct.submit_dossier":
      return actor.role === "HEAD" || actor.role === "ACTING_HEAD" || actor.role === "DEPUTY_INSPECTOR";

    // Hội đồng điều hành (01.01 - 03.02)
    case "council.access":
      return isCouncilRole(actor.role);

    case "council.conclude":
      return actor.role === "HEAD" || actor.role === "DEPUTY_INSPECTOR";

    // Ý tưởng, sáng kiến, sản phẩm chủ động
    case "initiative.submit":
      return true; // Mọi thành viên 01.01 - 05 (OBSERVER đã chặn ở trên)

    case "initiative.review":
      return isCouncilRole(actor.role);

    // Kho Data đồ họa cơ bản
    case "graphics.view":
      return true;

    case "graphics.manage":
      return isManagerRole(actor.role);

    default:
      return false;
  }
}

/**
 * Kiểm tra quyền giao việc cho một đối tượng cụ thể:
 * - HEAD (01.01): toàn Ban, self (không giao cho OBSERVER 06)
 * - ACTING_HEAD (01.02) & DEPUTY_INSPECTOR (02.01) & DEPUTY (02.02): cấp dưới, self
 * - TEAM_LEAD (03.01) & TEAM_DEPUTY (03.02): thành viên/CTV trong tổ mình quản lý, self, VÀ ngoại lệ giao cho bậc 01, 02
 * - MEMBER (04) / COLLABORATOR (05) / OBSERVER (06): không được giao việc
 */
export function canAssignToMember(
  actor: AuthActor,
  target: { memberId: string; role: MemberRole; teamIds: string[] },
): boolean {
  if (!isManagerRole(actor.role)) return false;
  if (target.role === "OBSERVER") return false;
  if (target.memberId === actor.memberId) return true;
  if (actor.role === "HEAD") return true;
  if (actor.role === "ACTING_HEAD") {
    return target.role !== "HEAD";
  }
  if (isDeputyRole(actor.role)) {
    return target.role !== "HEAD" && target.role !== "ACTING_HEAD";
  }
  if (isTeamLeadership(actor.role)) {
    if (isBoardLeadership(target.role)) {
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
  // Bậc 06 (Ngoại lệ - Chuyên viên TW Đoàn): CHỈ xem nhiệm vụ ĐÃ HOÀN THÀNH
  if (actor.role === "OBSERVER") {
    return { clause: `m.status = 'COMPLETED'`, params: [] };
  }
  if (isBoardLeadership(actor.role)) {
    return { clause: "TRUE", params: [] };
  }
  if (isTeamLeadership(actor.role)) {
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
  // MEMBER (04) & COLLABORATOR (05): chỉ xem nhiệm vụ mình có tham gia / được giao / phụ trách
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
