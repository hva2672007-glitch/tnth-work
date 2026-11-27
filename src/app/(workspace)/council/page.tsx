"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  Lock,
  Plus,
  Scale,
  Send,
  ShieldAlert,
  Upload,
  UserX,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { CouncilStatusBadge, RoleBadge } from "@/components/badges";
import {
  COUNCIL_OPINION_CHOICE_LABELS,
  ROLE_LABELS,
  type CouncilItemStatus,
  type CouncilItemType,
  type CouncilOpinionChoice,
  type MemberRole,
} from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface MemberOpt {
  id: string;
  memberCode: string;
  displayName: string;
  role: MemberRole;
  primaryTeam: { name: string } | null;
}

interface CouncilListItem {
  id: string;
  code: string;
  itemType: CouncilItemType;
  title: string;
  description: string;
  subject: { memberId: string; displayName: string; teams: string } | null;
  submittedByName: string;
  opinionDeadline: string;
  status: CouncilItemStatus;
  hasMyOpinion: boolean;
  respondedCount: number;
  eligibleCount: number;
  quorumThreshold: number;
  reportCount: number;
  concludedAt: string | null;
  concludedByName: string | null;
  createdAt: string;
  missingVoters: { memberId: string; memberCode: string; displayName: string; role: MemberRole }[];
}

interface CouncilDetail {
  id: string;
  code: string;
  itemType: CouncilItemType;
  title: string;
  description: string;
  subject: { memberId: string; displayName: string; teams: string } | null;
  inspectorProposal: string;
  links: { label: string; url: string }[];
  files: { id: string; originalName: string; safeMime: string; sizeBytes: number }[];
  submittedByName: string;
  opinionDeadline: string;
  status: CouncilItemStatus;
  lockedAt: string | null;
  meetingConclusion: string;
  concludedByName: string | null;
  concludedAt: string | null;
  createdAt: string;
  eligibleCount: number;
  respondedCount: number;
  quorumThreshold: number;
  hasMyOpinion: boolean;
  canSubmitOpinion: boolean;
  canViewOthersOpinions: boolean;
  canConclude: boolean;
  missingVoters: { memberId: string; memberCode: string; displayName: string; role: MemberRole }[];
  linkedReports: Array<{
    id: string;
    reporterName: string | null;
    issueSummary: string;
    evidenceText: string;
    evidenceLinks: { label: string; url: string }[];
    evidenceFiles: { id: string; originalName: string }[];
    proposedSolution: string;
    createdAt: string;
  }>;
  opinions: Array<{
    id: string;
    memberId: string;
    memberName: string;
    memberRole: MemberRole;
    choice: CouncilOpinionChoice;
    opinionText: string;
    createdAt: string;
  }>;
  myOpinion: { id: string; choice: CouncilOpinionChoice; opinionText: string; createdAt: string } | null;
}

interface ConductListResponse {
  canViewAll: boolean;
  canSubmitDossier: boolean;
  mySubmittedCount: number;
  reports: Array<{
    id: string;
    reporterName: string;
    reporterRole: MemberRole;
    subjectMemberId: string;
    subjectName: string;
    subjectCode: string;
    subjectTeams: string;
    issueSummary: string;
    evidenceText: string;
    evidenceLinks: { label: string; url: string }[];
    evidenceFiles: { id: string; originalName: string }[];
    proposedSolution: string;
    dossierCount: number;
    createdAt: string;
  }>;
  subjectSummaries: Array<{
    subjectMemberId: string;
    subjectName: string;
    subjectCode: string;
    subjectTeams: string;
    reportCount: number;
    unlinkedCount: number;
    latestAt: string;
    reportIds: string[];
  }>;
}

