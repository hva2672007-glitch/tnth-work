import { query, queryOne, withTransaction, type DbClient } from "@/server/db";
import type { AuthActor } from "@/server/auth/session";
import { can, isManagerRole, requirePermission } from "@/server/authorization/policy";
import { writeAudit } from "@/server/audit/service";
import { createNotification, createNotifications } from "@/server/notifications/service";
import { AppError } from "@/server/errors";

export type InitiativeKind = "IDEA" | "INITIATIVE" | "PRODUCT";
export type GraphicCategory = "LOGO" | "FRAME" | "TEMPLATE" | "BRAND_GUIDELINE" | "FONT" | "ICON" | "OTHER";

async function generateInitiativeCode(tx: DbClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `SK-${year}-`;
  const row = await tx.query<{ code: string }>(
    `SELECT code FROM initiatives WHERE code LIKE $1 ORDER BY code DESC LIMIT 1`,
    [`${prefix}%`],
  );
  const last = row.rows[0]?.code;
  const seq = last ? Number(last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * 1. Ý tưởng, sáng kiến, sản phẩm chủ động (đặc biệt dành cho Bậc 04 & Bậc 05)
 * Khi được 01.01 - 03.02 duyệt: tự cộng điểm KPI cho người phụ trách chính & tất cả thành viên tham gia.
 */
export async function createInitiative(
  actor: AuthActor,
  input: {
    kind?: InitiativeKind;
    title: string;
    description: string;
    links?: { label: string; url: string }[];
    fileIds?: string[];
    leadMemberId?: string;
    participantIds?: string[];
  },
  requestId?: string,
) {
  requirePermission(actor, "initiative.submit", {}, "Tài khoản Ngoại lệ (Bậc 06) không thể gửi ý tưởng/sáng kiến.");

  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 3) throw new AppError(400, "TITLE_REQUIRED", "Tên ý tưởng/sáng kiến tối thiểu 3 ký tự.");
  if (description.length < 5) throw new AppError(400, "DESCRIPTION_REQUIRED", "Vui lòng mô tả chi tiết nội dung đề xuất.");

  const leadMemberId = input.leadMemberId || actor.memberId;
  const participantIds = [...new Set([...(input.participantIds ?? []), actor.memberId].filter((id) => id !== leadMemberId))];

  return withTransaction(async (tx) => {
    const code = await generateInitiativeCode(tx);
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO initiatives (
         code, kind, title, description, links, file_ids, lead_member_id, submitted_by, status
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'PENDING')
       RETURNING id`,
      [
        code,
        input.kind ?? "INITIATIVE",
        title,
        description,
        JSON.stringify(input.links ?? []),
        JSON.stringify([...new Set(input.fileIds ?? [])]),
        leadMemberId,
        actor.memberId,
      ],
    );
    const initiativeId = ins.rows[0].id;

    await tx.query(
      `INSERT INTO initiative_participants (initiative_id, member_id, role, awarded_points)
       VALUES ($1, $2, 'LEAD', 1.00)`,
      [initiativeId, leadMemberId],
    );
    for (const pid of participantIds) {
      await tx.query(
        `INSERT INTO initiative_participants (initiative_id, member_id, role, awarded_points)
         VALUES ($1, $2, 'PARTICIPANT', 1.00)
         ON CONFLICT DO NOTHING`,
        [initiativeId, pid],
      );
    }

    // Thông báo tới lãnh đạo 01.01 - 03.02 để xét duyệt
    const managers = await tx.query<{ id: string }>(
      `SELECT id FROM members
       WHERE access_enabled = true AND activity_status = 'ACTIVE' AND archived_at IS NULL
         AND role IN ('HEAD', 'ACTING_HEAD', 'DEPUTY_INSPECTOR', 'DEPUTY', 'TEAM_LEAD', 'TEAM_DEPUTY')`,
    );
    await createNotifications(
      managers.rows.map((r) => r.id).filter((id) => id !== actor.memberId),
      {
        eventType: "INITIATIVE_SUBMITTED",
        targetType: "INITIATIVE",
        targetId: initiativeId,
        title: `Đề xuất sáng kiến mới: ${code}`,
        message: `${actor.displayName} vừa nộp "${title}". Vui lòng xem xét duyệt và cộng điểm KPI.`,
        link: `/initiatives`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "INITIATIVE_SUBMITTED",
        targetType: "INITIATIVE",
        targetId: initiativeId,
        safeDiff: { code, kind: input.kind ?? "INITIATIVE", participantCount: participantIds.length + 1 },
        requestId,
      },
      tx,
    );

    return { id: initiativeId, code, status: "PENDING" as const };
  });
}

export async function listInitiatives(actor: AuthActor, filters?: { status?: string }) {
  requirePermission(actor, "initiative.submit", {}, "Tài khoản Ngoại lệ (Bậc 06) không thể truy cập mục này.");

  const canReview = can(actor, "initiative.review");
  const params: unknown[] = [];
  const where: string[] = ["TRUE"];

  if (!canReview) {
    params.push(actor.memberId);
    where.push(
      `(i.submitted_by = $${params.length} OR i.lead_member_id = $${params.length} OR EXISTS (SELECT 1 FROM initiative_participants ip WHERE ip.initiative_id = i.id AND ip.member_id = $${params.length}))`,
    );
  }
  if (filters?.status) {
    params.push(filters.status);
    where.push(`i.status = $${params.length}`);
  }

  const rows = await query<{
    id: string;
    code: string;
    kind: InitiativeKind;
    title: string;
    description: string;
    links: unknown;
    file_ids: unknown;
    lead_member_id: string;
    lead_name: string;
    submitted_by: string;
    submitted_by_name: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    awarded_points_lead: string | number;
    awarded_points_participant: string | number;
    reviewer_id: string | null;
    reviewer_name: string | null;
    review_note: string;
    reviewed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT i.*, lm.display_name AS lead_name, sm.display_name AS submitted_by_name, rm.display_name AS reviewer_name
     FROM initiatives i
     JOIN members lm ON lm.id = i.lead_member_id
     JOIN members sm ON sm.id = i.submitted_by
     LEFT JOIN members rm ON rm.id = i.reviewer_id
     WHERE ${where.join(" AND ")}
     ORDER BY CASE i.status WHEN 'PENDING' THEN 1 WHEN 'APPROVED' THEN 2 ELSE 3 END, i.created_at DESC
     LIMIT 120`,
    params,
  );

  const ids = rows.map((r) => r.id);
  const participants =
    ids.length > 0
      ? await query<{ initiative_id: string; member_id: string; display_name: string; role: string; awarded_points: string | number }>(
          `SELECT ip.initiative_id, ip.member_id, m.display_name, ip.role, ip.awarded_points
           FROM initiative_participants ip
           JOIN members m ON m.id = ip.member_id
           WHERE ip.initiative_id = ANY($1::uuid[])
           ORDER BY CASE ip.role WHEN 'LEAD' THEN 1 ELSE 2 END, m.display_name ASC`,
          [ids],
        )
      : [];

  const fileIds = [...new Set(rows.flatMap((r) => (Array.isArray(r.file_ids) ? (r.file_ids as string[]) : [])))];
  const files =
    fileIds.length > 0
      ? await query<{ id: string; original_name: string; safe_mime: string; size_bytes: string | number }>(
          `SELECT id, original_name, safe_mime, size_bytes FROM files WHERE id = ANY($1::uuid[]) AND state = 'ACTIVE'`,
          [fileIds],
        )
      : [];
  const fileMap = new Map(
    files.map((f) => [f.id, { id: f.id, originalName: f.original_name, safeMime: f.safe_mime, sizeBytes: Number(f.size_bytes) }]),
  );

  return rows.map((r) => {
    const fIds = Array.isArray(r.file_ids) ? (r.file_ids as string[]) : [];
    return {
      id: r.id,
      code: r.code,
      kind: r.kind,
      title: r.title,
      description: r.description,
      links: Array.isArray(r.links) ? (r.links as { label: string; url: string }[]) : [],
      files: fIds.map((id) => fileMap.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
      leadMemberId: r.lead_member_id,
      leadName: r.lead_name,
      submittedBy: r.submitted_by,
      submittedByName: r.submitted_by_name,
      status: r.status,
      awardedPointsLead: Number(r.awarded_points_lead),
      awardedPointsParticipant: Number(r.awarded_points_participant),
      reviewerName: r.reviewer_name,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      canReview: canReview && r.status === "PENDING" && r.submitted_by !== actor.memberId,
      participants: participants
        .filter((p) => p.initiative_id === r.id)
        .map((p) => ({
          memberId: p.member_id,
          displayName: p.display_name,
          role: p.role,
          awardedPoints: Number(p.awarded_points),
        })),
    };
  });
}

export async function reviewInitiative(
  actor: AuthActor,
  initiativeId: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    reviewNote?: string;
    pointsLead?: number;
    pointsParticipant?: number;
  },
  requestId?: string,
) {
  requirePermission(actor, "initiative.review", {}, "Chỉ Bậc 01.01–03.02 được duyệt ý tưởng, sáng kiến, sản phẩm.");

  return withTransaction(async (tx) => {
    const row = await tx.query<{ id: string; code: string; title: string; submitted_by: string; status: string }>(
      `SELECT id, code, title, submitted_by, status FROM initiatives WHERE id = $1`,
      [initiativeId],
    );
    const ini = row.rows[0];
    if (!ini) throw new AppError(404, "INITIATIVE_NOT_FOUND", "Không tìm thấy ý tưởng/sáng kiến.");
    if (ini.status !== "PENDING") {
      throw new AppError(409, "ALREADY_REVIEWED", "Đề xuất này đã được duyệt trước đó.");
    }
    if (ini.submitted_by === actor.memberId) {
      throw new AppError(403, "SELF_REVIEW_FORBIDDEN", "Bạn không thể tự duyệt đề xuất do chính mình nộp.");
    }
    if (input.decision === "REJECTED" && !(input.reviewNote ?? "").trim()) {
      throw new AppError(400, "NOTE_REQUIRED", "Vui lòng ghi rõ lý do khi từ chối đề xuất.");
    }

    const ptsLead = Math.max(0.1, Math.min(20, input.pointsLead ?? 1.5));
    const ptsPart = Math.max(0.1, Math.min(20, input.pointsParticipant ?? 1.0));

    await tx.query(
      `UPDATE initiatives
       SET status = $1,
           awarded_points_lead = $2,
           awarded_points_participant = $3,
           reviewer_id = $4,
           review_note = $5,
           reviewed_at = now(),
           updated_at = now()
       WHERE id = $6`,
      [input.decision, ptsLead, ptsPart, actor.memberId, (input.reviewNote ?? "").trim(), initiativeId],
    );

    if (input.decision === "APPROVED") {
      await tx.query(
        `UPDATE initiative_participants
         SET awarded_points = CASE WHEN role = 'LEAD' THEN $1::numeric ELSE $2::numeric END
         WHERE initiative_id = $3`,
        [ptsLead, ptsPart, initiativeId],
      );
    }

    const partRows = await tx.query<{ member_id: string }>(
      `SELECT member_id FROM initiative_participants WHERE initiative_id = $1`,
      [initiativeId],
    );
    await createNotifications(
      [...new Set([ini.submitted_by, ...partRows.rows.map((p) => p.member_id)])].filter((id) => id !== actor.memberId),
      {
        eventType: input.decision === "APPROVED" ? "INITIATIVE_APPROVED" : "INITIATIVE_REJECTED",
        targetType: "INITIATIVE",
        targetId: initiativeId,
        title:
          input.decision === "APPROVED"
            ? `Sáng kiến ${ini.code} đã được duyệt & cộng điểm KPI`
            : `Sáng kiến ${ini.code} chưa được duyệt`,
        message:
          input.decision === "APPROVED"
            ? `${actor.displayName} đã duyệt "${ini.title}" (+${ptsLead} điểm phụ trách / +${ptsPart} điểm tham gia).`
            : `${actor.displayName} đã từ chối "${ini.title}". Lý do: ${(input.reviewNote ?? "").trim()}`,
        link: `/initiatives`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: `INITIATIVE_${input.decision}`,
        targetType: "INITIATIVE",
        targetId: initiativeId,
        safeDiff: { code: ini.code, ptsLead, ptsPart },
        requestId,
      },
      tx,
    );

    return { id: initiativeId, status: input.decision, pointsLead: ptsLead, pointsParticipant: ptsPart };
  });
}

/**
 * 2. Tự cập nhật số liệu thực hiện nhiệm vụ & tự động quy đổi sang điểm KPI
 */
export async function submitMetricLog(
  actor: AuthActor,
  input: {
    taskId?: string | null;
    title: string;
    metricUnit: string;
    quantity: number;
    pointsPerUnit?: number;
    evidenceUrl?: string;
    note?: string;
    periodDate?: string;
  },
  requestId?: string,
) {
  requirePermission(actor, "initiative.submit", {}, "Tài khoản Ngoại lệ (Bậc 06) không thể cập nhật số liệu.");

  const title = input.title.trim();
  const unit = input.metricUnit.trim();
  if (title.length < 2) throw new AppError(400, "TITLE_REQUIRED", "Vui lòng nhập tên chỉ tiêu / công việc.");
  if (!unit) throw new AppError(400, "UNIT_REQUIRED", "Vui lòng nhập đơn vị tính (vd: bài viết, video, lượt duyệt...).");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new AppError(400, "INVALID_QUANTITY", "Số lượng phải lớn hơn 0.");
  }

  let pointsPerUnit = input.pointsPerUnit ?? 1;
  if (input.taskId) {
    const t = await queryOne<{ metric_points_per_unit: string | number }>(
      `SELECT metric_points_per_unit FROM tasks WHERE id = $1`,
      [input.taskId],
    );
    if (t && !input.pointsPerUnit) {
      pointsPerUnit = Number(t.metric_points_per_unit || 1);
    }
  }
  const computedPoints = Math.round(input.quantity * pointsPerUnit * 100) / 100;
  // Cấp quản trị (01.01-03.02) tự ghi nhận có hiệu lực ngay; Bậc 04/05 chờ cấp trên xác nhận
  const initialStatus = isManagerRole(actor.role) ? "APPROVED" : "PENDING";

  return withTransaction(async (tx) => {
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO metric_logs (
         member_id, task_id, title, metric_unit, quantity, points_per_unit, computed_points,
         evidence_url, note, status, reviewed_by, reviewed_at, period_date
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, COALESCE($13::date, CURRENT_DATE)
       ) RETURNING id`,
      [
        actor.memberId,
        input.taskId || null,
        title,
        unit,
        input.quantity,
        pointsPerUnit,
        computedPoints,
        (input.evidenceUrl ?? "").trim(),
        (input.note ?? "").trim(),
        initialStatus,
        initialStatus === "APPROVED" ? actor.memberId : null,
        initialStatus === "APPROVED" ? new Date().toISOString() : null,
        input.periodDate || null,
      ],
    );
    const id = ins.rows[0].id;

    if (initialStatus === "PENDING") {
      const leads = await tx.query<{ id: string }>(
        `SELECT DISTINCT m.id
         FROM members m
         LEFT JOIN team_memberships tm ON tm.member_id = m.id AND tm.effective_to IS NULL
         WHERE m.access_enabled = true AND m.activity_status = 'ACTIVE' AND m.archived_at IS NULL
           AND (
             m.role IN ('HEAD', 'ACTING_HEAD', 'DEPUTY_INSPECTOR', 'DEPUTY')
             OR (m.role IN ('TEAM_LEAD', 'TEAM_DEPUTY') AND tm.team_id = ANY($1::uuid[]))
           )`,
        [actor.teamIds],
      );
      await createNotifications(
        leads.rows.map((r) => r.id).filter((uid) => uid !== actor.memberId),
        {
          eventType: "METRIC_LOG_SUBMITTED",
          targetType: "METRIC_LOG",
          targetId: id,
          title: `${actor.displayName} báo cáo số liệu KPI (+${computedPoints} đ)`,
          message: `"${title}": ${input.quantity} ${unit} (${pointsPerUnit} đ/${unit}). Vui lòng kiểm tra và xác nhận.`,
          link: `/initiatives?tab=metrics`,
        },
        tx,
      );
    }

    await writeAudit(
      {
        actorId: actor.memberId,
        action: "METRIC_LOG_SUBMITTED",
        targetType: "METRIC_LOG",
        targetId: id,
        safeDiff: { quantity: input.quantity, unit, computedPoints, status: initialStatus },
        requestId,
      },
      tx,
    );

    return { id, computedPoints, status: initialStatus };
  });
}

export async function listMetricLogs(actor: AuthActor, filters?: { status?: string }) {
  requirePermission(actor, "initiative.submit", {}, "Tài khoản Ngoại lệ (Bậc 06) không thể truy cập mục này.");

  const canReview = isManagerRole(actor.role);
  const params: unknown[] = [];
  const where: string[] = ["TRUE"];
  if (!canReview) {
    params.push(actor.memberId);
    where.push(`ml.member_id = $${params.length}`);
  }
  if (filters?.status) {
    params.push(filters.status);
    where.push(`ml.status = $${params.length}`);
  }

  const rows = await query<{
    id: string;
    member_id: string;
    member_name: string;
    task_id: string | null;
    task_code: string | null;
    title: string;
    metric_unit: string;
    quantity: string | number;
    points_per_unit: string | number;
    computed_points: string | number;
    evidence_url: string;
    note: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reviewer_name: string | null;
    reviewed_at: Date | null;
    period_date: string | Date;
    created_at: Date;
  }>(
    `SELECT ml.*, m.display_name AS member_name, t.code AS task_code, rm.display_name AS reviewer_name
     FROM metric_logs ml
     JOIN members m ON m.id = ml.member_id
     LEFT JOIN tasks t ON t.id = ml.task_id
     LEFT JOIN members rm ON rm.id = ml.reviewed_by
     WHERE ${where.join(" AND ")}
     ORDER BY CASE ml.status WHEN 'PENDING' THEN 1 ELSE 2 END, ml.created_at DESC
     LIMIT 150`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    memberId: r.member_id,
    memberName: r.member_name,
    taskId: r.task_id,
    taskCode: r.task_code,
    title: r.title,
    metricUnit: r.metric_unit,
    quantity: Number(r.quantity),
    pointsPerUnit: Number(r.points_per_unit),
    computedPoints: Number(r.computed_points),
    evidenceUrl: r.evidence_url,
    note: r.note,
    status: r.status,
    reviewerName: r.reviewer_name,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    periodDate: typeof r.period_date === "string" ? r.period_date.slice(0, 10) : new Date(r.period_date).toISOString().slice(0, 10),
    createdAt: new Date(r.created_at).toISOString(),
    canReview: canReview && r.status === "PENDING" && r.member_id !== actor.memberId,
  }));
}

export async function reviewMetricLog(
  actor: AuthActor,
  metricLogId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
  requestId?: string,
) {
  requirePermission(actor, "initiative.review", {}, "Chỉ Bậc 01.01–03.02 được xác nhận số liệu KPI.");

  return withTransaction(async (tx) => {
    const row = await tx.query<{ id: string; member_id: string; title: string; computed_points: string | number; status: string }>(
      `SELECT id, member_id, title, computed_points, status FROM metric_logs WHERE id = $1`,
      [metricLogId],
    );
    const log = row.rows[0];
    if (!log) throw new AppError(404, "METRIC_LOG_NOT_FOUND", "Không tìm thấy bản ghi số liệu.");
    if (log.status !== "PENDING") {
      throw new AppError(409, "ALREADY_REVIEWED", "Bản ghi số liệu đã được xử lý.");
    }
    if (log.member_id === actor.memberId) {
      throw new AppError(403, "SELF_REVIEW_FORBIDDEN", "Không thể tự duyệt số liệu của chính mình.");
    }

    await tx.query(
      `UPDATE metric_logs
       SET status = $1, reviewed_by = $2, reviewed_at = now(),
           note = CASE WHEN $3 <> '' THEN CONCAT_WS(' | Duyệt: ', NULLIF(note, ''), $3) ELSE note END
       WHERE id = $4`,
      [decision, actor.memberId, (note ?? "").trim(), metricLogId],
    );

    await createNotification(
      {
        recipientId: log.member_id,
        eventType: decision === "APPROVED" ? "METRIC_LOG_APPROVED" : "METRIC_LOG_REJECTED",
        targetType: "METRIC_LOG",
        targetId: metricLogId,
        title:
          decision === "APPROVED"
            ? `Số liệu "${log.title}" đã được duyệt (+${Number(log.computed_points)} đ KPI)`
            : `Số liệu "${log.title}" bị từ chối`,
        message: `${actor.displayName} đã ${decision === "APPROVED" ? "xác nhận" : "từ chối"} báo cáo số liệu của bạn.`,
        link: `/initiatives?tab=metrics`,
      },
      tx,
    );

    await writeAudit(
      {
        actorId: actor.memberId,
        action: `METRIC_LOG_${decision}`,
        targetType: "METRIC_LOG",
        targetId: metricLogId,
        safeDiff: { computedPoints: Number(log.computed_points) },
        requestId,
      },
      tx,
    );

    return { id: metricLogId, status: decision };
  });
}

/**
 * 3. Kho Data đồ họa cơ bản phục vụ thiết kế sản phẩm (01.01 - 05 xem & tải, 01.01 - 03.02 quản lý)
 */
export async function listGraphicAssets(actor: AuthActor, filters?: { category?: string; search?: string }) {
  requirePermission(actor, "graphics.view", {}, "Bạn không có quyền truy cập Kho Data đồ họa.");

  const params: unknown[] = [];
  const where: string[] = ["ga.active = true"];
  if (filters?.category) {
    params.push(filters.category);
    where.push(`ga.category = $${params.length}`);
  }
  if (filters?.search?.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    where.push(`(lower(ga.title) LIKE $${params.length} OR lower(ga.description) LIKE $${params.length})`);
  }

  const rows = await query<{
    id: string;
    title: string;
    category: GraphicCategory;
    description: string;
    external_url: string;
    file_id: string | null;
    file_name: string | null;
    file_mime: string | null;
    file_size: string | number | null;
    tags: unknown;
    uploaded_by: string;
    uploaded_by_name: string;
    created_at: Date;
  }>(
    `SELECT ga.*, f.original_name AS file_name, f.safe_mime AS file_mime, f.size_bytes AS file_size,
            m.display_name AS uploaded_by_name
     FROM graphic_assets ga
     JOIN members m ON m.id = ga.uploaded_by
     LEFT JOIN files f ON f.id = ga.file_id AND f.state = 'ACTIVE'
     WHERE ${where.join(" AND ")}
     ORDER BY ga.created_at DESC
     LIMIT 200`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description,
    externalUrl: r.external_url,
    file: r.file_id
      ? {
          id: r.file_id,
          originalName: r.file_name ?? "file",
          safeMime: r.file_mime ?? "application/octet-stream",
          sizeBytes: Number(r.file_size ?? 0),
        }
      : null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    uploadedBy: r.uploaded_by,
    uploadedByName: r.uploaded_by_name,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function createGraphicAsset(
  actor: AuthActor,
  input: {
    title: string;
    category: GraphicCategory;
    description?: string;
    externalUrl?: string;
    fileId?: string | null;
    tags?: string[];
  },
  requestId?: string,
) {
  requirePermission(actor, "graphics.manage", {}, "Chỉ Bậc 01.01–03.02 được thêm dữ liệu vào Kho đồ họa.");

  const title = input.title.trim();
  if (title.length < 2) throw new AppError(400, "TITLE_REQUIRED", "Tên tài nguyên đồ họa tối thiểu 2 ký tự.");
  if (!input.fileId && !(input.externalUrl ?? "").trim()) {
    throw new AppError(400, "ASSET_REQUIRED", "Vui lòng tải lên tệp hoặc nhập đường dẫn tài nguyên (Canva/Drive/Figma...).");
  }

  return withTransaction(async (tx) => {
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO graphic_assets (title, category, description, external_url, file_id, tags, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id`,
      [
        title,
        input.category,
        (input.description ?? "").trim(),
        (input.externalUrl ?? "").trim(),
        input.fileId || null,
        JSON.stringify([...new Set((input.tags ?? []).map((t) => t.trim()).filter(Boolean))]),
        actor.memberId,
      ],
    );
    const id = ins.rows[0].id;
    await writeAudit(
      {
        actorId: actor.memberId,
        action: "GRAPHIC_ASSET_CREATED",
        targetType: "GRAPHIC_ASSET",
        targetId: id,
        safeDiff: { title, category: input.category },
        requestId,
      },
      tx,
    );
    return { id };
  });
}

export async function deleteGraphicAsset(actor: AuthActor, assetId: string, requestId?: string) {
  requirePermission(actor, "graphics.manage", {}, "Chỉ Bậc 01.01–03.02 được xóa tài nguyên khỏi Kho đồ họa.");

  const res = await query<{ id: string }>(
    `UPDATE graphic_assets SET active = false, updated_at = now() WHERE id = $1 AND active = true RETURNING id`,
    [assetId],
  );
  if (!res[0]) throw new AppError(404, "ASSET_NOT_FOUND", "Không tìm thấy tài nguyên đồ họa.");

  await writeAudit({
    actorId: actor.memberId,
    action: "GRAPHIC_ASSET_DELETED",
    targetType: "GRAPHIC_ASSET",
    targetId: assetId,
    requestId,
  });

  return { id: assetId, deleted: true };
}
