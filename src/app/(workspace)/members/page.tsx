"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Search,
  ShieldPlus,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { RoleBadge, StatusBadge, UrgencyBadge, WorkloadBadge, type WorkloadLevelUi } from "@/components/badges";
import {
  ROLE_LABELS,
  TEAM_TITLE_LABELS,
  type ActivityStatus,
  type MemberRole,
  type TeamTitle,
  type UrgencyLevel,
} from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface MemberRow {
  id: string;
  memberCode: string;
  provider?: string;
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

interface WorkloadResponse {
  summary: {
    totalMembers: number;
    freeCount: number;
    normalCount: number;
    busyCount: number;
    overloadedCount: number;
    totalActiveTasks: number;
    totalOverdueTasks: number;
  };
  members: Array<{
    memberId: string;
    memberCode: string;
    username: string;
    displayName: string;
    role: MemberRole;
    activityStatus: ActivityStatus;
    primaryTeam: { id: string; code: string; name: string; title: TeamTitle } | null;
    teams: { id: string; code: string; name: string; isPrimary: boolean; title: TeamTitle }[];
    counts: {
      pending: number;
      inProgress: number;
      submitted: number;
      revisionRequired: number;
      activeTotal: number;
      overdue: number;
      completedThisMonth: number;
    };
    activeWeight: number;
    nearestDeadline: string | null;
    workloadLevel: WorkloadLevelUi;
    activeTasks: Array<{
      assignmentId: string;
      taskId: string;
      taskCode: string;
      taskTitle: string;
      missionId: string;
      missionCode: string;
      missionTitle: string;
      teamName: string;
      status: string;
      urgency: UrgencyLevel;
      weight: number;
      deadline: string;
      isOverdue: boolean;
    }>;
  }>;
}

export default function MembersPage() {
  const { actor, capabilities } = useAuth();
  const isManager = Boolean(actor && actor.role !== "MEMBER");

  const [viewTab, setViewTab] = useState<"directory" | "workload">("directory");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [workloadData, setWorkloadData] = useState<WorkloadResponse | null>(null);
  const [workloadFilter, setWorkloadFilter] = useState<"ALL" | "FREE" | "OVERDUE">("ALL");
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [workloadLoading, setWorkloadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Modal / panel cấp quyền từ cổng thông tin HOẶC tạo tài khoản nội bộ trực tiếp (Bậc 01.01)
  const [showGrantPanel, setShowGrantPanel] = useState(false);
  const [grantMode, setGrantMode] = useState<"portal" | "local">("portal");
  const [portalQuery, setPortalQuery] = useState("");
  const [portalResults, setPortalResults] = useState<PortalAccountItem[]>([]);
  const [selectedExtId, setSelectedExtId] = useState("");
  const [grantRole, setGrantRole] = useState<Exclude<MemberRole, "HEAD">>("MEMBER");
  const [grantTeamId, setGrantTeamId] = useState("");
  const [grantTeamTitle, setGrantTeamTitle] = useState<TeamTitle>("MEMBER");

  // Form tạo tài khoản nội bộ trực tiếp (CTV / thành viên không còn Đoàn trực thuộc)
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localEmail, setLocalEmail] = useState("");
  const [localOrg, setLocalOrg] = useState("Cộng tác viên / Thành viên Ban Biên tập");
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [createdLocalCreds, setCreatedLocalCreds] = useState<{
    displayName: string;
    username: string;
    password: string;
    memberCode: string;
  } | null>(null);

  const loadDirectory = useCallback(async () => {
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

  const loadWorkload = useCallback(async () => {
    if (!isManager) return;
    setWorkloadLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("q", search.trim());
      if (teamFilter) qs.set("teamId", teamFilter);
      if (workloadFilter === "FREE") qs.set("onlyFree", "true");
      if (workloadFilter === "OVERDUE") qs.set("onlyOverdue", "true");
      const res = await apiFetch<WorkloadResponse>(`/api/v1/members/workload?${qs.toString()}`);
      setWorkloadData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được tình hình công việc nhân sự.");
    } finally {
      setWorkloadLoading(false);
    }
  }, [isManager, search, teamFilter, workloadFilter]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadDirectory();
    });
    return () => {
      active = false;
    };
  }, [loadDirectory]);

  useEffect(() => {
    if (!isManager || viewTab !== "workload") return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void loadWorkload();
    });
    return () => {
      active = false;
    };
  }, [isManager, viewTab, loadWorkload]);

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
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cấp quyền.");
    }
  };

  const generateRandomPassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$";
    let pw = "TNTH@";
    for (let i = 0; i < 7; i++) {
      pw += chars[Math.floor(Math.random() * chars.length)];
    }
    setLocalPassword(pw);
  };

  const suggestUsernameFromName = (name: string) => {
    const clean = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (clean.length === 0) return "";
    if (clean.length === 1) return `${clean[0]}.bbt`;
    return `${clean[clean.length - 1]}.${clean.slice(0, -1).map((p) => p[0]).join("")}bbt`;
  };

  const handleCreateLocalMember = async () => {
    if (!localDisplayName.trim() || !localUsername.trim() || !localPassword || !grantTeamId) return;
    setLocalSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<{ memberId: string; memberCode: string; username: string; displayName: string }>(
        "/api/v1/members/local",
        {
          method: "POST",
          body: JSON.stringify({
            displayName: localDisplayName.trim(),
            username: localUsername.trim().toLowerCase(),
            password: localPassword,
            email: localEmail.trim() || undefined,
            currentOrg: localOrg.trim() || undefined,
            role: grantRole,
            primaryTeamId: grantTeamId,
            primaryTeamTitle: grantRole === "TEAM_LEAD" ? grantTeamTitle : "MEMBER",
          }),
        },
      );
      setCreatedLocalCreds({
        displayName: created.displayName,
        username: created.username,
        password: localPassword,
        memberCode: created.memberCode,
      });
      setNotice(`Đã tạo tài khoản nội bộ cho ${created.displayName} (@${created.username}). Hãy sao chép thông tin đăng nhập gửi thành viên.`);
      setLocalDisplayName("");
      setLocalUsername("");
      setLocalPassword("");
      setLocalEmail("");
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo tài khoản nội bộ.");
    } finally {
      setLocalSubmitting(false);
    }
  };

  const handleResetLocalPassword = async (m: MemberRow) => {
    const newPassword = window.prompt(`Nhập mật khẩu tạm mới (tối thiểu 8 ký tự) cho ${m.displayName} (@${m.username}):`);
    if (!newPassword) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/api/v1/members/${m.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });
      setCreatedLocalCreds({
        displayName: m.displayName,
        username: m.username,
        password: newPassword,
        memberCode: m.memberCode,
      });
      setNotice(`Đã đặt lại mật khẩu cho ${m.displayName} và đăng xuất các phiên cũ.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể đặt lại mật khẩu.");
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
      await loadDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể thu hồi quyền.");
    }
  };

  const visibleTeams =
    viewTab === "workload" && actor?.role === "TEAM_LEAD" && actor.leadTeamIds.length > 0
      ? teams.filter((t) => actor.leadTeamIds.includes(t.id))
      : teams;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Thành viên &amp; Tổ chuyên môn</h1>
          <p className="text-sm text-slate-500">
            5 cấp bậc · 7 tổ chuyên môn · Theo dõi tải công việc từng nhân sự để điều phối hợp lý
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
            Thêm / Cấp quyền thành viên
          </button>
        )}
      </div>

      {/* Tabs chuyển giữa Danh bạ và Tình hình công việc nhân sự (cho Ban & Lead tổ) */}
      {isManager && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            onClick={() => setViewTab("directory")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
              viewTab === "directory" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Users className="h-4 w-4" />
            Danh bạ thành viên ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setViewTab("workload")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
              viewTab === "workload" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Activity className="h-4 w-4" />
            Tình hình công việc nhân sự
            {actor?.role === "TEAM_LEAD" ? " (Tổ phụ trách)" : " (Toàn Ban)"}
          </button>
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {/* Hộp thông tin tài khoản nội bộ vừa tạo / vừa đặt lại mật khẩu */}
      {createdLocalCreds && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold">
              Thông tin đăng nhập tài khoản nội bộ — {createdLocalCreds.displayName} ({createdLocalCreds.memberCode})
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const text = `Thông tin đăng nhập Web Phân công Ban Biên tập:\n- Họ tên: ${createdLocalCreds.displayName}\n- Tên đăng nhập: ${createdLocalCreds.username}\n- Mật khẩu tạm: ${createdLocalCreds.password}\n(Vui lòng đăng nhập mục "Tài khoản nội bộ" và đổi mật khẩu trong phần Cài đặt.)`;
                  void navigator.clipboard?.writeText(text);
                  setNotice("Đã sao chép thông tin đăng nhập vào bộ nhớ tạm.");
                }}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 font-semibold text-white hover:bg-indigo-700"
              >
                <Copy className="h-3.5 w-3.5" /> Sao chép gửi thành viên
              </button>
              <button
                type="button"
                onClick={() => setCreatedLocalCreds(null)}
                className="rounded-md border border-indigo-200 bg-white px-2.5 py-1 font-medium text-indigo-800"
              >
                Đóng
              </button>
            </div>
          </div>
          <div className="mt-2 grid gap-2 rounded-lg bg-white p-3 font-mono sm:grid-cols-2">
            <div>Tên đăng nhập: <strong>{createdLocalCreds.username}</strong></div>
            <div>Mật khẩu tạm: <strong>{createdLocalCreds.password}</strong></div>
          </div>
        </div>
      )}

      {/* Panel cấp quyền từ cổng thông tin HOẶC tạo tài khoản nội bộ trực tiếp */}
      {showGrantPanel && capabilities?.canGrantAccess && (
        <section className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-base font-bold text-blue-950">
              Thêm thành viên vào Web Phân công
            </div>
            <div className="inline-flex rounded-lg border border-blue-200 bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setGrantMode("portal")}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-semibold ${
                  grantMode === "portal" ? "bg-blue-600 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Search className="h-3.5 w-3.5" /> Từ cổng thanhnientruonghoc.io.vn
              </button>
              <button
                type="button"
                onClick={() => {
                  setGrantMode("local");
                  if (!localPassword) generateRandomPassword();
                }}
                className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 font-semibold ${
                  grantMode === "local" ? "bg-indigo-600 text-white" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" /> Tạo tài khoản nội bộ (không thuộc Đoàn)
              </button>
            </div>
          </div>

          {grantMode === "portal" ? (
            <>
              <p className="text-xs text-slate-600">
                Dành cho thành viên đã có tài khoản tại <strong>thanhnientruonghoc.io.vn</strong> (01 tài khoản dùng chung 2 nền tảng).
              </p>
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
            </>
          ) : (
            <div className="space-y-3 rounded-lg border border-indigo-200 bg-white p-4">
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
                Dành cho <strong>cộng tác viên / cựu thành viên / anh chị chuyên môn không còn Đoàn trực thuộc</strong> (VD tổ VietGENIUS, tổ 35...) không tự đăng ký được trên cổng thông tin. Tài khoản đăng nhập trực tiếp vào Web Phân công bằng mục <em>Tài khoản nội bộ</em>.
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Họ và tên *</label>
                  <input
                    type="text"
                    value={localDisplayName}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocalDisplayName(val);
                      if (!localUsername) {
                        const sug = suggestUsernameFromName(val);
                        if (sug) setLocalUsername(sug);
                      }
                    }}
                    placeholder="VD: Nguyễn Trung Việt"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Tên đăng nhập (4–40 ký tự) *</label>
                  <input
                    type="text"
                    value={localUsername}
                    onChange={(e) => setLocalUsername(e.target.value.toLowerCase())}
                    placeholder="VD: trungviet.vg"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Mật khẩu tạm (≥ 8 ký tự) *</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={localPassword}
                      onChange={(e) => setLocalPassword(e.target.value)}
                      placeholder="Nhập hoặc tạo ngẫu nhiên"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={generateRandomPassword}
                      title="Tạo mật khẩu ngẫu nhiên"
                      className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-slate-700 hover:bg-slate-100"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Email liên hệ (tuỳ chọn)</label>
                  <input
                    type="email"
                    value={localEmail}
                    onChange={(e) => setLocalEmail(e.target.value)}
                    placeholder="email@domain.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Đơn vị / Ghi chú công tác</label>
                  <input
                    type="text"
                    value={localOrg}
                    onChange={(e) => setLocalOrg(e.target.value)}
                    placeholder="VD: Cộng tác viên chuyên môn Tổ 35"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Cấp bậc</label>
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
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={localSubmitting || !localDisplayName.trim() || localUsername.trim().length < 4 || localPassword.length < 8}
                  onClick={() => void handleCreateLocalMember()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {localSubmitting ? "Đang tạo..." : "Tạo tài khoản nội bộ"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Tóm tắt tổ */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {visibleTeams.map((t) => (
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

      {/* TAB 1: DANH BẠ THÀNH VIÊN */}
      {viewTab === "directory" && (
        <>
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
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <span>@{m.username}</span>
                            {m.provider === "local" ? (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                Nội bộ
                              </span>
                            ) : (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                Cổng TNTH
                              </span>
                            )}
                          </div>
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
                            {capabilities?.canGrantAccess && m.provider === "local" && (
                              <button
                                type="button"
                                onClick={() => void handleResetLocalPassword(m)}
                                className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                              >
                                <KeyRound className="h-3 w-3" /> Đặt lại MK
                              </button>
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
        </>
      )}

      {/* TAB 2: TÌNH HÌNH CÔNG VIỆC NHÂN SỰ (WORKLOAD REAL-TIME) */}
      {viewTab === "workload" && isManager && (
        <div className="space-y-4">
          {workloadData && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="text-xs text-slate-500">Nhân sự theo dõi</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{workloadData.summary.totalMembers}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                <div className="text-xs text-emerald-700">Đang rảnh (0 việc)</div>
                <div className="mt-1 text-2xl font-bold text-emerald-800">{workloadData.summary.freeCount}</div>
              </div>
              <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5">
                <div className="text-xs text-blue-700">Tổng việc đang mở</div>
                <div className="mt-1 text-2xl font-bold text-blue-900">{workloadData.summary.totalActiveTasks}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <div className="text-xs text-amber-800">Đang bận (3–4 việc)</div>
                <div className="mt-1 text-2xl font-bold text-amber-900">{workloadData.summary.busyCount}</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5">
                <div className="text-xs text-red-700">Quá tải / Có việc quá hạn</div>
                <div className="mt-1 text-2xl font-bold text-red-800">
                  {workloadData.summary.overloadedCount}{" "}
                  <span className="text-xs font-medium">({workloadData.summary.totalOverdueTasks} quá hạn)</span>
                </div>
              </div>
            </div>
          )}

          {/* Bộ lọc tải công việc */}
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm nhân sự..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <div className="flex gap-1.5">
              {[
                { key: "ALL", label: "Tất cả" },
                { key: "FREE", label: "Đang rảnh" },
                { key: "OVERDUE", label: "Có việc quá hạn" },
              ].map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => setWorkloadFilter(btn.key as "ALL" | "FREE" | "OVERDUE")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    workloadFilter === btn.key
                      ? "bg-blue-600 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="excel-table text-xs">
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Tổ chính</th>
                    <th>Mức tải</th>
                    <th className="text-center">Chờ nhận</th>
                    <th className="text-center">Đang làm</th>
                    <th className="text-center">Chờ duyệt</th>
                    <th className="text-center">Cần sửa</th>
                    <th className="text-center">Quá hạn</th>
                    <th className="text-center">KL gánh</th>
                    <th>Hạn gần nhất</th>
                    <th className="text-center">Xong tháng này</th>
                    <th>Chi tiết việc</th>
                  </tr>
                </thead>
                <tbody>
                  {workloadLoading ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-500">Đang tổng hợp tình hình nhân sự...</td>
                    </tr>
                  ) : !workloadData || workloadData.members.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-slate-500">Không có nhân sự phù hợp bộ lọc.</td>
                    </tr>
                  ) : (
                    workloadData.members.map((m) => {
                      const isExpanded = expandedMemberId === m.memberId;
                      return (
                        <React.Fragment key={m.memberId}>
                          <tr className={isExpanded ? "bg-blue-50/30" : ""}>
                            <td>
                              <div className="flex items-center gap-1.5">
                                <Link
                                  href={`/members/${m.memberId}`}
                                  className="font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                                >
                                  {m.displayName}
                                </Link>
                                <RoleBadge role={m.role} />
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-400">
                                {m.memberCode} {m.activityStatus !== "ACTIVE" ? `· ${m.activityStatus}` : ""}
                              </div>
                            </td>
                            <td>{m.primaryTeam?.name ?? "—"}</td>
                            <td>
                              <WorkloadBadge
                                level={m.workloadLevel}
                                activeTotal={m.counts.activeTotal}
                                overdue={m.counts.overdue}
                              />
                            </td>
                            <td className="text-center font-semibold">{m.counts.pending}</td>
                            <td className="text-center font-semibold text-blue-700">{m.counts.inProgress}</td>
                            <td className="text-center">{m.counts.submitted}</td>
                            <td className={`text-center font-semibold ${m.counts.revisionRequired > 0 ? "text-amber-700" : ""}`}>
                              {m.counts.revisionRequired}
                            </td>
                            <td className={`text-center font-bold ${m.counts.overdue > 0 ? "text-red-700" : "text-slate-400"}`}>
                              {m.counts.overdue}
                            </td>
                            <td className="text-center font-medium">{m.activeWeight}</td>
                            <td className="whitespace-nowrap">
                              {m.nearestDeadline ? formatVnDateTime(m.nearestDeadline) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="text-center font-semibold text-emerald-700">{m.counts.completedThisMonth}</td>
                            <td>
                              {m.activeTasks.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedMemberId(isExpanded ? null : m.memberId)}
                                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                  {m.activeTasks.length} việc
                                </button>
                              ) : (
                                <span className="text-slate-400">Trống lịch</span>
                              )}
                            </td>
                          </tr>

                          {isExpanded && m.activeTasks.length > 0 && (
                            <tr className="bg-slate-50/70">
                              <td colSpan={12} className="p-3">
                                <div className="mb-2 text-xs font-bold text-slate-700">
                                  Các đầu việc đang mở của {m.displayName} ({m.activeTasks.length})
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {m.activeTasks.map((t) => (
                                    <Link
                                      key={t.assignmentId}
                                      href={`/missions/${t.missionId}`}
                                      className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-2.5 hover:border-blue-400"
                                    >
                                      <div>
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                          <span className="font-mono text-[11px] font-bold text-blue-700">{t.taskCode}</span>
                                          <div className="flex items-center gap-1">
                                            <UrgencyBadge urgency={t.urgency} />
                                            <StatusBadge status={t.status} kind="assignment" />
                                          </div>
                                        </div>
                                        <div className="mt-1 font-semibold text-slate-900">{t.taskTitle}</div>
                                        <div className="text-[11px] text-slate-500">Nhiệm vụ: {t.missionTitle}</div>
                                      </div>
                                      <div className="mt-2 flex items-center justify-between text-[11px]">
                                        <span className={t.isOverdue ? "font-bold text-red-700" : "text-slate-600"}>
                                          Hạn: {formatVnDateTime(t.deadline)} {t.isOverdue ? "(QUÁ HẠN)" : ""}
                                        </span>
                                        <span className="inline-flex items-center gap-0.5 font-medium text-blue-600">
                                          Mở <ExternalLink className="h-3 w-3" />
                                        </span>
                                      </div>
                                    </Link>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
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
