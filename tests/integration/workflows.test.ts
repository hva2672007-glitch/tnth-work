import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { execSql, query, resetDbForTests } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import {
  createSessionForMember,
  loadActorByMemberId,
  resolveSessionActor,
  type AuthActor,
} from "@/server/auth/session";
import {
  resetMockPortalState,
  setMockPortalAccountStatus,
  setMockPortalSourceDown,
} from "@/server/auth/portal-adapter";
import {
  changeOwnLocalPassword,
  createLocalMember,
  getMembersWorkload,
  grantMemberAccess,
  listMembersDirectory,
  resetLocalMemberPassword,
  revokeMemberAccess,
  updateMemberProfile,
} from "@/server/members/service";
import {
  addTaskToMission,
  assignTaskMembers,
  assignmentAction,
  createMission,
  getMissionDetail,
  getMyWork,
  missionLifecycleAction,
  requestDeadlineExtension,
  resolveDeadlineExtension,
  updateMission,
} from "@/server/missions/workflow";
import {
  addPublicationLink,
  assertCanAccessFile,
  reviewSubmissionVersion,
  submitTaskProduct,
} from "@/server/submissions/service";
import { saveUploadedFile } from "@/server/storage/local-storage";
import {
  applyApprovalRequest,
  castApprovalVote,
  proposePromoteActingHead,
  proposeRegulationAmendment,
} from "@/server/approvals/service";
import { finalizeKpiPeriod, getKpiReport } from "@/server/reports/kpi";
import { detectBottlenecks } from "@/server/reports/bottlenecks";
import { generateReportWorkbook } from "@/server/reports/excel";
import { runScheduledJobs } from "@/server/jobs/runner";
import { SEED_CHANNELS, SEED_TEAMS } from "@/lib/constants";

let head!: AuthActor;
let acting!: AuthActor;
let deputy!: AuthActor;
let leadNd!: AuthActor;
let leadMedia!: AuthActor;
let memNd!: AuthActor;
let memMedia!: AuthActor;
let teamNdId!: string;
let teamMediaId!: string;
let groupAId!: string;
let groupBId!: string;
let channelFbId!: string;

async function setupSeededMemoryDb() {
  process.env.APP_ENV = "test";
  process.env.DATABASE_URL = "pglite://memory";
  process.env.PORTAL_AUTH_MODE = "mock";
  process.env.UPLOAD_DIR = "/tmp/tnth-work-test-uploads";

  await resetDbForTests();
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await execSql(sql);
  }

  for (const t of SEED_TEAMS) {
    await query("INSERT INTO teams (code, name, sort_order) VALUES ($1, $2, $3)", [t.code, t.name, t.sort_order]);
  }
  for (const c of SEED_CHANNELS) {
    await query(
      "INSERT INTO publication_channels (code, name, allow_custom_name, sort_order) VALUES ($1, $2, $3, $4)",
      [c.code, c.name, c.allow_custom_name, c.sort_order],
    );
  }
  await query("INSERT INTO kpi_policies (version_code, completion_weight, ontime_weight) VALUES ('KPI-V1', 60, 40)");

  const tRows = await query<{ id: string; code: string }>("SELECT id, code FROM teams");
  const tMap = Object.fromEntries(tRows.map((r) => [r.code, r.id]));
  teamNdId = tMap["NOI_DUNG"];
  teamMediaId = tMap["MEDIA"];

  const chRow = await query<{ id: string }>("SELECT id FROM publication_channels WHERE code = 'FB_TNTH'");
  channelFbId = chRow[0].id;

  // Bootstrap HEAD (01.01)
  const hRow = await query<{ id: string }>(
    `INSERT INTO members (member_code, provider, external_account_id, username, display_name, role, access_enabled, activity_status)
     VALUES ('BBT-001', 'tnth', '1001', 'truongban.bbt', 'Nguyễn Minh Quân', 'HEAD', true, 'ACTIVE') RETURNING id`,
  );
  await query("INSERT INTO member_profiles (member_id, full_name) VALUES ($1, 'Nguyễn Minh Quân')", [hRow[0].id]);
  await query("INSERT INTO team_memberships (member_id, team_id, is_primary, team_title) VALUES ($1, $2, true, 'MEMBER')", [
    hRow[0].id,
    teamNdId,
  ]);
  head = (await loadActorByMemberId(hRow[0].id))!;

  // HEAD cấp quyền cho các bậc khác qua service thật
  const rActing = await grantMemberAccess(head, { externalAccountId: "1002", role: "ACTING_HEAD", primaryTeamId: teamNdId });
  const rDep = await grantMemberAccess(head, { externalAccountId: "1003", role: "DEPUTY", primaryTeamId: teamMediaId });
  const rLeadNd = await grantMemberAccess(head, { externalAccountId: "1004", role: "TEAM_LEAD", primaryTeamId: teamNdId, primaryTeamTitle: "LEADER" });
  const rLeadMedia = await grantMemberAccess(head, { externalAccountId: "1005", role: "TEAM_LEAD", primaryTeamId: teamMediaId, primaryTeamTitle: "LEADER" });
  const rMemNd = await grantMemberAccess(head, { externalAccountId: "1007", role: "MEMBER", primaryTeamId: teamNdId });
  const rMemMedia = await grantMemberAccess(head, { externalAccountId: "1008", role: "MEMBER", primaryTeamId: teamMediaId });

  acting = (await loadActorByMemberId(rActing.memberId))!;
  deputy = (await loadActorByMemberId(rDep.memberId))!;
  leadNd = (await loadActorByMemberId(rLeadNd.memberId))!;
  leadMedia = (await loadActorByMemberId(rLeadMedia.memberId))!;
  memNd = (await loadActorByMemberId(rMemNd.memberId))!;
  memMedia = (await loadActorByMemberId(rMemMedia.memberId))!;

  const g1 = await query<{ id: string }>(
    "INSERT INTO task_groups (code, name, sort_order, created_by) VALUES ('G1', 'Khối Truyền thông', 1, $1) RETURNING id",
    [head.memberId],
  );
  const g2 = await query<{ id: string }>(
    "INSERT INTO task_groups (code, name, sort_order, created_by) VALUES ('G2', 'Khối Chuyên đề', 2, $1) RETURNING id",
    [head.memberId],
  );
  groupAId = g1[0].id;
  groupBId = g2[0].id;
}

