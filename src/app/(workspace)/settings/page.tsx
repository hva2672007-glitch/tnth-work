"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Play, Plus, Shield } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { formatVnDateTime } from "@/lib/date";

type TabKey = "groups" | "channels" | "schedules" | "portal" | "audit";

export default function SettingsPage() {
  const { actor, capabilities } = useAuth();
  const [tab, setTab] = useState<TabKey>("groups");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [groups, setGroups] = useState<Array<{ id: string; code: string; name: string; active: boolean; missionCount: number }>>([]);
  const [newGroupName, setNewGroupName] = useState("");

  const [channels, setChannels] = useState<Array<{ id: string; code: string; name: string; active: boolean }>>([]);
  const [newChannelName, setNewChannelName] = useState("");

  const [schedules, setSchedules] = useState<
    Array<{ id: string; name: string; groupName: string; frequency: string; autoAssign: boolean; nextRunAt: string | null; enabled: boolean }>
  >([]);

  const [portalRequests, setPortalRequests] = useState<
    Array<{
      id: string;
      targetName: string;
      targetExternalAccountId: string;
      requestedPermissions: string[];
      reason: string;
      status: string;
      evidence: string;
      createdAt: string;
    }>
  >([]);
  const [members, setMembers] = useState<Array<{ id: string; displayName: string }>>([]);
  const [permTargetId, setPermTargetId] = useState("");
  const [permCodes, setPermCodes] = useState("post.manage, post.publish");
  const [permReason, setPermReason] = useState("");

  const [auditLogs, setAuditLogs] = useState<
    Array<{ id: string; actorName: string; action: string; targetType: string; targetId: string | null; createdAt: string }>
  >([]);

  const load = useCallback(async () => {
    try {
      const [g, c] = await Promise.all([
        apiFetch<typeof groups>("/api/v1/groups?includeInactive=true"),
        apiFetch<typeof channels>("/api/v1/channels?includeInactive=true"),
      ]);
      setGroups(g);
      setChannels(c);
      if (capabilities?.canCreateMission) {
        apiFetch<typeof schedules>("/api/v1/recurring-schedules").then(setSchedules).catch(() => {});
      }
      if (capabilities?.canRequestPortalPerms) {
        apiFetch<typeof portalRequests>("/api/v1/integration/portal-permission-requests").then(setPortalRequests).catch(() => {});
        apiFetch<typeof members>("/api/v1/members").then((m) => {
          setMembers(m);
          if (m[0]) setPermTargetId((p) => p || m[0].id);
        }).catch(() => {});
      }
      if (capabilities?.canViewAudit) {
        apiFetch<typeof auditLogs>("/api/v1/audit-logs?limit=50").then(setAuditLogs).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được cài đặt.");
    }
  }, [capabilities]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cài đặt &amp; Quản trị hệ thống</h1>
          <p className="text-sm text-slate-500">Quản lý khối nhiệm vụ, kênh đăng tải, lịch định kỳ, cổng thông tin và nhật ký</p>
        </div>
        {actor && (
          <Link
            href={`/members/${actor.memberId}`}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Chỉnh sửa hồ sơ cá nhân →
          </Link>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { key: "groups", label: "Khối nhiệm vụ", show: true },
          { key: "channels", label: "Kênh đăng tải", show: true },
          { key: "schedules", label: "Nhiệm vụ định kỳ", show: Boolean(capabilities?.canCreateMission) },
          { key: "portal", label: "Quản trị Web nguồn", show: Boolean(capabilities?.canRequestPortalPerms) },
          { key: "audit", label: "Nhật ký Audit", show: Boolean(capabilities?.canViewAudit) },
        ]
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as TabKey)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold ${
                tab === t.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Tab Khối nhiệm vụ */}
      {tab === "groups" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          {capabilities?.canManageGroups && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Tên khối nhiệm vụ mới (vd: Truyền thông tháng 12)..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newGroupName.trim()) return;
                  void run(async () => {
                    await apiFetch("/api/v1/groups", { method: "POST", body: JSON.stringify({ name: newGroupName.trim() }) });
                    setNewGroupName("");
                  }, "Đã thêm khối nhiệm vụ mới.");
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Thêm khối
              </button>
            </div>
          )}
          <table className="excel-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên khối nhiệm vụ</th>
                <th>Số nhiệm vụ</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td className="font-mono text-xs">{g.code}</td>
                  <td className="font-semibold">{g.name}</td>
                  <td>{g.missionCount}</td>
                  <td className="text-xs">{g.active ? "Đang dùng" : "Đã ngừng"}</td>
                  <td>
                    {capabilities?.canManageGroups && (
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => apiFetch(`/api/v1/groups/${g.id}`, { method: "PATCH", body: JSON.stringify({ active: !g.active }) }),
                            g.active ? "Đã ngừng sử dụng khối nhiệm vụ." : "Đã kích hoạt lại khối nhiệm vụ.",
                          )
                        }
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        {g.active ? "Ngừng dùng" : "Kích hoạt lại"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab Kênh đăng tải */}
      {tab === "channels" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          {capabilities?.canManageChannels && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                placeholder="Tên kênh đăng tải mới..."
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newChannelName.trim()) return;
                  void run(async () => {
                    await apiFetch("/api/v1/channels", { method: "POST", body: JSON.stringify({ name: newChannelName.trim() }) });
                    setNewChannelName("");
                  }, "Đã thêm kênh đăng tải.");
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Thêm kênh
              </button>
            </div>
          )}
          <table className="excel-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên kênh / nền tảng</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-xs">{c.active ? "Đang dùng" : "Đã ngừng"}</td>
                  <td>
                    {capabilities?.canManageChannels && (
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            () => apiFetch(`/api/v1/channels/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) }),
                            "Đã cập nhật trạng thái kênh.",
                          )
                        }
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        {c.active ? "Tắt" : "Bật"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab Nhiệm vụ định kỳ */}
      {tab === "schedules" && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Lịch nhiệm vụ định kỳ (tuần / tháng / năm)</h2>
            {capabilities?.canManageSettings && (
              <button
                type="button"
                onClick={() =>
                  void run(
                    () => apiFetch("/api/v1/recurring-schedules", { method: "POST", body: JSON.stringify({ action: "RUN_JOBS_NOW" }) }),
                    "Đã chạy bộ quét nhắc hạn & sinh nhiệm vụ định kỳ!",
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Play className="h-3.5 w-3.5" /> Chạy Job nhắc hạn &amp; định kỳ ngay
              </button>
            )}
          </div>
          <table className="excel-table">
            <thead>
              <tr>
                <th>Tên lịch</th>
                <th>Khối</th>
                <th>Chu kỳ</th>
                <th>Chế độ</th>
                <th>Lần chạy kế tiếp</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">{s.name}</td>
                  <td className="text-xs">{s.groupName}</td>
                  <td className="text-xs">{s.frequency}</td>
                  <td className="text-xs">{s.autoAssign ? "Giao tự động" : "Tạo nháp trước"}</td>
                  <td className="text-xs">{formatVnDateTime(s.nextRunAt)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        void run(
                          () => apiFetch(`/api/v1/recurring-schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }),
                          "Đã cập nhật lịch định kỳ.",
                        )
                      }
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      {s.enabled ? "Đang bật (Tắt)" : "Đang tắt (Bật)"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab Phân công quản trị cổng thông tin nguồn */}
      {tab === "portal" && capabilities?.canRequestPortalPerms && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <Shield className="mr-1 inline h-4 w-4" />
            <strong>Lưu ý bảo mật (mục 4.5):</strong> Yêu cầu phân công quản trị trang thanhnientruonghoc.io.vn được tách riêng khỏi nhiệm vụ công tác và không tự ghi đè bảng <code>account_permissions</code> ở web nguồn. Chỉ chuyển sang APPLIED khi có xác nhận thực thi qua API ủy quyền hoặc quản trị viên cổng thông tin.
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4">
            <select value={permTargetId} onChange={(e) => setPermTargetId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
            <input
              type="text"
              value={permCodes}
              onChange={(e) => setPermCodes(e.target.value)}
              placeholder="Mã quyền nguồn (vd: post.manage, post.publish)"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
            <input
              type="text"
              value={permReason}
              onChange={(e) => setPermReason(e.target.value)}
              placeholder="Lý do phân công quản trị..."
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!permTargetId || !permReason.trim()) return;
                void run(async () => {
                  await apiFetch("/api/v1/integration/portal-permission-requests", {
                    method: "POST",
                    body: JSON.stringify({
                      targetMemberId: permTargetId,
                      requestedPermissions: permCodes.split(",").map((s) => s.trim()).filter(Boolean),
                      reason: permReason.trim(),
                    }),
                  });
                  setPermReason("");
                }, "Đã tạo yêu cầu phân công quản trị cổng thông tin.");
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Tạo yêu cầu
            </button>
          </div>

          <table className="excel-table">
            <thead>
              <tr>
                <th>Thành viên</th>
                <th>Quyền đề xuất</th>
                <th>Lý do</th>
                <th>Trạng thái &amp; Bằng chứng</th>
                <th>Xác nhận</th>
              </tr>
            </thead>
            <tbody>
              {portalRequests.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold">{r.targetName} (#{r.targetExternalAccountId})</td>
                  <td className="font-mono text-xs">{r.requestedPermissions.join(", ")}</td>
                  <td className="text-xs">{r.reason}</td>
                  <td className="text-xs">
                    <strong>{r.status}</strong> — {r.evidence}
                  </td>
                  <td>
                    {r.status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => {
                          const ev = window.prompt("Nhập bằng chứng quản trị viên cổng thông tin đã thực thi:");
                          if (!ev) return;
                          void run(
                            () =>
                              apiFetch(`/api/v1/integration/portal-permission-requests/${r.id}/resolve`, {
                                method: "POST",
                                body: JSON.stringify({ status: "APPLIED", evidence: ev }),
                              }),
                            "Đã ghi nhận xác nhận thực thi từ quản trị viên cổng thông tin.",
                          );
                        }}
                        className="text-xs font-semibold text-emerald-700 hover:underline"
                      >
                        Xác nhận đã cấp
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Tab Audit Logs */}
      {tab === "audit" && capabilities?.canViewAudit && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="excel-table">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Người thực hiện</th>
                  <th>Hành động</th>
                  <th>Đối tượng</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-xs">{formatVnDateTime(a.createdAt)}</td>
                    <td className="font-medium">{a.actorName}</td>
                    <td className="font-mono text-xs text-blue-800">{a.action}</td>
                    <td className="text-xs text-slate-600">{a.targetType} {a.targetId ? `(${a.targetId.slice(0, 8)}...)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
