import { query, queryOne, withTransaction, type DbClient } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { writeAudit } from "@/server/audit/service";
import { createNotifications } from "@/server/notifications/service";
import { AppError } from "@/server/errors";
import type { ApprovalStatus, ApprovalType, MemberRole } from "@/lib/constants";

type GroupThresholdMode = "ANY_ONE" | "ALL" | number;
type PolicySnapshot = {
  requiredGroups: Partial<Record<"HEAD" | "DEPUTY" | "TEAM_LEAD", GroupThresholdMode>>;
  requireDistinctVotersAcrossGroups: boolean;
};

/** Kiểm tra danh sách phiếu đã đạt điều kiện đồng xác nhận theo policySnapshot hay chưa */
export function evaluateApprovalVotes(params: {
  policy: PolicySnapshot;
  eligibleVoters: { memberId: string; requiredGroup: "HEAD" | "DEPUTY" | "TEAM_LEAD" }[];
  votes: { memberId: string; decision: "APPROVE" | "REJECT" }[];
}): {
  status: "PENDING" | "READY_TO_APPLY" | "REJECTED";
  groupProgress: Record<string, { approved: number; required: number; totalEligible: number }>;
} {
  if (params.votes.some((v) => v.decision === "REJECT")) {
    return { status: "REJECTED", groupProgress: {} };
  }

  const approvedSet = new Set(params.votes.filter((v) => v.decision === "APPROVE").map((v) => v.memberId));
  const groups = Object.entries(params.policy.requiredGroups) as Array<
    ["HEAD" | "DEPUTY" | "TEAM_LEAD", GroupThresholdMode]
  >;

  const groupProgress: Record<string, { approved: number; required: number; totalEligible: number }> = {};
  let allMet = groups.length > 0;
  const distinctApproversUsed = new Set<string>();

  for (const [group, mode] of groups) {
    const eligibles = params.eligibleVoters.filter((e) => e.requiredGroup === group);
    if (eligibles.length === 0) {
      // Không tự duyệt khi danh sách cử tri rỗng (mục 11.2)
      allMet = false;
      groupProgress[group] = { approved: 0, required: 1, totalEligible: 0 };
      continue;
    }
    const required = mode === "ALL" ? eligibles.length : mode === "ANY_ONE" ? 1 : Math.min(eligibles.length, Math.max(1, mode));
    const approvedInGroup = eligibles.filter((e) => approvedSet.has(e.memberId));
    for (const a of approvedInGroup) distinctApproversUsed.add(a.memberId);

    groupProgress[group] = {
      approved: approvedInGroup.length,
      required,
      totalEligible: eligibles.length,
    };
    if (approvedInGroup.length < required) {
      allMet = false;
    }
  }

  // Không dùng cùng một người để đáp ứng 2 nhóm khác nhau (vd 01.02 sửa quy chế cần 1 DEPUTY + 1 TEAM_LEAD khác người)
  if (allMet && params.policy.requireDistinctVotersAcrossGroups && groups.length > 1) {
    const minDistinct = Object.values(groupProgress).reduce((sum, g) => sum + g.required, 0);
    if (distinctApproversUsed.size < minDistinct) {
      allMet = false;
    }
  }

  return {
    status: allMet ? "READY_TO_APPLY" : "PENDING",
    groupProgress,
  };
}

