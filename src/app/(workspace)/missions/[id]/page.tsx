"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileDown,
  Link2,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { apiFetch, randomIdempotencyKey } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { ImportanceBadge, StatusBadge, UrgencyBadge } from "@/components/badges";
import { COMPLETION_MODE_LABELS, type CompletionMode, type ImportanceLevel, type MissionStatus, type UrgencyLevel } from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface MissionDetail {
  id: string;
  code: string;
  groupName: string;
  title: string;
  description: string;
  expectedOutcome: string;
  refs: { label: string; url: string }[];
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
    ownerTeamName: string;
    ownerName: string;
    reviewerName: string | null;
    submissionMode: string;
    weight: number;
    urgency: UrgencyLevel;
    deadlineCurrent: string;
    isOverdue: boolean;
    status: string;
    isBlocked: boolean;
    dependencies: { taskId: string; code: string; title: string; status: string }[];
    supervisors: { memberId: string; displayName: string }[];
    assignments: Array<{
      id: string;
      memberId: string;
      memberName: string;
      status: string;
      declineReason: string | null;
      evaluationDeadline: string;
      weight: number;
      submittedAt: string | null;
      effectiveSubmittedAt: string | null;
      reviewedAt: string | null;
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
  deadlineHistory: Array<{ id: string; oldDeadline: string; newDeadline: string; reason: string; changedByName: string; changedAt: string }>;
}

interface OptionItem {
  id: string;
  name: string;
}

export default function MissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { actor } = useAuth();

  const [mission, setMission] = useState<MissionDetail | null>(null);
  const [channels, setChannels] = useState<OptionItem[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    apiFetch<OptionItem[]>("/api/v1/channels").then(setChannels).catch(() => {});
    apiFetch<Array<{ id: string; displayName: string }>>("/api/v1/members?activityStatus=ACTIVE").then(setMembers).catch(() => {});
    return () => {
      active = false;
    };
  }, [load]);

  const runAction = async (fn: () => Promise<unknown>, successMsg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(successMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
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
                    "Đã giao nhiệm vụ và gửi thông báo đến các thành viên.",
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
        <h2 className="text-lg font-bold text-slate-900">Danh sách Task &amp; Sản phẩm ({mission.tasks.length})</h2>
        {mission.tasks.map((task) => {
          const myAss = task.assignments.find((a) => a.memberId === actor?.memberId && !["TRANSFERRED", "CANCELLED"].includes(a.status));
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

                {/* Nút thao tác cá nhân ngay trên task */}
                <div className="flex flex-wrap gap-2">
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

              {/* Bảng phân công cá nhân */}
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-100">
                <table className="excel-table text-xs">
                  <thead>
                    <tr>
                      <th>Người thực hiện</th>
                      <th>Trạng thái</th>
                      <th>Trọng số</th>
                      <th>Nộp lúc</th>
                      <th>Nghiệm thu lúc</th>
                      <th>Ghi chú / Chuyển giao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.assignments.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium text-slate-900">{a.memberName}</td>
                        <td><StatusBadge status={a.status} kind="assignment" /></td>
                        <td>{a.weight}</td>
                        <td>{formatVnDateTime(a.effectiveSubmittedAt ?? a.submittedAt)}</td>
                        <td>{formatVnDateTime(a.reviewedAt)}</td>
                        <td>
                          {a.declineReason && <span className="text-red-700">Lý do từ chối: {a.declineReason}</span>}
                          {mission.permissions.canManage && !["COMPLETED", "CANCELLED", "TRANSFERRED"].includes(a.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                const listText = members.map((m, i) => `${i + 1}. ${m.displayName}`).join("\n");
                                const pick = Number(window.prompt(`Chọn số thứ tự thành viên nhận chuyển giao:\n${listText}`));
                                const chosen = members[pick - 1];
                                if (!chosen) return;
                                const reason = window.prompt("Lý do chuyển giao (bắt buộc):");
                                if (!reason) return;
                                void runAction(
                                  () =>
                                    apiFetch(`/api/v1/assignments/${a.id}/transfer`, {
                                      method: "POST",
                                      body: JSON.stringify({ newMemberId: chosen.id, reason }),
                                    }),
                                  `Đã chuyển giao cho ${chosen.displayName}.`,
                                );
                              }}
                              className="ml-2 text-blue-600 hover:underline"
                            >
                              Chuyển giao
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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

              {/* Danh sách phiên bản sản phẩm đã nộp (mọi người tham gia mission đều xem được để phối hợp) */}
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

          {/* Form cập nhật link đăng tải */}
          <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
            <select
              value={pubReqId || pubChannelId}
              onChange={(e) => {
                const val = e.target.value;
                if (mission.publications.some((p) => p.id === val)) {
                  setPubReqId(val);
                  setPubChannelId("");
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
                  + {c.name}
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
                        url: pubUrl.trim(),
                        confirmChannel: mission.permissions.canManage ? pubConfirm : false,
                      }),
                    });
                    setPubUrl("");
                  }, "Đã thêm đường dẫn đăng tải.");
                }}
                className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Thêm link
              </button>
            </div>
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
              <div className="font-semibold text-amber-900">Lịch sử điều chỉnh deadline</div>
              {mission.deadlineHistory.map((d) => (
                <div key={d.id} className="text-amber-900">
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
    </div>
  );
}
