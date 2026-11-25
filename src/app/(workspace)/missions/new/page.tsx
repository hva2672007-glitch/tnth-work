"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  Plus,
  Save,
  Send,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { apiFetch, randomIdempotencyKey } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { WorkloadBadge, type WorkloadLevelUi } from "@/components/badges";
import {
  COMPLETION_MODE_LABELS,
  suggestUrgency,
  URGENCY_LABELS,
  WEIGHT_OPTIONS,
  type CompletionMode,
  type ImportanceLevel,
  type SubmissionMode,
  type UrgencyLevel,
} from "@/lib/constants";
import { isoToVnLocalInput, vnLocalInputToIso } from "@/lib/date";

interface OptionItem {
  id: string;
  name: string;
  code?: string;
  allowCustomName?: boolean;
}

interface MemberItem {
  id: string;
  displayName: string;
  role: string;
  activityStatus: string;
  primaryTeam: { id: string; name: string; title?: string } | null;
  teams?: { id: string; name: string; isPrimary: boolean; title: string }[];
  workload?: {
    activeTotal: number;
    overdue: number;
    workloadLevel: WorkloadLevelUi;
  } | null;
}

interface TaskDraft {
  tempKey: string;
  title: string;
  deliverable: string;
  ownerTeamId: string;
  assignMode: "DIRECT" | "TEAM_LEAD";
  filterByTeam: boolean;
  reviewerId: string;
  supervisorIds: string[];
  assigneeIds: string[];
  submissionMode: SubmissionMode;
  weight: number;
  deadlineLocal: string;
  predecessorTempKeys: string[];
}

interface CustomChannelDraft {
  key: string;
  name: string;
}

