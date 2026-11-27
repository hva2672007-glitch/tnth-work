"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { StatusBadge, UrgencyBadge } from "@/components/badges";
import { formatVnDateTime } from "@/lib/date";
import type { UrgencyLevel } from "@/lib/constants";

interface DashboardData {
  period: { periodKey: string; label: string; allTime: boolean };
  missions: {
    total: number;
    draft: number;
    notStarted: number;
    inProgress: number;
    awaitingReview: number;
    awaitingPublication: number;
    overdue: number;
    completed: number;
    onHold: number;
    cancelled: number;
  };
  tasks: {
    total: number;
    draft: number;
    notStarted: number;
    inProgress: number;
    awaitingReview: number;
    revisionRequired: number;
    overdue: number;
    completed: number;
    onHold: number;
    cancelled: number;
  };
  upcomingDeadlines: Array<{
    taskId: string;
    taskCode: string;
    taskTitle: string;
    missionId: string;
    missionCode: string;
    teamName: string;
    status: string;
    urgency: UrgencyLevel;
    deadline: string;
    isOverdue: boolean;
  }>;
  bottlenecks: {
    total: number;
    countsByCode: Record<string, number>;
    items: Array<{
      code: string;
      label: string;
      severity: "HIGH" | "MEDIUM";
      title: string;
      cause: string;
      responsibleName: string;
      link: string;
    }>;
  };
  refreshedAt: string;
}

