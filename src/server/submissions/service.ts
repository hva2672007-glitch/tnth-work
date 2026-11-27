import { query, queryOne, withTransaction } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { can, isBoardLeadership, isCouncilRole, requirePermission } from "@/server/authorization/policy";
import { recomputeMissionStatus, recomputeTaskStatus } from "@/server/missions/workflow";
import { writeActivity, writeAudit } from "@/server/audit/service";
import { createNotifications } from "@/server/notifications/service";
import { AppError } from "@/server/errors";
import { classifyTimeliness } from "@/lib/date";
import { MAX_REVISION_RETURNS, type SubmissionMode } from "@/lib/constants";

function validateHttpUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, "INVALID_URL", `Đường dẫn không hợp lệ: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "INVALID_URL_PROTOCOL", "Đường dẫn chỉ chấp nhận http:// hoặc https://");
  }
  return parsed.toString();
}

/** Nộp hoặc nộp lại sản phẩm cho 1 task (hỗ trợ LINK / FILE / FOLDER / TEXT / MIXED, nộp riêng & nộp chung) */
export async function submitTaskProduct(
  actor: AuthActor,
  taskId: string,
  input: {
    submissionType?: "LINK" | "FILE" | "FOLDER" | "TEXT" | "MIXED";
    note?: string;
    textContent?: string;
    links?: { label: string; url: string; kind?: "LINK" | "FOLDER" }[];
    fileIds?: string[];
    contributorAssignmentIds?: string[];
  },
  requestId?: string,
) {
  const cleanLinks = (input.links ?? []).map((l) => ({
    label: l.label?.trim() || "Liên kết sản phẩm",
    url: validateHttpUrl(l.url),
    kind: l.kind ?? "LINK",
  }));
  const fileIds = [...new Set(input.fileIds ?? [])];

  return withTransaction(async (tx) => {
    const taskRes = await tx.query<{
      id: string;
      code: string;
      title: string;
      mission_id: string;
      mission_code: string;
      owner_team_id: string;
      owner_id: string;
      reviewer_id: string | null;
      submission_mode: SubmissionMode;
      requires_artifact: boolean;
      status: string;
    }>(
      `SELECT t.*, m.code AS mission_code
       FROM tasks t JOIN missions m ON m.id = t.mission_id
       WHERE t.id = $1`,
      [taskId],
    );
    const task = taskRes.rows[0];
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Không tìm thấy task.");
    if (["DRAFT", "ON_HOLD", "CANCELLED", "COMPLETED"].includes(task.status)) {
      throw new AppError(409, "INVALID_TASK_STATE", "Task hiện không ở trạng thái cho phép nộp sản phẩm.");
    }

    // Kiểm tra người dùng có assignment hợp lệ đang thực hiện hoặc cần sửa
    const myAssRes = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM task_assignments
       WHERE task_id = $1 AND member_id = $2 AND status IN ('ACCEPTED', 'REVISION_REQUIRED', 'SUBMITTED')`,
      [taskId, actor.memberId],
    );
    const myAssignment = myAssRes.rows[0];
    if (!myAssignment) {
      throw new AppError(403, "NOT_ACCEPTED_ASSIGNEE", "Bạn cần bấm Nhận việc trước khi nộp sản phẩm cho task này.");
    }

    const hasArtifact = cleanLinks.length > 0 || fileIds.length > 0 || Boolean(input.textContent?.trim());
    if (task.requires_artifact && !hasArtifact) {
      throw new AppError(400, "ARTIFACT_REQUIRED", "Vui lòng đính kèm ít nhất 01 link sản phẩm, tệp, thư mục hoặc nội dung xác nhận.");
    }

    // Xác minh fileIds thuộc quyền người upload
    if (fileIds.length > 0) {
      const fRows = await tx.query<{ id: string; uploader_id: string }>(
        `SELECT id, uploader_id FROM files WHERE id = ANY($1::uuid[]) AND state = 'ACTIVE'`,
        [fileIds],
      );
      if (fRows.rows.length !== fileIds.length) {
        throw new AppError(400, "FILE_NOT_FOUND", "Một số tệp đính kèm không tồn tại.");
      }
      if (fRows.rows.some((f) => f.uploader_id !== actor.memberId)) {
        throw new AppError(403, "FILE_OWNERSHIP_ERROR", "Bạn chỉ có thể gắn các tệp do chính mình tải lên.");
      }
    }

    // Tạo hoặc lấy bản ghi submissions
    const subLookup =
      task.submission_mode === "SHARED"
        ? await tx.query<{ id: string; current_version: number }>(
            `SELECT id, current_version FROM submissions WHERE task_id = $1 AND assignment_id IS NULL LIMIT 1`,
            [taskId],
          )
        : await tx.query<{ id: string; current_version: number }>(
            `SELECT id, current_version FROM submissions WHERE task_id = $1 AND assignment_id = $2 LIMIT 1`,
            [taskId, myAssignment.id],
          );

    let submissionId: string;
    let nextVersionNo: number;
    if (subLookup.rows[0]) {
      submissionId = subLookup.rows[0].id;
      nextVersionNo = subLookup.rows[0].current_version + 1;
      // Đánh dấu version SUBMITTED cũ (nếu có) thành SUPERSEDED
      await tx.query(
        `UPDATE submission_versions SET state = 'SUPERSEDED' WHERE submission_id = $1 AND state = 'SUBMITTED'`,
        [submissionId],
      );
      await tx.query(`UPDATE submissions SET current_version = $1, updated_at = now() WHERE id = $2`, [nextVersionNo, submissionId]);
    } else {
      nextVersionNo = 1;
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO submissions (task_id, assignment_id, submitter_id, current_version)
         VALUES ($1, $2, $3, 1) RETURNING id`,
        [taskId, task.submission_mode === "SHARED" ? null : myAssignment.id, actor.memberId],
      );
      submissionId = ins.rows[0].id;
    }

    const inferredType =
      input.submissionType ??
      (fileIds.length > 0 && cleanLinks.length > 0
        ? "MIXED"
        : fileIds.length > 0
          ? "FILE"
          : cleanLinks.some((l) => l.kind === "FOLDER")
            ? "FOLDER"
            : cleanLinks.length > 0
              ? "LINK"
              : "TEXT");

    const verIns = await tx.query<{ id: string; submitted_at: Date }>(
      `INSERT INTO submission_versions (submission_id, version_no, submission_type, note, text_content, links, submitted_by, state)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'SUBMITTED')
       RETURNING id, submitted_at`,
      [
        submissionId,
        nextVersionNo,
        inferredType,
        (input.note ?? "").trim(),
        (input.textContent ?? "").trim(),
        JSON.stringify(cleanLinks),
        actor.memberId,
      ],
    );
    const versionId = verIns.rows[0].id;
    const submittedAtIso = new Date(verIns.rows[0].submitted_at).toISOString();

    for (const fid of fileIds) {
      await tx.query(
        `INSERT INTO file_links (file_id, submission_version_id) VALUES ($1, $2)`,
        [fid, versionId],
      );
    }

    // Xác định danh sách assignment đóng góp (nộp riêng = chính mình; nộp chung = những người đã nhận việc được chọn)
    let targetAssignmentIds: string[] = [myAssignment.id];
    if (task.submission_mode === "SHARED") {
      const acceptedRows = await tx.query<{ id: string }>(
        `SELECT id FROM task_assignments WHERE task_id = $1 AND status IN ('ACCEPTED', 'REVISION_REQUIRED', 'SUBMITTED')`,
        [taskId],
      );
      const acceptedSet = new Set(acceptedRows.rows.map((r) => r.id));
      const requested = input.contributorAssignmentIds?.filter((id) => acceptedSet.has(id)) ?? [];
      targetAssignmentIds = requested.length > 0 ? [...new Set([myAssignment.id, ...requested])] : [...acceptedSet];
    }

    for (const aid of targetAssignmentIds) {
      await tx.query(
        `INSERT INTO submission_contributors (submission_version_id, assignment_id, review_confirmed)
         VALUES ($1, $2, false) ON CONFLICT DO NOTHING`,
        [versionId, aid],
      );
      await tx.query(
        `UPDATE task_assignments SET status = 'SUBMITTED', submitted_at = $1, updated_at = now() WHERE id = $2`,
        [submittedAtIso, aid],
      );
    }

    await recomputeTaskStatus(taskId, tx);

    // Thông báo reviewer và trưởng tổ phụ trách
    const teamLeads = await tx.query<{ member_id: string }>(
      `SELECT member_id FROM team_memberships WHERE team_id = $1 AND effective_to IS NULL AND team_title IN ('LEADER', 'DEPUTY_LEADER')`,
      [task.owner_team_id],
    );
    const recipients = [task.reviewer_id, task.owner_id, ...teamLeads.rows.map((r) => r.member_id)].filter(
      (id): id is string => Boolean(id) && id !== actor.memberId,
    );
    await createNotifications(
      recipients,
      {
        eventType: "PRODUCT_SUBMITTED",
        targetType: "MISSION",
        targetId: task.mission_id,
        title: `Có sản phẩm mới cần nghiệm thu (${task.code} v${nextVersionNo})`,
        message: `${actor.displayName} đã nộp sản phẩm phiên bản v${nextVersionNo} cho task "${task.title}".`,
        link: `/missions/${task.mission_id}`,
      },
      tx,
    );

    await writeActivity(
      {
        missionId: task.mission_id,
        taskId,
        assignmentId: myAssignment.id,
        actorId: actor.memberId,
        action: "PRODUCT_SUBMITTED",
        summary: `${actor.displayName} đã nộp sản phẩm v${nextVersionNo} cho task "${task.title}".`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "PRODUCT_SUBMITTED",
        targetType: "SUBMISSION_VERSION",
        targetId: versionId,
        safeDiff: { taskId, versionNo: nextVersionNo, fileCount: fileIds.length, linkCount: cleanLinks.length },
        requestId,
      },
      tx,
    );

    return {
      submissionId,
      versionId,
      versionNo: nextVersionNo,
      submittedAt: submittedAtIso,
      state: "SUBMITTED",
    };
  });
}

/** Nghiệm thu sản phẩm (approve hoặc request-revision) cho một phiên bản cụ thể */
export async function reviewSubmissionVersion(
  actor: AuthActor,
  versionId: string,
  decision: "APPROVED" | "REVISION_REQUIRED",
  input: { note?: string; overrideReason?: string; confirmedContributorIds?: string[] },
  requestId?: string,
) {
  if (decision === "REVISION_REQUIRED" && !input.note?.trim()) {
    throw new AppError(400, "NOTE_REQUIRED", "Khi yêu cầu chỉnh sửa bắt buộc ghi rõ nhận xét.");
  }

  return withTransaction(async (tx) => {
    const verRes = await tx.query<{
      version_id: string;
      version_no: number;
      state: string;
      submitted_at: Date;
      submitted_by: string;
      submission_id: string;
      task_id: string;
      task_code: string;
      task_title: string;
      mission_id: string;
      owner_team_id: string;
      reviewer_id: string | null;
      submission_mode: SubmissionMode;
    }>(
      `SELECT sv.id AS version_id, sv.version_no, sv.state, sv.submitted_at, sv.submitted_by,
              s.id AS submission_id, t.id AS task_id, t.code AS task_code, t.title AS task_title,
              t.mission_id, t.owner_team_id, t.reviewer_id, t.submission_mode
       FROM submission_versions sv
       JOIN submissions s ON s.id = sv.submission_id
       JOIN tasks t ON t.id = s.task_id
       WHERE sv.id = $1`,
      [versionId],
    );
    const v = verRes.rows[0];
    if (!v) throw new AppError(404, "SUBMISSION_VERSION_NOT_FOUND", "Không tìm thấy phiên bản sản phẩm.");

    // Chặn tự duyệt sản phẩm của chính mình (mục 5.3)
    if (v.submitted_by === actor.memberId) {
      throw new AppError(403, "SELF_REVIEW_FORBIDDEN", "Người nộp sản phẩm không được tự nghiệm thu sản phẩm của chính mình.");
    }

    requirePermission(
      actor,
      "task.review",
      {
        ownerTeamId: v.owner_team_id,
        taskReviewerId: v.reviewer_id,
        taskSubmitterId: v.submitted_by,
      },
      "Bạn không thuộc lãnh đạo tổ phụ trách hoặc không có thẩm quyền nghiệm thu task này.",
    );

    if (v.state !== "SUBMITTED") {
      throw new AppError(409, "ALREADY_REVIEWED", "Phiên bản sản phẩm này đã được xử lý trước đó.");
    }

    // Kiểm tra xem có phải cấp Ban duyệt thay lãnh đạo tổ hay không
    const isDefaultTeamReviewer = actor.leadTeamIds.includes(v.owner_team_id) || v.reviewer_id === actor.memberId;
    const overrideReason = !isDefaultTeamReviewer ? (input.overrideReason?.trim() || "Duyệt thay theo thẩm quyền Ban Biên tập") : null;

    // Ghi review (unique constraint trên submission_version_id chống double review do race condition)
    const revIns = await tx.query<{ id: string; reviewed_at: Date }>(
      `INSERT INTO reviews (submission_version_id, reviewer_id, decision, note, override_reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, reviewed_at`,
      [versionId, actor.memberId, decision, (input.note ?? "").trim(), overrideReason],
    );
    const reviewedAtIso = new Date(revIns.rows[0].reviewed_at).toISOString();

    await tx.query(`UPDATE submission_versions SET state = $1 WHERE id = $2`, [decision, versionId]);

    const contribRows = await tx.query<{ assignment_id: string; member_id: string; original_deadline: Date; revision_count: number }>(
      `SELECT sc.assignment_id, ta.member_id, ta.original_deadline, ta.revision_count
       FROM submission_contributors sc
       JOIN task_assignments ta ON ta.id = sc.assignment_id
       WHERE sc.submission_version_id = $1`,
      [versionId],
    );

    const confirmedSet =
      input.confirmedContributorIds && input.confirmedContributorIds.length > 0
        ? new Set(input.confirmedContributorIds)
        : new Set(contribRows.rows.map((c) => c.assignment_id));

    const notifiedMembers: string[] = [];
    let exceededMaxReturns = false;

    for (const c of contribRows.rows) {
      notifiedMembers.push(c.member_id);
      if (decision === "APPROVED") {
        if (confirmedSet.has(c.assignment_id)) {
          const lateOriginal = classifyTimeliness(v.submitted_at, c.original_deadline) === "LATE";
          await tx.query(
            `UPDATE submission_contributors SET review_confirmed = true WHERE submission_version_id = $1 AND assignment_id = $2`,
            [versionId, c.assignment_id],
          );
          // Lưu effective_submitted_at = thời điểm nộp của phiên bản được duyệt (KHÔNG dùng reviewed_at!)
          await tx.query(
            `UPDATE task_assignments
             SET status = 'COMPLETED',
                 effective_submitted_at = $1,
                 reviewed_at = $2,
                 late_against_original_deadline = $3,
                 needs_reassignment = false,
                 version = version + 1,
                 updated_at = now()
             WHERE id = $4`,
            [new Date(v.submitted_at).toISOString(), reviewedAtIso, lateOriginal, c.assignment_id],
          );
        }
      } else {
        // Quy tắc Bước 06 mới: tối đa 02 lần trả lại; sau 02 lần vẫn không đạt → đánh dấu cần quay lại Bước 01 phân công lại!
        const nextRevCount = Number(c.revision_count ?? 0) + 1;
        const needsReassign = nextRevCount >= MAX_REVISION_RETURNS;
        if (needsReassign) exceededMaxReturns = true;
        await tx.query(
          `UPDATE task_assignments
           SET status = 'REVISION_REQUIRED',
               revision_count = $1,
               needs_reassignment = $2,
               reviewed_at = $3,
               version = version + 1,
               updated_at = now()
           WHERE id = $4`,
          [nextRevCount, needsReassign, reviewedAtIso, c.assignment_id],
        );
      }
    }

    await recomputeTaskStatus(v.task_id, tx);

    if (exceededMaxReturns) {
      const managers = await tx.query<{ member_id: string }>(
        `SELECT tm.member_id FROM team_memberships tm
         JOIN members m ON m.id = tm.member_id
         WHERE tm.team_id = $1 AND tm.effective_to IS NULL
           AND tm.team_title IN ('LEADER', 'DEPUTY_LEADER')
           AND m.access_enabled = true AND m.activity_status = 'ACTIVE'`,
        [v.owner_team_id],
      );
      const missionOwner = await tx.query<{ owner_id: string }>(`SELECT owner_id FROM missions WHERE id = $1`, [v.mission_id]);
      const alertRecipients = [
        ...new Set([
          ...managers.rows.map((r) => r.member_id),
          ...(missionOwner.rows[0] ? [missionOwner.rows[0].owner_id] : []),
        ]),
      ];
      await createNotifications(
        alertRecipients,
        {
          eventType: "REVISION_LIMIT_REACHED",
          targetType: "MISSION",
          targetId: v.mission_id,
          title: `Cảnh báo: ${v.task_code} đã trả lại ${MAX_REVISION_RETURNS} lần — cần phân công lại`,
          message: `Sản phẩm task "${v.task_title}" đã bị trả lại ${MAX_REVISION_RETURNS} lần nhưng vẫn chưa đạt yêu cầu. Theo quy trình Bước 06, vui lòng xem xét quay lại Bước 01 để phân công/chuyển giao lại.`,
          link: `/missions/${v.mission_id}`,
        },
        tx,
      );
    }

    await createNotifications(
      notifiedMembers,
      {
        eventType: decision === "APPROVED" ? "SUBMISSION_APPROVED" : "SUBMISSION_REVISION_REQUIRED",
        targetType: "MISSION",
        targetId: v.mission_id,
        title:
          decision === "APPROVED"
            ? `Sản phẩm ${v.task_code} v${v.version_no} đã được nghiệm thu`
            : `Sản phẩm ${v.task_code} v${v.version_no} cần chỉnh sửa`,
        message:
          decision === "APPROVED"
            ? `${actor.displayName} đã phê duyệt sản phẩm task "${v.task_title}".`
            : `${actor.displayName} yêu cầu chỉnh sửa: ${input.note!.trim()}`,
        link: `/missions/${v.mission_id}`,
      },
      tx,
    );

    await writeActivity(
      {
        missionId: v.mission_id,
        taskId: v.task_id,
        actorId: actor.memberId,
        action: decision === "APPROVED" ? "SUBMISSION_APPROVED" : "SUBMISSION_REVISION_REQUIRED",
        summary:
          decision === "APPROVED"
            ? `${actor.displayName} đã nghiệm thu hoàn thành sản phẩm v${v.version_no} của task "${v.task_title}".`
            : `${actor.displayName} yêu cầu sửa sản phẩm v${v.version_no} (${input.note!.trim()}).`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: decision === "APPROVED" ? "SUBMISSION_APPROVED" : "SUBMISSION_REVISION_REQUIRED",
        targetType: "SUBMISSION_VERSION",
        targetId: versionId,
        safeDiff: { decision, overrideReason, taskId: v.task_id },
        requestId,
      },
      tx,
    );

    return {
      reviewId: revIns.rows[0].id,
      versionId,
      decision,
      reviewedAt: reviewedAtIso,
    };
  });
}

/** Thêm link đăng tải hoặc xác nhận hoàn tất kênh đăng tải */
export async function addPublicationLink(
  actor: AuthActor,
  missionId: string,
  input: {
    requirementId?: string;
    channelId?: string;
    customChannelName?: string;
    url: string;
    title?: string;
    postedAt?: string;
    note?: string;
    confirmChannel?: boolean;
  },
  requestId?: string,
) {
  const safeUrl = validateHttpUrl(input.url);

  return withTransaction(async (tx) => {
    const mRes = await tx.query<{ id: string; code: string; creator_id: string; owner_id: string }>(
      `SELECT id, code, creator_id, owner_id FROM missions WHERE id = $1`,
      [missionId],
    );
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

    const teams = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [missionId]);
    const participants = await tx.query<{ member_id: string }>(
      `SELECT DISTINCT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.mission_id = $1`,
      [missionId],
    );

    const policyRes = {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teams.rows.map((t) => t.team_id),
      missionParticipantIds: participants.rows.map((p) => p.member_id),
    };
    requirePermission(actor, "mission.view", policyRes, "Bạn không có quyền cập nhật link đăng tải cho nhiệm vụ này.");

    let reqId = input.requirementId;
    if (!reqId) {
      if (!input.channelId) {
        throw new AppError(400, "CHANNEL_REQUIRED", "Vui lòng chọn kênh đăng tải.");
      }
      const existingReq = await tx.query<{ id: string }>(
        `SELECT id FROM mission_publication_requirements WHERE mission_id = $1 AND channel_id = $2 AND COALESCE(custom_channel_name, '') = COALESCE($3, '')`,
        [missionId, input.channelId, input.customChannelName?.trim() || null],
      );
      if (existingReq.rows[0]) {
        reqId = existingReq.rows[0].id;
      } else {
        const ins = await tx.query<{ id: string }>(
          `INSERT INTO mission_publication_requirements (mission_id, channel_id, custom_channel_name, required, required_count)
           VALUES ($1, $2, $3, true, 1) RETURNING id`,
          [missionId, input.channelId, input.customChannelName?.trim() || null],
        );
        reqId = ins.rows[0].id;
      }
    }

    const linkIns = await tx.query<{ id: string }>(
      `INSERT INTO publication_links (requirement_id, url, title, posted_at, created_by, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        reqId,
        safeUrl,
        (input.title ?? "").trim(),
        input.postedAt ? new Date(input.postedAt).toISOString() : null,
        actor.memberId,
        (input.note ?? "").trim(),
      ],
    );

    // Chỉ cấp quản trị (01/02/03) mới được xác nhận hoàn tất kênh; bậc 04 chỉ nhập link
    if (input.confirmChannel && can(actor, "mission.manage", policyRes)) {
      await tx.query(
        `UPDATE mission_publication_requirements SET confirmed_by = $1, confirmed_at = now() WHERE id = $2`,
        [actor.memberId, reqId],
      );
    }

    await recomputeMissionStatus(missionId, tx);

    await writeActivity(
      {
        missionId,
        actorId: actor.memberId,
        action: "PUBLICATION_LINK_ADDED",
        summary: `${actor.displayName} đã cập nhật link đăng tải cho nhiệm vụ ${mission.code}.`,
      },
      tx,
    );
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "PUBLICATION_LINK_ADDED",
        targetType: "MISSION",
        targetId: missionId,
        safeDiff: { requirementId: reqId, url: safeUrl, confirmed: Boolean(input.confirmChannel) },
        requestId,
      },
      tx,
    );

    return { linkId: linkIns.rows[0].id, requirementId: reqId };
  });
}

