import { query, queryOne, withTransaction, type DbClient } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { can, isBoardLeadership, requirePermission } from "@/server/authorization/policy";
import { writeAudit } from "@/server/audit/service";
import { createNotifications } from "@/server/notifications/service";
import { AppError } from "@/server/errors";
import type { MemberRole } from "@/lib/constants";

export type CouncilItemType = "PERSONNEL_DOSSIER" | "GENERAL_DOCUMENT";
export type CouncilItemStatus = "OPEN_FOR_OPINION" | "RED_ALERT" | "AWAITING_MEETING" | "COMPLETED";
export type CouncilOpinionChoice = "AGREE" | "DISAGREE" | "OTHER" | "COMMENT";

const COUNCIL_SQL_ROLES = `('HEAD', 'ACTING_HEAD', 'DEPUTY_INSPECTOR', 'DEPUTY', 'TEAM_LEAD', 'TEAM_DEPUTY')`;
const BOARD_SQL_ROLES = `('HEAD', 'ACTING_HEAD', 'DEPUTY_INSPECTOR', 'DEPUTY')`;
const FIVE_DAYS_MS = 5 * 24 * 3600 * 1000;

async function generateCouncilCode(tx: DbClient, itemType: CouncilItemType): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = itemType === "PERSONNEL_DOSSIER" ? `HS-${year}-` : `HD-${year}-`;
  const row = await tx.query<{ code: string }>(
    `SELECT code FROM council_items WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
    [`${prefix}%`],
  );
  const last = row.rows[0]?.code;
  const seq = last ? Number(last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

async function getActiveCouncilMembers(tx?: DbClient) {
  const sql = `SELECT id, member_code, display_name, role
               FROM members
               WHERE access_enabled = true AND activity_status = 'ACTIVE' AND archived_at IS NULL
                 AND role IN ${COUNCIL_SQL_ROLES}
               ORDER BY display_name ASC`;
  return tx
    ? (await tx.query<{ id: string; member_code: string; display_name: string; role: MemberRole }>(sql)).rows
    : query<{ id: string; member_code: string; display_name: string; role: MemberRole }>(sql);
}

/**
 * 1. Ghi nhận thái độ trong công việc (Tổ Thẩm tra - Giám sát)
 * - Ai được gửi: Bậc 01.01 -> 03.02 và Bậc 04 thuộc Tổ Thẩm tra - Giám sát.
 * - Quyền bảo mật:
 *   + 01.01, 01.02, 02.01: xem đầy đủ tất cả phiếu, tên người gửi, lịch sử theo cá nhân.
 *   + 02.02, 03.01, 03.02, 04 (Tổ Thẩm tra): KHÔNG xem lại được phiếu đã gửi (tránh lộ nguồn).
 */
export async function createConductReport(
  actor: AuthActor,
  input: {
    subjectMemberId: string;
    issueSummary: string;
    evidenceText?: string;
    evidenceLinks?: { label: string; url: string }[];
    evidenceFileIds?: string[];
    proposedSolution: string;
  },
  requestId?: string,
) {
  requirePermission(
    actor,
    "conduct.create",
    {},
    "Chỉ Bậc 01.01–03.02 hoặc thành viên Tổ Thẩm tra - Giám sát mới được gửi phiếu ghi nhận thái độ.",
  );

  if (input.subjectMemberId === actor.memberId) {
    throw new AppError(400, "INVALID_SUBJECT", "Không thể tự gửi phiếu ghi nhận thái độ cho chính mình.");
  }
  const issue = input.issueSummary.trim();
  const solution = input.proposedSolution.trim();
  if (issue.length < 5) {
    throw new AppError(400, "ISSUE_REQUIRED", "Vui lòng mô tả chi tiết vấn đề (tối thiểu 5 ký tự).");
  }
  if (solution.length < 3) {
    throw new AppError(400, "SOLUTION_REQUIRED", "Vui lòng nhập phương hướng giải quyết đề xuất.");
  }

  return withTransaction(async (tx) => {
    const subject = await tx.query<{ id: string; display_name: string; role: MemberRole }>(
      `SELECT id, display_name, role FROM members WHERE id = $1 AND archived_at IS NULL`,
      [input.subjectMemberId],
    );
    if (!subject.rows[0]) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên bị ghi nhận.");
    }
    if (subject.rows[0].role === "OBSERVER") {
      throw new AppError(400, "INVALID_SUBJECT", "Không áp dụng ghi nhận thái độ cho tài khoản Ngoại lệ (Bậc 06).");
    }

    const fileIds = [...new Set(input.evidenceFileIds ?? [])];
    const inserted = await tx.query<{ id: string; created_at: Date }>(
      `INSERT INTO conduct_reports (
         reporter_id, subject_member_id, issue_summary, evidence_text, evidence_links, evidence_file_ids, proposed_solution
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING id, created_at`,
      [
        actor.memberId,
        input.subjectMemberId,
        issue,
        (input.evidenceText ?? "").trim(),
        JSON.stringify(input.evidenceLinks ?? []),
        JSON.stringify(fileIds),
        solution,
      ],
    );
    const reportId = inserted.rows[0].id;

    // Thông báo riêng tới 01.01, 01.02, 02.01 (những người có thẩm quyền xem toàn bộ ghi nhận thái độ)
    const inspectors = await tx.query<{ id: string }>(
      `SELECT id FROM members
       WHERE access_enabled = true AND activity_status = 'ACTIVE' AND archived_at IS NULL
         AND role IN ('HEAD', 'ACTING_HEAD', 'DEPUTY_INSPECTOR')`,
    );
    await createNotifications(
      inspectors.rows.map((r) => r.id).filter((id) => id !== actor.memberId),
      {
        eventType: "CONDUCT_REPORT_CREATED",
        targetType: "CONDUCT_REPORT",
        targetId: reportId,
        title: `Có phiếu ghi nhận thái độ mới (${subject.rows[0].display_name})`,
        message: `Hệ thống vừa tiếp nhận 01 phiếu ghi nhận thái độ mới liên quan đến ${subject.rows[0].display_name}.`,
        link: `/council?tab=conduct`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "CONDUCT_REPORT_CREATED",
        targetType: "CONDUCT_REPORT",
        targetId: reportId,
        safeDiff: { subjectMemberId: input.subjectMemberId, fileCount: fileIds.length },
        requestId,
      },
      tx,
    );

    return {
      id: reportId,
      createdAt: new Date(inserted.rows[0].created_at).toISOString(),
    };
  });
}

/**
 * Danh sách phiếu ghi nhận thái độ:
 * - 01.01, 01.02, 02.01: thấy toàn bộ chi tiết + người gửi + tổng hợp theo cá nhân để trình HĐĐH.
 * - 02.02, 03.01, 03.02, 04 (Tổ Thẩm tra): chỉ nhận metadata `{ canViewAll: false, mySubmittedCount }` — TUYỆT ĐỐI không trả nội dung phiếu cũ!
 */
export async function listConductReports(actor: AuthActor, filters?: { subjectMemberId?: string }) {
  if (!can(actor, "conduct.create") && !can(actor, "conduct.view_all")) {
    throw new AppError(403, "FORBIDDEN", "Bạn không có quyền truy cập phân hệ Ghi nhận thái độ.");
  }

  const canViewAll = can(actor, "conduct.view_all");
  const myCountRow = await queryOne<{ c: string }>(
    `SELECT count(*)::text AS c FROM conduct_reports WHERE reporter_id = $1`,
    [actor.memberId],
  );
  const mySubmittedCount = Number(myCountRow?.c ?? 0);

  if (!canViewAll) {
    return {
      canViewAll: false,
      canSubmitDossier: false,
      mySubmittedCount,
      reports: [],
      subjectSummaries: [],
    };
  }

  const params: unknown[] = [];
  const where: string[] = ["TRUE"];
  if (filters?.subjectMemberId) {
    params.push(filters.subjectMemberId);
    where.push(`cr.subject_member_id = $${params.length}`);
  }

  const rows = await query<{
    id: string;
    reporter_id: string;
    reporter_name: string;
    reporter_role: MemberRole;
    subject_member_id: string;
    subject_name: string;
    subject_code: string;
    subject_teams: string | null;
    issue_summary: string;
    evidence_text: string;
    evidence_links: unknown;
    evidence_file_ids: unknown;
    proposed_solution: string;
    created_at: Date;
    dossier_count: string | number;
  }>(
    `SELECT cr.*,
            rep.display_name AS reporter_name, rep.role AS reporter_role,
            sub.display_name AS subject_name, sub.member_code AS subject_code,
            (SELECT string_agg(t.name, ', ' ORDER BY tm.is_primary DESC, t.sort_order ASC)
             FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
             WHERE tm.member_id = sub.id AND tm.effective_to IS NULL) AS subject_teams,
            (SELECT count(*) FROM council_item_reports cir WHERE cir.conduct_report_id = cr.id) AS dossier_count
     FROM conduct_reports cr
     JOIN members rep ON rep.id = cr.reporter_id
     JOIN members sub ON sub.id = cr.subject_member_id
     WHERE ${where.join(" AND ")}
     ORDER BY cr.created_at DESC
     LIMIT 200`,
    params,
  );

  // Lấy thông tin file đính kèm
  const allFileIds = [
    ...new Set(
      rows.flatMap((r) => (Array.isArray(r.evidence_file_ids) ? (r.evidence_file_ids as string[]) : [])),
    ),
  ];
  const files =
    allFileIds.length > 0
      ? await query<{ id: string; original_name: string; safe_mime: string; size_bytes: string | number }>(
          `SELECT id, original_name, safe_mime, size_bytes FROM files WHERE id = ANY($1::uuid[]) AND state = 'ACTIVE'`,
          [allFileIds],
        )
      : [];
  const fileMap = new Map(
    files.map((f) => [
      f.id,
      { id: f.id, originalName: f.original_name, safeMime: f.safe_mime, sizeBytes: Number(f.size_bytes) },
    ]),
  );

  const reports = rows.map((r) => {
    const fIds = Array.isArray(r.evidence_file_ids) ? (r.evidence_file_ids as string[]) : [];
    return {
      id: r.id,
      reporterId: r.reporter_id,
      reporterName: r.reporter_name,
      reporterRole: r.reporter_role,
      subjectMemberId: r.subject_member_id,
      subjectName: r.subject_name,
      subjectCode: r.subject_code,
      subjectTeams: r.subject_teams ?? "Chưa phân tổ",
      issueSummary: r.issue_summary,
      evidenceText: r.evidence_text,
      evidenceLinks: Array.isArray(r.evidence_links) ? (r.evidence_links as { label: string; url: string }[]) : [],
      evidenceFiles: fIds.map((id) => fileMap.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
      proposedSolution: r.proposed_solution,
      dossierCount: Number(r.dossier_count ?? 0),
      createdAt: new Date(r.created_at).toISOString(),
    };
  });

  // Gom nhóm theo cá nhân để 02.01 / 01.01 / 01.02 dễ trình hồ sơ nhân sự ra Hội đồng điều hành
  const summaryMap = new Map<
    string,
    {
      subjectMemberId: string;
      subjectName: string;
      subjectCode: string;
      subjectTeams: string;
      reportCount: number;
      unlinkedCount: number;
      latestAt: string;
      reportIds: string[];
    }
  >();
  for (const r of reports) {
    const cur = summaryMap.get(r.subjectMemberId) ?? {
      subjectMemberId: r.subjectMemberId,
      subjectName: r.subjectName,
      subjectCode: r.subjectCode,
      subjectTeams: r.subjectTeams,
      reportCount: 0,
      unlinkedCount: 0,
      latestAt: r.createdAt,
      reportIds: [],
    };
    cur.reportCount++;
    if (r.dossierCount === 0) cur.unlinkedCount++;
    if (r.createdAt > cur.latestAt) cur.latestAt = r.createdAt;
    cur.reportIds.push(r.id);
    summaryMap.set(r.subjectMemberId, cur);
  }

  return {
    canViewAll: true,
    canSubmitDossier: can(actor, "conduct.submit_dossier"),
    mySubmittedCount,
    reports,
    subjectSummaries: [...summaryMap.values()].sort((a, b) => b.reportCount - a.reportCount),
  };
}

/**
 * 2. Đánh giá mốc 5 ngày & ngưỡng 2/3 của 1 hồ sơ / tài liệu trình Hội đồng điều hành:
 * - Nếu quá 5 ngày mà tỷ lệ đóng góp >= 2/3 (responded * 3 >= eligible * 2): tự khóa góp ý -> AWAITING_MEETING.
 * - Nếu quá 5 ngày mà < 2/3: chuyển RED_ALERT, gửi cảnh báo đỏ kèm danh sách chính xác các tài khoản 01.01-03.02 chưa góp ý tới 01.01-02.02.
 */
export async function evaluateCouncilItemDeadline(itemId: string, now: Date = new Date(), tx?: DbClient) {
  const run = async (client: DbClient) => {
    const itemRes = await client.query<{
      id: string;
      code: string;
      title: string;
      status: CouncilItemStatus;
      opinion_deadline: Date;
      red_alert_notified_at: Date | null;
    }>(
      `SELECT id, code, title, status, opinion_deadline, red_alert_notified_at FROM council_items WHERE id = $1`,
      [itemId],
    );
    const item = itemRes.rows[0];
    if (!item || item.status === "COMPLETED" || item.status === "AWAITING_MEETING") {
      return { changed: false, status: item?.status ?? null };
    }

    const councilMembers = await getActiveCouncilMembers(client);
    const eligibleCount = councilMembers.length;
    const opsRes = await client.query<{ member_id: string }>(
      `SELECT member_id FROM council_opinions WHERE council_item_id = $1`,
      [itemId],
    );
    const votedSet = new Set(opsRes.rows.map((r) => r.member_id));
    const respondedCount = councilMembers.filter((m) => votedSet.has(m.id)).length;
    const reachedTwoThirds = eligibleCount > 0 && respondedCount * 3 >= eligibleCount * 2;
    const pastDeadline = now.getTime() >= new Date(item.opinion_deadline).getTime();

    if (!pastDeadline) {
      return { changed: false, status: item.status };
    }

    if (reachedTwoThirds) {
      await client.query(
        `UPDATE council_items SET status = 'AWAITING_MEETING', locked_at = COALESCE(locked_at, now()), updated_at = now() WHERE id = $1`,
        [itemId],
      );
      await createNotifications(
        councilMembers.map((m) => m.id),
        {
          eventType: "COUNCIL_OPINIONS_LOCKED",
          targetType: "COUNCIL_ITEM",
          targetId: itemId,
          title: `Hồ sơ ${item.code} đã đủ 2/3 ý kiến & tự khóa chờ họp HĐĐH`,
          message: `"${item.title}" đã đạt ${respondedCount}/${eligibleCount} thành viên HĐĐH góp ý sau 5 ngày và chuyển sang giai đoạn họp kết luận.`,
          link: `/council?item=${itemId}`,
          dedupeKey: `council_locked:${itemId}`,
        },
        client,
      );
      return { changed: true, status: "AWAITING_MEETING" as const };
    }

    // Quá 5 ngày nhưng chưa đạt 2/3 -> RED_ALERT + thông báo cho 01.01 - 02.02 kèm danh sách chưa góp ý
    const missing = councilMembers.filter((m) => !votedSet.has(m.id));
    await client.query(
      `UPDATE council_items
       SET status = 'RED_ALERT',
           red_alert_notified_at = COALESCE(red_alert_notified_at, now()),
           updated_at = now()
       WHERE id = $1`,
      [itemId],
    );

    if (!item.red_alert_notified_at) {
      const boardRows = await client.query<{ id: string }>(
        `SELECT id FROM members
         WHERE access_enabled = true AND activity_status = 'ACTIVE' AND archived_at IS NULL
           AND role IN ${BOARD_SQL_ROLES}`,
      );
      const missingNames = missing.map((m) => m.display_name).join(", ");
      await createNotifications(
        boardRows.rows.map((r) => r.id),
        {
          eventType: "COUNCIL_RED_ALERT",
          targetType: "COUNCIL_ITEM",
          targetId: itemId,
          title: `[CẢNH BÁO ĐỎ] Hồ sơ ${item.code} quá 5 ngày chưa đạt 2/3 ý kiến`,
          message: `"${item.title}" mới có ${respondedCount}/${eligibleCount} ý kiến. Chưa góp ý: ${missingNames || "Không rõ"}.`,
          link: `/council?item=${itemId}`,
          dedupeKey: `council_red_alert:${itemId}`,
        },
        client,
      );
    }

    return { changed: item.status !== "RED_ALERT", status: "RED_ALERT" as const };
  };

  return tx ? run(tx) : withTransaction(run);
}

/** Quét toàn bộ hồ sơ/tài liệu HĐĐH đang mở (dùng trong job runner và khi tải danh sách) */
export async function evaluateAllPendingCouncilItems(now: Date = new Date()): Promise<{ locked: number; redAlerts: number }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM council_items WHERE status IN ('OPEN_FOR_OPINION', 'RED_ALERT') AND opinion_deadline <= $1`,
    [now.toISOString()],
  );
  let locked = 0;
  let redAlerts = 0;
  for (const r of rows) {
    const res = await evaluateCouncilItemDeadline(r.id, now);
    if (res.changed && res.status === "AWAITING_MEETING") locked++;
    if (res.changed && res.status === "RED_ALERT") redAlerts++;
  }
  return { locked, redAlerts };
}