async function loadRegulationPolicyForRole(proposerRole: MemberRole): Promise<PolicySnapshot> {
  const settings = await queryOne<{ value: Record<string, Record<string, GroupThresholdMode>> }>(
    `SELECT value FROM system_settings WHERE key = 'approval_thresholds'`,
  );
  const cfg = settings?.value ?? {};

  if (proposerRole === "HEAD") {
    return {
      requiredGroups: { DEPUTY: cfg.regulation_head?.DEPUTY ?? "ANY_ONE" },
      requireDistinctVotersAcrossGroups: true,
    };
  }
  if (proposerRole === "ACTING_HEAD") {
    return {
      requiredGroups: {
        DEPUTY: cfg.regulation_acting?.DEPUTY ?? "ANY_ONE",
        TEAM_LEAD: cfg.regulation_acting?.TEAM_LEAD ?? "ANY_ONE",
      },
      requireDistinctVotersAcrossGroups: true,
    };
  }
  if (proposerRole === "DEPUTY") {
    return {
      requiredGroups: { HEAD: cfg.regulation_deputy?.HEAD ?? "ANY_ONE" },
      requireDistinctVotersAcrossGroups: true,
    };
  }
  throw new AppError(403, "FORBIDDEN", "Chỉ Trưởng Ban (01.01), Quyền Trưởng Ban (01.02) hoặc Phó Ban (02) được đề xuất sửa quy chế.");
}

async function snapshotEligibleVoters(
  tx: DbClient,
  proposerId: string,
  groups: ("HEAD" | "DEPUTY" | "TEAM_LEAD")[],
  includeOnLeaveForTeamLead = false,
) {
  const voters: { memberId: string; requiredGroup: "HEAD" | "DEPUTY" | "TEAM_LEAD" }[] = [];
  for (const group of groups) {
    // Với nâng chức vụ 01.02 → 01.01: lấy TẤT CẢ tài khoản Bậc 03 giữ chức vụ hiệu lực (gồm cả tạm nghỉ theo mục 11.2)
    const statusFilter =
      group === "TEAM_LEAD" && includeOnLeaveForTeamLead
        ? `activity_status IN ('ACTIVE', 'ON_LEAVE')`
        : `activity_status = 'ACTIVE'`;
    const rows = await tx.query<{ id: string }>(
      `SELECT id FROM members
       WHERE role = $1 AND access_enabled = true AND archived_at IS NULL AND ${statusFilter} AND id <> $2`,
      [group, proposerId],
    );
    if (rows.rows.length === 0) {
      throw new AppError(
        409,
        "MISSING_REQUIRED_APPROVERS",
        `Không tìm thấy thành viên đủ thẩm quyền thuộc nhóm ${group} để đồng xác nhận. Yêu cầu bị chặn.`,
      );
    }
    for (const r of rows.rows) {
      voters.push({ memberId: r.id, requiredGroup: group });
    }
  }
  return voters;
}

