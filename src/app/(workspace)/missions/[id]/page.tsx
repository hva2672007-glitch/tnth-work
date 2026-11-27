"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileDown,
  Link2,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Send,
  Upload,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch, randomIdempotencyKey } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { ConfidentialityBadge, ImportanceBadge, StatusBadge, UrgencyBadge, WorkloadBadge, type WorkloadLevelUi } from "@/components/badges";
import {
  COMPLETION_MODE_LABELS,
  MAX_REVISION_RETURNS,
  WEIGHT_OPTIONS,
  type CompletionMode,
  type ConfidentialityLevel,
  type ImportanceLevel,
  type MissionStatus,
  type SubmissionMode,
  type UrgencyLevel,
} from "@/lib/constants";
import { formatVnDateTime, isoToVnLocalInput, vnLocalInputToIso } from "@/lib/date";

interface MissionDetail {
  id: string;
  code: string;
  groupName: string;
  title: string;
  description: string;
  expectedOutcome: string;
  refs: { label: string; url: string }[];
  directiveAuthorities?: string[];
  confidentiality?: ConfidentialityLevel;
  observerMode?: boolean;
  ownerName: string;
  creatorName: string;
  status: MissionStatus;
  importance: ImportanceLevel;
  urgency: UrgencyLevel;
  deadlineOriginal: string;
  deadlineCurrent: string;
  isOverdue: boolean;
  completionMode: CompletionMode;
  holdUntil: string | null;
  holdReason: string | null;
  cancelReason: string | null;
  version: number;
  teams: { id: string; name: string }[];
  completion: {
    requiredTaskCount: number;
    completedTaskCount: number;
    requiredPublicationCount: number;
    completedPublicationCount: number;
    canComplete: boolean;
    reasons: string[];
  };
  permissions: { canManage: boolean; canComplete: boolean };
  tasks: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    deliverable: string;
    ownerTeamId: string;
    ownerTeamName: string;
    ownerName: string;
    reviewerName: string | null;
    submissionMode: SubmissionMode;
    weight: number;
    urgency: UrgencyLevel;
    deadlineCurrent: string;
    isOverdue: boolean;
    status: string;
    canManageTask: boolean;
    isBlocked: boolean;
    dependencies: { taskId: string; code: string; title: string; status: string }[];
    supervisors: { memberId: string; displayName: string }[];
    assignments: Array<{
      id: string;
      memberId: string;
      memberName: string;
      status: string;
      declineReason: string | null;
      originalDeadline: string;
      evaluationDeadline: string;
      lateAgainstOriginalDeadline: boolean;
      extensionCount: number;
      revisionCount?: number;
      needsReassignment?: boolean;
      pendingExtension: {
        id: string;
        requestedDeadline: string;
        reason: string;
        createdAt: string;
      } | null;
      weight: number;
      submittedAt: string | null;
      effectiveSubmittedAt: string | null;
      reviewedAt: string | null;
      transferReason?: string | null;
    }>;
    submissions: Array<{
      submissionId: string;
      versionId: string;
      versionNo: number;
      submissionType: string;
      note: string;
      textContent: string;
      links: { label: string; url: string; kind?: string }[];
      submittedAt: string;
      submittedBy: string;
      submittedByName: string;
      state: string;
      canReview: boolean;
      review: { id: string; decision: string; note: string; reviewerName: string; reviewedAt: string } | null;
      files: { id: string; originalName: string; relativePath: string | null; safeMime: string; sizeBytes: number }[];
    }>;
  }>;
  publications: Array<{
    id: string;
    channelId: string;
    channelName: string;
    required: boolean;
    requiredCount: number;
    confirmedAt: string | null;
    confirmedByName: string | null;
    links: { id: string; url: string; title: string; postedAt: string | null; createdByName: string; createdAt: string }[];
  }>;
  comments: Array<{
    id: string;
    taskId: string | null;
    authorName: string;
    body: string;
    createdAt: string;
  }>;
  activities: Array<{ id: string; summary: string; createdAt: string }>;
  deadlineHistory: Array<{
    id: string;
    assigneeName?: string | null;
    approvedException?: boolean;
    oldDeadline: string;
    newDeadline: string;
    reason: string;
    changedByName: string;
    changedAt: string;
  }>;
  extensionRequests: Array<{
    id: string;
    assignmentId: string;
    taskId: string;
    taskCode: string;
    taskTitle: string;
    ownerTeamId: string;
    requesterId: string;
    requesterName: string;
    currentDeadline: string;
    requestedDeadline: string;
    reason: string;
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    approvedDeadline: string | null;
    resolverId: string | null;
    resolverName: string | null;
    resolverNote: string;
    resolvedAt: string | null;
    createdAt: string;
    canResolve: boolean;
  }>;
}

interface ChannelOption {
  id: string;
  name: string;
  allowCustomName?: boolean;
}

interface TeamOption {
  id: string;
  name: string;
  active?: boolean;
}

interface MemberCandidate {
  id: string;
  displayName: string;
  role: string;
  primaryTeam: { id: string; name: string } | null;
  teams?: { id: string; name: string; isPrimary: boolean; title: string }[];
  workload?: {
    activeTotal: number;
    overdue: number;
    workloadLevel: WorkloadLevelUi;
  } | null;
}

