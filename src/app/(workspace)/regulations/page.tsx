"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, FileDiff, FilePlus2, Stamp } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { StatusBadge } from "@/components/badges";
import { formatVnDateTime } from "@/lib/date";

interface RegulationVersion {
  id: string;
  versionCode: string;
  title: string;
  body: string;
  reason: string;
  status: string;
  effectiveAt: string;
  createdByName: string;
  createdAt: string;
  approvedAt: string | null;
}

export default function RegulationsPage() {
  const { capabilities } = useAuth();
  const [current, setCurrent] = useState<RegulationVersion | null>(null);
  const [versions, setVersions] = useState<RegulationVersion[]>([]);
  const [showPropose, setShowPropose] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ current: RegulationVersion | null; versions: RegulationVersion[] }>("/api/v1/regulations");
      setCurrent(res.current);
      setVersions(res.versions);
      if (res.current) {
        setTitle((prev) => prev || res.current!.title);
        setBody((prev) => prev || res.current!.body);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được quy chế.");
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

  const handlePropose = async () => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/regulations", {
        method: "POST",
        body: JSON.stringify({ title, body, reason }),
      });
      setNotice("Đã gửi đề xuất sửa đổi quy chế vào Trung tâm phê duyệt đồng xác nhận!");
      setReason("");
      setShowPropose(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gửi đề xuất thất bại.");
    }
  };

  const compareVer = versions.find((v) => v.id === compareId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quy chế hoạt động Ban Biên tập</h1>
          <p className="text-sm text-slate-500">
            Mọi sửa đổi quy chế chỉ có hiệu lực sau khi hoàn tất đồng xác nhận đúng cấp bậc
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/approvals"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            <Stamp className="h-4 w-4" /> Hộp phê duyệt đồng xác nhận
          </Link>
          {capabilities?.canProposeRegulation && (
            <button
              type="button"
              onClick={() => setShowPropose((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <FilePlus2 className="h-4 w-4" /> Đề xuất sửa quy chế
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {showPropose && capabilities?.canProposeRegulation && (
        <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
          <h2 className="text-base font-bold text-blue-950">Đề xuất phiên bản quy chế mới</h2>
          <p className="text-xs text-slate-600">
            01.01 sửa cần 02 đồng xác nhận · 01.02 sửa cần 02 và 03 đồng xác nhận · 02 sửa cần 01.01 đồng xác nhận.
          </p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tiêu đề quy chế"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <textarea
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Nội dung quy chế đề xuất..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Lý do đề xuất sửa đổi quy chế (bắt buộc)..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handlePropose()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Gửi yêu cầu đồng xác nhận
            </button>
            <button
              type="button"
              onClick={() => setShowPropose(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
            >
              Đóng
            </button>
          </div>
        </section>
      )}

      {/* Phiên bản hiện hành */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold text-slate-900">
              {current ? `${current.versionCode} — ${current.title}` : "Chưa có quy chế ban hành"}
            </h2>
          </div>
          {current && <StatusBadge status={current.status} kind="approval" />}
        </div>
        {current ? (
          <>
            <div className="mt-2 text-xs text-slate-500">
              Ban hành bởi {current.createdByName} · Hiệu lực từ {formatVnDateTime(current.effectiveAt)}
            </div>
            <div className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
              {current.body}
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Chưa có phiên bản quy chế chính thức.</p>
        )}
      </section>

      {/* So sánh 2 phiên bản */}
      {compareVer && current && (
        <section className="rounded-xl border border-blue-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-blue-900">
              <FileDiff className="h-4 w-4" /> So sánh: {current.versionCode} (Hiện hành) vs {compareVer.versionCode}
            </h3>
            <button type="button" onClick={() => setCompareId(null)} className="text-xs text-slate-500 hover:underline">
              Đóng so sánh
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="mb-2 font-bold text-slate-700">{current.versionCode} (Hiện hành)</div>
              <pre className="whitespace-pre-wrap font-sans text-slate-700">{current.body}</pre>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs">
              <div className="mb-2 font-bold text-blue-900">{compareVer.versionCode} ({compareVer.status})</div>
              <pre className="whitespace-pre-wrap font-sans text-slate-800">{compareVer.body}</pre>
            </div>
          </div>
        </section>
      )}

      {/* Lịch sử phiên bản */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-900">
          Lịch sử phiên bản quy chế ({versions.length})
        </div>
        <div className="overflow-x-auto">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Phiên bản</th>
                <th>Tiêu đề &amp; Lý do</th>
                <th>Người lập</th>
                <th>Thời điểm</th>
                <th>Trạng thái</th>
                <th>So sánh</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono text-xs font-bold text-blue-700">{v.versionCode}</td>
                  <td>
                    <div className="font-semibold text-slate-900">{v.title}</div>
                    <div className="text-xs text-slate-500">{v.reason}</div>
                  </td>
                  <td className="text-xs">{v.createdByName}</td>
                  <td className="whitespace-nowrap text-xs">{formatVnDateTime(v.createdAt)}</td>
                  <td><StatusBadge status={v.status} kind="approval" /></td>
                  <td>
                    {current && v.id !== current.id && (
                      <button
                        type="button"
                        onClick={() => setCompareId(v.id)}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Xem khác biệt
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