/** Đề xuất sửa quy chế hoạt động (tạo regulation_version PENDING + approval_request + snapshot cử tri) */
export async function proposeRegulationAmendment(
  actor: AuthActor,
  input: { title: string; body: string; reason: string; effectiveAt?: string },
  requestId?: string,
) {
  requirePermission(actor, "regulation.propose");
  if (!input.title.trim() || !input.body.trim() || !input.reason.trim()) {
    throw new AppError(400, "FIELDS_REQUIRED", "Vui lòng nhập đầy đủ tiêu đề, nội dung quy chế và lý do sửa đổi.");
  }

  const policy = await loadRegulationPolicyForRole(actor.role);
  const requiredGroups = Object.keys(policy.requiredGroups) as ("HEAD" | "DEPUTY" | "TEAM_LEAD")[];

  return withTransaction(async (tx) => {
    const voters = await snapshotEligibleVoters(tx, actor.memberId, requiredGroups, false);

    const prev = await tx.query<{ id: string }>(
      `SELECT id FROM regulation_versions WHERE status = 'APPROVED' ORDER BY approved_at DESC LIMIT 1`,
    );
    const cnt = await tx.query<{ c: string }>(`SELECT count(*)::text AS c FROM regulation_versions`);
    const versionCode = `QC-${Number(cnt.rows[0]?.c ?? 0) + 1}.0`;

    const regIns = await tx.query<{ id: string }>(
      `INSERT INTO regulation_versions (version_code, title, body, reason, previous_id, status, effective_at, created_by)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
       RETURNING id`,
      [
        versionCode,
        input.title.trim(),
        input.body.trim(),
        input.reason.trim(),
        prev.rows[0]?.id ?? null,
        input.effectiveAt ? new Date(input.effectiveAt).toISOString() : new Date().toISOString(),
        actor.memberId,
      ],
    );
    const regId = regIns.rows[0].id;

    const reqIns = await tx.query<{ id: string }>(
      `INSERT INTO approval_requests (type, proposer_id, target_type, target_id, title, reason, payload, policy_snapshot, status)
       VALUES ('REGULATION_AMENDMENT', $1, 'REGULATION_VERSION', $2, $3, $4, $5::jsonb, $6::jsonb, 'PENDING')
       RETURNING id`,
      [
        actor.memberId,
        regId,
        `Sửa đổi quy chế ${versionCode}: ${input.title.trim()}`,
        input.reason.trim(),
        JSON.stringify({ regulationVersionId: regId, versionCode, title: input.title.trim() }),
        JSON.stringify(policy),
      ],
    );
    const approvalId = reqIns.rows[0].id;

    for (const v of voters) {
      await tx.query(
        `INSERT INTO approval_eligible_voters (request_id, member_id, required_group) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [approvalId, v.memberId, v.requiredGroup],
      );
    }

    await createNotifications(
      voters.map((v) => v.memberId),
      {
        eventType: "APPROVAL_REQUESTED",
        targetType: "APPROVAL",
        targetId: approvalId,
        title: `Yêu cầu đồng xác nhận sửa quy chế ${versionCode}`,
        message: `${actor.displayName} đề xuất sửa quy chế. Lý do: ${input.reason.trim()}`,
        link: "/approvals",
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "REGULATION_PROPOSAL_CREATED",
        targetType: "APPROVAL_REQUEST",
        targetId: approvalId,
        safeDiff: { versionCode, voterCount: voters.length, policy },
        requestId,
      },
      tx,
    );

    return { approvalId, regulationVersionId: regId, versionCode, eligibleVoterCount: voters.length };
  });
}

/** Đề xuất nâng Bậc 01.02 (ACTING_HEAD) lên Bậc 01.01 (HEAD) — bắt buộc 100% Bậc 03 đồng thuận */
export async function proposePromoteActingHead(
  actor: AuthActor,
  input: { targetMemberId: string; reason: string },
  requestId?: string,
) {
  requirePermission(
    actor,
    "member.role.promote_head",
    {},
    "Chỉ Phó Trưởng Ban Biên tập (Bậc 02) mới được đề xuất nâng Bậc 01.02 lên Bậc 01.01.",
  );
  if (!input.reason.trim()) {
    throw new AppError(400, "REASON_REQUIRED", "Vui lòng ghi rõ lý do đề xuất nâng cấp bậc.");
  }

  return withTransaction(async (tx) => {
    const targetRes = await tx.query<{ id: string; role: MemberRole; display_name: string; access_enabled: boolean; activity_status: string }>(
      `SELECT id, role, display_name, access_enabled, activity_status FROM members WHERE id = $1 AND archived_at IS NULL`,
      [input.targetMemberId],
    );
    const target = targetRes.rows[0];
    if (!target || target.role !== "ACTING_HEAD" || !target.access_enabled || target.activity_status === "INACTIVE") {
      throw new AppError(400, "INVALID_TARGET", "Đối tượng đề xuất phải đang giữ chức vụ Quyền Trưởng Ban Biên tập (Bậc 01.02).");
    }

    // Kiểm tra có HEAD đang hiệu lực không (tối đa 1 HEAD theo mục 5.1 & REG-03)
    const activeHead = await tx.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM members WHERE role = 'HEAD' AND access_enabled = true AND archived_at IS NULL AND activity_status <> 'INACTIVE'`,
    );
    if (activeHead.rows[0]) {
      throw new AppError(
        409,
        "ACTIVE_HEAD_EXISTS",
        `Hiện đang có Trưởng Ban Biên tập hiệu lực (${activeHead.rows[0].display_name}). Không thể tồn tại hai Bậc 01.01 đồng thời.`,
      );
    }

    // Luôn ép ngưỡng ALL cho Bậc 03 theo yêu cầu gốc Word & mục 11.2
    const policy: PolicySnapshot = {
      requiredGroups: { TEAM_LEAD: "ALL" },
      requireDistinctVotersAcrossGroups: true,
    };
    const voters = await snapshotEligibleVoters(tx, actor.memberId, ["TEAM_LEAD"], true);

    const reqIns = await tx.query<{ id: string }>(
      `INSERT INTO approval_requests (type, proposer_id, target_type, target_id, title, reason, payload, policy_snapshot, status)
       VALUES ('ROLE_PROMOTION_HEAD', $1, 'MEMBER', $2, $3, $4, $5::jsonb, $6::jsonb, 'PENDING')
       RETURNING id`,
      [
        actor.memberId,
        target.id,
        `Đề xuất nâng ${target.display_name} từ Bậc 01.02 lên Bậc 01.01`,
        input.reason.trim(),
        JSON.stringify({ targetMemberId: target.id, targetName: target.display_name, fromRole: "ACTING_HEAD", toRole: "HEAD" }),
        JSON.stringify(policy),
      ],
    );
    const approvalId = reqIns.rows[0].id;

    for (const v of voters) {
      await tx.query(
        `INSERT INTO approval_eligible_voters (request_id, member_id, required_group) VALUES ($1, $2, $3)`,
        [approvalId, v.memberId, v.requiredGroup],
      );
    }

    await createNotifications(
      voters.map((v) => v.memberId),
      {
        eventType: "APPROVAL_REQUESTED",
        targetType: "APPROVAL",
        targetId: approvalId,
        title: "Yêu cầu đồng thuận 100% Bậc 03 nâng cấp Bậc 01.02 → 01.01",
        message: `${actor.displayName} đề xuất nâng ${target.display_name} lên Trưởng Ban Biên tập. Cần toàn bộ ${voters.length} tài khoản Bậc 03 đồng ý.`,
        link: "/approvals",
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "ROLE_PROMOTION_PROPOSED",
        targetType: "APPROVAL_REQUEST",
        targetId: approvalId,
        safeDiff: { targetMemberId: target.id, requiredTeamLeadCount: voters.length },
        requestId,
      },
      tx,
    );

    return { approvalId, targetMemberId: target.id, requiredTeamLeadCount: voters.length };
  });
}

/** Kiểm tra danh sách cử tri Bậc 03 có bị thay đổi trong lúc đề xuất nâng bậc đang mở không (mục 11.2) */
async function checkPromotionRosterStale(tx: DbClient, requestId: string): Promise<boolean> {
  const snap = await tx.query<{ member_id: string }>(
    `SELECT member_id FROM approval_eligible_voters WHERE request_id = $1 AND required_group = 'TEAM_LEAD' ORDER BY member_id`,
    [requestId],
  );
  const current = await tx.query<{ id: string }>(
    `SELECT id FROM members WHERE role = 'TEAM_LEAD' AND access_enabled = true AND archived_at IS NULL AND activity_status IN ('ACTIVE', 'ON_LEAVE') ORDER BY id`,
  );
  const snapIds = snap.rows.map((r) => r.member_id);
  const curIds = current.rows.map((r) => r.id);
  if (snapIds.length !== curIds.length) return true;
  return snapIds.some((id, idx) => id !== curIds[idx]);
}

/** Bỏ phiếu đồng xác nhận (APPROVE / REJECT) */
export async function castApprovalVote(
  actor: AuthActor,
  approvalId: string,
  input: { decision: "APPROVE" | "REJECT"; reason?: string },
  requestId?: string,
) {
  if (input.decision === "REJECT" && !input.reason?.trim()) {
    throw new AppError(400, "REASON_REQUIRED", "Khi từ chối đồng xác nhận bắt buộc ghi rõ lý do.");
  }

  return withTransaction(async (tx) => {
    const reqRes = await tx.query<{
      id: string;
      type: ApprovalType;
      proposer_id: string;
      target_id: string;
      title: string;
      status: ApprovalStatus;
      policy_snapshot: PolicySnapshot;
    }>(`SELECT id, type, proposer_id, target_id, title, status, policy_snapshot FROM approval_requests WHERE id = $1`, [approvalId]);
    const req = reqRes.rows[0];
    if (!req) throw new AppError(404, "APPROVAL_NOT_FOUND", "Không tìm thấy yêu cầu phê duyệt.");
    if (req.status !== "PENDING") {
      throw new AppError(409, "APPROVAL_NOT_PENDING", `Yêu cầu đang ở trạng thái ${req.status}, không thể bỏ phiếu.`);
    }
    if (req.proposer_id === actor.memberId) {
      throw new AppError(403, "SELF_APPROVE_FORBIDDEN", "Người đề xuất không được tự bỏ phiếu đồng xác nhận.");
    }

    // Kiểm tra người bỏ phiếu có nằm trong snapshot cử tri và vẫn giữ đúng role tại thời điểm bỏ phiếu
    const voterRes = await tx.query<{ required_group: "HEAD" | "DEPUTY" | "TEAM_LEAD" }>(
      `SELECT required_group FROM approval_eligible_voters WHERE request_id = $1 AND member_id = $2`,
      [approvalId, actor.memberId],
    );
    const voter = voterRes.rows[0];
    if (!voter) {
      throw new AppError(403, "NOT_ELIGIBLE_VOTER", "Bạn không nằm trong danh sách cử tri đồng xác nhận của yêu cầu này.");
    }
    if (actor.role !== voter.required_group) {
      throw new AppError(409, "VOTER_ROLE_CHANGED", "Chức vụ hiện tại của bạn đã thay đổi so với lúc gửi đề xuất.");
    }

    // Nếu là đề xuất nâng 01.02 → 01.01, kiểm tra danh sách Bậc 03 có bị thay đổi không
    if (req.type === "ROLE_PROMOTION_HEAD") {
      const stale = await checkPromotionRosterStale(tx, approvalId);
      if (stale) {
        await tx.query(`UPDATE approval_requests SET status = 'STALE', resolved_at = now(), version = version + 1 WHERE id = $1`, [approvalId]);
        await writeAudit(
          { actorId: actor.memberId, action: "APPROVAL_MARKED_STALE", targetType: "APPROVAL_REQUEST", targetId: approvalId, requestId },
          tx,
        );
        throw new AppError(409, "APPROVAL_STALE", "Danh sách tài khoản Bậc 03 đã thay đổi sau khi tạo đề xuất. Yêu cầu đã chuyển STALE, cần lập lại.");
      }
    }

    // Một người một phiếu (unique constraint request_id + member_id)
    const dup = await tx.query<{ id: string }>(
      `SELECT id FROM approval_votes WHERE request_id = $1 AND member_id = $2`,
      [approvalId, actor.memberId],
    );
    if (dup.rows[0]) {
      throw new AppError(409, "DUPLICATE_VOTE", "Bạn đã bỏ phiếu cho yêu cầu này rồi.");
    }

    await tx.query(
      `INSERT INTO approval_votes (request_id, member_id, decision, reason) VALUES ($1, $2, $3, $4)`,
      [approvalId, actor.memberId, input.decision, (input.reason ?? "").trim()],
    );

    const eligibleRows = await tx.query<{ member_id: string; required_group: "HEAD" | "DEPUTY" | "TEAM_LEAD" }>(
      `SELECT member_id, required_group FROM approval_eligible_voters WHERE request_id = $1`,
      [approvalId],
    );
    const voteRows = await tx.query<{ member_id: string; decision: "APPROVE" | "REJECT" }>(
      `SELECT member_id, decision FROM approval_votes WHERE request_id = $1`,
      [approvalId],
    );

    const evalRes = evaluateApprovalVotes({
      policy: req.policy_snapshot,
      eligibleVoters: eligibleRows.rows.map((e) => ({ memberId: e.member_id, requiredGroup: e.required_group })),
      votes: voteRows.rows.map((v) => ({ memberId: v.member_id, decision: v.decision })),
    });

    if (evalRes.status === "REJECTED") {
      await tx.query(
        `UPDATE approval_requests SET status = 'REJECTED', resolved_at = now(), version = version + 1 WHERE id = $1`,
        [approvalId],
      );
      if (req.type === "REGULATION_AMENDMENT") {
        await tx.query(`UPDATE regulation_versions SET status = 'REJECTED' WHERE id = $1`, [req.target_id]);
      }
    } else if (evalRes.status === "READY_TO_APPLY") {
      await tx.query(
        `UPDATE approval_requests SET status = 'READY_TO_APPLY', resolved_at = now(), version = version + 1 WHERE id = $1`,
        [approvalId],
      );
    }

    await createNotifications(
      [req.proposer_id],
      {
        eventType: "APPROVAL_VOTED",
        targetType: "APPROVAL",
        targetId: approvalId,
        title: `${actor.displayName} đã ${input.decision === "APPROVE" ? "đồng ý" : "từ chối"} đề xuất`,
        message: `${req.title}${evalRes.status === "READY_TO_APPLY" ? " — Đã đủ phiếu, sẵn sàng áp dụng!" : ""}`,
        link: "/approvals",
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "APPROVAL_VOTE_CAST",
        targetType: "APPROVAL_REQUEST",
        targetId: approvalId,
        safeDiff: { decision: input.decision, resultingStatus: evalRes.status },
        requestId,
      },
      tx,
    );

    return { approvalId, decision: input.decision, status: evalRes.status, groupProgress: evalRes.groupProgress };
  });
}

/** Áp dụng đề xuất đã đủ phiếu đồng xác nhận trong transaction có kiểm tra lại điều kiện vai trò & ràng buộc HEAD */
export async function applyApprovalRequest(actor: AuthActor, approvalId: string, requestId?: string) {
  return withTransaction(async (tx) => {
    const reqRes = await tx.query<{
      id: string;
      type: ApprovalType;
      proposer_id: string;
      target_id: string;
      title: string;
      status: ApprovalStatus;
      policy_snapshot: PolicySnapshot;
    }>(`SELECT id, type, proposer_id, target_id, title, status, policy_snapshot FROM approval_requests WHERE id = $1`, [approvalId]);
    const req = reqRes.rows[0];
    if (!req) throw new AppError(404, "APPROVAL_NOT_FOUND", "Không tìm thấy yêu cầu phê duyệt.");
    if (req.status !== "READY_TO_APPLY") {
      throw new AppError(409, "NOT_READY_TO_APPLY", `Yêu cầu chưa đủ điều kiện áp dụng (trạng thái: ${req.status}).`);
    }

    // Với nâng cấp 01.02 → 01.01, Phó Ban (02) thực hiện xác nhận cuối; với quy chế, người đề xuất hoặc HEAD/DEPUTY
    if (req.type === "ROLE_PROMOTION_HEAD" && actor.role !== "DEPUTY") {
      throw new AppError(403, "FORBIDDEN", "Chỉ Phó Trưởng Ban (Bậc 02) thực hiện bước áp dụng cuối cho đề xuất nâng bậc 01.01.");
    }
    if (req.type === "REGULATION_AMENDMENT" && actor.memberId !== req.proposer_id && actor.role !== "HEAD" && actor.role !== "DEPUTY") {
      throw new AppError(403, "FORBIDDEN", "Bạn không có quyền ban hành đề xuất quy chế này.");
    }

    // Tái xác minh toàn bộ phiếu đồng ý đến từ người VẪN CÒN giữ đúng vai trò và quyền truy cập
    const validVotes = await tx.query<{ member_id: string; required_group: "HEAD" | "DEPUTY" | "TEAM_LEAD"; decision: "APPROVE" | "REJECT" }>(
      `SELECT ev.member_id, ev.required_group, av.decision
       FROM approval_eligible_voters ev
       JOIN approval_votes av ON av.request_id = ev.request_id AND av.member_id = ev.member_id
       JOIN members m ON m.id = ev.member_id
       WHERE ev.request_id = $1
         AND m.access_enabled = true
         AND m.archived_at IS NULL
         AND m.role = ev.required_group`,
      [approvalId],
    );
    const eligibleRows = await tx.query<{ member_id: string; required_group: "HEAD" | "DEPUTY" | "TEAM_LEAD" }>(
      `SELECT member_id, required_group FROM approval_eligible_voters WHERE request_id = $1`,
      [approvalId],
    );
    const recheck = evaluateApprovalVotes({
      policy: req.policy_snapshot,
      eligibleVoters: eligibleRows.rows.map((e) => ({ memberId: e.member_id, requiredGroup: e.required_group })),
      votes: validVotes.rows.map((v) => ({ memberId: v.member_id, decision: v.decision })),
    });
    if (recheck.status !== "READY_TO_APPLY") {
      throw new AppError(409, "VOTES_INVALIDATED", "Một số phiếu đồng xác nhận không còn hợp lệ do thay đổi chức vụ/quyền truy cập.");
    }

    if (req.type === "ROLE_PROMOTION_HEAD") {
      const stale = await checkPromotionRosterStale(tx, approvalId);
      if (stale) {
        await tx.query(`UPDATE approval_requests SET status = 'STALE', version = version + 1 WHERE id = $1`, [approvalId]);
        throw new AppError(409, "APPROVAL_STALE", "Danh sách Bậc 03 đã thay đổi, không thể áp dụng đề xuất cũ.");
      }

      const targetCheck = await tx.query<{ id: string; role: MemberRole }>(
        `SELECT id, role FROM members WHERE id = $1 AND access_enabled = true AND archived_at IS NULL`,
        [req.target_id],
      );
      if (!targetCheck.rows[0] || targetCheck.rows[0].role !== "ACTING_HEAD") {
        throw new AppError(409, "TARGET_CHANGED", "Thành viên mục tiêu không còn ở Bậc 01.02.");
      }

      const activeHead = await tx.query<{ id: string }>(
        `SELECT id FROM members WHERE role = 'HEAD' AND access_enabled = true AND archived_at IS NULL AND activity_status <> 'INACTIVE'`,
      );
      if (activeHead.rows[0]) {
        throw new AppError(409, "ACTIVE_HEAD_EXISTS", "Hiện đã có Bậc 01.01 đang hiệu lực, không thể nâng cấp trùng.");
      }

      await tx.query(
        `UPDATE members SET role = 'HEAD', role_version = role_version + 1, updated_at = now() WHERE id = $1`,
        [req.target_id],
      );
      await tx.query(
        `INSERT INTO member_role_history (member_id, old_role, new_role, reason, changed_by, approval_request_id)
         VALUES ($1, 'ACTING_HEAD', 'HEAD', 'Nâng bậc theo đồng thuận 100% Bậc 03', $2, $3)`,
        [req.target_id, actor.memberId, approvalId],
      );
    } else if (req.type === "REGULATION_AMENDMENT") {
      // Đánh dấu quy chế APPROVED cũ là SUPERSEDED và kích hoạt bản mới
      await tx.query(`UPDATE regulation_versions SET status = 'SUPERSEDED' WHERE status = 'APPROVED' AND id <> $1`, [req.target_id]);
      await tx.query(`UPDATE regulation_versions SET status = 'APPROVED', approved_at = now() WHERE id = $1`, [req.target_id]);

      const allMembers = await tx.query<{ id: string }>(`SELECT id FROM members WHERE access_enabled = true AND archived_at IS NULL`);
      await createNotifications(
        allMembers.rows.map((m) => m.id),
        {
          eventType: "REGULATION_PUBLISHED",
          targetType: "REGULATION",
          targetId: req.target_id,
          title: "Quy chế hoạt động mới đã được ban hành",
          message: req.title,
          link: "/regulations",
        },
        tx,
      );
    }

    await tx.query(
      `UPDATE approval_requests SET status = 'APPLIED', applied_at = now(), applied_by = $1, version = version + 1 WHERE id = $2`,
      [actor.memberId, approvalId],
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "APPROVAL_APPLIED",
        targetType: "APPROVAL_REQUEST",
        targetId: approvalId,
        safeDiff: { type: req.type, targetId: req.target_id },
        requestId,
      },
      tx,
    );

    return { approvalId, status: "APPLIED" as const };
  });
}

