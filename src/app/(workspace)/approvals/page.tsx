"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Crown, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { StatusBadge } from "@/components/badges";
import { formatVnDateTime } from "@/lib/date";

interface ApprovalItem {
  id: string;
  type: "REGULATION_AMENDMENT" | "ROLE_PROMOTION_HEAD";
  proposerName: string;
  title: string;
  reason: string;
  status: string;
  createdAt: string;
  appliedAt: string | null;
  groupProgress: Record<string, { approved: number; required: number; totalEligible: number }>;
  eligibleVoters: { memberId: string; displayName: string; requiredGroup: string }[];
  votes: { memberId: string; displayName: string; decision: "APPROVE" | "REJECT"; reason: string; votedAt: string }[];
  canVote: boolean;
  canApply: boolean;
}

interface MemberItem {
  id: string;
  displayName: string;
  role: string;
}

export default function ApprovalsPage() {
  const { capabilities } = useAuth();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [actingHeads, setActingHeads] = useState<MemberItem[]>([]);
  const [promoteTargetId, setPromoteTargetId] = useState("");
  const [promoteReason, setPromoteReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [ap, mems] = await Promise.all([
        apiFetch<ApprovalItem[]>("/api/v1/approvals"),
        apiFetch<MemberItem[]>("/api/v1/members?role=ACTING_HEAD"),
      ]);
      setItems(ap);
      setActingHeads(mems);
      if (mems[0]) setPromoteTargetId((p) => p || mems[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách phê duyệt.");
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

  const vote = async (id: string, decision: "APPROVE" | "REJECT") => {
    let reason = "";
    if (decision === "REJECT") {
      reason = window.prompt("Nhập lý do từ chối đồng xác nhận (bắt buộc):") ?? "";
      if (!reason) return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/approvals/${id}/vote`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      });
      setNotice(decision === "APPROVE" ? "Đã ghi nhận phiếu Đồng ý!" : "Đã ghi nhận phiếu Từ chối.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể bỏ phiếu.");
    }
  };

  const apply = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/approvals/${id}/apply`, { method: "POST" });
      setNotice("Đã áp dụng đề xuất thành công!");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể áp dụng đề xuất.");
    }
  };

  const proposePromotion = async () => {
    if (!promoteTargetId || !promoteReason.trim()) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/approvals", {
        method: "POST",
        body: JSON.stringify({
          type: "ROLE_PROMOTION_HEAD",
          targetMemberId: promoteTargetId,
          reason: promoteReason.trim(),
        }),
      });
      setNotice("Đã gửi đề xuất nâng Bậc 01.02 → 01.01. Cần 100% tài khoản Bậc 03 đồng thuận.");
      setPromoteReason("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tạo được đề xuất nâng bậc.");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/regulations" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại trang Quy chế
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Trung tâm phê duyệt &amp; Đồng xác nhận</h1>
        <p className="text-sm text-slate-500">
          Xử lý đồng xác nhận sửa quy chế và đề xuất nâng Bậc 01.02 lên Bậc 01.01 (100% Bậc 03 đồng thuận)
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {/* Form đề xuất nâng 01.02 lên 01.01 dành cho Phó Trưởng Ban (Bậc 02) */}
      {capabilities?.canPromoteHead && (
        <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-indigo-950">
            <Crown className="h-4 w-4 text-indigo-700" />
            Đề xuất nâng Quyền Trưởng Ban (01.02) lên Trưởng Ban (01.01)
          </h2>
          <p className="text-xs text-slate-600">
            Yêu cầu 100% toàn bộ tài khoản Bậc 03 đồng thuận và không có Bậc 01.01 khác đang hiệu lực.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={promoteTargetId}
              onChange={(e) => setPromoteTargetId(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {actingHeads.length === 0 ? (
                <option value="">Không có tài khoản Bậc 01.02</option>
              ) : (
                actingHeads.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} (01.02)
                  </option>
                ))
              )}
            </select>
            <input
              type="text"
              value={promoteReason}
              onChange={(e) => setPromoteReason(e.target.value)}
              placeholder="Lý do đề xuất nâng cấp bậc..."
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={!promoteTargetId || !promoteReason.trim()}
              onClick={() => void proposePromotion()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Gửi lấy ý kiến 100% Bậc 03
            </button>
          </div>
        </section>
      )}

      {/* Danh sách yêu cầu phê duyệt */}
      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Chưa có yêu cầu phê duyệt đồng xác nhận nào.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {item.type === "REGULATION_AMENDMENT" ? "Sửa quy chế" : "Nâng bậc 01.02 → 01.01"}
                    </span>
                    <StatusBadge status={item.status} kind="approval" />
                  </div>
                  <h3 className="mt-1.5 text-base font-bold text-slate-900">{item.title}</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Người đề xuất: <strong>{item.proposerName}</strong> · {formatVnDateTime(item.createdAt)} · Lý do: {item.reason}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {item.canVote && (
                    <>
                      <button
                        type="button"
                        onClick={() => void vote(item.id, "APPROVE")}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" /> Đồng xác nhận
                      </button>
                      <button
                        type="button"
                        onClick={() => void vote(item.id, "REJECT")}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" /> Từ chối
                      </button>
                    </>
                  )}
                  {item.canApply && (
                    <button
                      type="button"
                      onClick={() => void apply(item.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận áp dụng chính thức
                    </button>
                  )}
                </div>
              </div>

              {/* Tiến độ phiếu theo nhóm */}
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
                <div>
                  <div className="font-semibold text-slate-700">Tiến độ đồng xác nhận:</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {Object.entries(item.groupProgress).map(([grp, prog]) => (
                      <span key={grp} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium">
                        Nhóm {grp}: <strong>{prog.approved}/{prog.required}</strong> phiếu (tổng {prog.totalEligible} cử tri)
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-700">Chi tiết phiếu ({item.votes.length}/{item.eligibleVoters.length}):</div>
                  <div className="mt-1 space-y-1">
                    {item.votes.length === 0 ? (
                      <span className="text-slate-400">Chưa có phiếu phản hồi.</span>
                    ) : (
                      item.votes.map((v) => (
                        <div key={v.memberId} className={v.decision === "APPROVE" ? "text-emerald-700" : "text-red-700"}>
                          {v.decision === "APPROVE" ? "✓" : "✗"} {v.displayName} ({formatVnDateTime(v.votedAt)})
                          {v.reason ? ` — ${v.reason}` : ""}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