export async function confirmPublicationRequirement(actor: AuthActor, requirementId: string, requestId?: string) {
  return withTransaction(async (tx) => {
    const r = await tx.query<{
      id: string;
      mission_id: string;
      required_count: number;
      creator_id: string;
      owner_id: string;
      link_count: string | number;
    }>(
      `SELECT r.id, r.mission_id, r.required_count, m.creator_id, m.owner_id,
              (SELECT count(*) FROM publication_links pl WHERE pl.requirement_id = r.id AND pl.active = true) AS link_count
       FROM mission_publication_requirements r
       JOIN missions m ON m.id = r.mission_id
       WHERE r.id = $1`,
      [requirementId],
    );
    const req = r.rows[0];
    if (!req) throw new AppError(404, "PUBLICATION_REQ_NOT_FOUND", "Không tìm thấy yêu cầu kênh đăng tải.");

    const teams = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [req.mission_id]);
    requirePermission(actor, "mission.manage", {
      missionCreatorId: req.creator_id,
      missionOwnerId: req.owner_id,
      missionTeamIds: teams.rows.map((t) => t.team_id),
    });

    if (Number(req.link_count) < req.required_count) {
      throw new AppError(400, "LINKS_INSUFFICIENT", `Cần ít nhất ${req.required_count} đường dẫn bài đăng trước khi xác nhận kênh.`);
    }

    await tx.query(
      `UPDATE mission_publication_requirements SET confirmed_by = $1, confirmed_at = now() WHERE id = $2`,
      [actor.memberId, requirementId],
    );
    await recomputeMissionStatus(req.mission_id, tx);

    await writeAudit(
      { actorId: actor.memberId, action: "PUBLICATION_CONFIRMED", targetType: "PUBLICATION_REQ", targetId: requirementId, requestId },
      tx,
    );
    return { requirementId, confirmed: true };
  });
}