interface TeamOption {
  id: string;
  name: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { actor } = useAuth();
  const [mode, setMode] = useState<"missions" | "tasks">("missions");
  const [allTime, setAllTime] = useState(true);
  const [periodKey, setPeriodKey] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (actor?.role === "OBSERVER") {
      router.replace("/missions");
    }
  }, [actor?.role, router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (allTime) qs.set("allTime", "true");
      else qs.set("periodKey", periodKey);
      if (teamId) qs.set("teamId", teamId);
      const res = await apiFetch<DashboardData>(`/api/v1/dashboard?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu tổng quan.");
    } finally {
      setLoading(false);
    }
  }, [allTime, periodKey, teamId]);

  useEffect(() => {
    apiFetch<TeamOption[]>("/api/v1/teams").then(setTeams).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    // Tự làm mới mỗi 15 giây khi tab đang mở (mục 9)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const counts = data ? (mode === "missions" ? data.missions : data.tasks) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tổng quan tiến độ</h1>
          <p className="text-sm text-slate-500">
            Thống kê trực tiếp từ cơ sở dữ liệu theo thẩm quyền ·{" "}
            {data ? `Cập nhật lúc ${formatVnDateTime(data.refreshedAt)}` : "Đang tải..."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode("missions")}
              className={`rounded-md px-3 py-1.5 ${mode === "missions" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Theo Nhiệm vụ
            </button>
            <button
              type="button"
              onClick={() => setMode("tasks")}
              className={`rounded-md px-3 py-1.5 ${mode === "tasks" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              Theo Task
            </button>
          </div>

          <select
            value={allTime ? "ALL" : "MONTH"}
            onChange={(e) => setAllTime(e.target.value === "ALL")}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"
          >
            <option value="ALL">Toàn thời gian</option>
            <option value="MONTH">Theo tháng</option>
          </select>

          {!allTime && (
            <input
              type="month"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            />
          )}

          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="">Tất cả tổ</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Làm mới
          </button>

          <a
            href={`/api/v1/reports/export?${allTime ? "allTime=true" : `periodKey=${periodKey}`}${teamId ? `&teamId=${teamId}` : ""}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Xuất Excel
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading || !counts ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : (
        <>
          {/* 5 thẻ thống kê bắt buộc theo tài liệu gốc */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Link
              href="/missions"
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-blue-300"
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>Tổng {mode === "missions" ? "nhiệm vụ" : "task"}</span>
                <Inbox className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-2 text-3xl font-bold text-slate-900">{counts.total}</div>
              <div className="mt-1 text-xs text-slate-500">
                Nháp: {counts.draft} · Tạm hoãn: {counts.onHold}
              </div>
            </Link>

            <Link
              href="/missions?status=IN_PROGRESS"
              className="rounded-xl border border-blue-200 bg-white p-4 shadow-xs transition hover:border-blue-400"
            >
              <div className="flex items-center justify-between text-xs font-medium text-blue-700">
                <span>Đang thực hiện</span>
                <Clock className="h-4 w-4 text-blue-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-blue-700">{counts.inProgress}</div>
              <div className="mt-1 text-xs text-slate-500">
                Chờ duyệt: {counts.awaitingReview}
              </div>
            </Link>

            <Link
              href="/missions?status=ASSIGNED"
              className="rounded-xl border border-amber-200 bg-white p-4 shadow-xs transition hover:border-amber-400"
            >
              <div className="flex items-center justify-between text-xs font-medium text-amber-800">
                <span>Đã giao, chưa thực hiện</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-amber-700">{counts.notStarted}</div>
              <div className="mt-1 text-xs text-slate-500">Đang chờ thành viên nhận việc</div>
            </Link>

            <Link
              href="/missions?overdueOnly=true"
              className="rounded-xl border border-red-200 bg-red-50/40 p-4 shadow-xs transition hover:border-red-400"
            >
              <div className="flex items-center justify-between text-xs font-medium text-red-700">
                <span>Đang trễ hạn *</span>
                <AlertOctagon className="h-4 w-4 text-red-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-red-700">{counts.overdue}</div>
              <div className="mt-1 text-xs text-red-700/80">
                Có thể giao với đang làm / chờ duyệt
              </div>
            </Link>

            <Link
              href="/missions?status=COMPLETED"
              className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs transition hover:border-emerald-400"
            >
              <div className="flex items-center justify-between text-xs font-medium text-emerald-800">
                <span>Đã hoàn thành</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">{counts.completed}</div>
              <div className="mt-1 text-xs text-emerald-800/80">
                Đã hủy: {counts.cancelled}
              </div>
            </Link>
          </div>

          <p className="text-xs text-slate-500">
            * Nhóm &ldquo;Đang trễ hạn&rdquo; tính động trên các công việc chưa hoàn thành đã quá deadline nên có thể giao với nhóm Đang thực hiện hoặc Chờ nhận việc (không cộng gộp thành tổng).
          </p>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Điểm nghẽn */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Điểm nghẽn cần xử lý ({data?.bottlenecks.total ?? 0})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Tách rõ lỗi chưa nộp của cá nhân với chờ duyệt/chốt của lãnh đạo
                  </p>
                </div>
                <Link href="/reports?tab=bottlenecks" className="text-xs font-semibold text-blue-600 hover:underline">
                  Xem toàn bộ →
                </Link>
              </div>
              <div className="divide-y divide-slate-100">
                {data && data.bottlenecks.items.length > 0 ? (
                  data.bottlenecks.items.slice(0, 8).map((b, idx) => (
                    <Link
                      key={`${b.code}-${idx}`}
                      href={b.link}
                      className="block px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                              b.severity === "HIGH" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {b.code}
                          </span>
                          {b.label}
                        </span>
                        <span className="text-xs text-slate-500">{b.responsibleName}</span>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{b.title}</div>
                      <div className="mt-0.5 text-xs text-slate-600">{b.cause}</div>
                    </Link>
                  ))
                ) : (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Chưa ghi nhận điểm nghẽn nào trong phạm vi hiện tại.
                  </div>
                )}
              </div>
            </section>

            {/* Việc sắp đến hạn / quá hạn */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Task sắp đến hạn (48 giờ tới) &amp; quá hạn
                  </h2>
                  <p className="text-xs text-slate-500">Sắp xếp theo mốc deadline gần nhất</p>
                </div>
                <Link href="/my-work" className="text-xs font-semibold text-blue-600 hover:underline">
                  Việc của tôi →
                </Link>
              </div>
              <div className="divide-y divide-slate-100">
                {data && data.upcomingDeadlines.length > 0 ? (
                  data.upcomingDeadlines.map((t) => (
                    <Link
                      key={t.taskId}
                      href={`/missions/${t.missionId}`}
                      className="block px-4 py-3 hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-blue-700">
                          {t.taskCode} · {t.teamName}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <UrgencyBadge urgency={t.urgency} />
                          <StatusBadge status={t.status} kind="task" />
                        </div>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{t.taskTitle}</div>
                      <div className={`mt-1 text-xs font-medium ${t.isOverdue ? "text-red-700" : "text-slate-600"}`}>
                        Hạn: {formatVnDateTime(t.deadline)} {t.isOverdue ? "— ĐÃ QUÁ HẠN" : ""}
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Không có task nào sắp đến hạn trong 48 giờ tới.
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