export async function listApprovals(actor: AuthActor) {
  const requests = await query<{
    id: string;
    type: ApprovalType;
    proposer_id: string;
    proposer_name: string;
    target_type: string;
    target_id: string;
    title: string;
    reason: string;
    payload: unknown;
    policy_snapshot: PolicySnapshot;
    status: ApprovalStatus;
    created_at: Date;
    applied_at: Date | null;
  }>(
    `SELECT ar.*, m.display_name AS proposer_name
     FROM approval_requests ar
     JOIN members m ON m.id = ar.proposer_id
     ORDER BY ar.created_at DESC
     LIMIT 50`,
  );

  const reqIds = requests.map((r) => r.id);
  const [eligibles, votes] = await Promise.all([
    reqIds.length > 0
      ? query<{ request_id: string; member_id: string; display_name: string; required_group: "HEAD" | "DEPUTY" | "TEAM_LEAD" }>(
          `SELECT ev.request_id, ev.member_id, m.display_name, ev.required_group
           FROM approval_eligible_voters ev
           JOIN members m ON m.id = ev.member_id
           WHERE ev.request_id = ANY($1::uuid[])`,
          [reqIds],
        )
      : Promise.resolve([]),
    reqIds.length > 0
      ? query<{ request_id: string; member_id: string; display_name: string; decision: "APPROVE" | "REJECT"; reason: string; voted_at: Date }>(
          `SELECT av.request_id, av.member_id, m.display_name, av.decision, av.reason, av.voted_at
           FROM approval_votes av
           JOIN members m ON m.id = av.member_id
           WHERE av.request_id = ANY($1::uuid[])
           ORDER BY av.voted_at ASC`,
          [reqIds],
        )
      : Promise.resolve([]),
  ]);

  return requests.map((r) => {
    const rElig = eligibles.filter((e) => e.request_id === r.id);
    const rVotes = votes.filter((v) => v.request_id === r.id);
    const evalRes = evaluateApprovalVotes({
      policy: r.policy_snapshot,
      eligibleVoters: rElig.map((e) => ({ memberId: e.member_id, requiredGroup: e.required_group })),
      votes: rVotes.map((v) => ({ memberId: v.member_id, decision: v.decision })),
    });
    const myEligible = rElig.find((e) => e.member_id === actor.memberId);
    const myVote = rVotes.find((v) => v.member_id === actor.memberId);

    return {
      id: r.id,
      type: r.type,
      proposerId: r.proposer_id,
      proposerName: r.proposer_name,
      targetType: r.target_type,
      targetId: r.target_id,
      title: r.title,
      reason: r.reason,
      payload: r.payload,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
      groupProgress: evalRes.groupProgress,
      eligibleVoters: rElig.map((e) => ({
        memberId: e.member_id,
        displayName: e.display_name,
        requiredGroup: e.required_group,
      })),
      votes: rVotes.map((v) => ({
        memberId: v.member_id,
        displayName: v.display_name,
        decision: v.decision,
        reason: v.reason,
        votedAt: new Date(v.voted_at).toISOString(),
      })),
      canVote: r.status === "PENDING" && Boolean(myEligible) && !myVote && r.proposer_id !== actor.memberId,
      canApply:
        r.status === "READY_TO_APPLY" &&
        ((r.type === "ROLE_PROMOTION_HEAD" && actor.role === "DEPUTY") ||
          (r.type === "REGULATION_AMENDMENT" && (actor.memberId === r.proposer_id || actor.role === "HEAD" || actor.role === "DEPUTY"))),
    };
  });
}
