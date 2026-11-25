"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSpreadsheet, Lock, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { formatVnDateTime } from "@/lib/date";

interface KpiReportData {
  period: {
    id: string;
    periodKey: string;
    label: string;
    status: "OPEN" | "FINALIZED";
    revision: number;
    finalizedAt: string | null;
    finalizedByName: string | null;
  };
  policy: { versionCode: string; completionWeight: number; ontimeWeight: number };
  pendingReviewCount: number;
  members: Array<{
    memberId: string;
    memberCode: string;
    displayName: string;
    primaryTeamName: string;
    eligibleWeight: number;
    completedWeight: number;
    ontimeWeight: number;
    completionRate: number | null;
    ontimeRate: number | null;
    score: number | null;
    counts: {
      total: number;
      completed: number;
      early: number;
      onTime: number;
      lateCompleted: number;
      pendingReview: number;
      unsubmitted: number;
      declined: number;
    };
  }>;
  teamSummaries: Array<{
    teamName: string;
    memberCount: number;
    eligibleWeight: number;
    completedWeight: number;
    ontimeWeight: number;
    avgScore: number | null;
  }>;
  reviewerStats?: Array<{ reviewerId: string; reviewerName: string; reviewedCount: number; avgReviewHours: number | null }>;
}

interface BottleneckData {
  items: Array<{
    code: string;
    label: string;
    severity: "HIGH" | "MEDIUM";
    title: string;
    cause: string;
    responsibleName: string;
    link: string;
  }>;
  countsByCode: Record<string, number>;
}

