import { describe, expect, it } from "vitest";
import { can, canAssignToMember } from "@/server/authorization/policy";
import type { AuthActor } from "@/server/auth/session";
import { suggestUrgency } from "@/lib/constants";
import { classifyTimeliness, computeNextOccurrence } from "@/lib/date";
import { computeKpiFromAssignments } from "@/server/reports/kpi";
import { assertNoDependencyCycle } from "@/server/missions/workflow";
import { evaluateApprovalVotes } from "@/server/approvals/service";
import { sanitizeExcelCell } from "@/server/reports/excel";
import { validateFileBuffer } from "@/server/storage/local-storage";

function makeActor(overrides: Partial<AuthActor>): AuthActor {
  return {
    memberId: "m-1",
    memberCode: "BBT-001",
    provider: "tnth",
    externalAccountId: "1001",
    username: "user",
    displayName: "User",
    role: "MEMBER",
    accessEnabled: true,
    activityStatus: "ACTIVE",
    identityCheckedAt: new Date().toISOString(),
    roleVersion: 1,
    memberships: [],
    leadTeamIds: [],
    teamIds: ["team-a"],
    ...overrides,
  };
}

describe("Phân quyền 5 cấp bậc (ROLE-01 .. ROLE-05)", () => {
  const head = makeActor({ memberId: "head", role: "HEAD" });
  const acting = makeActor({ memberId: "acting", role: "ACTING_HEAD" });
  const deputy = makeActor({ memberId: "deputy", role: "DEPUTY" });
  const leadA = makeActor({ memberId: "leadA", role: "TEAM_LEAD", leadTeamIds: ["team-a"], teamIds: ["team-a"] });
  const memA = makeActor({ memberId: "memA", role: "MEMBER", teamIds: ["team-a"] });

  it("01.01 cấp quyền 01.02 trở xuống, thu hồi 02/03/04; 01.02 chỉ xem danh sách người khác", () => {
    expect(can(head, "member.access.grant", { grantRole: "ACTING_HEAD" })).toBe(true);
    expect(can(head, "member.access.grant", { grantRole: "HEAD" })).toBe(false);
    expect(can(head, "member.access.revoke", { targetMemberId: "deputy", targetRole: "DEPUTY" })).toBe(true);
    expect(can(head, "member.access.revoke", { targetMemberId: "acting", targetRole: "ACTING_HEAD" })).toBe(false);

    expect(can(acting, "member.profile.view", { targetMemberId: "memA", targetRole: "MEMBER" })).toBe(true);
    expect(can(acting, "member.profile.edit", { targetMemberId: "memA", targetRole: "MEMBER" })).toBe(false);
    expect(can(acting, "member.profile.edit", { targetMemberId: "acting", targetRole: "ACTING_HEAD" })).toBe(true);
    expect(can(acting, "group.manage")).toBe(false);
  });

  it("01.01 và 02 thêm/bỏ khối; 01.02, 03, 04 không có quyền mặc định", () => {
    expect(can(head, "group.manage")).toBe(true);
    expect(can(deputy, "group.manage")).toBe(true);
    expect(can(acting, "group.manage")).toBe(false);
    expect(can(leadA, "group.manage")).toBe(false);
    expect(can(memA, "group.manage")).toBe(false);
  });

  it("03 có ngoại lệ giao việc cho 01/02 nhưng không xem/sửa hồ sơ cấp trên và không giao tổ khác", () => {
    expect(canAssignToMember(leadA, { memberId: "deputy", role: "DEPUTY", teamIds: ["team-b"] })).toBe(true);
    expect(canAssignToMember(leadA, { memberId: "head", role: "HEAD", teamIds: ["team-b"] })).toBe(true);
    expect(canAssignToMember(leadA, { memberId: "memA", role: "MEMBER", teamIds: ["team-a"] })).toBe(true);
    expect(canAssignToMember(leadA, { memberId: "memB", role: "MEMBER", teamIds: ["team-b"] })).toBe(false);

    expect(can(leadA, "member.profile.view", { targetMemberId: "deputy", targetRole: "DEPUTY", targetTeamIds: ["team-a"] })).toBe(false);
    expect(can(leadA, "member.profile.edit", { targetMemberId: "deputy", targetRole: "DEPUTY", targetTeamIds: ["team-a"] })).toBe(false);
    expect(can(leadA, "member.access.revoke", { targetMemberId: "memA", targetRole: "MEMBER", targetTeamIds: ["team-a"] })).toBe(true);
    expect(can(leadA, "member.access.revoke", { targetMemberId: "memB", targetRole: "MEMBER", targetTeamIds: ["team-b"] })).toBe(false);
  });

  it("chặn tự nghiệm thu sản phẩm của chính mình kể cả với HEAD/TEAM_LEAD", () => {
    expect(can(head, "task.review", { ownerTeamId: "team-a", taskSubmitterId: "head" })).toBe(false);
    expect(can(leadA, "task.review", { ownerTeamId: "team-a", taskSubmitterId: "leadA" })).toBe(false);
    expect(can(leadA, "task.review", { ownerTeamId: "team-a", taskSubmitterId: "memA" })).toBe(true);
    expect(can(memA, "task.review", { ownerTeamId: "team-a", taskSubmitterId: "leadA" })).toBe(false);
  });
});

