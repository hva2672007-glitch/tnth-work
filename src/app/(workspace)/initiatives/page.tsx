"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart2,
  CheckCircle2,
  ExternalLink,
  FileDown,
  Lightbulb,
  Send,
  Upload,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { StatusBadge } from "@/components/badges";
import { INITIATIVE_KIND_LABELS, type InitiativeKind } from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface MemberOpt {
  id: string;
  displayName: string;
  role: string;
  primaryTeam: { name: string } | null;
}

interface InitiativeItem {
  id: string;
  code: string;
  kind: InitiativeKind;
  title: string;
  description: string;
  links: { label: string; url: string }[];
  files: { id: string; originalName: string }[];
  leadName: string;
  submittedByName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  awardedPointsLead: number;
  awardedPointsParticipant: number;
  reviewerName: string | null;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  canReview: boolean;
  participants: { memberId: string; displayName: string; role: string; awardedPoints: number }[];
}

interface MetricLogItem {
  id: string;
  memberName: string;
  taskCode: string | null;
  title: string;
  metricUnit: string;
  quantity: number;
  pointsPerUnit: number;
  computedPoints: number;
  evidenceUrl: string;
  note: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewerName: string | null;
  periodDate: string;
  createdAt: string;
  canReview: boolean;
}

function InitiativesContent() {
  const { actor } = useAuth();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"initiatives" | "metrics">(
    searchParams.get("tab") === "metrics" ? "metrics" : "initiatives",
  );

  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeItem[]>([]);
  const [metrics, setMetrics] = useState<MetricLogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form nộp sáng kiến
  const [kind, setKind] = useState<InitiativeKind>("INITIATIVE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [leadId, setLeadId] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [files, setFiles] = useState<{ id: string; originalName: string }[]>([]);

  // Form báo cáo số liệu KPI
  const [mTitle, setMTitle] = useState("");
  const [mUnit, setMUnit] = useState("bài viết");
  const [mQty, setMQty] = useState("1");
  const [mPpu, setMPpu] = useState("1");
  const [mEvidence, setMEvidence] = useState("");
  const [mNote, setMNote] = useState("");
  const [mDate, setMDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    try {
      const [inits, logs] = await Promise.all([
        apiFetch<InitiativeItem[]>("/api/v1/initiatives"),
        apiFetch<MetricLogItem[]>("/api/v1/metric-logs"),
      ]);
      setInitiatives(inits);
      setMetrics(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<MemberOpt[]>("/api/v1/members")
      .then((list) => {
        if (active) setMembers(list.filter((m) => m.role !== "OBSERVER"));
      })
      .catch(() => {});
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("purpose", "INITIATIVE");
      Array.from(fileList).forEach((f) => form.append("files", f));
      const res = await apiFetch<{ files: { id: string; originalName: string }[] }>("/api/v1/files", {
        method: "POST",
        body: form,
      });
      setFiles((prev) => [...prev, ...res.files]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải tệp thất bại.");
    }
  };

  const handleCreateInitiative = async () => {
    if (title.trim().length < 3 || description.trim().length < 5) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ code: string }>("/api/v1/initiatives", {
        method: "POST",
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim(),
          leadMemberId: leadId || actor?.memberId,
          participantIds,
          links: linkUrl.trim() ? [{ label: "Link sản phẩm / đề xuất", url: linkUrl.trim() }] : [],
          fileIds: files.map((f) => f.id),
        }),
      });
      setTitle("");
      setDescription("");
      setLinkUrl("");
      setParticipantIds([]);
      setFiles([]);
      setNotice(`Đã gửi đề xuất ${res.code} tới Bậc 01.01–03.02 để xét duyệt và cộng điểm KPI.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể gửi đề xuất.");
    } finally {
      setBusy(false);
    }
  };

  const handleReviewInitiative = async (item: InitiativeItem, decision: "APPROVED" | "REJECTED") => {
    setError(null);
    setNotice(null);
    let pointsLead = 1.5;
    let pointsParticipant = 1.0;
    let reviewNote = "";
    if (decision === "APPROVED") {
      const pLeadStr = window.prompt("Điểm KPI thưởng cho người phụ trách chính:", "1.5");
      if (!pLeadStr) return;
      const pPartStr = window.prompt("Điểm KPI thưởng cho mỗi thành viên tham gia:", "1.0");
      if (!pPartStr) return;
      pointsLead = Number(pLeadStr) || 1.5;
      pointsParticipant = Number(pPartStr) || 1.0;
      reviewNote = window.prompt("Ghi chú khen thưởng / nhận xét (tuỳ chọn):", "") ?? "";
    } else {
      const note = window.prompt("Nhập lý do từ chối đề xuất (bắt buộc):");
      if (!note) return;
      reviewNote = note;
    }
    try {
      await apiFetch(`/api/v1/initiatives/${item.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewNote, pointsLead, pointsParticipant }),
      });
      setNotice(
        decision === "APPROVED"
          ? `Đã duyệt ${item.code} và tự động cộng điểm KPI cho tất cả thành viên tham gia.`
          : `Đã từ chối đề xuất ${item.code}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xét duyệt thất bại.");
    }
  };

  const handleSubmitMetric = async () => {
    const qty = Number(mQty);
    const ppu = Number(mPpu);
    if (mTitle.trim().length < 2 || !mUnit.trim() || !(qty > 0) || !(ppu > 0)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ computedPoints: number; status: string }>("/api/v1/metric-logs", {
        method: "POST",
        body: JSON.stringify({
          title: mTitle.trim(),
          metricUnit: mUnit.trim(),
          quantity: qty,
          pointsPerUnit: ppu,
          evidenceUrl: mEvidence.trim(),
          note: mNote.trim(),
          periodDate: mDate,
        }),
      });
      setMTitle("");
      setMEvidence("");
      setMNote("");
      setNotice(
        res.status === "APPROVED"
          ? `Đã ghi nhận số liệu và tự động quy đổi +${res.computedPoints} điểm vào KPI tháng!`
          : `Đã gửi báo cáo số liệu (+${res.computedPoints} điểm dự kiến) chờ lãnh đạo xác nhận.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể ghi nhận số liệu.");
    } finally {
      setBusy(false);
    }
  };

  const handleReviewMetric = async (item: MetricLogItem, decision: "APPROVED" | "REJECTED") => {
    const note = decision === "REJECTED" ? window.prompt("Lý do từ chối số liệu:") ?? "" : "";
    if (decision === "REJECTED" && !note) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/metric-logs/${item.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
      setNotice(
        decision === "APPROVED"
          ? `Đã xác nhận số liệu "${item.title}" (+${item.computedPoints} điểm KPI cho ${item.memberName}).`
          : `Đã từ chối bản ghi số liệu.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
    }
  };

  const previewPoints = Math.round((Number(mQty) || 0) * (Number(mPpu) || 0) * 100) / 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sáng kiến chủ động &amp; Cập nhật số liệu KPI</h1>
        <p className="text-sm text-slate-500">
          Thành viên &amp; Cộng tác viên chủ động nộp ý tưởng, sáng kiến, sản phẩm hoặc cập nhật số liệu công việc để quy đổi tự động vào KPI tháng
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab("initiatives")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "initiatives" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Lightbulb className="h-4 w-4" />
          Ý tưởng, Sáng kiến &amp; Sản phẩm ({initiatives.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("metrics")}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "metrics" ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          <BarChart2 className="h-4 w-4" />
          Cập nhật số liệu quy đổi KPI ({metrics.length})
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {tab === "initiatives" ? (
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-base font-bold text-slate-900">Nộp Ý tưởng / Sáng kiến / Sản phẩm chủ động</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Phân loại</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as InitiativeKind)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {(Object.keys(INITIATIVE_KIND_LABELS) as InitiativeKind[]).map((k) => (
                    <option key={k} value={k}>
                      {INITIATIVE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Người phụ trách chính</label>
                <select
                  value={leadId || actor?.memberId || ""}
                  onChange={(e) => setLeadId(e.target.value)}
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
                <label className="mb-1 block text-xs font-semibold text-slate-700">Tên ý tưởng / sáng kiến / sản phẩm *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="VD: Chuỗi infographic Hỏi đáp Quy chế thi THPT Quốc gia 2027"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Mô tả nội dung &amp; giá trị đóng góp *</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Trình bày rõ mục tiêu, cách triển khai, hiệu quả dự kiến..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Link sản phẩm / tài liệu (tuỳ chọn)</label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://canva.com/... hoặc https://drive.google.com/..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                    <Upload className="h-3.5 w-3.5" /> Đính kèm tệp
                    <input type="file" multiple className="hidden" onChange={(e) => void handleUpload(e.target.files)} />
                  </label>
                  {files.map((f) => (
                    <span key={f.id} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">
                      {f.originalName}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Thành viên cùng tham gia ({participantIds.length} người)
                </label>
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2 text-xs">
                  {members
                    .filter((m) => m.id !== (leadId || actor?.memberId))
                    .map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={participantIds.includes(m.id)}
                          onChange={() =>
                            setParticipantIds((prev) =>
                              prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                            )
                          }
                        />
                        <span>{m.displayName}</span>
                        <span className="text-slate-400">({m.primaryTeam?.name ?? "Ban"})</span>
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={busy || title.trim().length < 3 || description.trim().length < 5}
              onClick={() => void handleCreateInitiative()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Gửi xét duyệt
            </button>
          </section>

          <div className="space-y-3">
            {initiatives.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Chưa có ý tưởng, sáng kiến hay sản phẩm chủ động nào.
              </div>
            ) : (
              initiatives.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">{item.code}</span>
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">
                          {INITIATIVE_KIND_LABELS[item.kind]}
                        </span>
                        <StatusBadge status={item.status} kind="approval" />
                      </div>
                      <h3 className="mt-1 text-base font-bold text-slate-900">{item.title}</h3>
                      <div className="text-xs text-slate-500">
                        Phụ trách chính: <strong>{item.leadName}</strong> · Nộp bởi: {item.submittedByName} · {formatVnDateTime(item.createdAt)}
                      </div>
                    </div>
                    {item.canReview && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReviewInitiative(item, "APPROVED")}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Duyệt &amp; Cộng KPI
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReviewInitiative(item, "REJECTED")}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Từ chối
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-sm text-slate-700">{item.description}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {item.participants.map((p) => (
                      <span key={p.memberId} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5">
                        {p.role === "LEAD" ? "★ " : ""}{p.displayName}
                        {item.status === "APPROVED" && <strong className="ml-1 text-emerald-700">(+{p.awardedPoints} đ)</strong>}
                      </span>
                    ))}
                  </div>
                  {(item.links.length > 0 || item.files.length > 0) && (
                    <div className="flex flex-wrap gap-2 pt-1 text-xs">
                      {item.links.map((l, i) => (
                        <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 underline">
                          <ExternalLink className="h-3 w-3" /> {l.label}
                        </a>
                      ))}
                      {item.files.map((f) => (
                        <a key={f.id} href={`/api/v1/files/${f.id}/download`} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-blue-700">
                          <FileDown className="h-3 w-3" /> {f.originalName}
                        </a>
                      ))}
                    </div>
                  )}
                  {item.reviewerName && (
                    <div className="border-t border-slate-100 pt-2 text-xs text-slate-600">
                      Xét duyệt bởi <strong>{item.reviewerName}</strong> ({formatVnDateTime(item.reviewedAt)})
                      {item.reviewNote ? ` — ${item.reviewNote}` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-emerald-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">Cập nhật số liệu thực hiện nhiệm vụ</h2>
              <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
                Quy đổi tự động: +{previewPoints} điểm KPI
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Nội dung / đầu việc tính theo số liệu *</label>
                <input
                  type="text"
                  value={mTitle}
                  onChange={(e) => setMTitle(e.target.value)}
                  placeholder="VD: Duyệt tin bài cơ sở tuần 4 tháng 11"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Đơn vị tính *</label>
                <input
                  type="text"
                  value={mUnit}
                  onChange={(e) => setMUnit(e.target.value)}
                  placeholder="bài / video / ảnh..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Ngày ghi nhận KPI</label>
                <input
                  type="date"
                  value={mDate}
                  onChange={(e) => setMDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Số lượng hoàn thành *</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={mQty}
                  onChange={(e) => setMQty(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Hệ số điểm / đơn vị</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={mPpu}
                  onChange={(e) => setMPpu(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Link bảng thống kê / minh chứng (tuỳ chọn)</label>
                <input
                  type="url"
                  value={mEvidence}
                  onChange={(e) => setMEvidence(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-4">
                <label className="mb-1 block text-xs font-semibold text-slate-700">Ghi chú bổ sung</label>
                <input
                  type="text"
                  value={mNote}
                  onChange={(e) => setMNote(e.target.value)}
                  placeholder="Ghi chú chi tiết số liệu..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={busy || mTitle.trim().length < 2 || previewPoints <= 0}
              onClick={() => void handleSubmitMetric()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Ghi nhận số liệu (+{previewPoints} điểm KPI)
            </button>
          </section>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="excel-table text-xs">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Thành viên</th>
                    <th>Nội dung chỉ tiêu</th>
                    <th>Số liệu</th>
                    <th>Điểm KPI</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">Chưa có bản ghi số liệu nào.</td>
                    </tr>
                  ) : (
                    metrics.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{m.periodDate}</td>
                        <td className="font-semibold text-slate-900">{m.memberName}</td>
                        <td>
                          <div className="font-medium text-slate-800">{m.title}</div>
                          {m.note && <div className="text-[11px] text-slate-500">{m.note}</div>}
                          {m.evidenceUrl && (
                            <a href={m.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 underline">
                              Minh chứng
                            </a>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          <strong>{m.quantity}</strong> {m.metricUnit} (× {m.pointsPerUnit})
                        </td>
                        <td className="font-bold text-emerald-700">+{m.computedPoints}</td>
                        <td><StatusBadge status={m.status} kind="approval" /></td>
                        <td className="whitespace-nowrap">
                          {m.canReview ? (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleReviewMetric(m, "APPROVED")}
                                className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white hover:bg-emerald-700"
                              >
                                Duyệt
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleReviewMetric(m, "REJECTED")}
                                className="rounded border border-red-200 bg-red-50 px-2 py-1 font-semibold text-red-700 hover:bg-red-100"
                              >
                                Từ chối
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">{m.reviewerName ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InitiativesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Đang tải...</div>}>
      <InitiativesContent />
    </Suspense>
  );
}