/** Thêm bình luận theo mission/task (có hỗ trợ @username mention) */
export async function addMissionComment(
  actor: AuthActor,
  missionId: string,
  input: { taskId?: string | null; body: string },
) {
  const body = input.body.trim();
  if (!body) throw new AppError(400, "EMPTY_COMMENT", "Nội dung trao đổi không được để trống.");

  return withTransaction(async (tx) => {
    const mRes = await tx.query<{ id: string; code: string; creator_id: string; owner_id: string }>(
      `SELECT id, code, creator_id, owner_id FROM missions WHERE id = $1`,
      [missionId],
    );
    const mission = mRes.rows[0];
    if (!mission) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy nhiệm vụ.");

    const teams = await tx.query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [missionId]);
    const participants = await tx.query<{ member_id: string }>(
      `SELECT DISTINCT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.mission_id = $1`,
      [missionId],
    );
    requirePermission(actor, "mission.view", {
      missionCreatorId: mission.creator_id,
      missionOwnerId: mission.owner_id,
      missionTeamIds: teams.rows.map((t) => t.team_id),
      missionParticipantIds: participants.rows.map((p) => p.member_id),
    });

    // Tìm @username được nhắc tới
    const mentionMatches = [...body.matchAll(/@([a-zA-Z0-9._-]+)/g)].map((m) => m[1].toLowerCase());
    const mentionedIds: string[] = [];
    if (mentionMatches.length > 0) {
      const mRows = await tx.query<{ id: string }>(
        `SELECT id FROM members WHERE lower(username) = ANY($1::text[]) AND access_enabled = true`,
        [mentionMatches],
      );
      for (const r of mRows.rows) {
        if (r.id !== actor.memberId) mentionedIds.push(r.id);
      }
    }

    const ins = await tx.query<{ id: string; created_at: Date }>(
      `INSERT INTO comments (mission_id, task_id, author_id, body, mentions)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, created_at`,
      [missionId, input.taskId ?? null, actor.memberId, body, JSON.stringify(mentionedIds)],
    );

    if (mentionedIds.length > 0) {
      await createNotifications(
        mentionedIds,
        {
          eventType: "COMMENT_MENTION",
          targetType: "MISSION",
          targetId: missionId,
          title: `${actor.displayName} đã nhắc đến bạn (${mission.code})`,
          message: body.slice(0, 140),
          link: `/missions/${missionId}`,
        },
        tx,
      );
    }

    return {
      id: ins.rows[0].id,
      missionId,
      taskId: input.taskId ?? null,
      authorId: actor.memberId,
      authorName: actor.displayName,
      body,
      createdAt: new Date(ins.rows[0].created_at).toISOString(),
    };
  });
}

