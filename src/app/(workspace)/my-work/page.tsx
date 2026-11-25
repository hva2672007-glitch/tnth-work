"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { StatusBadge, UrgencyBadge } from "@/components/badges";
import { formatVnDateTime } from "@/lib/date";
import type { UrgencyLevel } from "@/lib/constants";

interface MyWorkData {
  assignments: Array<{
    assignmentId: string;
    taskId: string;
    taskCode: string;
    taskTitle: string;
    deliverable: string;
    missionId: string;
    missionCode: string;
    missionTitle: string;
    groupName: string;
    teamName: string;
    urgency: UrgencyLevel;
    status: string;
    deadline: string;
    isOverdue: boolean;
    weight: number;
  }>;
  reviewQueue: Array<{
    versionId: string;
    versionNo: number;
    taskCode: string;
    taskTitle: string;
    missionId: string;
    missionCode: string;
    submittedByName: string;
    submittedAt: string;
    deadline: string;
    urgency: UrgencyLevel;
  }>;
}

const TABS = [
  { key: "ALL", label: "Tất cả" },
  { key: "PENDING", label: "Mới giao" },
  { key: "ACCEPTED", label: "Đang làm" },
  { key: "SUBMITTED", label: "Chờ duyệt" },
  { key: "REVISION_REQUIRED", label: "Cần sửa" },
  { key: "COMPLETED", label: "Đã xong" },
];

export default function MyWorkPage() {
  const [data, setData] = useState<MyWorkData | null>(null);
  const [tab, setTab] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<MyWorkData>("/api/v1/my-work");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách việc của tôi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const filtered = (data?.assignments ?? []).filter((a) => (tab === "ALL" ? true : a.status === tab));

  const accept = async (assignmentId: string) => {
    try {
      await apiFetch(`/api/v1/assignments/${assignmentId}/accept`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không nhận được việc.");
    }
  };

  const decline = async (assignmentId: string) => {
    const reason = window.prompt("Nhập lý do từ chối nhận việc (bắt buộc):");
    if (!reason) return;
    try {
      await apiFetch(`/api/v1/assignments/${assignmentId}/decline`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không từ chối được việc.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Việc của tôi</h1>
        <p className="text-sm text-slate-500">Nhận việc, theo dõi hạn nộp sản phẩm và xử lý hàng chờ nghiệm thu</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {/* Hàng chờ nghiệm thu dành cho cấp quản trị */}
      {data && data.reviewQueue.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <h2 className="text-sm font-bold text-amber-950">
            Hàng chờ nghiệm thu của bạn ({data.reviewQueue.length} sản phẩm)
          </h2>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            {data.reviewQueue.map((q) => (
              <Link
                key={q.versionId}
                href={`/missions/${q.missionId}`}
                className="rounded-lg border border-amber-200 bg-white p-3 hover:border-blue-400"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-bold text-blue-700">{q.taskCode} v{q.versionNo}</span>
                  <UrgencyBadge urgency={q.urgency} />
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{q.taskTitle}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Nộp bởi {q.submittedByName} lúc {formatVnDateTime(q.submittedAt)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Tabs trạng thái */}
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {TABS.map((t) => {
          const count = (data?.assignments ?? []).filter((a) => (t.key === "ALL" ? true : a.status === t.key)).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === t.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Nhiệm vụ / Khối</th>
                <th>Task cần làm</th>
                <th>Deadline</th>
                <th>Độ khẩn</th>
                <th>Trạng thái</th>
                <th>Thao tác nhanh</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">Đang tải...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">Không có công việc nào trong mục này.</td>
                </tr>
              ) : (
                filtered.map((a) => (
                  <tr key={a.assignmentId}>
                    <td>
                      <div className="font-mono text-xs font-semibold text-blue-700">{a.missionCode}</div>
                      <div className="text-xs text-slate-500">{a.groupName}</div>
                    </td>
                    <td>
                      <Link href={`/missions/${a.missionId}`} className="font-semibold text-slate-900 hover:text-blue-700 hover:underline">
                        {a.taskTitle}
                      </Link>
                      {a.deliverable && <div className="text-xs text-slate-500">Đầu ra: {a.deliverable}</div>}
                    </td>
                    <td className={`whitespace-nowrap text-xs font-medium ${a.isOverdue ? "text-red-700" : "text-slate-700"}`}>
                      {formatVnDateTime(a.deadline)}
                      {a.isOverdue && <div className="font-bold text-red-600">QUÁ HẠN</div>}
                    </td>
                    <td><UrgencyBadge urgency={a.urgency} /></td>
                    <td><StatusBadge status={a.status} kind="assignment" /></td>
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {a.status === "PENDING" && (
                          <>
                            <button
                              type="button"
                              onClick={() => void accept(a.assignmentId)}
                              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                            >
                              <Check className="h-3 w-3" /> Nhận
                            </button>
                            <button
                              type="button"
                              onClick={() => void decline(a.assignmentId)}
                              className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                            >
                              <XCircle className="h-3 w-3" /> Từ chối
                            </button>
                          </>
                        )}
                        <Link
                          href={`/missions/${a.missionId}`}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          Mở / Nộp <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