/** Tạo mới Hồ sơ nhân sự (từ Tổ Thẩm tra) hoặc Tài liệu trình Hội đồng điều hành */
export async function createCouncilItem(
  actor: AuthActor,
  input: {
    itemType: CouncilItemType;
    title: string;
    description?: string;
    subjectMemberId?: string;
    inspectorProposal?: string;
    conductReportIds?: string[];
    links?: { label: string; url: string }[];
    fileIds?: string[];
    opinionDeadlineDays?: number;
  },
  requestId?: string,
) {
  requirePermission(actor, "council.access", {}, "Chỉ thành viên Hội đồng điều hành (Bậc 01.01–03.02) mới được trình nội dung.");

  if (input.itemType === "PERSONNEL_DOSSIER") {
    requirePermission(
      actor,
      "conduct.submit_dossier",
      {},
      "Chỉ Bậc 01.01, 01.02 hoặc Bậc 02.01 (Phó Trưởng Ban kiêm Tổ trưởng Tổ Thẩm tra) được trình hồ sơ nhân sự ra HĐĐH.",
    );
    if (!input.subjectMemberId) {
      throw new AppError(400, "SUBJECT_REQUIRED", "Hồ sơ nhân sự bắt buộc chọn thành viên liên quan.");
    }
    if (!input.inspectorProposal?.trim()) {
      throw new AppError(400, "PROPOSAL_REQUIRED", "Vui lòng nhập phương hướng xử lý đề xuất của Tổ Thẩm tra - Giám sát.");
    }
  }

  const cleanTitle = input.title.trim();
  if (cleanTitle.length < 3) {
    throw new AppError(400, "TITLE_REQUIRED", "Tiêu đề hồ sơ/tài liệu tối thiểu 3 ký tự.");
  }

  return withTransaction(async (tx) => {
    let reportIdsToLink: string[] = [];
    if (input.itemType === "PERSONNEL_DOSSIER") {
      if (input.conductReportIds && input.conductReportIds.length > 0) {
        const valid = await tx.query<{ id: string }>(
          `SELECT id FROM conduct_reports WHERE id = ANY($1::uuid[]) AND subject_member_id = $2`,
          [input.conductReportIds, input.subjectMemberId],
        );
        reportIdsToLink = valid.rows.map((r) => r.id);
      } else {
        const allForSubject = await tx.query<{ id: string }>(
          `SELECT id FROM conduct_reports WHERE subject_member_id = $1 ORDER BY created_at ASC`,
          [input.subjectMemberId],
        );
        reportIdsToLink = allForSubject.rows.map((r) => r.id);
      }
      if (reportIdsToLink.length === 0) {
        throw new AppError(
          400,
          "REPORTS_REQUIRED",
          "Thành viên này chưa có phiếu ghi nhận thái độ nào để tổng hợp thành hồ sơ nhân sự.",
        );
      }
    }

    const code = await generateCouncilCode(tx, input.itemType);
    const days = Math.min(14, Math.max(1, input.opinionDeadlineDays ?? 5));
    const deadline = new Date(Date.now() + (days === 5 ? FIVE_DAYS_MS : days * 24 * 3600 * 1000));

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO council_items (
         code, item_type, title, description, subject_member_id, inspector_proposal,
         links, file_ids, submitted_by, opinion_deadline, status
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7::jsonb, $8::jsonb, $9, $10, 'OPEN_FOR_OPINION'
       ) RETURNING id`,
      [
        code,
        input.itemType,
        cleanTitle,
        (input.description ?? "").trim(),
        input.itemType === "PERSONNEL_DOSSIER" ? input.subjectMemberId : null,
        (input.inspectorProposal ?? "").trim(),
        JSON.stringify(input.links ?? []),
        JSON.stringify([...new Set(input.fileIds ?? [])]),
        actor.memberId,
        deadline.toISOString(),
      ],
    );
    const itemId = inserted.rows[0].id;

    for (const rid of reportIdsToLink) {
      await tx.query(
        `INSERT INTO council_item_reports (council_item_id, conduct_report_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [itemId, rid],
      );
    }

    const councilMembers = await getActiveCouncilMembers(tx);
    await createNotifications(
      councilMembers.map((m) => m.id).filter((id) => id !== actor.memberId),
      {
        eventType: "COUNCIL_ITEM_SUBMITTED",
        targetType: "COUNCIL_ITEM",
        targetId: itemId,
        title:
          input.itemType === "PERSONNEL_DOSSIER"
            ? `Hồ sơ nhân sự mới trình HĐĐH: ${code}`
            : `Tài liệu mới trình HĐĐH: ${code}`,
        message: `${actor.displayName} vừa trình "${cleanTitle}". Vui lòng đóng góp ý kiến trong vòng ${days} ngày.`,
        link: `/council?item=${itemId}`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "COUNCIL_ITEM_CREATED",
        targetType: "COUNCIL_ITEM",
        targetId: itemId,
        safeDiff: { code, itemType: input.itemType, linkedReports: reportIdsToLink.length },
        requestId,
      },
      tx,
    );

    return { id: itemId, code, status: "OPEN_FOR_OPINION" as const, opinionDeadline: deadline.toISOString() };
  });
}