describe("Độ khẩn cấp, thời gian theo phút & lịch định kỳ", () => {
  it("phân loại đúng ranh giới 3h / 12h / 48h (TASK-02)", () => {
    const t0 = new Date("2026-11-25T08:00:00+07:00");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 45 * 60_000))).toBe("FLASH");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 3 * 3600_000))).toBe("FLASH");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 3.1 * 3600_000))).toBe("VERY_URGENT");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 12 * 3600_000))).toBe("VERY_URGENT");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 48 * 3600_000))).toBe("URGENT");
    expect(suggestUrgency(t0, new Date(t0.getTime() + 49 * 3600_000))).toBe("NORMAL");
  });

  it("phân loại trước/đúng/trễ hạn chính xác theo phút UTC (KPI-01)", () => {
    expect(classifyTimeliness("2026-11-25T10:00:59Z", "2026-11-25T10:00:00Z")).toBe("ON_TIME");
    expect(classifyTimeliness("2026-11-25T09:59:59Z", "2026-11-25T10:00:00Z")).toBe("EARLY");
    expect(classifyTimeliness("2026-11-25T10:01:00Z", "2026-11-25T10:00:00Z")).toBe("LATE");
  });

  it("lịch định kỳ tháng kẹp ngày 31 về cuối tháng 2 (RECUR-01)", () => {
    const next = computeNextOccurrence({
      frequency: "MONTHLY",
      intervalCount: 1,
      dayOfMonth: 31,
      runTime: "08:00",
      from: new Date("2026-01-31T08:00:00+07:00"),
    });
    expect(next.toISOString()).toBe(new Date("2026-02-28T08:00:00+07:00").toISOString());
  });
});

describe("Công thức KPI 60/40 (KPI-01 .. KPI-03)", () => {
  it("tính đúng ví dụ 72 điểm từ đặc tả mục 10.2", () => {
    // Tổng 10 điểm khối lượng, hoàn thành 8 (6 đúng/trước hạn, 2 trễ), 2 chưa hoàn thành
    const res = computeKpiFromAssignments([
      {
        assignmentId: "a1", taskId: "t1", taskCode: "T1", taskTitle: "Task 1", missionCode: "M1",
        status: "COMPLETED", weight: 6,
        originalDeadline: "2026-11-20T10:00:00Z", evaluationDeadline: "2026-11-20T10:00:00Z",
        effectiveSubmittedAt: "2026-11-20T09:00:00Z", reviewedAt: "2026-11-21T10:00:00Z", // duyệt trễ nhưng nộp sớm!
        exclusionReason: null, lateAgainstOriginalDeadline: false,
      },
      {
        assignmentId: "a2", taskId: "t2", taskCode: "T2", taskTitle: "Task 2", missionCode: "M1",
        status: "COMPLETED", weight: 2,
        originalDeadline: "2026-11-20T10:00:00Z", evaluationDeadline: "2026-11-20T10:00:00Z",
        effectiveSubmittedAt: "2026-11-20T11:00:00Z", reviewedAt: "2026-11-20T12:00:00Z",
        exclusionReason: null, lateAgainstOriginalDeadline: true,
      },
      {
        assignmentId: "a3", taskId: "t3", taskCode: "T3", taskTitle: "Task 3", missionCode: "M1",
        status: "ACCEPTED", weight: 2,
        originalDeadline: "2026-11-20T10:00:00Z", evaluationDeadline: "2026-11-20T10:00:00Z",
        effectiveSubmittedAt: null, reviewedAt: null,
        exclusionReason: null, lateAgainstOriginalDeadline: false,
      },
    ]);

    expect(res.eligibleWeight).toBe(10);
    expect(res.completedWeight).toBe(8);
    expect(res.ontimeWeight).toBe(6);
    expect(res.completionRate).toBe(80);
    expect(res.ontimeRate).toBe(75);
    expect(res.score).toBe(72);
  });

  it("không giao việc trả N/A (null), không phạt từ chối", () => {
    const res = computeKpiFromAssignments([
      {
        assignmentId: "a1", taskId: "t1", taskCode: "T1", taskTitle: "T", missionCode: "M1",
        status: "DECLINED", weight: 3,
        originalDeadline: "2026-11-20T10:00:00Z", evaluationDeadline: "2026-11-20T10:00:00Z",
        effectiveSubmittedAt: null, reviewedAt: null,
        exclusionReason: null, lateAgainstOriginalDeadline: false,
      },
    ]);
    expect(res.eligibleWeight).toBe(0);
    expect(res.score).toBeNull();
    expect(res.counts.declined).toBe(1);
  });
});