function CouncilContent() {
  const { capabilities } = useAuth();
  const searchParams = useSearchParams();

  const canCouncil = Boolean(capabilities?.canAccessCouncil);
  const canConduct = Boolean(capabilities?.canRecordConduct);

  const [tab, setTab] = useState<"council" | "conduct">(
    searchParams.get("tab") === "conduct" || (!canCouncil && canConduct) ? "conduct" : "council",
  );

  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [councilData, setCouncilData] = useState<{ eligibleCouncilCount: number; items: CouncilListItem[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string>(searchParams.get("item") ?? "");
  const [detail, setDetail] = useState<CouncilDetail | null>(null);
  const [conductData, setConductData] = useState<ConductListResponse | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form trình tài liệu chung ra HĐĐH
  const [showDocForm, setShowDocForm] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docDesc, setDocDesc] = useState("");
  const [docLinkLabel, setDocLinkLabel] = useState("");
  const [docLinkUrl, setDocLinkUrl] = useState("");
  const [docFiles, setDocFiles] = useState<{ id: string; originalName: string }[]>([]);

  // Form góp ý kiến HĐĐH
  const [opChoice, setOpChoice] = useState<CouncilOpinionChoice>("AGREE");
  const [opText, setOpText] = useState("");

  // Form kết luận cuộc họp (01.01 / 02.01)
  const [conclusionText, setConclusionText] = useState("");

  // Form gửi phiếu ghi nhận thái độ
  const [cSubjectId, setCSubjectId] = useState("");
  const [cIssue, setCIssue] = useState("");
  const [cEvidenceText, setCEvidenceText] = useState("");
  const [cEvidenceUrl, setCEvidenceUrl] = useState("");
  const [cFiles, setCFiles] = useState<{ id: string; originalName: string }[]>([]);
  const [cSolution, setCSolution] = useState("");

  // Form trình hồ sơ nhân sự từ Tổ Thẩm tra (02.01 / 01.01 / 01.02)
  const [dossierTarget, setDossierTarget] = useState<{ subjectMemberId: string; subjectName: string; reportIds: string[] } | null>(null);
  const [dossierTitle, setDossierTitle] = useState("");
  const [dossierProposal, setDossierProposal] = useState("");

  const loadCouncil = useCallback(async () => {
    if (!canCouncil) return;
    try {
      const data = await apiFetch<{ eligibleCouncilCount: number; items: CouncilListItem[] }>("/api/v1/council");
      setCouncilData(data);
      if (!selectedId && data.items[0]) {
        setSelectedId(data.items[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách Hội đồng điều hành.");
    }
  }, [canCouncil, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!canCouncil || !id) return;
    try {
      const d = await apiFetch<CouncilDetail>(`/api/v1/council/${id}`);
      setDetail(d);
      if (d.myOpinion) {
        setOpChoice(d.myOpinion.choice);
        setOpText(d.myOpinion.opinionText);
      } else {
        setOpChoice(d.itemType === "PERSONNEL_DOSSIER" ? "AGREE" : "COMMENT");
        setOpText("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được chi tiết hồ sơ.");
    }
  }, [canCouncil]);

  const loadConduct = useCallback(async () => {
    if (!canConduct) return;
    try {
      const data = await apiFetch<ConductListResponse>("/api/v1/conduct-reports");
      setConductData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được mục Ghi nhận thái độ.");
    }
  }, [canConduct]);

  useEffect(() => {
    apiFetch<MemberOpt[]>("/api/v1/members")
      .then((list) => setMembers(list.filter((m) => m.role !== "OBSERVER")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) {
        void loadCouncil();
        void loadConduct();
      }
    });
    return () => {
      active = false;
    };
  }, [loadCouncil, loadConduct]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadDetail(selectedId);
    });
    return () => {
      active = false;
    };
  }, [selectedId, loadDetail]);

  const uploadFiles = async (
    files: FileList | null,
    purpose: "COUNCIL_DOCUMENT" | "CONDUCT_EVIDENCE",
    setter: React.Dispatch<React.SetStateAction<{ id: string; originalName: string }[]>>,
  ) => {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("purpose", purpose);
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await apiFetch<{ files: { id: string; originalName: string }[] }>("/api/v1/files", {
        method: "POST",
        body: form,
      });
      setter((prev) => [...prev, ...res.files]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải tệp lên thất bại.");
    }
  };

  const handleCreateDocument = async () => {
    if (docTitle.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ id: string; code: string }>("/api/v1/council", {
        method: "POST",
        body: JSON.stringify({
          itemType: "GENERAL_DOCUMENT",
          title: docTitle.trim(),
          description: docDesc.trim(),
          links: docLinkUrl.trim() ? [{ label: docLinkLabel.trim() || "Tài liệu tham chiếu", url: docLinkUrl.trim() }] : [],
          fileIds: docFiles.map((f) => f.id),
        }),
      });
      setShowDocForm(false);
      setDocTitle("");
      setDocDesc("");
      setDocLinkLabel("");
      setDocLinkUrl("");
      setDocFiles([]);
      setNotice(`Đã trình tài liệu ${res.code} ra Hội đồng điều hành (+1 điểm KPI) và gửi thông báo lấy ý kiến trong 5 ngày.`);
      setSelectedId(res.id);
      await loadCouncil();
      await loadDetail(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể trình tài liệu.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitOpinion = async () => {
    if (!detail || opText.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/council/${detail.id}/opinions`, {
        method: "POST",
        body: JSON.stringify({
          choice: detail.itemType === "PERSONNEL_DOSSIER" ? opChoice : "COMMENT",
          opinionText: opText.trim(),
        }),
      });
      setNotice("Đã gửi ý kiến đóng góp cho Hội đồng điều hành (+1 điểm KPI). Hiện bạn đã có thể xem toàn bộ ý kiến của các thành viên khác.");
      await loadCouncil();
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể gửi ý kiến.");
    } finally {
      setBusy(false);
    }
  };

  const handleConclude = async () => {
    if (!detail || conclusionText.trim().length < 5) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/council/${detail.id}/conclude`, {
        method: "POST",
        body: JSON.stringify({ meetingConclusion: conclusionText.trim() }),
      });
      setConclusionText("");
      setNotice("Đã chốt kết luận cuộc họp Hội đồng điều hành (+1 điểm KPI) và lưu trữ vĩnh viễn hồ sơ.");
      await loadCouncil();
      await loadDetail(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể chốt kết luận cuộc họp.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitConduct = async () => {
    if (!cSubjectId || cIssue.trim().length < 5 || cSolution.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/conduct-reports", {
        method: "POST",
        body: JSON.stringify({
          subjectMemberId: cSubjectId,
          issueSummary: cIssue.trim(),
          evidenceText: cEvidenceText.trim(),
          evidenceLinks: cEvidenceUrl.trim() ? [{ label: "Link minh chứng", url: cEvidenceUrl.trim() }] : [],
          evidenceFileIds: cFiles.map((f) => f.id),
          proposedSolution: cSolution.trim(),
        }),
      });
      setCSubjectId("");
      setCIssue("");
      setCEvidenceText("");
      setCEvidenceUrl("");
      setCFiles([]);
      setCSolution("");
      setNotice("Đã gửi phiếu ghi nhận thái độ bảo mật (+1 điểm KPI). Phiếu đã được chuyển thẳng tới Tổ Thẩm tra – Giám sát và Trưởng Ban.");
      await loadConduct();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể gửi phiếu ghi nhận.");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitDossier = async () => {
    if (!dossierTarget || dossierTitle.trim().length < 3 || dossierProposal.trim().length < 5) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ id: string; code: string }>("/api/v1/council", {
        method: "POST",
        body: JSON.stringify({
          itemType: "PERSONNEL_DOSSIER",
          title: dossierTitle.trim(),
          subjectMemberId: dossierTarget.subjectMemberId,
          inspectorProposal: dossierProposal.trim(),
          conductReportIds: dossierTarget.reportIds,
        }),
      });
      setDossierTarget(null);
      setDossierTitle("");
      setDossierProposal("");
      setNotice(`Đã trình hồ sơ nhân sự ${res.code} ra Hội đồng điều hành (ẩn danh người gửi phiếu, chỉ hiển thị họ tên & tổ nhân sự).`);
      setTab("council");
      setSelectedId(res.id);
      await loadCouncil();
      await loadDetail(res.id);
      await loadConduct();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể trình hồ sơ nhân sự.");
    } finally {
      setBusy(false);
    }
  };

  if (!canCouncil && !canConduct) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Phân hệ Thẩm tra – Giám sát và Hội đồng điều hành chỉ dành cho Bậc 01.01–03.02 và thành viên Tổ Thẩm tra – Giám sát.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Thẩm tra – Giám sát &amp; Hội đồng điều hành</h1>
          <p className="text-sm text-slate-500">
            Góp ý độc lập trong 05 ngày · Ngưỡng khóa 2/3 · Cảnh báo đỏ đích danh tài khoản chưa góp ý · Bảo mật tuyệt đối người phản ánh
          </p>
        </div>
        {canCouncil && tab === "council" && (
          <button
            type="button"
            onClick={() => setShowDocForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Trình tài liệu ra HĐĐH
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {canCouncil && (
          <button
            type="button"
            onClick={() => setTab("council")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "council" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Scale className="h-4 w-4" />
            Hội đồng điều hành ({councilData?.items.length ?? 0})
          </button>
        )}
        {canConduct && (
          <button
            type="button"
            onClick={() => setTab("conduct")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "conduct" ? "bg-purple-700 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            Ghi nhận thái độ (Tổ Thẩm tra)
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {/* TAB 1: HỘI ĐỒNG ĐIỀU HÀNH */}
      {tab === "council" && canCouncil && (
        <div className="space-y-4">
          {showDocForm && (
            <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <div className="text-sm font-bold text-blue-950">Trình tài liệu xin ý kiến Hội đồng điều hành (hạn góp ý 05 ngày)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Tiêu đề tài liệu / nội dung trình *</label>
                  <input
                    type="text"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="VD: Dự thảo Kế hoạch truyền thông Tháng Thanh niên 2027"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Tóm tắt &amp; nội dung cần xin ý kiến</label>
                  <textarea
                    rows={3}
                    value={docDesc}
                    onChange={(e) => setDocDesc(e.target.value)}
                    placeholder="Nêu rõ các điểm cần thành viên HĐĐH góp ý..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Tên link tài liệu (Google Docs/Drive...)</label>
                  <input
                    type="text"
                    value={docLinkLabel}
                    onChange={(e) => setDocLinkLabel(e.target.value)}
                    placeholder="VD: Bản dự thảo trên Drive"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Đường dẫn (URL)</label>
                  <input
                    type="url"
                    value={docLinkUrl}
                    onChange={(e) => setDocLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    <Upload className="h-3.5 w-3.5" /> Đính kèm tệp (.docx, .xlsx, .pdf, ảnh...)
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void uploadFiles(e.target.files, "COUNCIL_DOCUMENT", setDocFiles)}
                    />
                  </label>
                  {docFiles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                      {docFiles.map((f) => (
                        <span key={f.id} className="rounded bg-white px-2 py-0.5 border border-slate-200">
                          {f.originalName}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || docTitle.trim().length < 3}
                  onClick={() => void handleCreateDocument()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" /> Trình Hội đồng điều hành
                </button>
                <button
                  type="button"
                  onClick={() => setShowDocForm(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                >
                  Hủy
                </button>
              </div>
            </section>
          )}

          <div className="grid gap-5 lg:grid-cols-12">
            {/* Danh sách bên trái */}
            <div className="space-y-2.5 lg:col-span-5">
              {!councilData || councilData.items.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  Chưa có hồ sơ hoặc tài liệu nào trình Hội đồng điều hành.
                </div>
              ) : (
                councilData.items.map((item) => {
                  const pct = item.eligibleCount > 0 ? Math.min(100, Math.round((item.respondedCount / item.eligibleCount) * 100)) : 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        selectedId === item.id
                          ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-500"
                          : item.status === "RED_ALERT"
                            ? "border-red-300 bg-red-50/30 hover:border-red-400"
                            : "border-slate-200 bg-white hover:border-blue-300"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-mono text-xs font-bold text-blue-700">{item.code}</span>
                        <CouncilStatusBadge status={item.status} />
                      </div>
                      <div className="mt-1.5 text-sm font-bold text-slate-900">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                          {item.itemType === "PERSONNEL_DOSSIER" ? "Hồ sơ nhân sự" : "Tài liệu trình HĐĐH"}
                        </span>
                        {item.subject && <span>Nhân sự: <strong>{item.subject.displayName}</strong></span>}
                        {!item.hasMyOpinion && item.status !== "COMPLETED" && item.status !== "AWAITING_MEETING" && (
                          <span className="font-bold text-amber-700">· Chưa góp ý</span>
                        )}
                      </div>
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-600">
                          <span>Tiến độ góp ý: <strong>{item.respondedCount}/{item.eligibleCount}</strong> (cần ≥ {item.quorumThreshold})</span>
                          <span>Hạn: {formatVnDateTime(item.opinionDeadline)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${item.status === "RED_ALERT" ? "bg-red-600" : "bg-blue-600"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Chi tiết bên phải */}
            <div className="lg:col-span-7">
              {!detail ? (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                  Chọn một hồ sơ / tài liệu ở danh sách bên trái để xem chi tiết và đóng góp ý kiến.
                </div>
              ) : (
                <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">{detail.code}</span>
                        <CouncilStatusBadge status={detail.status} />
                      </div>
                      <h2 className="mt-1 text-lg font-bold text-slate-900">{detail.title}</h2>
                      <div className="mt-1 text-xs text-slate-500">
                        Người trình: <strong>{detail.submittedByName}</strong> · Ngày trình: {formatVnDateTime(detail.createdAt)} · Hạn 05 ngày: <strong>{formatVnDateTime(detail.opinionDeadline)}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Cảnh báo đỏ & danh sách tài khoản chưa góp ý (01.01 - 02.02) */}
                  {detail.status === "RED_ALERT" && (
                    <div className="rounded-xl border-2 border-red-400 bg-red-50 p-4 text-xs text-red-950">
                      <div className="flex items-center gap-1.5 font-bold text-red-800">
                        <AlertOctagon className="h-4 w-4" />
                        CẢNH BÁO ĐỎ: Đã quá 05 ngày nhưng chưa đạt ngưỡng 2/3 thành viên HĐĐH góp ý ({detail.respondedCount}/{detail.eligibleCount})
                      </div>
                      {detail.missingVoters.length > 0 && (
                        <div className="mt-2">
                          <div className="font-semibold text-red-900">Danh sách tài khoản Bậc 01.01–03.02 chưa góp ý:</div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {detail.missingVoters.map((mv) => (
                              <span key={mv.memberId} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 font-medium text-red-900">
                                <UserX className="h-3 w-3 text-red-600" />
                                {mv.displayName} ({ROLE_LABELS[mv.role].code})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Nội dung Hồ sơ nhân sự */}
                  {detail.itemType === "PERSONNEL_DOSSIER" && detail.subject && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-xs">
                        <div className="font-bold text-purple-950">
                          Nhân sự liên quan: {detail.subject.displayName} — {detail.subject.teams}
                        </div>
                        <div className="mt-0.5 text-purple-800">
                          (Theo quy chế bảo mật, chỉ hiển thị họ tên và tổ chuyên môn của nhân sự; danh tính người gửi phiếu ghi nhận thái độ được ẩn hoàn toàn với Bậc 02.02–03.02.)
                        </div>
                      </div>

                      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs">
                        <div className="font-bold text-blue-950">Đề xuất, kiến nghị của Tổ Thẩm tra – Giám sát (Bậc 02.01):</div>
                        <p className="mt-1 whitespace-pre-line text-slate-800">{detail.inspectorProposal}</p>
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-bold text-slate-700">
                          Tổng hợp phiếu ghi nhận thái độ ({detail.linkedReports.length} phiếu):
                        </div>
                        {detail.linkedReports.map((r, idx) => (
                          <div key={r.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                              <span className="font-bold text-slate-700">Phiếu #{idx + 1} · {formatVnDateTime(r.createdAt)}</span>
                              <span className="rounded bg-white px-2 py-0.5 border border-slate-200">
                                Nguồn gửi: <strong>{r.reporterName ?? "Ẩn danh (bảo mật)"}</strong>
                              </span>
                            </div>
                            <div><strong>Vấn đề ghi nhận:</strong> <span className="whitespace-pre-line">{r.issueSummary}</span></div>
                            {r.evidenceText && <div><strong>Minh chứng:</strong> {r.evidenceText}</div>}
                            {r.evidenceLinks.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {r.evidenceLinks.map((l, i) => (
                                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">
                                    <ExternalLink className="h-3 w-3" /> {l.label}
                                  </a>
                                ))}
                              </div>
                            )}
                            {r.evidenceFiles.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {r.evidenceFiles.map((f) => (
                                  <a key={f.id} href={`/api/v1/files/${f.id}/download`} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-blue-700 hover:bg-blue-50">
                                    <FileDown className="h-3 w-3" /> {f.originalName}
                                  </a>
                                ))}
                              </div>
                            )}
                            <div className="text-slate-700"><strong>Đề xuất xử lý:</strong> {r.proposedSolution}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Nội dung Tài liệu trình HĐĐH */}
                  {detail.itemType === "GENERAL_DOCUMENT" && (
                    <div className="space-y-2 text-sm text-slate-700">
                      {detail.description && <p className="whitespace-pre-line">{detail.description}</p>}
                      {detail.links.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {detail.links.map((l, i) => (
                            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:underline">
                              <ExternalLink className="h-3.5 w-3.5" /> {l.label}
                            </a>
                          ))}
                        </div>
                      )}
                      {detail.files.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {detail.files.map((f) => (
                            <a key={f.id} href={`/api/v1/files/${f.id}/download`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-blue-50">
                              <FileText className="h-3.5 w-3.5 text-blue-600" /> {f.originalName}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Form đóng góp ý kiến (còn mở & chưa khóa) */}
                  {detail.canSubmitOpinion && (
                    <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-indigo-950">
                          {detail.hasMyOpinion ? "Cập nhật ý kiến đóng góp của bạn" : "Gửi ý kiến đóng góp của bạn (+1 điểm KPI)"}
                        </span>
                        {!detail.canViewOthersOpinions && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700">
                            <Lock className="h-3 w-3" /> Ý kiến khác chỉ hiển thị sau khi bạn góp ý
                          </span>
                        )}
                      </div>

                      {detail.itemType === "PERSONNEL_DOSSIER" && (
                        <div className="space-y-1.5 text-xs">
                          {(["AGREE", "DISAGREE", "OTHER"] as const).map((c) => (
                            <label key={c} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <input
                                type="radio"
                                name="councilChoice"
                                checked={opChoice === c}
                                onChange={() => setOpChoice(c)}
                              />
                              <span className="font-medium text-slate-800">{COUNCIL_OPINION_CHOICE_LABELS[c]}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      <textarea
                        rows={3}
                        value={opText}
                        onChange={(e) => setOpText(e.target.value)}
                        placeholder={
                          detail.itemType === "PERSONNEL_DOSSIER"
                            ? "Nhập rõ lý do hoặc ý kiến đề xuất của bạn..."
                            : "Nhập nội dung góp ý chi tiết cho tài liệu..."
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy || opText.trim().length < 3}
                        onClick={() => void handleSubmitOpinion()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {detail.hasMyOpinion ? "Cập nhật ý kiến" : "Gửi ý kiến đóng góp"}
                      </button>
                    </div>
                  )}

                  {/* Danh sách ý kiến của Hội đồng điều hành (chỉ hiện sau khi đã góp ý hoặc đã khóa) */}
                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>Ý kiến các thành viên Hội đồng điều hành ({detail.respondedCount}/{detail.eligibleCount})</span>
                      {detail.lockedAt && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <Clock className="h-3 w-3" /> Đã khóa góp ý lúc {formatVnDateTime(detail.lockedAt)}
                        </span>
                      )}
                    </div>
                    {!detail.canViewOthersOpinions ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
                        <Lock className="mx-auto mb-1 h-4 w-4 text-slate-400" />
                        Để đảm bảo tính độc lập, ý kiến của các thành viên khác sẽ được mở khóa ngay sau khi bạn gửi ý kiến đóng góp.
                      </div>
                    ) : detail.opinions.length === 0 ? (
                      <div className="text-xs text-slate-400">Chưa có ý kiến đóng góp nào.</div>
                    ) : (
                      <div className="space-y-2">
                        {detail.opinions.map((op) => (
                          <div key={op.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900">{op.memberName}</span>
                                <RoleBadge role={op.memberRole} />
                              </div>
                              <span className="text-[11px] text-slate-400">{formatVnDateTime(op.createdAt)}</span>
                            </div>
                            {detail.itemType === "PERSONNEL_DOSSIER" && (
                              <div className="mt-1 inline-block rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                                {COUNCIL_OPINION_CHOICE_LABELS[op.choice]}
                              </div>
                            )}
                            <p className="mt-1.5 whitespace-pre-line text-slate-700">{op.opinionText}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bước 03: Kết luận cuộc họp & lưu trữ vĩnh viễn */}
                  {detail.status === "COMPLETED" ? (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        Kết luận cuộc họp Hội đồng điều hành (Đã lưu trữ vĩnh viễn)
                      </div>
                      <p className="mt-1.5 whitespace-pre-line text-sm text-slate-900">{detail.meetingConclusion}</p>
                      <div className="mt-2 text-[11px] text-emerald-800">
                        Chốt bởi <strong>{detail.concludedByName}</strong> lúc {formatVnDateTime(detail.concludedAt)}
                      </div>
                    </div>
                  ) : (
                    detail.canConclude && (
                      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                        <div className="text-xs font-bold text-emerald-950">
                          Bước 03: Chốt kết luận cuộc họp Hội đồng điều hành (dành riêng cho 01.01 &amp; 02.01 · +1 điểm KPI)
                        </div>
                        <textarea
                          rows={3}
                          value={conclusionText}
                          onChange={(e) => setConclusionText(e.target.value)}
                          placeholder="Ghi rõ quyết nghị/kết luận cuối cùng sau cuộc họp Hội đồng điều hành..."
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busy || conclusionText.trim().length < 5}
                          onClick={() => void handleConclude()}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Chốt kết luận &amp; Lưu trữ vĩnh viễn
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GHI NHẬN THÁI ĐỘ (TỔ THẨM TRA - GIÁM SÁT) */}
      {tab === "conduct" && canConduct && (
        <div className="space-y-6">
          {/* Form gửi phiếu mới */}
          <section className="space-y-4 rounded-xl border border-purple-200 bg-white p-5 shadow-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">Gửi phiếu ghi nhận thái độ trong công việc (+1 điểm KPI)</h2>
              <p className="text-xs text-slate-500">
                Thông tin người gửi được bảo mật tuyệt đối — chỉ Trưởng Ban (01.01), Quyền Trưởng Ban (01.02) và Phó Trưởng Ban kiêm Tổ trưởng Tổ Thẩm tra (02.01) được xem.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Thành viên được ghi nhận *</label>
                <select
                  value={cSubjectId}
                  onChange={(e) => setCSubjectId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">-- Chọn thành viên --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.primaryTeam?.name ?? "Ban"} · {ROLE_LABELS[m.role].code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Link minh chứng (tuỳ chọn)</label>
                <input
                  type="url"
                  value={cEvidenceUrl}
                  onChange={(e) => setCEvidenceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Mô tả chi tiết vấn đề / thái độ làm việc * (không giới hạn số từ)</label>
                <textarea
                  rows={3}
                  value={cIssue}
                  onChange={(e) => setCIssue(e.target.value)}
                  placeholder="Ghi rõ sự việc, thời điểm, bối cảnh công việc..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Minh chứng bổ sung (văn bản / ảnh chụp / file đính kèm — tuỳ chọn)</label>
                <textarea
                  rows={2}
                  value={cEvidenceText}
                  onChange={(e) => setCEvidenceText(e.target.value)}
                  placeholder="Ghi chú minh chứng nếu có..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                    <Upload className="h-3.5 w-3.5" /> Tải file / ảnh minh chứng
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => void uploadFiles(e.target.files, "CONDUCT_EVIDENCE", setCFiles)}
                    />
                  </label>
                  {cFiles.map((f) => (
                    <span key={f.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                      {f.originalName}
                    </span>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Phương hướng giải quyết đề xuất * (không giới hạn số từ)</label>
                <textarea
                  rows={2}
                  value={cSolution}
                  onChange={(e) => setCSolution(e.target.value)}
                  placeholder="Đề xuất trao đổi nhắc nhở, điều chỉnh phân công hoặc trình Tổ Thẩm tra xem xét..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !cSubjectId || cIssue.trim().length < 5 || cSolution.trim().length < 3}
              onClick={() => void handleSubmitConduct()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Gửi phiếu ghi nhận bảo mật
            </button>
          </section>

          {/* Kết quả & Bảo mật */}
          {conductData && !conductData.canViewAll ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              <div className="font-bold text-slate-900">Cơ chế bảo mật danh tính người phản ánh</div>
              <p className="mt-1 text-xs text-slate-600">
                Bạn đã gửi tổng cộng <strong>{conductData.mySubmittedCount}</strong> phiếu ghi nhận thái độ. Sau khi gửi, hệ thống tự động ẩn toàn bộ nội dung phiếu để đảm bảo bảo mật nguồn thông tin. Chỉ Bậc 01.01, 01.02 và Bậc 02.01 mới có quyền tổng hợp và trình hồ sơ ẩn danh ra Hội đồng điều hành.
              </p>
            </div>
          ) : conductData && conductData.canViewAll ? (
            <div className="space-y-5">
              {/* Form trình hồ sơ nhân sự ra HĐĐH */}
              {dossierTarget && (
                <section className="space-y-3 rounded-xl border-2 border-purple-400 bg-purple-50/50 p-4">
                  <div className="text-sm font-bold text-purple-950">
                    Trình hồ sơ nhân sự ra Hội đồng điều hành: {dossierTarget.subjectName} ({dossierTarget.reportIds.length} phiếu)
                  </div>
                  <input
                    type="text"
                    value={dossierTitle}
                    onChange={(e) => setDossierTitle(e.target.value)}
                    placeholder="Tiêu đề hồ sơ trình HĐĐH..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <textarea
                    rows={3}
                    value={dossierProposal}
                    onChange={(e) => setDossierProposal(e.target.value)}
                    placeholder="Phương hướng xử lý, kiến nghị của Tổ Thẩm tra – Giám sát (Bậc 02.01)..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || dossierTitle.trim().length < 3 || dossierProposal.trim().length < 5}
                      onClick={() => void handleSubmitDossier()}
                      className="rounded-lg bg-purple-700 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
                    >
                      Trình hồ sơ ra HĐĐH (ẩn danh người gửi phiếu)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDossierTarget(null)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                    >
                      Hủy
                    </button>
                  </div>
                </section>
              )}

              {/* Tổng hợp theo cá nhân */}
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900">Tổng hợp theo nhân sự ({conductData.subjectSummaries.length})</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {conductData.subjectSummaries.map((s) => (
                    <div key={s.subjectMemberId} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                      <div className="font-bold text-slate-900">{s.subjectName} ({s.subjectCode})</div>
                      <div className="text-slate-500">{s.subjectTeams}</div>
                      <div className="mt-1.5 font-semibold text-purple-800">
                        Tổng {s.reportCount} phiếu ({s.unlinkedCount} phiếu chưa trình HĐĐH)
                      </div>
                      {conductData.canSubmitDossier && (
                        <button
                          type="button"
                          onClick={() => {
                            setDossierTarget({
                              subjectMemberId: s.subjectMemberId,
                              subjectName: s.subjectName,
                              reportIds: s.reportIds,
                            });
                            setDossierTitle(`Hồ sơ nhân sự: ${s.subjectName} (${s.reportCount} phiếu ghi nhận thái độ)`);
                            setDossierProposal("");
                          }}
                          className="mt-2 w-full rounded-md bg-purple-700 px-2.5 py-1.5 font-semibold text-white hover:bg-purple-800"
                        >
                          Trình hồ sơ ra HĐĐH
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Danh sách chi tiết tất cả phiếu */}
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900">Toàn bộ phiếu ghi nhận thái độ ({conductData.reports.length})</h3>
                <div className="mt-3 space-y-3">
                  {conductData.reports.map((r) => (
                    <div key={r.id} className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900">Nhân sự: {r.subjectName}</span>{" "}
                          <span className="text-slate-500">({r.subjectTeams})</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span>Người gửi: <strong className="text-slate-800">{r.reporterName}</strong></span>
                          <RoleBadge role={r.reporterRole} />
                          <span>· {formatVnDateTime(r.createdAt)}</span>
                        </div>
                      </div>
                      <div><strong>Vấn đề:</strong> <span className="whitespace-pre-line">{r.issueSummary}</span></div>
                      {r.evidenceText && <div><strong>Minh chứng:</strong> {r.evidenceText}</div>}
                      {r.evidenceFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {r.evidenceFiles.map((f) => (
                            <a key={f.id} href={`/api/v1/files/${f.id}/download`} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-blue-700">
                              <FileDown className="h-3 w-3" /> {f.originalName}
                            </a>
                          ))}
                        </div>
                      )}
                      <div><strong>Đề xuất giải quyết:</strong> {r.proposedSolution}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function CouncilPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Đang tải...</div>}>
      <CouncilContent />
    </Suspense>
  );
}