/** Danh sách toàn bộ hồ sơ & tài liệu trình Hội đồng điều hành (chỉ 01.01 - 03.02) */
export async function listCouncilItems(actor: AuthActor) {
  requirePermission(actor, "council.access", {}, "Chỉ thành viên Hội đồng điều hành (Bậc 01.01–03.02) được truy cập mục này.");

  await evaluateAllPendingCouncilItems();

  const councilMembers = await getActiveCouncilMembers();
  const eligibleCount = councilMembers.length;
  const eligibleIds = new Set(councilMembers.map((m) => m.id));
  const showMissingVoters = isBoardLeadership(actor.role);

  const items = await query<{
    id: string;
    code: string;
    item_type: CouncilItemType;
    title: string;
    description: string;
    subject_member_id: string | null;
    subject_name: string | null;
    subject_teams: string | null;
    inspector_proposal: string;
    submitted_by: string;
    submitted_by_name: string;
    opinion_deadline: Date;
    status: CouncilItemStatus;
    locked_at: Date | null;
    concluded_at: Date | null;
    concluded_by_name: string | null;
    created_at: Date;
    report_count: string | number;
  }>(
    `SELECT ci.id, ci.code, ci.item_type, ci.title, ci.description,
            ci.subject_member_id, sub.display_name AS subject_name,
            (SELECT string_agg(t.name, ', ' ORDER BY tm.is_primary DESC, t.sort_order ASC)
             FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
             WHERE tm.member_id = ci.subject_member_id AND tm.effective_to IS NULL) AS subject_teams,
            ci.inspector_proposal, ci.submitted_by, subm.display_name AS submitted_by_name,
            ci.opinion_deadline, ci.status, ci.locked_at, ci.concluded_at, conc.display_name AS concluded_by_name,
            ci.created_at,
            (SELECT count(*) FROM council_item_reports cir WHERE cir.council_item_id = ci.id) AS report_count
     FROM council_items ci
     JOIN members subm ON subm.id = ci.submitted_by
     LEFT JOIN members sub ON sub.id = ci.subject_member_id
     LEFT JOIN members conc ON conc.id = ci.concluded_by
     ORDER BY
       CASE ci.status WHEN 'RED_ALERT' THEN 1 WHEN 'OPEN_FOR_OPINION' THEN 2 WHEN 'AWAITING_MEETING' THEN 3 ELSE 4 END,
       ci.created_at DESC
     LIMIT 100`,
  );

  const itemIds = items.map((i) => i.id);
  const opinions =
    itemIds.length > 0
      ? await query<{ council_item_id: string; member_id: string }>(
          `SELECT council_item_id, member_id FROM council_opinions WHERE council_item_id = ANY($1::uuid[])`,
          [itemIds],
        )
      : [];

  const opsByItem = new Map<string, Set<string>>();
  for (const op of opinions) {
    const s = opsByItem.get(op.council_item_id) ?? new Set<string>();
    s.add(op.member_id);
    opsByItem.set(op.council_item_id, s);
  }

  return {
    eligibleCouncilCount: eligibleCount,
    canSubmitDossier: can(actor, "conduct.submit_dossier"),
    canConclude: can(actor, "council.conclude"),
    items: items.map((i) => {
      const votedSet = opsByItem.get(i.id) ?? new Set<string>();
      const respondedCount = [...votedSet].filter((id) => eligibleIds.has(id)).length;
      const missingVoters =
        showMissingVoters && (i.status === "RED_ALERT" || new Date(i.opinion_deadline).getTime() <= Date.now())
          ? councilMembers
              .filter((m) => !votedSet.has(m.id))
              .map((m) => ({ memberId: m.id, memberCode: m.member_code, displayName: m.display_name, role: m.role }))
          : [];
      return {
        id: i.id,
        code: i.code,
        itemType: i.item_type,
        title: i.title,
        description: i.description,
        // Bảo mật: với hồ sơ nhân sự, CHỈ trả tên + tổ (không lộ thông tin cá nhân khác)
        subject: i.subject_member_id
          ? {
              memberId: i.subject_member_id,
              displayName: i.subject_name ?? "",
              teams: i.subject_teams ?? "Chưa phân tổ",
            }
          : null,
        submittedByName: i.submitted_by_name,
        opinionDeadline: new Date(i.opinion_deadline).toISOString(),
        status: i.status,
        hasMyOpinion: votedSet.has(actor.memberId),
        respondedCount,
        eligibleCount,
        quorumThreshold: Math.ceil((eligibleCount * 2) / 3),
        reportCount: Number(i.report_count ?? 0),
        lockedAt: i.locked_at ? new Date(i.locked_at).toISOString() : null,
        concludedAt: i.concluded_at ? new Date(i.concluded_at).toISOString() : null,
        concludedByName: i.concluded_by_name,
        createdAt: new Date(i.created_at).toISOString(),
        missingVoters,
      };
    }),
  };
}