describe("Đồ thị phụ thuộc, Đồng xác nhận, Excel & Bảo mật tệp", () => {
  it("chặn chu trình phụ thuộc task (TASK-06)", () => {
    expect(() => assertNoDependencyCycle([["t1", "t2"], ["t2", "t3"]])).not.toThrow();
    expect(() => assertNoDependencyCycle([["t1", "t2"], ["t2", "t1"]])).toThrow();
    expect(() => assertNoDependencyCycle([["t1", "t1"]])).toThrow();
  });

  it("đánh giá đồng xác nhận: danh sách rỗng không auto duyệt, cần đủ nhóm riêng biệt (REG-01..03)", () => {
    const emptyRes = evaluateApprovalVotes({
      policy: { requiredGroups: { TEAM_LEAD: "ALL" }, requireDistinctVotersAcrossGroups: true },
      eligibleVoters: [],
      votes: [],
    });
    expect(emptyRes.status).toBe("PENDING");

    const actingReg = evaluateApprovalVotes({
      policy: { requiredGroups: { DEPUTY: "ANY_ONE", TEAM_LEAD: "ANY_ONE" }, requireDistinctVotersAcrossGroups: true },
      eligibleVoters: [
        { memberId: "dep1", requiredGroup: "DEPUTY" },
        { memberId: "lead1", requiredGroup: "TEAM_LEAD" },
      ],
      votes: [{ memberId: "dep1", decision: "APPROVE" }],
    });
    expect(actingReg.status).toBe("PENDING");

    const actingRegDone = evaluateApprovalVotes({
      policy: { requiredGroups: { DEPUTY: "ANY_ONE", TEAM_LEAD: "ANY_ONE" }, requireDistinctVotersAcrossGroups: true },
      eligibleVoters: [
        { memberId: "dep1", requiredGroup: "DEPUTY" },
        { memberId: "lead1", requiredGroup: "TEAM_LEAD" },
      ],
      votes: [
        { memberId: "dep1", decision: "APPROVE" },
        { memberId: "lead1", decision: "APPROVE" },
      ],
    });
    expect(actingRegDone.status).toBe("READY_TO_APPLY");
  });

  it("chống Excel Formula Injection (EXCEL-02)", () => {
    expect(sanitizeExcelCell("=SUM(A1:A5)")).toBe("'=SUM(A1:A5)");
    expect(sanitizeExcelCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(sanitizeExcelCell("-2+3")).toBe("'-2+3");
    expect(sanitizeExcelCell("@IMPORT")).toBe("'@IMPORT");
    expect(sanitizeExcelCell("Bài viết 20/11")).toBe("Bài viết 20/11");
  });

  it("chặn tệp thực thi/SVG và kiểm tra magic bytes (SUB-04)", () => {
    expect(() => validateFileBuffer(Buffer.from("<svg></svg>"), "hack.svg", "SUBMISSION")).toThrow();
    expect(() => validateFileBuffer(Buffer.from("echo hi"), "run.sh", "SUBMISSION")).toThrow();
    expect(() => validateFileBuffer(Buffer.from("not a pdf"), "fake.pdf", "SUBMISSION")).toThrow();
    expect(() => validateFileBuffer(Buffer.from("%PDF-1.7\ncontent"), "ok.pdf", "SUBMISSION")).not.toThrow();
  });
});