/** Kiểm tra object-level authorization trước khi cho tải file nội bộ (mục 8.3 & SUB-04) */
export async function assertCanAccessFile(actor: AuthActor, fileId: string) {
  const file = await queryOne<{
    id: string;
    private_storage_key: string;
    original_name: string;
    safe_mime: string;
    size_bytes: string | number;
    uploader_id: string;
    purpose: string;
    state: string;
  }>(`SELECT * FROM files WHERE id = $1 AND state = 'ACTIVE'`, [fileId]);
  if (!file) throw new AppError(404, "FILE_NOT_FOUND", "Không tìm thấy tệp.");

  // Bậc 06 (OBSERVER - Chuyên viên TW Đoàn): CHỈ được tải sản phẩm CUỐI CÙNG (APPROVED) của nhiệm vụ ĐÃ HOÀN THÀNH
  if (actor.role === "OBSERVER") {
    const okObs = await queryOne<{ id: string }>(
      `SELECT m.id
       FROM file_links fl
       JOIN submission_versions sv ON sv.id = fl.submission_version_id AND sv.state = 'APPROVED'
       JOIN submissions s ON s.id = sv.submission_id
       JOIN tasks t ON t.id = s.task_id
       JOIN missions m ON m.id = t.mission_id AND m.status = 'COMPLETED'
       WHERE fl.file_id = $1
       LIMIT 1`,
      [fileId],
    );
    if (okObs) return file;
    throw new AppError(403, "FILE_ACCESS_DENIED", "Tài khoản Bậc 06 chỉ được tải sản phẩm cuối cùng của nhiệm vụ đã hoàn thành.");
  }

  // Người upload luôn xem được file của mình (ngoại trừ phiếu ghi nhận thái độ bị ẩn sau khi gửi đối với 02.02/03/04!)
  if (file.uploader_id === actor.memberId && file.purpose !== "CONDUCT_EVIDENCE") {
    return file;
  }

  // Ảnh đại diện, quy chế đã ban hành hoặc Kho Data đồ họa: mọi thành viên 01.01 - 05 được xem
  if (file.purpose === "AVATAR" || file.purpose === "REGULATION" || file.purpose === "GRAPHIC_ASSET") {
    return file;
  }

  // Tài liệu trình Hội đồng điều hành: chỉ Bậc 01.01 - 03.02
  if (file.purpose === "COUNCIL_DOCUMENT") {
    if (isCouncilRole(actor.role)) return file;
    throw new AppError(403, "FILE_ACCESS_DENIED", "Chỉ thành viên Hội đồng điều hành (Bậc 01.01 – 03.02) được truy cập tài liệu này.");
  }

  // Minh chứng phiếu ghi nhận thái độ: 01.01/01.02/02.01 xem toàn bộ; 02.02/03.01/03.02 chỉ xem khi đã trình ra HĐĐH
  if (file.purpose === "CONDUCT_EVIDENCE") {
    if (can(actor, "conduct.view_all")) return file;
    if (isCouncilRole(actor.role)) {
      const inDossier = await queryOne<{ council_item_id: string }>(
        `SELECT cir.council_item_id
         FROM council_item_reports cir
         JOIN conduct_reports cr ON cr.id = cir.conduct_report_id
         WHERE cr.evidence_file_ids @> $1::jsonb
         LIMIT 1`,
        [JSON.stringify([fileId])],
      );
      if (inDossier) return file;
    }
    throw new AppError(403, "FILE_ACCESS_DENIED", "Bạn không có quyền xem minh chứng phiếu ghi nhận thái độ này.");
  }

  // File ý tưởng / sáng kiến chủ động: cấp duyệt 01.01 - 03.02 hoặc người tham gia
  if (file.purpose === "INITIATIVE") {
    if (isCouncilRole(actor.role)) return file;
    const isPart = await queryOne<{ id: string }>(
      `SELECT i.id
       FROM initiatives i
       LEFT JOIN initiative_participants ip ON ip.initiative_id = i.id AND ip.member_id = $2
       WHERE i.file_ids @> $1::jsonb
         AND (i.submitted_by = $2 OR i.lead_member_id = $2 OR ip.member_id IS NOT NULL)
       LIMIT 1`,
      [JSON.stringify([fileId]), actor.memberId],
    );
    if (isPart) return file;
    throw new AppError(403, "FILE_ACCESS_DENIED", "Bạn không có quyền truy cập tệp sáng kiến này.");
  }

  // Ban lãnh đạo (01.01, 01.02, 02.01, 02.02) có phạm vi toàn Ban đối với tệp nhiệm vụ
  if (isBoardLeadership(actor.role)) {
    return file;
  }

  // Tìm mission liên quan qua file_links (kể cả submission_version, task, mission, comment)
  const missionRows = await query<{ mission_id: string; creator_id: string; owner_id: string }>(
    `SELECT DISTINCT m.id AS mission_id, m.creator_id, m.owner_id
     FROM file_links fl
     LEFT JOIN submission_versions sv ON sv.id = fl.submission_version_id
     LEFT JOIN submissions s ON s.id = sv.submission_id
     LEFT JOIN tasks t ON t.id = COALESCE(fl.task_id, s.task_id)
     LEFT JOIN comments c ON c.id = fl.comment_id
     JOIN missions m ON m.id = COALESCE(fl.mission_id, t.mission_id, c.mission_id)
     WHERE fl.file_id = $1`,
    [fileId],
  );

  for (const m of missionRows) {
    const teams = await query<{ team_id: string }>("SELECT team_id FROM mission_teams WHERE mission_id = $1", [m.mission_id]);
    const participants = await query<{ member_id: string }>(
      `SELECT DISTINCT member_id FROM (
         SELECT ta.member_id FROM task_assignments ta JOIN tasks t ON t.id = ta.task_id WHERE t.mission_id = $1
         UNION
         SELECT ts.member_id FROM task_supervisors ts JOIN tasks t ON t.id = ts.task_id WHERE t.mission_id = $1
         UNION
         SELECT t.owner_id FROM tasks t WHERE t.mission_id = $1
         UNION
         SELECT t.reviewer_id FROM tasks t WHERE t.mission_id = $1 AND t.reviewer_id IS NOT NULL
       ) p`,
      [m.mission_id],
    );
    if (
      can(actor, "mission.view", {
        missionCreatorId: m.creator_id,
        missionOwnerId: m.owner_id,
        missionTeamIds: teams.map((t) => t.team_id),
        missionParticipantIds: participants.map((p) => p.member_id),
      })
    ) {
      return file;
    }
  }

  throw new AppError(403, "FILE_ACCESS_DENIED", "Bạn không có quyền truy cập tệp nội bộ này.");
}