/**
 * Chi tiết 1 hồ sơ / tài liệu trình Hội đồng điều hành:
 * - Quy tắc góp ý mù (blind review): chỉ thấy ý kiến của người khác SAU KHI bản thân đã góp ý, hoặc hồ sơ đã khóa/hoàn tất.
 * - Quy tắc ẩn danh người gửi phiếu ghi nhận thái độ: chỉ 01.01, 01.02, 02.01 thấy tên người gửi; 02.02, 03.01, 03.02 bị lược bỏ hoàn toàn từ server.
 * - Cảnh báo đỏ: trả danh sách đích danh tài khoản chưa góp ý cho Bậc 01.01 - 02.02.
 */
export async function getCouncilItemDetail(actor: AuthActor, itemId: string) {
  requirePermission(actor, "council.access", {}, "Chỉ thành viên Hội đồng điều hành (Bậc 01.01–03.02) được xem hồ sơ này.");

  await evaluateCouncilItemDeadline(itemId);

  const item = await queryOne<{
    id: string;
    code: string;
    item_type: CouncilItemType;
    title: string;
    description: string;
    subject_member_id: string | null;
    subject_name: string | null;
    subject_teams: string | null;
    inspector_proposal: string;
    links: unknown;
    file_ids: unknown;
    submitted_by: string;
    submitted_by_name: string;
    opinion_deadline: Date;
    status: CouncilItemStatus;
    locked_at: Date | null;
    meeting_conclusion: string;
    concluded_by: string | null;
    concluded_by_name: string | null;
    concluded_at: Date | null;
    created_at: Date;
  }>(
    `SELECT ci.*,
            sub.display_name AS subject_name,
            (SELECT string_agg(t.name, ', ' ORDER BY tm.is_primary DESC, t.sort_order ASC)
             FROM team_memberships tm JOIN teams t ON t.id = tm.team_id
             WHERE tm.member_id = ci.subject_member_id AND tm.effective_to IS NULL) AS subject_teams,
            subm.display_name AS submitted_by_name,
            conc.display_name AS concluded_by_name
     FROM council_items ci
     JOIN members subm ON subm.id = ci.submitted_by
     LEFT JOIN members sub ON sub.id = ci.subject_member_id
     LEFT JOIN members conc ON conc.id = ci.concluded_by
     WHERE ci.id = $1`,
    [itemId],
  );
  if (!item) throw new AppError(404, "COUNCIL_ITEM_NOT_FOUND", "Không tìm thấy hồ sơ/tài liệu Hội đồng điều hành.");

  const councilMembers = await getActiveCouncilMembers();
  const eligibleIds = new Set(councilMembers.map((m) => m.id));

  const opinionsRows = await query<{
    id: string;
    member_id: string;
    member_name: string;
    member_role: MemberRole;
    choice: CouncilOpinionChoice;
    opinion_text: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT co.*, m.display_name AS member_name, m.role AS member_role
     FROM council_opinions co
     JOIN members m ON m.id = co.member_id
     WHERE co.council_item_id = $1
     ORDER BY co.created_at ASC`,
    [itemId],
  );

  const myOpinionRow = opinionsRows.find((o) => o.member_id === actor.memberId) ?? null;
  const hasMyOpinion = Boolean(myOpinionRow);
  const isLocked = item.status === "AWAITING_MEETING" || item.status === "COMPLETED";
  const canViewOthersOpinions = hasMyOpinion || isLocked;

  const votedSet = new Set(opinionsRows.map((o) => o.member_id));
  const respondedCount = [...votedSet].filter((id) => eligibleIds.has(id)).length;
  const missingVoters =
    isBoardLeadership(actor.role)
      ? councilMembers
          .filter((m) => !votedSet.has(m.id))
          .map((m) => ({ memberId: m.id, memberCode: m.member_code, displayName: m.display_name, role: m.role }))
      : [];

  // Lấy các phiếu ghi nhận thái độ đính kèm (ẨN DANH người gửi với 02.02 / 03.01 / 03.02!)
  const canSeeReporter = can(actor, "conduct.view_all");
  const linkedReportsRows =
    item.item_type === "PERSONNEL_DOSSIER"
      ? await query<{
          id: string;
          reporter_name: string;
          issue_summary: string;
          evidence_text: string;
          evidence_links: unknown;
          evidence_file_ids: unknown;
          proposed_solution: string;
          created_at: Date;
        }>(
          `SELECT cr.id, rep.display_name AS reporter_name, cr.issue_summary, cr.evidence_text,
                  cr.evidence_links, cr.evidence_file_ids, cr.proposed_solution, cr.created_at
           FROM council_item_reports cir
           JOIN conduct_reports cr ON cr.id = cir.conduct_report_id
           JOIN members rep ON rep.id = cr.reporter_id
           WHERE cir.council_item_id = $1
           ORDER BY cr.created_at ASC`,
          [itemId],
        )
      : [];

  // Gom toàn bộ file đính kèm (cả tài liệu chính và minh chứng phiếu thái độ)
  const docFileIds = Array.isArray(item.file_ids) ? (item.file_ids as string[]) : [];
  const reportFileIds = linkedReportsRows.flatMap((r) =>
    Array.isArray(r.evidence_file_ids) ? (r.evidence_file_ids as string[]) : [],
  );
  const allFileIds = [...new Set([...docFileIds, ...reportFileIds])];
  const fileRows =
    allFileIds.length > 0
      ? await query<{ id: string; original_name: string; safe_mime: string; size_bytes: string | number }>(
          `SELECT id, original_name, safe_mime, size_bytes FROM files WHERE id = ANY($1::uuid[]) AND state = 'ACTIVE'`,
          [allFileIds],
        )
      : [];
  const fileMap = new Map(
    fileRows.map((f) => [
      f.id,
      { id: f.id, originalName: f.original_name, safeMime: f.safe_mime, sizeBytes: Number(f.size_bytes) },
    ]),
  );

  return {
    id: item.id,
    code: item.code,
    itemType: item.item_type,
    title: item.title,
    description: item.description,
    subject: item.subject_member_id
      ? {
          memberId: item.subject_member_id,
          displayName: item.subject_name ?? "",
          teams: item.subject_teams ?? "Chưa phân tổ",
        }
      : null,
    inspectorProposal: item.inspector_proposal,
    links: Array.isArray(item.links) ? (item.links as { label: string; url: string }[]) : [],
    files: docFileIds.map((id) => fileMap.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
    submittedByName: item.submitted_by_name,
    opinionDeadline: new Date(item.opinion_deadline).toISOString(),
    status: item.status,
    lockedAt: item.locked_at ? new Date(item.locked_at).toISOString() : null,
    meetingConclusion: item.meeting_conclusion,
    concludedByName: item.concluded_by_name,
    concludedAt: item.concluded_at ? new Date(item.concluded_at).toISOString() : null,
    createdAt: new Date(item.created_at).toISOString(),
    eligibleCount: councilMembers.length,
    respondedCount,
    quorumThreshold: Math.ceil((councilMembers.length * 2) / 3),
    hasMyOpinion,
    canSubmitOpinion: !isLocked,
    canViewOthersOpinions,
    canConclude: can(actor, "council.conclude") && item.status !== "COMPLETED",
    missingVoters,
    linkedReports: linkedReportsRows.map((r) => {
      const fIds = Array.isArray(r.evidence_file_ids) ? (r.evidence_file_ids as string[]) : [];
      return {
        id: r.id,
        // Chỉ trả tên người gửi cho 01.01, 01.02, 02.01; tuyệt đối ẩn danh với 02.02, 03.01, 03.02
        reporterName: canSeeReporter ? r.reporter_name : null,
        issueSummary: r.issue_summary,
        evidenceText: r.evidence_text,
        evidenceLinks: Array.isArray(r.evidence_links) ? (r.evidence_links as { label: string; url: string }[]) : [],
        evidenceFiles: fIds.map((id) => fileMap.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
        proposedSolution: r.proposed_solution,
        createdAt: new Date(r.created_at).toISOString(),
      };
    }),
    opinions: canViewOthersOpinions
      ? opinionsRows.map((o) => ({
          id: o.id,
          memberId: o.member_id,
          memberName: o.member_name,
          memberRole: o.member_role,
          choice: o.choice,
          opinionText: o.opinion_text,
          createdAt: new Date(o.created_at).toISOString(),
          updatedAt: new Date(o.updated_at).toISOString(),
        }))
      : [],
    myOpinion: myOpinionRow
      ? {
          id: myOpinionRow.id,
          choice: myOpinionRow.choice,
          opinionText: myOpinionRow.opinion_text,
          createdAt: new Date(myOpinionRow.created_at).toISOString(),
        }
      : null,
  };
}

/** Đóng góp ý kiến cho hồ sơ / tài liệu trình Hội đồng điều hành (tự cộng KPI +1) */
export async function submitCouncilOpinion(
  actor: AuthActor,
  itemId: string,
  input: { choice?: CouncilOpinionChoice; opinionText: string },
  requestId?: string,
) {
  requirePermission(actor, "council.access", {}, "Chỉ thành viên Hội đồng điều hành (Bậc 01.01–03.02) được đóng góp ý kiến.");

  const cleanText = input.opinionText.trim();
  if (cleanText.length < 3) {
    throw new AppError(400, "OPINION_REQUIRED", "Vui lòng nhập nội dung góp ý (tối thiểu 3 ký tự).");
  }

  return withTransaction(async (tx) => {
    const itemRes = await tx.query<{ id: string; code: string; item_type: CouncilItemType; status: CouncilItemStatus }>(
      `SELECT id, code, item_type, status FROM council_items WHERE id = $1`,
      [itemId],
    );
    const item = itemRes.rows[0];
    if (!item) throw new AppError(404, "COUNCIL_ITEM_NOT_FOUND", "Không tìm thấy hồ sơ/tài liệu.");
    if (item.status === "AWAITING_MEETING" || item.status === "COMPLETED") {
      throw new AppError(409, "OPINIONS_LOCKED", "Hồ sơ đã khóa góp ý và chuyển sang giai đoạn họp / lưu trữ.");
    }

    let choice: CouncilOpinionChoice = input.choice ?? "COMMENT";
    if (item.item_type === "PERSONNEL_DOSSIER") {
      if (!["AGREE", "DISAGREE", "OTHER"].includes(choice)) {
        throw new AppError(400, "CHOICE_REQUIRED", "Hồ sơ nhân sự bắt buộc chọn: Đồng ý, Không đồng ý hoặc Ý kiến khác.");
      }
    } else {
      choice = "COMMENT";
    }

    await tx.query(
      `INSERT INTO council_opinions (council_item_id, member_id, choice, opinion_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (council_item_id, member_id) DO UPDATE SET
         choice = EXCLUDED.choice,
         opinion_text = EXCLUDED.opinion_text,
         updated_at = now()`,
      [itemId, actor.memberId, choice, cleanText],
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "COUNCIL_OPINION_SUBMITTED",
        targetType: "COUNCIL_ITEM",
        targetId: itemId,
        safeDiff: { code: item.code, choice },
        requestId,
      },
      tx,
    );

    // Nếu đang ở RED_ALERT và vừa đạt đủ 2/3 thì tự động khóa sang AWAITING_MEETING
    const evalResult = await evaluateCouncilItemDeadline(itemId, new Date(), tx);
    return { itemId, choice, status: evalResult.status ?? item.status };
  });
}

/** Bước 03: Trưởng Ban (01.01) hoặc Phó Trưởng Ban kiêm Tổ trưởng Tổ Thẩm tra (02.01) chốt kết luận cuộc họp & lưu trữ vĩnh viễn */
export async function concludeCouncilItem(
  actor: AuthActor,
  itemId: string,
  meetingConclusion: string,
  requestId?: string,
) {
  requirePermission(
    actor,
    "council.conclude",
    {},
    "Chỉ Trưởng Ban (01.01) hoặc Phó Trưởng Ban kiêm Tổ trưởng Tổ Thẩm tra (02.01) mới được chốt kết luận cuộc họp HĐĐH.",
  );

  const cleanConclusion = meetingConclusion.trim();
  if (cleanConclusion.length < 5) {
    throw new AppError(400, "CONCLUSION_REQUIRED", "Vui lòng nhập đầy đủ nội dung kết luận cuộc họp.");
  }

  return withTransaction(async (tx) => {
    const itemRes = await tx.query<{ id: string; code: string; title: string; status: CouncilItemStatus }>(
      `SELECT id, code, title, status FROM council_items WHERE id = $1`,
      [itemId],
    );
    const item = itemRes.rows[0];
    if (!item) throw new AppError(404, "COUNCIL_ITEM_NOT_FOUND", "Không tìm thấy hồ sơ/tài liệu.");
    if (item.status === "COMPLETED") {
      throw new AppError(409, "ALREADY_COMPLETED", "Hồ sơ này đã được chốt kết luận và lưu trữ.");
    }

    await tx.query(
      `UPDATE council_items
       SET status = 'COMPLETED',
           locked_at = COALESCE(locked_at, now()),
           meeting_conclusion = $1,
           concluded_by = $2,
           concluded_at = now(),
           updated_at = now()
       WHERE id = $3`,
      [cleanConclusion, actor.memberId, itemId],
    );

    const councilMembers = await getActiveCouncilMembers(tx);
    await createNotifications(
      councilMembers.map((m) => m.id).filter((id) => id !== actor.memberId),
      {
        eventType: "COUNCIL_ITEM_CONCLUDED",
        targetType: "COUNCIL_ITEM",
        targetId: itemId,
        title: `Đã chốt kết luận HĐĐH: ${item.code}`,
        message: `${actor.displayName} đã cập nhật kết luận cuộc họp và lưu trữ hồ sơ "${item.title}".`,
        link: `/council?item=${itemId}`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "COUNCIL_ITEM_CONCLUDED",
        targetType: "COUNCIL_ITEM",
        targetId: itemId,
        safeDiff: { code: item.code },
        requestId,
      },
      tx,
    );

    return { id: itemId, status: "COMPLETED" as const };
  });
}