function ReportsContent() {
  const { capabilities } = useAuth();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"kpi" | "bottlenecks">(
    searchParams.get("tab") === "bottlenecks" ? "bottlenecks" : "kpi",
  );
  const [periodKey, setPeriodKey] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [kpi, setKpi] = useState<KpiReportData | null>(null);
  const [bottlenecks, setBottlenecks] = useState<BottleneckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, b] = await Promise.all([
        apiFetch<KpiReportData>(`/api/v1/kpi?periodKey=${periodKey}`),
        apiFetch<BottleneckData>("/api/v1/bottlenecks"),
      ]);
      setKpi(k);
      setBottlenecks(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu báo cáo.");
    } finally {
      setLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const handleFinalize = async () => {
    if (!kpi) return;
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {};
      if (kpi.pendingReviewCount > 0) {
        const reason = window.prompt(
          `Hiện còn ${kpi.pendingReviewCount} sản phẩm chờ duyệt. Nhập lý do ngoại lệ để vẫn chốt kỳ KPI:`,
        );
        if (!reason) return;
        body.allowPendingReviews = true;
        body.exceptionReason = reason;
      }
      await apiFetch(`/api/v1/kpi/periods/${kpi.period.id}/finalize`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice("Đã chốt kỳ KPI thành công (lưu snapshot bất biến).");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể chốt kỳ KPI.");
    }
  };

  const handleReopen = async () => {
    if (!kpi) return;
    const reason = window.prompt("Nhập lý do mở lại kỳ KPI đã chốt (bắt buộc):");
    if (!reason) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/kpi/periods/${kpi.period.id}/reopen`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setNotice("Đã mở lại kỳ KPI (tạo revision mới).");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể mở lại kỳ KPI.");
    }
  };

  const chartData = (kpi?.teamSummaries ?? [])
    .filter((t) => t.avgScore !== null)
    .map((t) => ({ name: t.teamName.replace("Tổ ", ""), score: t.avgScore ?? 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">KPI &amp; Báo cáo phân công</h1>
          <p className="text-sm text-slate-500">
            Tính theo trọng số khối lượng và mốc nộp hợp lệ (trước / đúng / trễ hạn theo phút)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <a
            href={`/api/v1/reports/export?periodKey=${periodKey}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-4 w-4" /> Xuất Excel đầy đủ
          </a>
          <a
            href={`/api/v1/reports/export?periodKey=${periodKey}&compact=true`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Excel gọn
          </a>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab("kpi")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "kpi" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
        >
          Bảng KPI ({kpi?.period.label ?? periodKey})
        </button>
        <button
          type="button"
          onClick={() => setTab("bottlenecks")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "bottlenecks" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
        >
          Điểm nghẽn B01–B11 ({bottlenecks?.items.length ?? 0})
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Đang tổng hợp báo cáo...</div>
      ) : tab === "kpi" && kpi ? (
        <div className="space-y-6">
          {/* Thông tin kỳ & công thức minh bạch */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs">
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900">
                {kpi.period.label} ·{" "}
                <span className={kpi.period.status === "FINALIZED" ? "text-emerald-700" : "text-blue-700"}>
                  {kpi.period.status === "FINALIZED"
                    ? `Đã chốt (Rev ${kpi.period.revision} — ${kpi.period.finalizedByName} lúc ${formatVnDateTime(kpi.period.finalizedAt)})`
                    : "Kỳ đang mở (tạm tính trực tiếp)"}
                </span>
              </div>
              <div className="text-slate-600">
                Công thức baseline ({kpi.policy.versionCode}):{" "}
                <code>
                  KPI = {kpi.policy.completionWeight / 100} × Tỷ lệ hoàn thành + {kpi.policy.ontimeWeight / 100} × (100 × KL đúng hạn / Tổng KL)
                </code>{" "}
                · Không giao việc hiển thị N/A.
              </div>
            </div>

            {capabilities?.canFinalizeKpi && (
              <div className="flex gap-2">
                {kpi.period.status === "OPEN" ? (
                  <button
                    type="button"
                    onClick={() => void handleFinalize()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <Lock className="h-3.5 w-3.5" /> Chốt kỳ KPI
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleReopen()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Mở lại kỳ
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Biểu đồ KPI trung bình theo tổ */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-bold text-slate-900">Điểm KPI trung bình theo Tổ chuyên môn</h2>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="score" name="KPI trung bình" fill="#2563eb" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bảng KPI cá nhân */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="excel-table">
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Tổ chính</th>
                    <th>Tổng KL</th>
                    <th>KL hoàn thành</th>
                    <th>KL đúng/trước hạn</th>
                    <th>Trước / Đúng / Trễ</th>
                    <th>Chờ duyệt / Chưa nộp</th>
                    <th>Tỷ lệ HT</th>
                    <th>Điểm KPI</th>
                  </tr>
                </thead>
                <tbody>
                  {kpi.members.map((m) => (
                    <tr key={m.memberId}>
                      <td>
                        <div className="font-semibold text-slate-900">{m.displayName}</div>
                        <div className="text-xs text-slate-500">{m.memberCode}</div>
                      </td>
                      <td className="text-xs text-slate-700">{m.primaryTeamName}</td>
                      <td className="font-semibold">{m.eligibleWeight}</td>
                      <td>{m.completedWeight}</td>
                      <td>{m.ontimeWeight}</td>
                      <td className="whitespace-nowrap text-xs">
                        <span className="text-emerald-700">{m.counts.early}</span> /{" "}
                        <span className="text-blue-700">{m.counts.onTime}</span> /{" "}
                        <span className="text-red-700">{m.counts.lateCompleted}</span>
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {m.counts.pendingReview} / {m.counts.unsubmitted}
                      </td>
                      <td className="text-xs font-medium">
                        {m.completionRate !== null ? `${m.completionRate}%` : "N/A"}
                      </td>
                      <td className="font-bold text-blue-700">{m.score !== null ? m.score : "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Thống kê SLA Reviewer tách riêng */}
          {kpi.reviewerStats && kpi.reviewerStats.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-bold text-slate-900">Thống kê SLA nghiệm thu của Lãnh đạo (tách riêng KPI thực hiện)</h2>
              <div className="grid gap-2 sm:grid-cols-3">
                {kpi.reviewerStats.map((r) => (
                  <div key={r.reviewerId} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs">
                    <div className="font-bold text-slate-900">{r.reviewerName}</div>
                    <div className="mt-1 text-slate-600">
                      Đã duyệt: <strong>{r.reviewedCount}</strong> bản · Trung bình:{" "}
                      <strong>{r.avgReviewHours ?? 0} giờ</strong>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        /* Tab Điểm nghẽn */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="excel-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Loại điểm nghẽn</th>
                  <th>Đối tượng</th>
                  <th>Nguyên nhân thực tế ghi nhận</th>
                  <th>Đầu mối xử lý</th>
                  <th>Mở</th>
                </tr>
              </thead>
              <tbody>
                {!bottlenecks || bottlenecks.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      Không có điểm nghẽn nào đang mở.
                    </td>
                  </tr>
                ) : (
                  bottlenecks.items.map((b, idx) => (
                    <tr key={`${b.code}-${idx}`}>
                      <td>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            b.severity === "HIGH" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {b.code}
                        </span>
                      </td>
                      <td className="font-semibold text-slate-900">{b.label}</td>
                      <td className="text-xs font-medium text-slate-800">{b.title}</td>
                      <td className="text-xs text-slate-600">{b.cause}</td>
                      <td className="text-xs font-medium text-slate-700">{b.responsibleName}</td>
                      <td>
                        <Link href={b.link} className="text-xs font-semibold text-blue-600 hover:underline">
                          Xử lý →
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Đang tải...</div>}>
      <ReportsContent />
    </Suspense>
  );
}