type ModalMode =
  | { kind: "ASSIGN"; taskId: string; taskCode: string; taskTitle: string; ownerTeamId: string; ownerTeamName: string; existingActiveMemberIds: string[]; currentSubmissionMode: SubmissionMode; replaceAssignmentId?: string; replaceMemberName?: string }
  | { kind: "TRANSFER"; assignmentId: string; currentMemberId: string; currentMemberName: string; taskCode: string; taskTitle: string; ownerTeamId: string; ownerTeamName: string };

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { actor } = useAuth();

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [members, setMembers] = useState<MemberCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal phân công / giao tiếp xuống mem / chuyển giao
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [modalSelectedIds, setModalSelectedIds] = useState<string[]>([]);
  const [modalSearch, setModalSearch] = useState("");
  const [modalFilterTeam, setModalFilterTeam] = useState(true);
  const [modalNote, setModalNote] = useState("");
  const [modalSubmissionMode, setModalSubmissionMode] = useState<SubmissionMode>("INDIVIDUAL");
  const [modalBusy, setModalBusy] = useState(false);

  // Modal thành viên xin dời deadline
  const [extReqModal, setExtReqModal] = useState<{
    assignmentId: string;
    taskCode: string;
    taskTitle: string;
    currentDeadline: string;
  } | null>(null);
  const [extNewDeadlineLocal, setExtNewDeadlineLocal] = useState("");
  const [extReason, setExtReason] = useState("");
  const [extBusy, setExtBusy] = useState(false);

  // Modal cấp trên duyệt / từ chối đơn xin dời deadline
  const [resolveExtModal, setResolveExtModal] = useState<{
    req: MissionDetail["extensionRequests"][number];
    decision: "approve" | "reject";
  } | null>(null);
  const [resolveApprovedLocal, setResolveApprovedLocal] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [resolveSyncMission, setResolveSyncMission] = useState(false);
  const [resolveOpenTransferOnReject, setResolveOpenTransferOnReject] = useState(true);
  const [resolveBusy, setResolveBusy] = useState(false);

  // Form thêm / tách task mới trong nhiệm vụ
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDeliverable, setNewTaskDeliverable] = useState("");
  const [newTaskTeamId, setNewTaskTeamId] = useState("");
  const [newTaskWeight, setNewTaskWeight] = useState(1);
  const [newTaskDeadlineLocal, setNewTaskDeadlineLocal] = useState("");
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskSubmissionMode, setNewTaskSubmissionMode] = useState<SubmissionMode>("INDIVIDUAL");
  const [addingTask, setAddingTask] = useState(false);

  // Form nộp sản phẩm theo task
  const [submitTaskId, setSubmitTaskId] = useState<string | null>(null);
  const [subLinks, setSubLinks] = useState<Array<{ label: string; url: string; kind: "LINK" | "FOLDER" }>>([
    { label: "Link sản phẩm (Drive/Canva)", url: "", kind: "LINK" },
  ]);
  const [subNote, setSubNote] = useState("");
  const [subText, setSubText] = useState("");
  const [subFiles, setSubFiles] = useState<Array<{ id: string; originalName: string }>>([]);
  const [uploading, setUploading] = useState(false);

  // Form thêm link đăng tải
  const [pubReqId, setPubReqId] = useState("");
  const [pubChannelId, setPubChannelId] = useState("");
  const [pubCustomChannelName, setPubCustomChannelName] = useState("");
  const [pubUrl, setPubUrl] = useState("");
  const [pubConfirm, setPubConfirm] = useState(true);

  // Bình luận
  const [commentBody, setCommentBody] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<MissionDetail>(`/api/v1/missions/${id}`);
      setMission(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được chi tiết nhiệm vụ.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadMembersWithWorkload = useCallback(async () => {
    if (actor?.role === "OBSERVER") return;
    try {
      const m = await apiFetch<MemberCandidate[]>("/api/v1/members?activityStatus=ACTIVE&includeWorkload=true");
      setMembers(m.filter((x) => x.role !== "OBSERVER"));
    } catch {
      // ignore
    }
  }, [actor?.role]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        void load();
        void loadMembersWithWorkload();
      }
    });
    apiFetch<ChannelOption[]>("/api/v1/channels").then(setChannels).catch(() => {});
    apiFetch<TeamOption[]>("/api/v1/teams").then(setTeams).catch(() => {});
    return () => {
      active = false;
    };
  }, [load, loadMembersWithWorkload]);

  const runAction = async (fn: () => Promise<unknown>, successMsg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await Promise.all([load(), loadMembersWithWorkload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
    }
  };

  const openAssignModal = (
    task: MissionDetail["tasks"][number],
    replaceAssignment?: { id: string; memberName: string },
  ) => {
    const activeIds = task.assignments
      .filter((a) => !["TRANSFERRED", "CANCELLED", "DECLINED"].includes(a.status))
      .map((a) => a.memberId);
    setModal({
      kind: "ASSIGN",
      taskId: task.id,
      taskCode: task.code,
      taskTitle: task.title,
      ownerTeamId: task.ownerTeamId,
      ownerTeamName: task.ownerTeamName,
      existingActiveMemberIds: activeIds,
      currentSubmissionMode: task.submissionMode,
      replaceAssignmentId: replaceAssignment?.id,
      replaceMemberName: replaceAssignment?.memberName,
    });
    setModalSelectedIds([]);
    setModalSearch("");
    setModalFilterTeam(true);
    setModalNote("");
    setModalSubmissionMode(task.submissionMode);
  };

  const openTransferModal = (
    task: MissionDetail["tasks"][number],
    assignment: MissionDetail["tasks"][number]["assignments"][number],
    prefillReason = "",
  ) => {
    setModal({
      kind: "TRANSFER",
      assignmentId: assignment.id,
      currentMemberId: assignment.memberId,
      currentMemberName: assignment.memberName,
      taskCode: task.code,
      taskTitle: task.title,
      ownerTeamId: task.ownerTeamId,
      ownerTeamName: task.ownerTeamName,
    });
    setModalSelectedIds([]);
    setModalSearch("");
    setModalFilterTeam(true);
    setModalNote(prefillReason);
  };

  const openRequestExtensionModal = (
    task: MissionDetail["tasks"][number],
    assignment: MissionDetail["tasks"][number]["assignments"][number],
  ) => {
    const baseMs = Math.max(Date.now(), new Date(assignment.evaluationDeadline).getTime());
    setExtReqModal({
      assignmentId: assignment.id,
      taskCode: task.code,
      taskTitle: task.title,
      currentDeadline: assignment.evaluationDeadline,
    });
    setExtNewDeadlineLocal(isoToVnLocalInput(new Date(baseMs + 24 * 3600_000)));
    setExtReason("");
  };

  const submitExtensionRequest = async () => {
    if (!extReqModal || extReason.trim().length < 5) return;
    setExtBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/assignments/${extReqModal.assignmentId}/extension-requests`, {
        method: "POST",
        body: JSON.stringify({
          requestedDeadline: vnLocalInputToIso(extNewDeadlineLocal),
          reason: extReason.trim(),
        }),
      });
      setExtReqModal(null);
      setNotice("Đã gửi yêu cầu xin dời deadline tới cấp trên để xem xét.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể gửi yêu cầu xin dời deadline.");
    } finally {
      setExtBusy(false);
    }
  };

  const openResolveExtensionModal = (
    req: MissionDetail["extensionRequests"][number],
    decision: "approve" | "reject",
  ) => {
    setResolveExtModal({ req, decision });
    setResolveApprovedLocal(isoToVnLocalInput(new Date(req.requestedDeadline)));
    setResolveNote("");
    setResolveSyncMission(false);
    setResolveOpenTransferOnReject(true);
  };

  const submitResolveExtension = async () => {
    if (!resolveExtModal || !mission) return;
    const { req, decision } = resolveExtModal;
    if (decision === "reject" && resolveNote.trim().length < 3) {
      setError("Vui lòng nhập lý do từ chối xin dời deadline.");
      return;
    }
    setResolveBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/deadline-extension-requests/${req.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(
          decision === "approve"
            ? {
                approvedDeadline: vnLocalInputToIso(resolveApprovedLocal),
                note: resolveNote.trim() || undefined,
                syncMissionDeadline: resolveSyncMission,
              }
            : {
                note: resolveNote.trim(),
              },
        ),
      });
      const rejectedNote = resolveNote.trim();
      const shouldTransfer = decision === "reject" && resolveOpenTransferOnReject;
      setResolveExtModal(null);
      setNotice(
        decision === "approve"
          ? `Đã duyệt dời deadline cho ${req.requesterName} và lưu đầy đủ lịch sử.`
          : `Đã từ chối đơn xin dời hạn của ${req.requesterName}.`,
      );
      await Promise.all([load(), loadMembersWithWorkload()]);

      // Nếu từ chối và cấp trên chọn phân người khác ngay → mở luôn modal Chuyển giao
      if (shouldTransfer) {
        const targetTask = mission.tasks.find((t) => t.id === req.taskId);
        const targetAss = targetTask?.assignments.find((a) => a.id === req.assignmentId);
        if (targetTask && targetAss) {
          openTransferModal(
            targetTask,
            targetAss,
            `Từ chối xin dời hạn của ${req.requesterName} (${rejectedNote}) — chuyển giao để kịp tiến độ`,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xử lý yêu cầu xin dời hạn.");
    } finally {
      setResolveBusy(false);
    }
  };

  const modalCandidates = useMemo(() => {
    if (!modal) return [];
    let list = members.filter((m) => m.role !== "OBSERVER");
    if (actor?.role === "TEAM_LEAD" || actor?.role === "TEAM_DEPUTY") {
      list = list.filter(
        (m) =>
          m.id === actor.memberId ||
          ["HEAD", "ACTING_HEAD", "DEPUTY_INSPECTOR", "DEPUTY"].includes(m.role) ||
          (m.teams ?? []).some((tm) => actor.leadTeamIds.includes(tm.id)),
      );
    }
    if (modal.kind === "ASSIGN") {
      list = list.filter((m) => !modal.existingActiveMemberIds.includes(m.id));
    } else {
      list = list.filter((m) => m.id !== modal.currentMemberId);
    }
    if (modalFilterTeam) {
      list = list.filter((m) => (m.teams ?? []).some((tm) => tm.id === modal.ownerTeamId));
    }
    if (modalSearch.trim()) {
      const q = modalSearch.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.displayName.toLowerCase().includes(q) ||
          (m.primaryTeam?.name.toLowerCase().includes(q) ?? false),
      );
    }
    // Ưu tiên người rảnh & thuộc tổ lên trước
    return [...list].sort((a, b) => {
      const aLoad = a.workload?.activeTotal ?? 99;
      const bLoad = b.workload?.activeTotal ?? 99;
      if (aLoad !== bLoad) return aLoad - bLoad;
      return a.displayName.localeCompare(b.displayName, "vi");
    });
  }, [modal, members, actor, modalFilterTeam, modalSearch]);

  const submitModal = async () => {
    if (!modal || modalSelectedIds.length === 0) return;
    if (modal.kind === "TRANSFER" && !modalNote.trim()) {
      setError("Vui lòng nhập lý do chuyển giao công việc.");
      return;
    }
    setModalBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (modal.kind === "ASSIGN") {
        await apiFetch(`/api/v1/tasks/${modal.taskId}/assignments`, {
          method: "POST",
          body: JSON.stringify({
            memberIds: modalSelectedIds,
            submissionMode: modalSubmissionMode,
            replaceAssignmentIds: modal.replaceAssignmentId ? [modal.replaceAssignmentId] : undefined,
            note: modalNote.trim() || undefined,
          }),
        });
        setNotice(
          modal.replaceAssignmentId
            ? `Đã giao tiếp task ${modal.taskCode} xuống ${modalSelectedIds.length} thành viên.`
            : `Đã phân công ${modalSelectedIds.length} thành viên vào task ${modal.taskCode}.`,
        );
      } else {
        await apiFetch(`/api/v1/assignments/${modal.assignmentId}/transfer`, {
          method: "POST",
          body: JSON.stringify({
            newMemberId: modalSelectedIds[0],
            reason: modalNote.trim(),
          }),
        });
        const chosenName = members.find((m) => m.id === modalSelectedIds[0])?.displayName ?? "thành viên mới";
        setNotice(`Đã chuyển giao task ${modal.taskCode} cho ${chosenName}.`);
      }
      setModal(null);
      await Promise.all([load(), loadMembersWithWorkload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
    } finally {
      setModalBusy(false);
    }
  };

  const availableTeamsForNewTask = useMemo(() => {
    const activeTeams = teams.filter((t) => t.active !== false);
    if ((actor?.role === "TEAM_LEAD" || actor?.role === "TEAM_DEPUTY") && actor.leadTeamIds.length > 0) {
      return activeTeams.filter((t) => actor.leadTeamIds.includes(t.id));
    }
    return activeTeams;
  }, [actor, teams]);

  const openAddTaskForm = () => {
    if (!mission) return;
    setNewTaskTitle("");
    setNewTaskDeliverable("");
    setNewTaskTeamId(availableTeamsForNewTask[0]?.id ?? mission.teams[0]?.id ?? "");
    setNewTaskWeight(1);
    setNewTaskDeadlineLocal(isoToVnLocalInput(new Date(mission.deadlineCurrent)));
    setNewTaskAssigneeIds([]);
    setNewTaskSubmissionMode("INDIVIDUAL");
    setShowAddTask(true);
  };

  const handleAddTask = async () => {
    if (!mission || !newTaskTitle.trim() || !newTaskTeamId) return;
    setAddingTask(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/missions/${mission.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          deliverable: newTaskDeliverable.trim(),
          ownerTeamId: newTaskTeamId,
          weight: newTaskWeight,
          deadline: vnLocalInputToIso(newTaskDeadlineLocal),
          assigneeIds: newTaskAssigneeIds,
          submissionMode: newTaskAssigneeIds.length > 1 ? newTaskSubmissionMode : "INDIVIDUAL",
        }),
      });
      setShowAddTask(false);
      setNotice(`Đã thêm task "${newTaskTitle.trim()}" vào nhiệm vụ.`);
      await Promise.all([load(), loadMembersWithWorkload()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể thêm task mới.");
    } finally {
      setAddingTask(false);
    }
  };

  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("purpose", "SUBMISSION");
      for (const f of Array.from(fileList)) {
        form.append("files", f);
      }
      const res = await apiFetch<{ files: Array<{ id: string; originalName: string }> }>("/api/v1/files", {
        method: "POST",
        body: form,
      });
      setSubFiles((prev) => [...prev, ...res.files]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải tệp lên thất bại.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitProduct = async () => {
    if (!submitTaskId) return;
    await runAction(async () => {
      await apiFetch(`/api/v1/tasks/${submitTaskId}/submissions`, {
        method: "POST",
        idempotencyKey: randomIdempotencyKey(),
        body: JSON.stringify({
          note: subNote,
          textContent: subText,
          links: subLinks.filter((l) => l.url.trim()),
          fileIds: subFiles.map((f) => f.id),
        }),
      });
      setSubmitTaskId(null);
      setSubNote("");
      setSubText("");
      setSubFiles([]);
      setSubLinks([{ label: "Link sản phẩm (Drive/Canva)", url: "", kind: "LINK" }]);
    }, "Đã nộp sản phẩm thành công và gửi thông báo nghiệm thu.");
  };

  const selectedPubChannelObj = useMemo(
    () => channels.find((c) => c.id === pubChannelId) ?? null,
    [channels, pubChannelId],
  );

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Đang tải chi tiết nhiệm vụ...</div>;
  if (!mission) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {error ?? "Không tìm thấy nhiệm vụ."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Action bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/missions" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600">
              <ArrowLeft className="h-3.5 w-3.5" /> Danh sách nhiệm vụ
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-blue-700">{mission.code}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                Khối: {mission.groupName}
              </span>
              <UrgencyBadge urgency={mission.urgency} />
              <ImportanceBadge importance={mission.importance} />
              <ConfidentialityBadge level={mission.confidentiality} />
              <StatusBadge status={mission.status} kind="mission" />
            </div>
            <h1 className="mt-2 text-xl font-bold text-slate-900">{mission.title}</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            {mission.status === "DRAFT" && mission.permissions.canManage && (
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => apiFetch(`/api/v1/missions/${mission.id}/assign`, { method: "POST" }),
                    "Đã giao nhiệm vụ và gửi thông báo đến các thành viên / lãnh đạo tổ.",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Send className="h-3.5 w-3.5" /> Giao nhiệm vụ ngay
              </button>
            )}

            {mission.permissions.canComplete && (
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => apiFetch(`/api/v1/missions/${mission.id}/complete`, { method: "POST" }),
                    "Đã xác nhận hoàn thành nhiệm vụ!",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4" /> Xác nhận hoàn thành nhiệm vụ
              </button>
            )}

            {mission.permissions.canManage && !["DRAFT", "COMPLETED", "CANCELLED", "ON_HOLD"].includes(mission.status) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const newDue = window.prompt("Nhập deadline mới (YYYY-MM-DD HH:mm giờ VN):", "");
                    if (!newDue) return;
                    const reason = window.prompt("Lý do điều chỉnh deadline (bắt buộc):");
                    if (!reason) return;
                    const iso = new Date(`${newDue.replace(" ", "T")}:00+07:00`).toISOString();
                    void runAction(
                      () =>
                        apiFetch(`/api/v1/missions/${mission.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ version: mission.version, deadline: iso, deadlineReason: reason }),
                        }),
                      "Đã cập nhật deadline nhiệm vụ và lưu lịch sử.",
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Clock className="h-3.5 w-3.5" /> Sửa deadline
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const reason = window.prompt("Lý do tạm hoãn nhiệm vụ (bắt buộc):");
                    if (!reason) return;
                    const days = Number(window.prompt("Dự kiến tiếp tục sau bao nhiêu ngày?", "3") || "3");
                    const holdUntil = new Date(Date.now() + days * 86400_000).toISOString();
                    void runAction(
                      () =>
                        apiFetch(`/api/v1/missions/${mission.id}/hold`, {
                          method: "POST",
                          body: JSON.stringify({ reason, holdUntil }),
                        }),
                      "Đã tạm hoãn nhiệm vụ.",
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-800 hover:bg-purple-100"
                >
                  <PauseCircle className="h-3.5 w-3.5" /> Hoãn
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const reason = window.prompt("Lý do hủy nhiệm vụ (bắt buộc):");
                    if (!reason) return;
                    void runAction(
                      () =>
                        apiFetch(`/api/v1/missions/${mission.id}/cancel`, {
                          method: "POST",
                          body: JSON.stringify({ reason }),
                        }),
                      "Đã hủy nhiệm vụ (lịch sử được giữ nguyên).",
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  <XCircle className="h-3.5 w-3.5" /> Hủy
                </button>
              </>
            )}

            {mission.permissions.canManage && mission.status === "ON_HOLD" && (
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    () => apiFetch(`/api/v1/missions/${mission.id}/resume`, { method: "POST" }),
                    "Đã khôi phục nhiệm vụ.",
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <PlayCircle className="h-3.5 w-3.5" /> Tiếp tục triển khai
              </button>
            )}

            {mission.permissions.canManage && mission.status === "COMPLETED" && (
              <button
                type="button"
                onClick={() => {
                  const reason = window.prompt("Lý do mở lại nhiệm vụ đã hoàn thành (bắt buộc):");
                  if (!reason) return;
                  void runAction(
                    () =>
                      apiFetch(`/api/v1/missions/${mission.id}/reopen`, {
                        method: "POST",
                        body: JSON.stringify({ reason }),
                      }),
                    "Đã mở lại nhiệm vụ.",
                  );
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Mở lại
              </button>
            )}
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}
        {notice && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}

        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Chủ trì / Người giao</div>
            <div className="font-medium text-slate-900">{mission.ownerName} / {mission.creatorName}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Deadline hiện tại</div>
            <div className={`font-semibold ${mission.isOverdue ? "text-red-700" : "text-slate-900"}`}>
              {formatVnDateTime(mission.deadlineCurrent)} {mission.isOverdue ? "(QUÁ HẠN)" : ""}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Tiến độ hoàn thành</div>
            <div className="font-semibold text-slate-900">
              {mission.completion.completedTaskCount}/{mission.completion.requiredTaskCount} task ·{" "}
              {mission.completion.completedPublicationCount}/{mission.completion.requiredPublicationCount} kênh
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Điều kiện hoàn thành</div>
            <div className="text-xs font-medium text-slate-700">{COMPLETION_MODE_LABELS[mission.completionMode]}</div>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm text-slate-700">
          {mission.observerMode && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Chế độ xem dành cho Chuyên viên Trung ương Đoàn (Bậc 06):</strong> Hiển thị thông tin cơ bản và sản phẩm đã được nghiệm thu cuối cùng của nhiệm vụ hoàn thành.
            </div>
          )}
          {mission.directiveAuthorities && mission.directiveAuthorities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-600">Chỉ đạo của:</span>
              {mission.directiveAuthorities.map((d) => (
                <span key={d} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-800">
                  {d}
                </span>
              ))}
            </div>
          )}
          <p className="whitespace-pre-line">{mission.description}</p>
          {mission.expectedOutcome && (
            <p className="text-xs text-slate-600">
              <strong>Đầu ra kỳ vọng:</strong> {mission.expectedOutcome}
            </p>
          )}
          {mission.refs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-600">Ref:</span>
              {mission.refs.map((r, i) => (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> {r.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Danh sách Task & Sản phẩm */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Danh sách Task &amp; Sản phẩm ({mission.tasks.length})</h2>
          {mission.permissions.canManage && !["COMPLETED", "CANCELLED"].includes(mission.status) && (
            <button
              type="button"
              onClick={showAddTask ? () => setShowAddTask(false) : openAddTaskForm}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddTask ? "Đóng form thêm task" : "Thêm / Tách task mới"}
            </button>
          )}
        </div>

        {/* Form tách / thêm task mới cho Lead tổ hoặc Ban */}
        {showAddTask && (
          <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
            <div className="text-sm font-bold text-blue-950">Thêm / Tách task mới trong nhiệm vụ {mission.code}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-700">Tên task *</label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="VD: Viết kịch bản / Thiết kế ấn phẩm..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Tổ phụ trách *</label>
                <select
                  value={newTaskTeamId}
                  onChange={(e) => setNewTaskTeamId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  {availableTeamsForNewTask.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Trọng số</label>
                <select
                  value={newTaskWeight}
                  onChange={(e) => setNewTaskWeight(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  {WEIGHT_OPTIONS.map((w) => (
                    <option key={w} value={w}>Trọng số {w}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Deadline (≤ hạn nhiệm vụ)</label>
                <input
                  type="datetime-local"
                  value={newTaskDeadlineLocal}
                  onChange={(e) => setNewTaskDeadlineLocal(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-700">Sản phẩm yêu cầu</label>
                <input
                  type="text"
                  value={newTaskDeliverable}
                  onChange={(e) => setNewTaskDeliverable(e.target.value)}
                  placeholder="Link Docs / Canva / File ảnh..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              {newTaskAssigneeIds.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Chế độ nộp</label>
                  <select
                    value={newTaskSubmissionMode}
                    onChange={(e) => setNewTaskSubmissionMode(e.target.value as SubmissionMode)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                  >
                    <option value="INDIVIDUAL">Nộp riêng từng người</option>
                    <option value="SHARED">Nộp chung 1 sản phẩm</option>
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Chọn người thực hiện ngay ({newTaskAssigneeIds.length} đã chọn — để trống nếu giao về Tổ trưởng phân công sau)
              </label>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                {members
                  .filter((m) => (m.teams ?? []).some((tm) => tm.id === newTaskTeamId))
                  .map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newTaskAssigneeIds.includes(m.id)}
                          onChange={() =>
                            setNewTaskAssigneeIds((prev) =>
                              prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                            )
                          }
                        />
                        <span className="font-medium text-slate-900">{m.displayName}</span>
                      </span>
                      {m.workload && (
                        <WorkloadBadge
                          level={m.workload.workloadLevel}
                          activeTotal={m.workload.activeTotal}
                          overdue={m.workload.overdue}
                        />
                      )}
                    </label>
                  ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={addingTask || !newTaskTitle.trim()}
                onClick={() => void handleAddTask()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {addingTask ? "Đang tạo..." : "Lưu task mới"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddTask(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
              >
                Hủy
              </button>
            </div>
          </div>
        )}

        {mission.tasks.map((task) => {
          const myAss = task.assignments.find((a) => a.memberId === actor?.memberId && !["TRANSFERRED", "CANCELLED"].includes(a.status));
          const activeAssignments = task.assignments.filter((a) => !["TRANSFERRED", "CANCELLED", "DECLINED"].includes(a.status));
          const isTaskOpen = !["COMPLETED", "CANCELLED"].includes(task.status) && !["COMPLETED", "CANCELLED"].includes(mission.status);
          const canLeadDelegateOwn =
            task.canManageTask &&
            isTaskOpen &&
            myAss &&
            ["PENDING", "ACCEPTED"].includes(myAss.status);

          return (
            <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700">{task.code}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{task.ownerTeamName}</span>
                    <StatusBadge status={task.status} kind="task" />
                    <UrgencyBadge urgency={task.urgency} />
                    <span className="text-xs text-slate-500">Trọng số: {task.weight}</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-slate-900">{task.title}</h3>
                  {task.deliverable && (
                    <p className="mt-0.5 text-xs text-slate-600">Yêu cầu sản phẩm: {task.deliverable}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>Hạn: <strong className={task.isOverdue ? "text-red-700" : "text-slate-700"}>{formatVnDateTime(task.deadlineCurrent)}</strong></span>
                    <span>Nghiệm thu: <strong>{task.reviewerName ?? "Chưa gán reviewer"}</strong></span>
                    {task.supervisors.length > 0 && (
                      <span>Thường vụ phụ trách: {task.supervisors.map((s) => s.displayName).join(", ")}</span>
                    )}
                  </div>
                  {task.isBlocked && (
                    <div className="mt-2 rounded bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                      Đang chờ task tiền nhiệm:{" "}
                      {task.dependencies
                        .filter((d) => d.status !== "COMPLETED")
                        .map((d) => `${d.code} (${d.title})`)
                        .join(", ")}
                    </div>
                  )}
                </div>

                {/* Nút thao tác cá nhân & điều phối ngay trên task */}
                <div className="flex flex-wrap gap-2">
                  {canLeadDelegateOwn && (
                    <button
                      type="button"
                      onClick={() => openAssignModal(task, { id: myAss.id, memberName: myAss.memberName })}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      <Users className="h-3.5 w-3.5" /> Giao tiếp xuống thành viên
                    </button>
                  )}
                  {task.canManageTask && isTaskOpen && (
                    <button
                      type="button"
                      onClick={() => openAssignModal(task)}
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {activeAssignments.length === 0 ? "Phân công thành viên" : "Thêm người thực hiện"}
                    </button>
                  )}
                  {myAss?.status === "PENDING" && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () => apiFetch(`/api/v1/assignments/${myAss.id}/accept`, { method: "POST" }),
                            "Bạn đã xác nhận nhận việc!",
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        <Check className="h-3.5 w-3.5" /> Nhận việc
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const reason = window.prompt("Nhập lý do từ chối nhận việc (bắt buộc):");
                          if (!reason) return;
                          void runAction(
                            () =>
                              apiFetch(`/api/v1/assignments/${myAss.id}/decline`, {
                                method: "POST",
                                body: JSON.stringify({ reason }),
                              }),
                            "Đã từ chối nhận việc và thông báo lên quản lý.",
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Từ chối
                      </button>
                    </>
                  )}
                  {myAss && ["PENDING", "ACCEPTED", "REVISION_REQUIRED"].includes(myAss.status) && isTaskOpen && (
                    myAss.pendingExtension ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                        <CalendarClock className="h-3.5 w-3.5" /> Đang chờ duyệt dời hạn
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openRequestExtensionModal(task, myAss)}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        <CalendarClock className="h-3.5 w-3.5" /> Xin dời deadline
                      </button>
                    )
                  )}
                  {myAss && ["ACCEPTED", "REVISION_REQUIRED", "SUBMITTED"].includes(myAss.status) && (
                    <button
                      type="button"
                      onClick={() => setSubmitTaskId(submitTaskId === task.id ? null : task.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {myAss.status === "ACCEPTED" ? "Nộp sản phẩm" : "Nộp phiên bản mới"}
                    </button>
                  )}
                </div>
              </div>

              {/* Callout khi task chưa có thành viên thực hiện (đang chờ Tổ trưởng phân công) */}
              {activeAssignments.length === 0 && isTaskOpen && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                  <div>
                    <strong>Chờ phân công người thực hiện:</strong> Task này đang được giao về{" "}
                    <strong>{task.ownerTeamName}</strong> để Lãnh đạo tổ chọn thành viên triển khai.
                  </div>
                  {task.canManageTask && (
                    <button
                      type="button"
                      onClick={() => openAssignModal(task)}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Phân công ngay
                    </button>
                  )}
                </div>
              )}

              {/* Bảng phân công cá nhân */}
              {task.assignments.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
                  <table className="excel-table text-xs">
                    <thead>
                      <tr>
                        <th>Người thực hiện</th>
                        <th>Trạng thái</th>
                        <th>Thời hạn áp dụng</th>
                        <th>Trọng số</th>
                        <th>Nộp lúc</th>
                        <th>Nghiệm thu lúc</th>
                        <th>Ghi chú / Điều phối</th>
                      </tr>
                    </thead>
                    <tbody>
                      {task.assignments.map((a) => (
                        <tr key={a.id}>
                          <td className="font-medium text-slate-900">{a.memberName}</td>
                          <td>
                            <StatusBadge status={a.status} kind="assignment" />
                            {(a.revisionCount ?? 0) > 0 && (
                              <div className={`mt-0.5 text-[11px] font-semibold ${a.needsReassignment ? "text-red-700" : "text-amber-700"}`}>
                                Trả sửa: {a.revisionCount}/{MAX_REVISION_RETURNS} lần
                                {a.needsReassignment && " — Cần phân công lại!"}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            <div className="font-medium text-slate-800">{formatVnDateTime(a.evaluationDeadline)}</div>
                            {(a.extensionCount > 0 || a.lateAgainstOriginalDeadline) && (
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-amber-800">
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold">
                                  Đã dời hạn{a.extensionCount > 0 ? ` (${a.extensionCount} lần)` : ""}
                                </span>
                                <span className="text-slate-500">Gốc: {formatVnDateTime(a.originalDeadline)}</span>
                              </div>
                            )}
                            {a.pendingExtension && (
                              <div className="mt-0.5 text-[11px] font-medium text-indigo-700">
                                Xin dời → {formatVnDateTime(a.pendingExtension.requestedDeadline)}
                              </div>
                            )}
                          </td>
                          <td>{a.weight}</td>
                          <td>{formatVnDateTime(a.effectiveSubmittedAt ?? a.submittedAt)}</td>
                          <td>{formatVnDateTime(a.reviewedAt)}</td>
                          <td>
                            {a.declineReason && <span className="mr-2 text-red-700">Từ chối: {a.declineReason}</span>}
                            {a.status === "TRANSFERRED" && a.transferReason && (
                              <span className="text-slate-500">{a.transferReason}</span>
                            )}
                            {task.canManageTask && isTaskOpen && !["COMPLETED", "CANCELLED", "TRANSFERRED"].includes(a.status) && (
                              <span className="inline-flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openTransferModal(task, a)}
                                  className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
                                >
                                  <ArrowRightLeft className="h-3 w-3" /> Chuyển giao
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAssignModal(task, { id: a.id, memberName: a.memberName })}
                                  className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline"
                                >
                                  <Users className="h-3 w-3" /> Chia xuống mem
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Yêu cầu & lịch sử xin dời deadline theo task (lưu dấu vết toàn bộ) */}
              {(() => {
                const taskExtReqs = (mission.extensionRequests ?? []).filter((er) => er.taskId === task.id);
                if (taskExtReqs.length === 0) return null;
                return (
                  <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs">
                    <div className="flex items-center gap-1.5 font-bold text-amber-950">
                      <CalendarClock className="h-3.5 w-3.5 text-amber-700" />
                      Đăng ký xin dời deadline ({taskExtReqs.length})
                    </div>
                    {taskExtReqs.map((er) => (
                      <div key={er.id} className="rounded-lg border border-amber-200/80 bg-white p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-900">{er.requesterName}</span>
                            <span className="text-slate-500">
                              xin dời: {formatVnDateTime(er.currentDeadline)} →{" "}
                              <strong className="text-blue-700">{formatVnDateTime(er.requestedDeadline)}</strong>
                            </span>
                            {er.status === "PENDING" && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                Chờ duyệt
                              </span>
                            )}
                            {er.status === "APPROVED" && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                Đã duyệt ({formatVnDateTime(er.approvedDeadline)})
                              </span>
                            )}
                            {er.status === "REJECTED" && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                Đã từ chối
                              </span>
                            )}
                            {er.status === "CANCELLED" && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                Đã đóng
                              </span>
                            )}
                          </div>

                          {er.canResolve && (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => openResolveExtensionModal(er, "approve")}
                                className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                              >
                                Duyệt dời hạn
                              </button>
                              <button
                                type="button"
                                onClick={() => openResolveExtensionModal(er, "reject")}
                                className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
                              >
                                Từ chối &amp; phân người khác
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="mt-1 text-slate-700">
                          <strong>Lý do xin dời:</strong> {er.reason}{" "}
                          <span className="text-slate-400">({formatVnDateTime(er.createdAt)})</span>
                        </div>
                        {er.resolverName && (
                          <div className="mt-1 text-slate-600">
                            <strong>Xử lý bởi {er.resolverName}</strong> ({formatVnDateTime(er.resolvedAt)}):{" "}
                            {er.resolverNote || (er.status === "APPROVED" ? "Đồng ý cho dời hạn" : "—")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Form nộp sản phẩm inline (Link / File / Folder / Văn bản) */}
              {submitTaskId === task.id && (
                <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                  <div className="text-sm font-bold text-emerald-950">Nộp sản phẩm cho {task.code}</div>
                  <p className="text-xs text-slate-600">
                    Lưu ý: Nếu nộp link Google Drive/Canva, vui lòng mở quyền xem cho lãnh đạo tổ nghiệm thu.
                  </p>

                  {/* Links / Folder links */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-700">Link sản phẩm / Link thư mục</span>
                      <button
                        type="button"
                        onClick={() => setSubLinks((prev) => [...prev, { label: "Thư mục sản phẩm", url: "", kind: "FOLDER" }])}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        + Thêm link / folder
                      </button>
                    </div>
                    {subLinks.map((l, idx) => (
                      <div key={idx} className="grid gap-2 sm:grid-cols-4">
                        <input
                          type="text"
                          value={l.label}
                          onChange={(e) => setSubLinks((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))}
                          placeholder="Nhãn hiển thị"
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        />
                        <input
                          type="url"
                          value={l.url}
                          onChange={(e) => setSubLinks((p) => p.map((x, i) => (i === idx ? { ...x, url: e.target.value } : x)))}
                          placeholder="https://drive.google.com/... hoặc canva.com/..."
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
                        />
                        <select
                          value={l.kind}
                          onChange={(e) => setSubLinks((p) => p.map((x, i) => (i === idx ? { ...x, kind: e.target.value as "LINK" | "FOLDER" } : x)))}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value="LINK">Link sản phẩm</option>
                          <option value="FOLDER">Link thư mục</option>
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Upload file/ZIP */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Tải tệp nội bộ (PNG/JPG/WebP, PDF, Office, MP4/MOV, ZIP — tối đa 50MB/tệp)
                    </label>
                    <input
                      type="file"
                      multiple
                      disabled={uploading}
                      onChange={(e) => void handleUploadFiles(e.target.files)}
                      className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                    />
                    {uploading && <p className="mt-1 text-xs text-blue-600">Đang tải tệp lên kho nội bộ...</p>}
                    {subFiles.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-emerald-800">
                        {subFiles.map((f) => (
                          <li key={f.id}>✓ {f.originalName}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <textarea
                    rows={2}
                    value={subText}
                    onChange={(e) => setSubText(e.target.value)}
                    placeholder="Nội dung văn bản / checklist xác nhận (nếu task không có file/link)..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                  <input
                    type="text"
                    value={subNote}
                    onChange={(e) => setSubNote(e.target.value)}
                    placeholder="Ghi chú gửi người nghiệm thu..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => void handleSubmitProduct()}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Gửi nộp sản phẩm
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubmitTaskId(null)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              )}

              {/* Danh sách phiên bản sản phẩm đã nộp */}
              {task.submissions.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  <div className="text-xs font-bold text-slate-700">Sản phẩm đã nộp ({task.submissions.length} phiên bản)</div>
                  {task.submissions.map((sv) => (
                    <div key={sv.versionId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">Phiên bản v{sv.versionNo}</span>
                          <span className="text-slate-600">bởi {sv.submittedByName} · {formatVnDateTime(sv.submittedAt)}</span>
                          <StatusBadge status={sv.state} kind="task" />
                        </div>
                        {sv.canReview && (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const note = window.prompt("Nhận xét nghiệm thu (tuỳ chọn):", "Đạt yêu cầu") ?? "";
                                void runAction(
                                  () =>
                                    apiFetch(`/api/v1/submission-versions/${sv.versionId}/approve`, {
                                      method: "POST",
                                      idempotencyKey: randomIdempotencyKey(),
                                      body: JSON.stringify({ note }),
                                    }),
                                  `Đã phê duyệt phiên bản v${sv.versionNo}!`,
                                );
                              }}
                              className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                            >
                              Duyệt nghiệm thu
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const note = window.prompt("Nhập nội dung yêu cầu chỉnh sửa (bắt buộc):");
                                if (!note) return;
                                void runAction(
                                  () =>
                                    apiFetch(`/api/v1/submission-versions/${sv.versionId}/request-revision`, {
                                      method: "POST",
                                      idempotencyKey: randomIdempotencyKey(),
                                      body: JSON.stringify({ note }),
                                    }),
                                  `Đã gửi yêu cầu chỉnh sửa cho v${sv.versionNo}.`,
                                );
                              }}
                              className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700 hover:bg-red-100"
                            >
                              Yêu cầu sửa
                            </button>
                          </div>
                        )}
                      </div>

                      {sv.note && <p className="mt-1 text-slate-700">Ghi chú: {sv.note}</p>}
                      {sv.textContent && <p className="mt-1 whitespace-pre-line rounded bg-white p-2 text-slate-700">{sv.textContent}</p>}

                      {sv.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {sv.links.map((l, idx) => (
                            <a
                              key={idx}
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-1 font-medium text-blue-700 hover:underline"
                            >
                              <Link2 className="h-3 w-3" /> {l.label}
                            </a>
                          ))}
                        </div>
                      )}

                      {sv.files.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {sv.files.map((f) => (
                            <a
                              key={f.id}
                              href={`/api/v1/files/${f.id}/download`}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-blue-50"
                            >
                              <FileDown className="h-3 w-3 text-blue-600" />
                              {f.relativePath ?? f.originalName} ({Math.max(1, Math.round(f.sizeBytes / 1024))} KB)
                            </a>
                          ))}
                        </div>
                      )}

                      {sv.review && (
                        <div className="mt-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700">
                          <strong>Nghiệm thu ({sv.review.reviewerName} · {formatVnDateTime(sv.review.reviewedAt)}):</strong>{" "}
                          {sv.review.decision === "APPROVED" ? "Đã duyệt" : "Yêu cầu sửa"} — {sv.review.note || "Không có ghi chú"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Kênh đăng tải & Link đăng tải */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-base font-bold text-slate-900">Kênh đăng tải sản phẩm</h2>
        <div className="mt-3 space-y-3">
          {mission.publications.length === 0 ? (
            <p className="text-xs text-slate-500">Chưa có kênh đăng tải nào được gắn với nhiệm vụ này.</p>
          ) : (
            mission.publications.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">
                    {p.channelName} ({p.links.length}/{p.requiredCount} link)
                  </div>
                  <div className="flex items-center gap-2">
                    {p.confirmedAt ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                        ✓ Đã xác nhận ({p.confirmedByName})
                      </span>
                    ) : mission.permissions.canManage && p.links.length >= p.requiredCount ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            () => apiFetch(`/api/v1/publications/${p.id}`, { method: "PATCH" }),
                            "Đã xác nhận hoàn tất kênh đăng tải.",
                          )
                        }
                        className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                      >
                        Xác nhận kênh
                      </button>
                    ) : (
                      <span className="text-amber-700">Chờ cập nhật / xác nhận</span>
                    )}
                  </div>
                </div>
                {p.links.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {p.links.map((l) => (
                      <li key={l.id}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {l.url}
                        </a>{" "}
                        <span className="text-slate-400">({l.createdByName} · {formatVnDateTime(l.createdAt)})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}

          {/* Form cập nhật link đăng tải (hỗ trợ cả trang tùy chỉnh Khác) */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <select
                value={pubReqId || pubChannelId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (mission.publications.some((p) => p.id === val)) {
                    setPubReqId(val);
                    setPubChannelId("");
                    setPubCustomChannelName("");
                  } else {
                    setPubReqId("");
                    setPubChannelId(val);
                  }
                }}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">Chọn kênh đăng tải...</option>
                {mission.publications.map((p) => (
                  <option key={p.id} value={p.id}>
                    [Đã gắn] {p.channelName}
                  </option>
                ))}
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    + {c.allowCustomName ? "Trang / kênh khác..." : c.name}
                  </option>
                ))}
              </select>
              <input
                type="url"
                value={pubUrl}
                onChange={(e) => setPubUrl(e.target.value)}
                placeholder="https://facebook.com/... hoặc thanhnientruonghoc.io.vn/..."
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs sm:col-span-2"
              />
              <div className="flex items-center gap-2">
                {mission.permissions.canManage && (
                  <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                    <input type="checkbox" checked={pubConfirm} onChange={(e) => setPubConfirm(e.target.checked)} />
                    Xác nhận
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!pubUrl.trim()) return;
                    void runAction(async () => {
                      await apiFetch(`/api/v1/missions/${mission.id}/publications`, {
                        method: "POST",
                        body: JSON.stringify({
                          requirementId: pubReqId || undefined,
                          channelId: pubChannelId || undefined,
                          customChannelName: selectedPubChannelObj?.allowCustomName
                            ? pubCustomChannelName.trim() || undefined
                            : undefined,
                          url: pubUrl.trim(),
                          confirmChannel: mission.permissions.canManage ? pubConfirm : false,
                        }),
                      });
                      setPubUrl("");
                      setPubCustomChannelName("");
                    }, "Đã thêm đường dẫn đăng tải.");
                  }}
                  className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Thêm link
                </button>
              </div>
            </div>
            {selectedPubChannelObj?.allowCustomName && (
              <input
                type="text"
                value={pubCustomChannelName}
                onChange={(e) => setPubCustomChannelName(e.target.value)}
                placeholder="Nhập tên trang / kênh khác cụ thể (vd: Fanpage Hội Sinh viên...)"
                className="w-full rounded-lg border border-blue-300 bg-blue-50/40 px-3 py-1.5 text-xs sm:max-w-md"
              />
            )}
          </div>
        </div>
      </section>

      {/* Trao đổi theo nhiệm vụ & Lịch sử */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <MessageSquare className="h-4 w-4 text-blue-600" /> Trao đổi công việc ({mission.comments.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Hỗ trợ nhắc tên đồng đội bằng @username (vd @mem.noidung1)</p>
          <div className="mt-3 max-h-72 space-y-2.5 overflow-y-auto">
            {mission.comments.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có trao đổi nào.</p>
            ) : (
              mission.comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{c.authorName}</span>
                    <span className="text-slate-400">{formatVnDateTime(c.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{c.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Nhập trao đổi hoặc @username..."
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!commentBody.trim()) return;
                void runAction(async () => {
                  await apiFetch(`/api/v1/missions/${mission.id}/comments`, {
                    method: "POST",
                    body: JSON.stringify({ body: commentBody }),
                  });
                  setCommentBody("");
                }, "Đã gửi trao đổi.");
              }}
              className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Gửi
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="text-base font-bold text-slate-900">Lịch sử hoạt động &amp; đổi hạn</h2>
          {mission.deadlineHistory.length > 0 && (
            <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
              <div className="font-semibold text-amber-900">Lịch sử điều chỉnh &amp; dời deadline (lưu dấu vết)</div>
              {mission.deadlineHistory.map((d) => (
                <div key={d.id} className="text-amber-900">
                  {d.assigneeName && <span className="mr-1 rounded bg-amber-200/70 px-1.5 py-0.5 font-semibold">{d.assigneeName}</span>}
                  {formatVnDateTime(d.oldDeadline)} → <strong>{formatVnDateTime(d.newDeadline)}</strong> ({d.changedByName}: {d.reason})
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs">
            {mission.activities.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <span className="text-slate-700">{a.summary}</span>
                <span className="shrink-0 text-slate-400">{formatVnDateTime(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Modal Phân công / Giao tiếp xuống thành viên / Chuyển giao */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {modal.kind === "TRANSFER"
                    ? `Chuyển giao task ${modal.taskCode}`
                    : modal.replaceAssignmentId
                      ? `Giao tiếp task ${modal.taskCode} xuống thành viên`
                      : `Phân công thành viên cho ${modal.taskCode}`}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {modal.taskTitle} · {modal.ownerTeamName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {modal.kind === "ASSIGN" && modal.replaceAssignmentId && (
              <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                Phân công đầu mối của <strong>{modal.replaceMemberName}</strong> sẽ được chuyển sang trạng thái{" "}
                <em>Đã chuyển giao</em> (không bị tính vào KPI chậm/chưa nộp) và gửi việc xuống các thành viên bạn chọn bên dưới.
              </div>
            )}

            {modal.kind === "TRANSFER" && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Đang chuyển giao phần việc của <strong>{modal.currentMemberName}</strong> sang 01 thành viên khác.
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder="Tìm nhanh theo tên thành viên..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
              />
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={modalFilterTeam}
                  onChange={(e) => setModalFilterTeam(e.target.checked)}
                />
                Chỉ hiện {modal.ownerTeamName.replace("Tổ ", "tổ ")}
              </label>
            </div>

            <div className="mt-2.5 max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-2">
              {modalCandidates.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-400">
                  Không có thành viên phù hợp. Thử bỏ chọn lọc theo tổ hoặc đổi từ khóa tìm kiếm.
                </p>
              ) : (
                modalCandidates.map((m) => {
                  const checked = modalSelectedIds.includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                        checked
                          ? "border-blue-400 bg-blue-50/70"
                          : "border-transparent bg-white hover:border-slate-200"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type={modal.kind === "TRANSFER" ? "radio" : "checkbox"}
                          name="modal-member-pick"
                          checked={checked}
                          onChange={() => {
                            if (modal.kind === "TRANSFER") {
                              setModalSelectedIds([m.id]);
                            } else {
                              setModalSelectedIds((prev) =>
                                prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                              );
                            }
                          }}
                        />
                        <span className="truncate font-semibold text-slate-900">{m.displayName}</span>
                        <span className="truncate text-[11px] text-slate-400">
                          ({m.primaryTeam?.name?.replace("Tổ ", "") ?? "Ban"})
                        </span>
                      </span>
                      {m.workload && (
                        <WorkloadBadge
                          level={m.workload.workloadLevel}
                          activeTotal={m.workload.activeTotal}
                          overdue={m.workload.overdue}
                        />
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {modal.kind === "ASSIGN" && modalSelectedIds.length > 1 && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Chế độ nộp sản phẩm cho nhóm</label>
                <select
                  value={modalSubmissionMode}
                  onChange={(e) => setModalSubmissionMode(e.target.value as SubmissionMode)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value="INDIVIDUAL">Nộp riêng từng người</option>
                  <option value="SHARED">Nộp chung 1 sản phẩm nhóm</option>
                </select>
              </div>
            )}

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                {modal.kind === "TRANSFER" ? "Lý do chuyển giao (bắt buộc) *" : "Ghi chú / dặn dò thành viên (tuỳ chọn)"}
              </label>
              <input
                type="text"
                value={modalNote}
                onChange={(e) => setModalNote(e.target.value)}
                placeholder={
                  modal.kind === "TRANSFER"
                    ? "VD: Thành viên bận lịch thi, điều phối lại tải công việc..."
                    : "VD: Em phụ trách phần viết bài, ưu tiên xong trước 18h nhé..."
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={modalBusy || modalSelectedIds.length === 0 || (modal.kind === "TRANSFER" && !modalNote.trim())}
                onClick={() => void submitModal()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {modalBusy
                  ? "Đang xử lý..."
                  : modal.kind === "TRANSFER"
                    ? "Xác nhận chuyển giao"
                    : `Xác nhận phân công (${modalSelectedIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Thành viên đăng ký xin dời deadline */}
      {extReqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">Đăng ký xin dời deadline ({extReqModal.taskCode})</h3>
                <p className="mt-0.5 text-xs text-slate-500">{extReqModal.taskTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setExtReqModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Thời hạn hiện tại: <strong>{formatVnDateTime(extReqModal.currentDeadline)}</strong>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Hạn mới tự đề xuất (giờ Việt Nam) *</label>
                <input
                  type="datetime-local"
                  value={extNewDeadlineLocal}
                  onChange={(e) => setExtNewDeadlineLocal(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[
                    { label: "+6h", h: 6 },
                    { label: "+12h", h: 12 },
                    { label: "+24h", h: 24 },
                    { label: "+48h", h: 48 },
                  ].map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      onClick={() => {
                        const base = Math.max(Date.now(), new Date(extReqModal.currentDeadline).getTime());
                        setExtNewDeadlineLocal(isoToVnLocalInput(new Date(base + b.h * 3600_000)));
                      }}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-blue-50"
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Lý do cụ thể xin dời deadline *</label>
                <textarea
                  rows={3}
                  value={extReason}
                  onChange={(e) => setExtReason(e.target.value)}
                  placeholder="Nêu rõ lý do cụ thể (VD: trùng lịch thi học kỳ, đang chờ số liệu từ đơn vị cơ sở...)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                Lưu ý: Cấp trên có thể đồng ý gia hạn (vẫn lưu đầy đủ dấu vết hạn gốc) hoặc từ chối để phân công thành viên khác kịp tiến độ.
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExtReqModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={extBusy || extReason.trim().length < 5 || !extNewDeadlineLocal}
                onClick={() => void submitExtensionRequest()}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {extBusy ? "Đang gửi..." : "Gửi đăng ký xin dời"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cấp trên duyệt hoặc từ chối xin dời deadline */}
      {resolveExtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {resolveExtModal.decision === "approve"
                    ? `Duyệt xin dời deadline (${resolveExtModal.req.taskCode})`
                    : `Từ chối xin dời deadline (${resolveExtModal.req.taskCode})`}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Người xin: <strong>{resolveExtModal.req.requesterName}</strong> · {resolveExtModal.req.taskTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResolveExtModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div>Hạn hiện tại: <strong>{formatVnDateTime(resolveExtModal.req.currentDeadline)}</strong></div>
              <div>Hạn mem đề xuất: <strong className="text-blue-700">{formatVnDateTime(resolveExtModal.req.requestedDeadline)}</strong></div>
              <div>Lý do: <em>{resolveExtModal.req.reason}</em></div>
            </div>

            <div className="mt-3 space-y-3">
              {resolveExtModal.decision === "approve" ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Thời hạn duyệt chốt (có thể giữ nguyên đề xuất hoặc điều chỉnh)
                    </label>
                    <input
                      type="datetime-local"
                      value={resolveApprovedLocal}
                      onChange={(e) => setResolveApprovedLocal(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  {actor && ["HEAD", "ACTING_HEAD", "DEPUTY"].includes(actor.role) && (
                    <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={resolveSyncMission}
                        onChange={(e) => setResolveSyncMission(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>Đồng thời nới hạn tổng của Nhiệm vụ nếu hạn duyệt mới vượt hạn nhiệm vụ</span>
                    </label>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Ghi chú phê duyệt (tuỳ chọn)</label>
                    <input
                      type="text"
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="VD: Đồng ý gia hạn, cố gắng nộp đúng hạn mới nhé..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                    Hệ thống sẽ giữ nguyên <strong>Hạn gốc</strong>, ghi vào lịch sử dời hạn và gắn nhãn <em>Đã dời hạn</em> trên bảng phân công.
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Lý do từ chối (bắt buộc) *</label>
                    <textarea
                      rows={2}
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="VD: Bài cần đăng gấp trong ngày, sẽ điều phối người khác hỗ trợ..."
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 text-xs font-medium text-blue-900">
                    <input
                      type="checkbox"
                      checked={resolveOpenTransferOnReject}
                      onChange={(e) => setResolveOpenTransferOnReject(e.target.checked)}
                    />
                    <span>Mở ngay bảng chuyển giao cho thành viên khác sau khi từ chối</span>
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolveExtModal(null)}
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={resolveBusy || (resolveExtModal.decision === "reject" && resolveNote.trim().length < 3)}
                onClick={() => void submitResolveExtension()}
                className={`rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 ${
                  resolveExtModal.decision === "approve"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {resolveBusy
                  ? "Đang xử lý..."
                  : resolveExtModal.decision === "approve"
                    ? "Xác nhận duyệt dời hạn"
                    : "Xác nhận từ chối"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
