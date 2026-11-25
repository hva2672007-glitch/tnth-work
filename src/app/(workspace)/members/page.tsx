"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, ShieldPlus, UserMinus, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { RoleBadge, StatusBadge } from "@/components/badges";
import { ROLE_LABELS, TEAM_TITLE_LABELS, type ActivityStatus, type MemberRole, type TeamTitle } from "@/lib/constants";

interface MemberRow {
  id: string;
  memberCode: string;
  externalAccountId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  accessEnabled: boolean;
  activityStatus: ActivityStatus;
  primaryTeam: { id: string; code: string; name: string; title: TeamTitle } | null;
  teams: { id: string; code: string; name: string; isPrimary: boolean; title: TeamTitle }[];
  canViewDetail: boolean;
  canEdit: boolean;
  canRevoke: boolean;
}

interface TeamRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  memberCount: number;
}

interface PortalAccountItem {
  externalAccountId: string;
  username: string;
  displayName: string;
  email?: string;
  status: string;
  hasAccess: boolean;
  internalRole: string | null;
}

export default function MembersPage() {
  const { capabilities } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal / panel tra cứu tài khoản nguồn & cấp quyền (Bậc 01.01)
  const [showGrantPanel, setShowGrantPanel] = useState(false);
  const [portalQuery, setPortalQuery] = useState("");
  const [portalResults, setPortalResults] = useState<PortalAccountItem[]>([]);
  const [selectedExtId, setSelectedExtId] = useState("");
  const [grantRole, setGrantRole] = useState<Exclude<MemberRole, "HEAD">>("MEMBER");
  const [grantTeamId, setGrantTeamId] = useState("");
  const [grantTeamTitle, setGrantTeamTitle] = useState<TeamTitle>("MEMBER");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("q", search.trim());
      if (teamFilter) qs.set("teamId", teamFilter);
      if (roleFilter) qs.set("role", roleFilter);
      const [m, t] = await Promise.all([
        apiFetch<MemberRow[]>(`/api/v1/members?${qs.toString()}`),
        apiFetch<TeamRow[]>("/api/v1/teams"),
      ]);
      setMembers(m);
      setTeams(t);
      if (t[0]) setGrantTeamId((prev) => prev || t[0].id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh bạ thành viên.");
    } finally {
      setLoading(false);
    }
  }, [search, teamFilter, roleFilter]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const searchPortal = async () => {
    setError(null);
    try {
      const res = await apiFetch<{ items: PortalAccountItem[] }>(
        `/api/v1/integration/accounts?q=${encodeURIComponent(portalQuery)}`,
      );
      setPortalResults(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tra cứu được tài khoản cổng thông tin.");
    }
  };

  const handleGrant = async () => {
    if (!selectedExtId || !grantTeamId) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/members/access", {
        method: "POST",
        body: JSON.stringify({
          externalAccountId: selectedExtId,
          role: grantRole,
          primaryTeamId: grantTeamId,
          primaryTeamTitle: grantRole === "TEAM_LEAD" ? grantTeamTitle : "MEMBER",
        }),
      });
      setNotice("Đã cấp quyền truy cập Web Phân công cho tài khoản đã chọn.");
      setSelectedExtId("");
      setShowGrantPanel(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cấp quyền.");
    }
  };

  const handleRevoke = async (m: MemberRow) => {
    const reason = window.prompt(`Nhập lý do thu hồi quyền truy cập của ${m.displayName} (bắt buộc):`);
    if (!reason) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ openAssignmentsRequiringTransfer: unknown[] }>(
        `/api/v1/members/${m.id}/access/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      setNotice(
        `Đã thu hồi quyền của ${m.displayName}. Có ${res.openAssignmentsRequiringTransfer.length} phân công đang mở cần chuyển giao.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể thu hồi quyền.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Thành viên &amp; Tổ chuyên môn</h1>
          <p className="text-sm text-slate-500">
            5 cấp bậc · 7 tổ chuyên môn · Liên kết 01 tài khoản từ thanhnientruonghoc.io.vn
          </p>
        </div>
        {capabilities?.canGrantAccess && (
          <button
            type="button"
            onClick={() => {
              setShowGrantPanel((v) => !v);
              if (!showGrantPanel) void searchPortal();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <ShieldPlus className="h-4 w-4" />
            Tra cứu &amp; cấp quyền thành viên
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {/* Panel tra cứu tài khoản nguồn & cấp quyền */}
      {showGrantPanel && capabilities?.canGrantAccess && (
        <section className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
          <div className="text-base font-bold text-blue-950">
            Tra cứu tài khoản đã đăng ký tại thanhnientruonghoc.io.vn
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={portalQuery}
              onChange={(e) => setPortalQuery(e.target.value)}
              placeholder="Tìm theo username, tên hiển thị, email hoặc ID nguồn..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void searchPortal()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Tra cứu
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {portalResults.map((p) => (
              <button
                key={p.externalAccountId}
                type="button"
                disabled={p.status !== "ACTIVE" || p.hasAccess}
                onClick={() => setSelectedExtId(p.externalAccountId)}
                className={`rounded-lg border p-3 text-left text-xs ${
                  selectedExtId === p.externalAccountId
                    ? "border-blue-600 bg-blue-100/70"
                    : p.hasAccess || p.status !== "ACTIVE"
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 opacity-60"
                      : "border-slate-200 bg-white hover:border-blue-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{p.displayName}</span>
                  <span className={p.status === "ACTIVE" ? "text-emerald-700" : "text-red-600"}>{p.status}</span>
                </div>
                <div className="mt-0.5 text-slate-500">@{p.username} · ID: {p.externalAccountId}</div>
                {p.hasAccess && <div className="mt-1 font-medium text-blue-700">Đã có quyền ({p.internalRole})</div>}
              </button>
            ))}
          </div>

          {selectedExtId && (
            <div className="grid gap-3 rounded-lg border border-blue-200 bg-white p-4 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Cấp bậc cấp quyền</label>
                <select
                  value={grantRole}
                  onChange={(e) => setGrantRole(e.target.value as Exclude<MemberRole, "HEAD">)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="MEMBER">{ROLE_LABELS.MEMBER.full}</option>
                  <option value="TEAM_LEAD">{ROLE_LABELS.TEAM_LEAD.full}</option>
                  <option value="DEPUTY">{ROLE_LABELS.DEPUTY.full}</option>
                  <option value="ACTING_HEAD">{ROLE_LABELS.ACTING_HEAD.full}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Tổ chuyên môn chính</label>
                <select
                  value={grantTeamId}
                  onChange={(e) => setGrantTeamId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  {teams.filter((t) => t.active).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              {grantRole === "TEAM_LEAD" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Chức danh tại tổ</label>
                  <select
                    value={grantTeamTitle}
                    onChange={(e) => setGrantTeamTitle(e.target.value as TeamTitle)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value="LEADER">Trưởng Tổ</option>
                    <option value="DEPUTY_LEADER">Phó Tổ</option>
                  </select>
                </div>
              )}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handleGrant()}
                  className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  Xác nhận cấp quyền
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tóm tắt 7 tổ */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {teams.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTeamFilter(teamFilter === t.id ? "" : t.id)}
            className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
              teamFilter === t.id
                ? "border-blue-500 bg-blue-50"
                : "border-slate-200 bg-white hover:border-blue-300"
            }`}
          >
            <div>
              <div className="text-xs font-bold text-slate-900">{t.name}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{t.code}</div>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
              <Users className="h-3 w-3" /> {t.memberCount}
            </div>
          </button>
        ))}
      </div>

      {/* Bộ lọc danh bạ */}
      <div className="flex flex-wrap gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, mã TV hoặc username..."
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Tất cả cấp bậc</option>
          <option value="HEAD">Bậc 01.01 — Trưởng Ban</option>
          <option value="ACTING_HEAD">Bậc 01.02 — Quyền Trưởng Ban</option>
          <option value="DEPUTY">Bậc 02 — Phó Ban</option>
          <option value="TEAM_LEAD">Bậc 03 — Lãnh đạo Tổ</option>
          <option value="MEMBER">Bậc 04 — Thành viên</option>
        </select>
      </div>

      {/* Bảng danh bạ */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Mã TV</th>
                <th>Họ và tên</th>
                <th>Cấp bậc</th>
                <th>Tổ chính &amp; Tổ phụ</th>
                <th>Tình trạng</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">Đang tải...</td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono text-xs font-semibold text-slate-600">{m.memberCode}</td>
                    <td>
                      <div className="font-semibold text-slate-900">{m.displayName}</div>
                      <div className="text-xs text-slate-500">@{m.username}</div>
                    </td>
                    <td>
                      <RoleBadge role={m.role} />
                      <div className="mt-0.5 text-[11px] text-slate-500">{ROLE_LABELS[m.role].name}</div>
                    </td>
                    <td className="text-xs">
                      {m.primaryTeam ? (
                        <div className="font-medium text-slate-900">
                          ★ {m.primaryTeam.name} ({TEAM_TITLE_LABELS[m.primaryTeam.title]})
                        </div>
                      ) : (
                        <span className="text-slate-400">Chưa phân tổ</span>
                      )}
                      {m.teams
                        .filter((t) => !t.isPrimary)
                        .map((sec) => (
                          <div key={sec.id} className="text-slate-500">
                            · Tổ phụ: {sec.name}
                          </div>
                        ))}
                    </td>
                    <td>
                      <StatusBadge status={m.activityStatus} kind="activity" />
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {m.canViewDetail ? (
                          <Link
                            href={`/members/${m.id}`}
                            className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                          >
                            Hồ sơ
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">Hạn chế xem</span>
                        )}
                        {m.canRevoke && (
                          <button
                            type="button"
                            onClick={() => void handleRevoke(m)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                          >
                            <UserMinus className="h-3 w-3" /> Thu hồi
                          </button>
                        )}
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