beforeAll(async () => {
  await setupSeededMemoryDb();
});

afterAll(async () => {
  resetMockPortalState();
  await resetDbForTests();
});

describe("Integration End-to-End theo kịch bản mục 18.3", () => {
  it("Kịch bản 1 & 8: Giao mission 2 task, xem chéo sản phẩm trong cùng mission, chặn xem file mission khác, nộp đúng hạn duyệt trễ vẫn tính KPI đúng hạn", async () => {
    const deadlineFuture = new Date(Date.now() + 24 * 3600_000).toISOString();
    const created = await createMission(head, {
      groupId: groupAId,
      title: "Chiến dịch Truyền thông A+B",
      description: "Test end-to-end",
      ownerId: head.memberId,
      deadline: deadlineFuture,
      completionMode: "TASKS_AND_PUBLICATIONS",
      publicationChannels: [{ channelId: channelFbId, required: true, requiredCount: 1 }],
      tasks: [
        { tempKey: "a", title: "Task Nội dung A", ownerTeamId: teamNdId, deadline: deadlineFuture, weight: 2, assigneeIds: [memNd.memberId] },
        { tempKey: "b", title: "Task Media B", ownerTeamId: teamMediaId, deadline: deadlineFuture, weight: 2, assigneeIds: [memMedia.memberId], predecessorTempKeys: ["a"] },
      ],
    });

    const detail = await getMissionDetail(head, created.id);
    const taskA = detail.tasks[0];
    const taskB = detail.tasks[1];
    const assA = taskA.assignments[0];

    // Thành viên A nhận việc và tải tệp PDF nội bộ lên kho private
    await assignmentAction(memNd, assA.id, "accept", {});
    const uploaded = await saveUploadedFile({
      buffer: Buffer.from("%PDF-1.7\nNoi dung bai viet"),
      originalName: "bai-viet-A.pdf",
      purpose: "SUBMISSION",
      uploaderId: memNd.memberId,
    });

    const sub = await submitTaskProduct(memNd, taskA.id, {
      note: "Đã nộp bài A đúng hạn",
      fileIds: [uploaded.id],
      links: [{ label: "Google Docs A", url: "https://docs.google.com/document/d/demo" }],
    });

    // B cùng mission xem được file của A (yêu cầu gốc!)
    await expect(assertCanAccessFile(memMedia, uploaded.id)).resolves.toBeTruthy();

    // Một thành viên KHÔNG thuộc mission (cấp mới cho 2001) bị từ chối truy cập file nội bộ
    const outsider = await grantMemberAccess(head, { externalAccountId: "2001", role: "MEMBER", primaryTeamId: teamNdId });
    const outsiderActor = (await loadActorByMemberId(outsider.memberId))!;
    await expect(assertCanAccessFile(outsiderActor, uploaded.id)).rejects.toThrow();

    // MEMBER gọi review bị từ chối; người nộp tự duyệt bị từ chối
    await expect(reviewSubmissionVersion(memMedia, sub.versionId, "APPROVED", {})).rejects.toThrow();
    await expect(reviewSubmissionVersion(memNd, sub.versionId, "APPROVED", {})).rejects.toThrow();

    // Trưởng tổ Nội dung nghiệm thu thành công
    await reviewSubmissionVersion(leadNd, sub.versionId, "APPROVED", { note: "Tốt" });

    // Giả lập reviewed_at sau deadline nhưng effective_submitted_at vẫn trước deadline -> KPI vẫn ON_TIME/EARLY
    await query(
      `UPDATE task_assignments SET reviewed_at = evaluation_deadline + interval '48 hours' WHERE id = $1`,
      [assA.id],
    );
    const kpi = await getKpiReport(memNd, { memberId: memNd.memberId });
    const myKpi = kpi.members[0];
    expect(myKpi.ontimeWeight).toBe(2);
    expect(myKpi.counts.lateCompleted).toBe(0);

    // Hoàn thành task B nhưng CHƯA có link đăng tải -> TASKS_AND_PUBLICATIONS chặn chốt mission!
    const assB = taskB.assignments[0];
    await assignmentAction(memMedia, assB.id, "accept", {});
    const subB = await submitTaskProduct(memMedia, taskB.id, { textContent: "Hoàn tất thiết kế B" });
    await reviewSubmissionVersion(leadMedia, subB.versionId, "APPROVED", {});
    await expect(missionLifecycleAction(head, created.id, "complete", {})).rejects.toThrow();

    // Thêm link đăng tải + xác nhận kênh -> chốt mission thành công!
    const afterTasks = await getMissionDetail(head, created.id);
    await addPublicationLink(head, created.id, {
      requirementId: afterTasks.publications[0].id,
      url: "https://facebook.com/tnth/posts/12345",
      confirmChannel: true,
    });
    const completed = await missionLifecycleAction(head, created.id, "complete", {});
    expect(completed.status).toBe("COMPLETED");
  });

  it("Kịch bản 2: TEAM_LEAD giao task cho DEPUTY được phép nhưng không sửa được hồ sơ DEPUTY", async () => {
    const due = new Date(Date.now() + 10 * 3600_000).toISOString();
    const m = await createMission(leadNd, {
      groupId: groupBId,
      title: "Xin ý kiến chỉ đạo Phó Ban",
      description: "Bậc 03 giao việc cho Bậc 02",
      ownerId: leadNd.memberId,
      deadline: due,
      tasks: [{ title: "Phê duyệt khung chủ đề", ownerTeamId: teamNdId, deadline: due, assigneeIds: [deputy.memberId] }],
    });
    expect(m.status).toBe("ASSIGNED");
    await expect(updateMemberProfile(leadNd, deputy.memberId, { hometown: "Hack" })).rejects.toThrow();
  });

  it("Kịch bản 3 & 4: Từ chối 1 người không reset người khác + Chuyển giao + Xung đột version 409", async () => {
    const due = new Date(Date.now() + 30 * 3600_000).toISOString();
    const m = await createMission(head, {
      groupId: groupAId,
      title: "Task 2 người thực hiện",
      description: "Test decline + transfer + version conflict",
      ownerId: head.memberId,
      deadline: due,
      tasks: [
        {
          title: "Sản xuất video",
          ownerTeamId: teamMediaId,
          deadline: due,
          assigneeIds: [memNd.memberId, memMedia.memberId],
        },
      ],
    });

    const detail = await getMissionDetail(head, m.id);
    const assNd = detail.tasks[0].assignments.find((a) => a.memberId === memNd.memberId)!;
    const assMedia = detail.tasks[0].assignments.find((a) => a.memberId === memMedia.memberId)!;

    await assignmentAction(memNd, assNd.id, "accept", {});
    await assignmentAction(memMedia, assMedia.id, "decline", { reason: "Trùng lịch thi học kỳ" });

    const afterDecline = await getMissionDetail(head, m.id);
    expect(afterDecline.tasks[0].assignments.find((a) => a.id === assNd.id)?.status).toBe("ACCEPTED");
    expect(afterDecline.tasks[0].assignments.find((a) => a.id === assMedia.id)?.status).toBe("DECLINED");

    // Version conflict 409 khi hai quản lý sửa đồng thời
    const u1 = await updateMission(head, m.id, { version: 1, title: "Tên mới v2" });
    expect(u1.version).toBe(2);
    await expect(updateMission(deputy, m.id, { version: 1, title: "Ghi đè cũ" })).rejects.toMatchObject({ status: 409 });
  });

  it("Kịch bản 6: PUBLICATIONS_ONLY chốt mission nhưng không tự cộng KPI cho task chưa nghiệm thu", async () => {
    const due = new Date(Date.now() + 12 * 3600_000).toISOString();
    const m = await createMission(head, {
      groupId: groupBId,
      title: "Tin nhanh đăng ngay",
      description: "Hoàn thành theo link đăng tải",
      ownerId: head.memberId,
      deadline: due,
      completionMode: "PUBLICATIONS_ONLY",
      completionModeReason: "Tin thời sự phát nhanh",
      publicationChannels: [{ channelId: channelFbId, required: true, requiredCount: 1 }],
      tasks: [{ title: "Cập nhật ảnh tin nhanh", ownerTeamId: teamMediaId, deadline: due, assigneeIds: [memMedia.memberId] }],
    });

    const d = await getMissionDetail(head, m.id);
    await addPublicationLink(head, m.id, {
      requirementId: d.publications[0].id,
      url: "https://facebook.com/tnth/posts/99999",
      confirmChannel: true,
    });

    const closed = await missionLifecycleAction(head, m.id, "complete", {});
    expect(closed.status).toBe("COMPLETED");

    // Task chưa nghiệm thu vẫn giữ trạng thái ASSIGNED (không tự chuyển COMPLETED)
    const afterClose = await getMissionDetail(head, m.id);
    expect(afterClose.tasks[0].status).toBe("ASSIGNED");
  });

  it("Kịch bản 5: Đồng xác nhận sửa quy chế (01.02 cần 02 + 03) và nâng 01.02 → 01.01 cần 100% Bậc 03", async () => {
    const regProp = await proposeRegulationAmendment(acting, {
      title: "Quy chế v2",
      body: "Nội dung sửa đổi quy chế hoạt động Ban Biên tập phiên bản 2.",
      reason: "Cập nhật quy trình nghiệm thu",
    });

    // Mới có 1 phiếu DEPUTY -> vẫn PENDING
    const v1 = await castApprovalVote(deputy, regProp.approvalId, { decision: "APPROVE" });
    expect(v1.status).toBe("PENDING");
    await expect(applyApprovalRequest(acting, regProp.approvalId)).rejects.toThrow();

    // Phiếu thứ 2 từ TEAM_LEAD -> READY_TO_APPLY -> apply thành công!
    const v2 = await castApprovalVote(leadNd, regProp.approvalId, { decision: "APPROVE" });
    expect(v2.status).toBe("READY_TO_APPLY");
    const applied = await applyApprovalRequest(acting, regProp.approvalId);
    expect(applied.status).toBe("APPLIED");

    // Nâng 01.02 → 01.01 bị chặn khi đang có HEAD hiệu lực
    await expect(
      proposePromoteActingHead(deputy, { targetMemberId: acting.memberId, reason: "Thử nâng khi vẫn còn HEAD" }),
    ).rejects.toThrow();

    // Khi HEAD ngừng hoạt động (chuyển giao) -> đề xuất nâng cần 100% cả 2 TEAM_LEAD (leadNd + leadMedia)
    await query("UPDATE members SET activity_status = 'INACTIVE', access_enabled = false WHERE id = $1", [head.memberId]);

    const promo = await proposePromoteActingHead(deputy, {
      targetMemberId: acting.memberId,
      reason: "Chuyển giao chức vụ Trưởng Ban",
    });
    expect(promo.requiredTeamLeadCount).toBe(2);

    const pv1 = await castApprovalVote(leadNd, promo.approvalId, { decision: "APPROVE" });
    expect(pv1.status).toBe("PENDING");
    const pv2 = await castApprovalVote(leadMedia, promo.approvalId, { decision: "APPROVE" });
    expect(pv2.status).toBe("READY_TO_APPLY");

    const promoApplied = await applyApprovalRequest(deputy, promo.approvalId);
    expect(promoApplied.status).toBe("APPLIED");

    const promotedActor = await loadActorByMemberId(acting.memberId);
    expect(promotedActor?.role).toBe("HEAD");

    // Khôi phục lại để các test sau chạy bình thường
    await query("UPDATE members SET role = 'ACTING_HEAD' WHERE id = $1", [acting.memberId]);
    await query("UPDATE members SET activity_status = 'ACTIVE', access_enabled = true WHERE id = $1", [head.memberId]);
  });

  it("Kịch bản 7, 9, 10: Revoke phiên tức thời, nguồn lỗi fail-closed, Recurring idempotent, Bottleneck & Excel export", async () => {
    // Session revoke + nguồn khóa tài khoản
    const tok = await createSessionForMember(memMedia.memberId);
    expect(await resolveSessionActor(tok)).not.toBeNull();

    setMockPortalAccountStatus("1008", "LOCKED");
    expect(await resolveSessionActor(tok, { forceRecheck: true })).toBeNull();
    setMockPortalAccountStatus("1008", null);

    // Mất kết nối nguồn + forceRecheck -> fail-closed (503)
    const tokHead = await createSessionForMember(head.memberId);
    setMockPortalSourceDown(true);
    await expect(resolveSessionActor(tokHead, { forceRecheck: true })).rejects.toMatchObject({ status: 503 });
    setMockPortalSourceDown(false);

    // Revoke nội bộ có hiệu lực ngay
    const temp = await grantMemberAccess(head, { externalAccountId: "2002", role: "MEMBER", primaryTeamId: teamNdId });
    const tempTok = await createSessionForMember(temp.memberId);
    await revokeMemberAccess(head, temp.memberId, "Kết thúc công tác");
    expect(await resolveSessionActor(tempTok)).toBeNull();

    // Recurring schedule chạy 2 lần không tạo mission trùng
    const past = new Date(Date.now() - 60_000).toISOString();
    const sched = await query<{ id: string }>(
      `INSERT INTO recurring_schedules (name, group_id, template, frequency, interval_count, run_time, deadline_offset_hours, auto_assign, starts_at, next_run_at, creator_id)
       VALUES ('Lịch test tuần', $1, $2::jsonb, 'WEEKLY', 1, '08:00', 48, false, $3, $3, $4) RETURNING id`,
      [
        groupAId,
        JSON.stringify({
          title: "Báo cáo tuần tự động",
          ownerId: head.memberId,
          tasks: [{ title: "Tổng hợp số liệu", ownerTeamId: teamNdId, weight: 1, assigneeIds: [] }],
        }),
        past,
        head.memberId,
      ],
    );
    const run1 = await runScheduledJobs();
    const run2 = await runScheduledJobs();
    expect(run1.recurringMissionsCreated).toBeGreaterThanOrEqual(1);
    expect(run2.recurringMissionsCreated).toBe(0);
    const createdBySched = await query<{ id: string }>("SELECT id FROM missions WHERE schedule_id = $1", [sched[0].id]);
    expect(createdBySched.length).toBe(1);

    // Bottleneck + KPI finalize + Excel export mở được bằng ExcelJS và các nhiệm vụ cùng khối liên tiếp
    const bots = await detectBottlenecks(head);
    expect(Array.isArray(bots.items)).toBe(true);

    const kpiLive = await getKpiReport(head);
    const fin = await finalizeKpiPeriod(head, kpiLive.period.id, {
      allowPendingReviews: true,
      exceptionReason: "Chốt test integration",
    });
    expect(fin.status).toBe("FINALIZED");

    const xlsx = await generateReportWorkbook(head, { allTime: true });
    expect(xlsx.buffer.length).toBeGreaterThan(1000);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.buffer as unknown as ArrayBuffer);
    expect(wb.getWorksheet("Task & phân công")).toBeDefined();
    expect(wb.getWorksheet("KPI cá nhân")).toBeDefined();
    expect(wb.getWorksheet("Điểm nghẽn")).toBeDefined();
  });

  it("Kịch bản 11: Nhiều kênh đăng tải tùy chỉnh (OTHER), luồng giao 2 cấp qua Tổ trưởng (Bậc 03), tách task và báo cáo tải nhân sự theo phạm vi quyền", async () => {
    const otherCh = await query<{ id: string }>("SELECT id FROM publication_channels WHERE code = 'OTHER'");
    const otherChannelId = otherCh[0].id;
    const deadlineFuture = new Date(Date.now() + 48 * 3600_000).toISOString();

    // 1. Phó Ban (Bậc 02) tạo mission với 2 trang khác tùy chỉnh (kèm 1 bản trùng hoa/thường để test dedupe)
    //    và 2 task: Task 1 giao cho Tổ Nội dung (không chọn mem -> chờ Lead phân công); Task 2 giao trực tiếp cho Lead Nội dung
    const created = await createMission(deputy, {
      groupId: groupAId,
      title: "Chiến dịch phối hợp nhiều trang và giao qua Tổ trưởng",
      description: "Kiểm thử thêm nhiều trang khác + giao 2 cấp qua Bậc 03 + xem tải nhân sự",
      ownerId: deputy.memberId,
      deadline: deadlineFuture,
      completionMode: "TASKS_AND_PUBLICATIONS",
      publicationChannels: [
        { channelId: otherChannelId, customChannelName: "Fanpage Hội Sinh viên Việt Nam", required: true, requiredCount: 1 },
        { channelId: otherChannelId, customChannelName: "YouTube Thanh niên Trường học", required: true, requiredCount: 1 },
        { channelId: otherChannelId, customChannelName: "fanpage hội sinh viên việt nam", required: true, requiredCount: 1 },
      ],
      tasks: [
        { tempKey: "t1", title: "Bài viết tổng hợp (chờ Lead phân công)", ownerTeamId: teamNdId, deadline: deadlineFuture, weight: 2, assigneeIds: [] },
        { tempKey: "t2", title: "Bài phỏng vấn (giao thẳng Lead để chia)", ownerTeamId: teamNdId, deadline: deadlineFuture, weight: 2, assigneeIds: [leadNd.memberId] },
      ],
    });

    const detail = await getMissionDetail(leadNd, created.id);
    // Đúng 2 kênh tùy chỉnh sau dedupe
    expect(detail.publications.length).toBe(2);
    expect(detail.publications.map((p) => p.channelName).sort()).toEqual([
      "Khác: Fanpage Hội Sinh viên Việt Nam",
      "Khác: YouTube Thanh niên Trường học",
    ]);

    const t1 = detail.tasks.find((t) => t.title.includes("chờ Lead phân công"))!;
    const t2 = detail.tasks.find((t) => t.title.includes("giao thẳng Lead"))!;
    expect(t1.canManageTask).toBe(true);
    expect(t1.assignments.length).toBe(0);

    // Lead Nội dung thấy Task 1 trong delegationQueue và có thông báo TASK_AWAITING_DELEGATION; Lead Media KHÔNG thấy
    const myWorkLeadNd = await getMyWork(leadNd);
    expect(myWorkLeadNd.delegationQueue.some((d) => d.taskId === t1.id)).toBe(true);
    const myWorkLeadMedia = await getMyWork(leadMedia);
    expect(myWorkLeadMedia.delegationQueue.some((d) => d.taskId === t1.id)).toBe(false);

    const notifRows = await query<{ event_type: string }>(
      `SELECT event_type FROM notifications WHERE recipient_id = $1 AND target_id = $2`,
      [leadNd.memberId, created.id],
    );
    expect(notifRows.some((n) => n.event_type === "TASK_AWAITING_DELEGATION")).toBe(true);

    // Bảo mật: Lead Media hoặc MEMBER KHÔNG được phân công vào task của Tổ Nội dung
    await expect(assignTaskMembers(leadMedia, t1.id, { memberIds: [memMedia.memberId] })).rejects.toMatchObject({ status: 403 });
    await expect(assignTaskMembers(memNd, t1.id, { memberIds: [memNd.memberId] })).rejects.toMatchObject({ status: 403 });
    // Lead Nội dung cũng KHÔNG được gán mem của Tổ Media vào task của Tổ Nội dung
    await expect(assignTaskMembers(leadNd, t1.id, { memberIds: [memMedia.memberId] })).rejects.toMatchObject({ status: 403 });

    // Lead Nội dung phân công Task 1 cho memNd
    await assignTaskMembers(leadNd, t1.id, { memberIds: [memNd.memberId], note: "Em triển khai nhé" });
    const myWorkLeadNdAfter = await getMyWork(leadNd);
    expect(myWorkLeadNdAfter.delegationQueue.some((d) => d.taskId === t1.id)).toBe(false);

    // Lead Nội dung giao tiếp Task 2 (vốn giao thẳng cho Lead) xuống memNd -> assignment của Lead chuyển TRANSFERRED
    const leadT2Ass = t2.assignments.find((a) => a.memberId === leadNd.memberId)!;
    await assignTaskMembers(leadNd, t2.id, {
      memberIds: [memNd.memberId],
      replaceAssignmentIds: [leadT2Ass.id],
      note: "Giao tiếp từ Tổ trưởng xuống thành viên",
    });
    const detailAfterDelegate = await getMissionDetail(leadNd, created.id);
    const t2After = detailAfterDelegate.tasks.find((t) => t.id === t2.id)!;
    expect(t2After.assignments.find((a) => a.id === leadT2Ass.id)?.status).toBe("TRANSFERRED");
    expect(t2After.assignments.some((a) => a.memberId === memNd.memberId && a.status === "PENDING")).toBe(true);

    // Lead Nội dung tách thêm 1 task mới trong tổ mình; bị chặn nếu cố tách sang Tổ Media
    await expect(
      addTaskToMission(leadNd, created.id, {
        title: "Task sai tổ",
        ownerTeamId: teamMediaId,
        deadline: deadlineFuture,
      }),
    ).rejects.toMatchObject({ status: 403 });

    const splitTask = await addTaskToMission(leadNd, created.id, {
      title: "Rà soát câu chữ trước đăng",
      ownerTeamId: teamNdId,
      deadline: deadlineFuture,
      weight: 1,
      assigneeIds: [memNd.memberId],
    });
    expect(splitTask.code).toMatch(/-T3$/);

    // Kiểm tra báo cáo tải nhân sự (getMembersWorkload) & phân quyền nghiêm ngặt
    await expect(getMembersWorkload(memNd)).rejects.toMatchObject({ status: 403 });

    const workloadForLeadNd = await getMembersWorkload(leadNd);
    const leadVisibleIds = workloadForLeadNd.members.map((m) => m.memberId);
    expect(leadVisibleIds).toContain(memNd.memberId);
    expect(leadVisibleIds).not.toContain(memMedia.memberId);
    expect(leadVisibleIds).not.toContain(head.memberId);

    const memNdWorkload = workloadForLeadNd.members.find((m) => m.memberId === memNd.memberId)!;
    expect(memNdWorkload.counts.pending).toBeGreaterThanOrEqual(3);
    expect(memNdWorkload.activeTasks.length).toBeGreaterThanOrEqual(3);

    const workloadForHead = await getMembersWorkload(head);
    expect(workloadForHead.members.some((m) => m.memberId === memMedia.memberId)).toBe(true);

    // Danh bạ kèm workload ẩn workload của thành viên ngoài tổ đối với TEAM_LEAD
    const dirForLeadNd = await listMembersDirectory(leadNd, { includeWorkload: true });
    const mediaEntry = dirForLeadNd.find((m) => m.id === memMedia.memberId);
    const ndEntry = dirForLeadNd.find((m) => m.id === memNd.memberId);
    expect(mediaEntry?.workload).toBeNull();
    expect(ndEntry?.workload?.activeTotal).toBeGreaterThanOrEqual(3);
  });

  it("Kịch bản 12: Quy trình đăng ký xin dời deadline (duyệt giữ dấu vết / từ chối → chuyển người khác) và Tài khoản nội bộ (provider = local) cho thành viên không thuộc Đoàn trực thuộc", async () => {
    // --- Phần A: Tài khoản nội bộ trực tiếp (VD Tổ VietGENIUS) ---
    const vgTeam = await query<{ id: string }>("SELECT id FROM teams WHERE code = 'VIETGENIUS'");
    const teamVgId = vgTeam[0].id;

    // Không phải Bậc 01.01 (HEAD) không được tạo tài khoản nội bộ
    await expect(
      createLocalMember(deputy, {
        username: "khongduoc.tao",
        displayName: "Người Test",
        password: "Password@123",
        role: "MEMBER",
        primaryTeamId: teamVgId,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Bậc 01.01 tạo tài khoản nội bộ cho anh Trung Việt (Tổ VietGENIUS)
    const localCreated = await createLocalMember(head, {
      username: "trungviet.vg",
      displayName: "Nguyễn Trung Việt",
      password: "InitPassword@2026",
      email: "trungviet@example.com",
      currentOrg: "Cộng tác viên chuyên môn Tổ VietGENIUS",
      role: "MEMBER",
      primaryTeamId: teamVgId,
    });
    expect(localCreated.username).toBe("trungviet.vg");

    // Trùng username bị chặn 409
    await expect(
      createLocalMember(head, {
        username: "TRUNGVIET.VG",
        displayName: "Trùng tên",
        password: "InitPassword@2026",
        role: "MEMBER",
        primaryTeamId: teamVgId,
      }),
    ).rejects.toMatchObject({ status: 409 });

    // Mật khẩu băm scrypt xác minh chính xác
    const credRow = await query<{ password_hash: string }>(
      "SELECT password_hash FROM local_credentials WHERE member_id = $1",
      [localCreated.memberId],
    );
    expect(verifyPassword("InitPassword@2026", credRow[0].password_hash)).toBe(true);
    expect(verifyPassword("WrongPassword", credRow[0].password_hash)).toBe(false);

    // Phiên tài khoản nội bộ vẫn hoạt động ngay cả khi cổng thông tin ngoài mất kết nối (không bị portal recheck)
    const localToken = await createSessionForMember(localCreated.memberId);
    setMockPortalSourceDown(true);
    const localActor = await resolveSessionActor(localToken, { forceRecheck: true });
    expect(localActor).not.toBeNull();
    expect(localActor?.provider).toBe("local");
    setMockPortalSourceDown(false);

    // Thành viên nội bộ tự đổi mật khẩu
    await changeOwnLocalPassword(localActor!, "InitPassword@2026", "NewStrongPw@2026");
    const credAfterChange = await query<{ password_hash: string; must_change_password: boolean }>(
      "SELECT password_hash, must_change_password FROM local_credentials WHERE member_id = $1",
      [localCreated.memberId],
    );
    expect(verifyPassword("NewStrongPw@2026", credAfterChange[0].password_hash)).toBe(true);
    expect(credAfterChange[0].must_change_password).toBe(false);

    // HEAD đặt lại mật khẩu -> thu hồi ngay phiên cũ
    await resetLocalMemberPassword(head, localCreated.memberId, "ResetPw@2026");
    expect(await resolveSessionActor(localToken)).toBeNull();

    // --- Phần B: Quy trình xin dời deadline (Duyệt lưu dấu vết + Từ chối rồi chuyển giao) ---
    const deadline24h = new Date(Date.now() + 24 * 3600_000).toISOString();
    const deadline72h = new Date(Date.now() + 72 * 3600_000).toISOString();
    const deadline48h = new Date(Date.now() + 48 * 3600_000).toISOString();

    const mission = await createMission(deputy, {
      groupId: groupAId,
      title: "Nhiệm vụ kiểm thử đăng ký xin dời deadline",
      description: "Kiểm thử cả 2 nhánh: duyệt dời có dấu vết và từ chối để chuyển người khác",
      ownerId: deputy.memberId,
      deadline: deadline72h,
      tasks: [
        { tempKey: "e1", title: "Task xin dời được duyệt", ownerTeamId: teamNdId, deadline: deadline24h, weight: 2, assigneeIds: [memNd.memberId] },
        { tempKey: "e2", title: "Task xin dời bị từ chối", ownerTeamId: teamNdId, deadline: deadline24h, weight: 2, assigneeIds: [memNd.memberId] },
      ],
    });

    const mDetail = await getMissionDetail(leadNd, mission.id);
    const ass1 = mDetail.tasks[0].assignments[0];
    const ass2 = mDetail.tasks[1].assignments[0];
    const originalDeadline1 = ass1.originalDeadline;

    // 1. Mem gửi đơn xin dời Task 1 -> hiện trong extensionQueue của Lead Nội dung (không hiện ở Lead Media)
    const ext1 = await requestDeadlineExtension(memNd, ass1.id, {
      requestedDeadline: deadline48h,
      reason: "Trùng lịch thi giữa kỳ ở trường, xin dời thêm 24 giờ",
    });
    expect(ext1.status).toBe("PENDING");

    // Chặn gửi đơn trùng khi đã có đơn PENDING
    await expect(
      requestDeadlineExtension(memNd, ass1.id, {
        requestedDeadline: deadline72h,
        reason: "Gửi trùng lần hai",
      }),
    ).rejects.toMatchObject({ status: 409 });

    const leadNdWork = await getMyWork(leadNd);
    expect(leadNdWork.extensionQueue.some((e) => e.id === ext1.id)).toBe(true);
    const leadMediaWork = await getMyWork(leadMedia);
    expect(leadMediaWork.extensionQueue.some((e) => e.id === ext1.id)).toBe(false);

    // Chặn tự duyệt và chặn trưởng tổ khác duyệt
    await expect(resolveDeadlineExtension(memNd, ext1.id, "approve", {})).rejects.toMatchObject({ status: 403 });
    await expect(resolveDeadlineExtension(leadMedia, ext1.id, "approve", {})).rejects.toMatchObject({ status: 403 });

    // Lead Nội dung duyệt dời hạn -> giữ nguyên originalDeadline, cập nhật evaluationDeadline, bật cờ dấu vết & lưu deadline_history
    await resolveDeadlineExtension(leadNd, ext1.id, "approve", {
      approvedDeadline: deadline48h,
      note: "Đồng ý gia hạn 24h",
    });
    const afterApprove = await getMissionDetail(leadNd, mission.id);
    const ass1After = afterApprove.tasks[0].assignments[0];
    expect(ass1After.originalDeadline).toBe(originalDeadline1);
    expect(ass1After.evaluationDeadline).toBe(deadline48h);
    expect(ass1After.lateAgainstOriginalDeadline).toBe(true);
    expect(ass1After.extensionCount).toBe(1);
    expect(afterApprove.deadlineHistory.some((h) => h.assignmentId === ass1.id && h.approvedException)).toBe(true);

    // 2. Mem gửi đơn xin dời Task 2 -> Lead từ chối rồi chuyển giao cho thành viên khác trong tổ
    const ext2 = await requestDeadlineExtension(memNd, ass2.id, {
      requestedDeadline: deadline48h,
      reason: "Em bận đột xuất không kịp làm tối nay",
    });
    const rej = await resolveDeadlineExtension(leadNd, ext2.id, "reject", {
      note: "Bài cần lên sóng gấp, tổ sẽ phân người khác hỗ trợ",
    });
    expect(rej.status).toBe("REJECTED");

    // Sau khi từ chối, Lead chuyển giao Task 2 cho chính lead hoặc 1 mem khác trong tổ
    const memNd2 = await createLocalMember(head, {
      username: "ctv.noidung2",
      displayName: "Trần CTV Nội Dung",
      password: "Password@2026",
      role: "MEMBER",
      primaryTeamId: teamNdId,
    });
    await assignmentAction(leadNd, ass2.id, "transfer", {
      newMemberId: memNd2.memberId,
      reason: "Từ chối xin dời hạn — phân người khác kịp tiến độ",
    });

    const afterRejectTransfer = await getMissionDetail(leadNd, mission.id);
    expect(afterRejectTransfer.extensionRequests.find((e) => e.id === ext2.id)?.status).toBe("REJECTED");
    expect(afterRejectTransfer.tasks[1].assignments.some((a) => a.memberId === memNd2.memberId && a.status === "PENDING")).toBe(true);
  });
});