export default function NewMissionPage() {
  const router = useRouter();
  const { actor, capabilities } = useAuth();

  const [groups, setGroups] = useState<OptionItem[]>([]);
  const [teams, setTeams] = useState<OptionItem[]>([]);
  const [channels, setChannels] = useState<OptionItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);

  const [deadlineLocal, setDeadlineLocal] = useState(() =>
    isoToVnLocalInput(new Date(Date.now() + 24 * 3600 * 1000)),
  );
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [importance, setImportance] = useState<ImportanceLevel>("NORMAL");
  const [urgencyOverride, setUrgencyOverride] = useState<UrgencyLevel | "">("");
  const [urgencyOverrideReason, setUrgencyOverrideReason] = useState("");
  const [refs, setRefs] = useState<Array<{ label: string; url: string }>>([]);

  // Kênh đăng tải chuẩn + danh sách nhiều trang tùy chỉnh khác
  const [selectedStandardChannelIds, setSelectedStandardChannelIds] = useState<string[]>([]);
  const [customChannels, setCustomChannels] = useState<CustomChannelDraft[]>([]);
  const [savingPermanentKey, setSavingPermanentKey] = useState<string | null>(null);
  const [channelNotice, setChannelNotice] = useState<string | null>(null);

  const [completionMode, setCompletionMode] = useState<CompletionMode>("TASKS_ONLY");
  const [completionModeReason, setCompletionModeReason] = useState("");
  const [tasks, setTasks] = useState<TaskDraft[]>(() => [
    {
      tempKey: "t1",
      title: "",
      deliverable: "",
      ownerTeamId: "",
      assignMode: "DIRECT",
      filterByTeam: false,
      reviewerId: "",
      supervisorIds: [],
      assigneeIds: [],
      submissionMode: "INDIVIDUAL",
      weight: 1,
      deadlineLocal: isoToVnLocalInput(new Date(Date.now() + 24 * 3600 * 1000)),
      predecessorTempKeys: [],
    },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<OptionItem[]>("/api/v1/groups"),
      apiFetch<OptionItem[]>("/api/v1/teams"),
      apiFetch<OptionItem[]>("/api/v1/channels"),
      apiFetch<MemberItem[]>("/api/v1/members?activityStatus=ACTIVE&includeWorkload=true"),
    ])
      .then(([g, t, c, m]) => {
        setGroups(g);
        setTeams(t);
        setChannels(c);
        setMembers(m);
        if (g[0]) setGroupId((prev) => prev || g[0].id);
        const preferredTeamId =
          actor?.role === "TEAM_LEAD" && actor.leadTeamIds[0]
            ? actor.leadTeamIds[0]
            : t[0]?.id ?? "";
        if (preferredTeamId) {
          setTasks((prev) =>
            prev.map((item) => (item.ownerTeamId ? item : { ...item, ownerTeamId: preferredTeamId })),
          );
        }
      })
      .catch(() => {});
  }, [actor?.role, actor?.leadTeamIds]);

  const effectiveOwnerId = ownerId || actor?.memberId || "";
  const [baseNow] = useState(() => new Date());

  const suggestedUrgency = useMemo<UrgencyLevel>(() => {
    if (!deadlineLocal) return "NORMAL";
    const iso = vnLocalInputToIso(deadlineLocal);
    return suggestUrgency(baseNow, new Date(iso));
  }, [deadlineLocal, baseNow]);

  const effectiveUrgency = urgencyOverride || suggestedUrgency;

  const standardChannels = useMemo(() => channels.filter((c) => !c.allowCustomName), [channels]);
  const otherChannel = useMemo(() => channels.find((c) => c.allowCustomName), [channels]);

  const availableTeams = useMemo(() => {
    if (actor?.role === "TEAM_LEAD" && actor.leadTeamIds.length > 0) {
      return teams.filter((t) => actor.leadTeamIds.includes(t.id));
    }
    return teams;
  }, [actor, teams]);

  const syncCompletionModeForChannelCount = (nextCount: number) => {
    setCompletionMode((prev) => {
      if (nextCount > 0 && prev === "TASKS_ONLY") return "TASKS_AND_PUBLICATIONS";
      if (nextCount === 0 && prev !== "TASKS_ONLY") return "TASKS_ONLY";
      return prev;
    });
  };

  const setRelativeHours = (hours: number) => {
    const target = new Date();
    target.setTime(target.getTime() + hours * 3600 * 1000);
    const local = isoToVnLocalInput(target);
    setDeadlineLocal(local);
    setTasks((prev) => prev.map((t) => ({ ...t, deadlineLocal: local })));
  };

  const addTask = () => {
    const nextIdx = tasks.length + 1;
    setTasks((prev) => [
      ...prev,
      {
        tempKey: `t${nextIdx}`,
        title: "",
        deliverable: "",
        ownerTeamId: availableTeams[0]?.id ?? teams[0]?.id ?? "",
        assignMode: "DIRECT",
        filterByTeam: false,
        reviewerId: "",
        supervisorIds: [],
        assigneeIds: [],
        submissionMode: "INDIVIDUAL",
        weight: 1,
        deadlineLocal,
        predecessorTempKeys: [],
      },
    ]);
  };

  const updateTask = (idx: number, patch: Partial<TaskDraft>) => {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const toggleTaskMember = (idx: number, field: "assigneeIds" | "supervisorIds", memberId: string) => {
    setTasks((prev) =>
      prev.map((t, i) => {
        if (i !== idx) return t;
        const exists = t[field].includes(memberId);
        return {
          ...t,
          [field]: exists ? t[field].filter((id) => id !== memberId) : [...t[field], memberId],
        };
      }),
    );
  };

  const toggleStandardChannel = (channelId: string) => {
    setSelectedStandardChannelIds((prev) => {
      const exists = prev.includes(channelId);
      const next = exists ? prev.filter((id) => id !== channelId) : [...prev, channelId];
      const total = next.length + customChannels.filter((c) => c.name.trim()).length;
      syncCompletionModeForChannelCount(total);
      return next;
    });
  };

  const addCustomChannelRow = () => {
    setChannelNotice(null);
    setCustomChannels((prev) => [...prev, { key: `custom_${Date.now()}_${prev.length}`, name: "" }]);
  };

  const updateCustomChannelRow = (key: string, name: string) => {
    setCustomChannels((prev) => {
      const next = prev.map((c) => (c.key === key ? { ...c, name } : c));
      const total = selectedStandardChannelIds.length + next.filter((c) => c.name.trim()).length;
      syncCompletionModeForChannelCount(total);
      return next;
    });
  };

  const removeCustomChannelRow = (key: string) => {
    setCustomChannels((prev) => {
      const next = prev.filter((c) => c.key !== key);
      const total = selectedStandardChannelIds.length + next.filter((c) => c.name.trim()).length;
      syncCompletionModeForChannelCount(total);
      return next;
    });
  };

  const saveCustomAsPermanentChannel = async (item: CustomChannelDraft) => {
    const trimmed = item.name.trim();
    if (trimmed.length < 2) {
      setError("Tên trang/kênh mới cần tối thiểu 2 ký tự.");
      return;
    }
    setSavingPermanentKey(item.key);
    setError(null);
    setChannelNotice(null);
    try {
      const created = await apiFetch<{ id: string; code: string; name: string }>("/api/v1/channels", {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setChannels((prev) => [
        ...prev.filter((c) => !c.allowCustomName),
        { id: created.id, code: created.code, name: created.name, allowCustomName: false },
        ...prev.filter((c) => c.allowCustomName),
      ]);
      setSelectedStandardChannelIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
      setCustomChannels((prev) => prev.filter((c) => c.key !== item.key));
      syncCompletionModeForChannelCount(selectedStandardChannelIds.length + 1);
      setChannelNotice(`Đã lưu "${created.name}" vào danh mục kênh dùng chung và tự động tích chọn.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu kênh mới vào danh mục.");
    } finally {
      setSavingPermanentKey(null);
    }
  };

  const getTeamLeaders = (teamId: string) =>
    members.filter((m) =>
      (m.teams ?? []).some((tm) => tm.id === teamId && (tm.title === "LEADER" || tm.title === "DEPUTY_LEADER")),
    );

  const getVisibleAssignees = (task: TaskDraft) => {
    let list = members;
    if (actor?.role === "TEAM_LEAD") {
      // Bậc 03 giao cho thành viên tổ mình lãnh đạo, bản thân hoặc ngoại lệ Bậc 01/02
      list = list.filter(
        (m) =>
          m.id === actor.memberId ||
          ["HEAD", "ACTING_HEAD", "DEPUTY"].includes(m.role) ||
          (m.teams ?? []).some((tm) => actor.leadTeamIds.includes(tm.id)),
      );
    }
    if (task.filterByTeam && task.ownerTeamId) {
      list = list.filter((m) => (m.teams ?? []).some((tm) => tm.id === task.ownerTeamId));
    }
    // Ưu tiên thành viên thuộc tổ phụ trách của task lên đầu danh sách cho dễ chọn
    return [...list].sort((a, b) => {
      const aInTeam = (a.teams ?? []).some((tm) => tm.id === task.ownerTeamId) ? 0 : 1;
      const bInTeam = (b.teams ?? []).some((tm) => tm.id === task.ownerTeamId) ? 0 : 1;
      if (aInTeam !== bInTeam) return aInTeam - bInTeam;
      return a.displayName.localeCompare(b.displayName, "vi");
    });
  };

  const handleSubmit = async (saveAsDraft: boolean) => {
    setError(null);

    const invalidCustom = customChannels.some((c) => !c.name.trim());
    if (invalidCustom) {
      setError("Vui lòng nhập tên trang/kênh cho tất cả các dòng 'Trang khác' hoặc xóa dòng trống.");
      return;
    }

    setSubmitting(true);
    try {
      const deadlineIso = vnLocalInputToIso(deadlineLocal);
      const publicationChannels = [
        ...selectedStandardChannelIds.map((channelId) => ({
          channelId,
          required: true,
          requiredCount: 1,
        })),
        ...customChannels
          .filter((c) => c.name.trim() && otherChannel)
          .map((c) => ({
            channelId: otherChannel!.id,
            customChannelName: c.name.trim(),
            required: true,
            requiredCount: 1,
          })),
      ];

      const payload = {
        groupId,
        title,
        description,
        expectedOutcome,
        ownerId: effectiveOwnerId,
        importance,
        urgency: effectiveUrgency,
        urgencyOverrideReason: urgencyOverride && urgencyOverride !== suggestedUrgency ? urgencyOverrideReason : undefined,
        deadline: deadlineIso,
        refs: refs.filter((r) => r.url.trim()),
        completionMode,
        completionModeReason: completionMode === "PUBLICATIONS_ONLY" ? completionModeReason : undefined,
        publicationChannels,
        tasks: tasks
          .filter((t) => t.title.trim() || tasks.length === 1)
          .map((t) => {
            const finalAssignees = t.assignMode === "TEAM_LEAD" ? [] : t.assigneeIds;
            return {
              tempKey: t.tempKey,
              title: t.title.trim() || title.trim(),
              deliverable: t.deliverable.trim(),
              ownerTeamId: t.ownerTeamId || availableTeams[0]?.id || teams[0]?.id,
              reviewerId: t.reviewerId || null,
              supervisorIds: t.supervisorIds,
              assigneeIds: finalAssignees,
              submissionMode: finalAssignees.length > 1 ? t.submissionMode : "INDIVIDUAL",
              weight: t.weight,
              deadline: vnLocalInputToIso(t.deadlineLocal || deadlineLocal),
              predecessorTempKeys: t.predecessorTempKeys,
            };
          }),
        saveAsDraft,
      };

      const created = await apiFetch<{ id: string }>("/api/v1/missions", {
        method: "POST",
        body: JSON.stringify(payload),
        idempotencyKey: randomIdempotencyKey(),
      });
      router.push(`/missions/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo nhiệm vụ.");
    } finally {
      setSubmitting(false);
    }
  };

  const isBoard = actor && ["HEAD", "ACTING_HEAD", "DEPUTY"].includes(actor.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/missions" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lại danh sách nhiệm vụ
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Giao nhiệm vụ mới</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Lưu nháp
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {submitting ? "Đang gửi..." : "Giao nhiệm vụ"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {/* Phần 1: Thông tin chung */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <h2 className="text-base font-bold text-slate-900">1. Thông tin nhiệm vụ</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">Tên nhiệm vụ *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Bộ bài truyền thông Chiến dịch Tình nguyện mùa Đông"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Khối nhiệm vụ *</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Người chủ trì nhiệm vụ *</label>
            <select
              value={effectiveOwnerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.primaryTeam?.name ?? "Ban"})
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">Mô tả yêu cầu &amp; kết quả mong đợi *</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nêu rõ mục tiêu, định hướng nội dung, yêu cầu hình ảnh/văn phong..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">Đầu ra kỳ vọng (tuỳ chọn)</label>
            <input
              type="text"
              value={expectedOutcome}
              onChange={(e) => setExpectedOutcome(e.target.value)}
              placeholder="Ví dụ: 01 bài viết Word + 05 slide Canva kích thước 1080x1350"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Deadline + Độ khẩn tự gợi ý + Trọng tâm */}
        <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Thời hạn nộp (giờ Việt Nam) *</label>
            <input
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[
                { label: "+2h", h: 2 },
                { label: "+6h", h: 6 },
                { label: "+24h", h: 24 },
                { label: "+72h", h: 72 },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => setRelativeHours(b.h)}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-blue-50"
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Mức độ khẩn (gợi ý: {URGENCY_LABELS[suggestedUrgency]})
            </label>
            <select
              value={urgencyOverride}
              onChange={(e) => setUrgencyOverride(e.target.value as UrgencyLevel | "")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Tự động ({URGENCY_LABELS[suggestedUrgency]})</option>
              <option value="FLASH">Hỏa tốc (≤ 3 giờ)</option>
              <option value="VERY_URGENT">Thượng khẩn (&gt;3 – 12 giờ)</option>
              <option value="URGENT">Khẩn (&gt;12 – 48 giờ)</option>
              <option value="NORMAL">Thông thường (&gt; 48 giờ)</option>
            </select>
            {urgencyOverride && urgencyOverride !== suggestedUrgency && (
              <input
                type="text"
                value={urgencyOverrideReason}
                onChange={(e) => setUrgencyOverrideReason(e.target.value)}
                placeholder="Lý do đổi mức khẩn (bắt buộc)..."
                className="mt-1.5 w-full rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Phân loại nội dung</label>
            <select
              value={importance}
              onChange={(e) => setImportance(e.target.value as ImportanceLevel)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="NORMAL">Thông thường</option>
              <option value="KEY">Trọng tâm</option>
            </select>
          </div>
        </div>

        {/* Ref links */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Link tham khảo (Ref)</span>
            <button
              type="button"
              onClick={() => setRefs((prev) => [...prev, { label: "", url: "" }])}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              + Thêm link Ref
            </button>
          </div>
          {refs.map((r, i) => (
            <div key={i} className="mt-2 flex flex-wrap gap-2">
              <input
                type="text"
                value={r.label}
                onChange={(e) => setRefs((prev) => prev.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Tên tài liệu tham khảo"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <input
                type="url"
                value={r.url}
                onChange={(e) => setRefs((prev) => prev.map((x, idx) => (idx === i ? { ...x, url: e.target.value } : x)))}
                placeholder="https://..."
                className="flex-[2] rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Phần 2: Danh sách task inline */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">2. Danh sách Task &amp; phân công ({tasks.length})</h2>
            <p className="text-xs text-slate-500">
              Có thể giao trực tiếp cho thành viên hoặc giao về Tổ để Trưởng/Phó tổ tiếp nhận và chia việc xuống các mem.
            </p>
          </div>
          <button
            type="button"
            onClick={addTask}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            <Plus className="h-3.5 w-3.5" /> Thêm task
          </button>
        </div>

        <div className="space-y-4">
          {tasks.map((t, idx) => {
            const teamLeaders = getTeamLeaders(t.ownerTeamId);
            const teamName = teams.find((tm) => tm.id === t.ownerTeamId)?.name ?? "Tổ phụ trách";
            const visibleAssignees = getVisibleAssignees(t);

            return (
              <div key={t.tempKey} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-800">Task #{idx + 1}</span>
                  {tasks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTasks((prev) => prev.filter((_, i) => i !== idx))}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Xóa task
                    </button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-700">Tên task *</label>
                    <input
                      type="text"
                      value={t.title}
                      onChange={(e) => updateTask(idx, { title: e.target.value })}
                      placeholder={idx === 0 ? "Để trống sẽ lấy theo tên nhiệm vụ" : "Ví dụ: Thiết kế bộ ảnh Canva"}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Tổ phụ trách chính *</label>
                    <select
                      value={t.ownerTeamId}
                      onChange={(e) => updateTask(idx, { ownerTeamId: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    >
                      {availableTeams.map((tm) => (
                        <option key={tm.id} value={tm.id}>
                          {tm.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Trọng số khối lượng</label>
                    <select
                      value={t.weight}
                      onChange={(e) => updateTask(idx, { weight: Number(e.target.value) })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    >
                      {WEIGHT_OPTIONS.map((w) => (
                        <option key={w} value={w}>
                          Trọng số {w}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Deadline task</label>
                    <input
                      type="datetime-local"
                      value={t.deadlineLocal}
                      onChange={(e) => updateTask(idx, { deadlineLocal: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Sản phẩm yêu cầu</label>
                    <input
                      type="text"
                      value={t.deliverable}
                      onChange={(e) => updateTask(idx, { deliverable: e.target.value })}
                      placeholder="Link Docs / Canva / File PNG..."
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Người nghiệm thu (mặc định Trưởng tổ)</label>
                    <select
                      value={t.reviewerId}
                      onChange={(e) => updateTask(idx, { reviewerId: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    >
                      <option value="">Tự chọn Lãnh đạo tổ phụ trách</option>
                      {members
                        .filter((m) => m.role !== "MEMBER")
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.displayName}
                          </option>
                        ))}
                    </select>
                  </div>
                  {t.assignMode === "DIRECT" && t.assigneeIds.length > 1 && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700">Chế độ nộp sản phẩm</label>
                      <select
                        value={t.submissionMode}
                        onChange={(e) => updateTask(idx, { submissionMode: e.target.value as SubmissionMode })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                      >
                        <option value="INDIVIDUAL">Nộp riêng từng người</option>
                        <option value="SHARED">Nộp chung 1 sản phẩm nhóm</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Chế độ phân công: Giao trực tiếp vs Giao Tổ trưởng phân công */}
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">Hình thức phân công người thực hiện</span>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => updateTask(idx, { assignMode: "DIRECT" })}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                          t.assignMode === "DIRECT"
                            ? "bg-white text-blue-700 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Giao trực tiếp
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTask(idx, { assignMode: "TEAM_LEAD", assigneeIds: [] })}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition ${
                          t.assignMode === "TEAM_LEAD"
                            ? "bg-white text-blue-700 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Giao Tổ trưởng phân công
                      </button>
                    </div>
                  </div>

                  {t.assignMode === "TEAM_LEAD" ? (
                    <div className="mt-2.5 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900">
                      <div className="font-semibold">
                        Đầu việc sẽ được chuyển về {teamName} để Trưởng/Phó tổ tiếp nhận và phân công xuống thành viên.
                      </div>
                      <div className="mt-1 text-blue-800">
                        Lãnh đạo tổ nhận thông báo:{" "}
                        <strong>
                          {teamLeaders.length > 0
                            ? teamLeaders.map((l) => l.displayName).join(", ")
                            : "Chưa gán Trưởng/Phó tổ (sẽ hiển thị ở danh sách chờ phân công của Ban)"}
                        </strong>
                        . Sau khi gửi, Lãnh đạo tổ có thể chọn 1 hoặc nhiều mem (hoặc tách thêm task nhỏ) ngay trên trang chi tiết nhiệm vụ.
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="text-xs font-medium text-slate-700">
                            Người thực hiện ({t.assigneeIds.length} đã chọn)
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium text-blue-700">
                            <input
                              type="checkbox"
                              checked={t.filterByTeam}
                              onChange={(e) => updateTask(idx, { filterByTeam: e.target.checked })}
                            />
                            Chỉ hiện tổ phụ trách
                          </label>
                        </div>
                        <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                          {visibleAssignees.length === 0 ? (
                            <p className="py-2 text-center text-xs text-slate-400">Không có thành viên phù hợp trong bộ lọc.</p>
                          ) : (
                            visibleAssignees.map((m) => (
                              <label
                                key={m.id}
                                className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-white"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={t.assigneeIds.includes(m.id)}
                                    onChange={() => toggleTaskMember(idx, "assigneeIds", m.id)}
                                  />
                                  <span className="truncate font-medium text-slate-900">{m.displayName}</span>
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
                            ))
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">
                          Thường vụ phụ trách / theo dõi ({t.supervisorIds.length} đã chọn)
                        </label>
                        <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                          {members
                            .filter((m) => m.role !== "MEMBER")
                            .map((m) => (
                              <label
                                key={m.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-white"
                              >
                                <input
                                  type="checkbox"
                                  checked={t.supervisorIds.includes(m.id)}
                                  onChange={() => toggleTaskMember(idx, "supervisorIds", m.id)}
                                />
                                <span className="font-medium text-slate-900">{m.displayName}</span>
                                <span className="text-[11px] text-slate-400">
                                  ({m.primaryTeam?.name?.replace("Tổ ", "") ?? "Ban"})
                                </span>
                              </label>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Task tiền nhiệm */}
                {tasks.length > 1 && (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-medium text-slate-700">Phụ thuộc task trước (tuỳ chọn)</label>
                    <div className="flex flex-wrap gap-2">
                      {tasks
                        .filter((other) => other.tempKey !== t.tempKey)
                        .map((other) => (
                          <label key={other.tempKey} className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                            <input
                              type="checkbox"
                              checked={t.predecessorTempKeys.includes(other.tempKey)}
                              onChange={() => {
                                const has = t.predecessorTempKeys.includes(other.tempKey);
                                updateTask(idx, {
                                  predecessorTempKeys: has
                                    ? t.predecessorTempKeys.filter((k) => k !== other.tempKey)
                                    : [...t.predecessorTempKeys, other.tempKey],
                                });
                              }}
                            />
                            {other.title.trim() || other.tempKey}
                          </label>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Phần 3: Kênh đăng tải & Điều kiện hoàn thành */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">3. Kênh đăng tải &amp; Điều kiện hoàn thành</h2>
            <p className="text-xs text-slate-500">
              Chọn các kênh có sẵn hoặc bấm &quot;+ Thêm trang khác&quot; để gắn thêm nhiều trang/fanpage phát sinh.
            </p>
          </div>
          {otherChannel && (
            <button
              type="button"
              onClick={addCustomChannelRow}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-3.5 w-3.5" /> Thêm trang khác
            </button>
          )}
        </div>

        {channelNotice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {channelNotice}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {standardChannels.map((ch) => {
            const checked = selectedStandardChannelIds.includes(ch.id);
            return (
              <div
                key={ch.id}
                className={`rounded-lg border p-2.5 transition ${
                  checked ? "border-blue-400 bg-blue-50/40" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStandardChannel(ch.id)}
                    className="mt-0.5"
                  />
                  <span>{ch.name}</span>
                </label>
              </div>
            );
          })}
        </div>

        {/* Danh sách các trang/kênh phát sinh thêm */}
        {customChannels.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-blue-300 bg-blue-50/30 p-3">
            <div className="text-xs font-semibold text-blue-900">
              Các trang / kênh đăng tải khác ({customChannels.length})
            </div>
            {customChannels.map((item) => (
              <div key={item.key} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateCustomChannelRow(item.key, e.target.value)}
                  placeholder="Nhập tên trang/kênh khác (vd: Fanpage Hội Sinh viên, YouTube...)"
                  className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none"
                />
                {capabilities?.canManageChannels && (
                  <button
                    type="button"
                    disabled={savingPermanentKey === item.key || item.name.trim().length < 2}
                    onClick={() => void saveCustomAsPermanentChannel(item)}
                    title="Lưu trang này vào danh mục kênh dùng chung cho các nhiệm vụ sau"
                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    {savingPermanentKey === item.key ? "Đang lưu..." : "Lưu dùng chung"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeCustomChannelRow(item.key)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title="Xóa dòng này"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-100 pt-3">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Chế độ xác nhận hoàn thành nhiệm vụ</label>
          <select
            value={completionMode}
            onChange={(e) => setCompletionMode(e.target.value as CompletionMode)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:max-w-lg"
          >
            <option value="TASKS_ONLY">{COMPLETION_MODE_LABELS.TASKS_ONLY}</option>
            <option value="TASKS_AND_PUBLICATIONS">{COMPLETION_MODE_LABELS.TASKS_AND_PUBLICATIONS}</option>
            {isBoard && <option value="PUBLICATIONS_ONLY">{COMPLETION_MODE_LABELS.PUBLICATIONS_ONLY}</option>}
          </select>

          {completionMode === "PUBLICATIONS_ONLY" && (
            <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4" />
                Lưu ý: Chế độ này cho phép chốt nhiệm vụ khi đủ link đăng tải, nhưng task chưa nghiệm thu sẽ không tự động cộng KPI.
              </div>
              <input
                type="text"
                value={completionModeReason}
                onChange={(e) => setCompletionModeReason(e.target.value)}
                placeholder="Ghi lý do áp dụng chế độ hoàn thành theo link đăng tải (bắt buộc)..."
                className="w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
