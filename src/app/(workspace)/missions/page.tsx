"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet, Plus, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { ConfidentialityBadge, ImportanceBadge, StatusBadge, UrgencyBadge } from "@/components/badges";
import { formatVnDateTime } from "@/lib/date";
import type { ConfidentialityLevel, ImportanceLevel, MissionStatus, UrgencyLevel } from "@/lib/constants";

interface MissionRow {
  id: string;
  code: string;
  groupId: string;
  groupName: string;
  title: string;
  status: MissionStatus;
  importance: ImportanceLevel;
  urgency: UrgencyLevel;
  confidentiality?: ConfidentialityLevel;
  directiveAuthorities?: string[];
  deadlineOriginal: string;
  deadlineCurrent: string;
  isOverdue: boolean;
  ownerName: string;
  teamNames: string;
  progress: { completed: number; total: number };
}

interface OptionItem {
  id: string;
  name: string;
}

function MissionsContent() {
  const { actor, capabilities } = useAuth();
  const isObserver = actor?.role === "OBSERVER";
  const searchParams = useSearchParams();

  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [groups, setGroups] = useState<OptionItem[]>([]);
  const [teams, setTeams] = useState<OptionItem[]>([]);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [urgency, setUrgency] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(searchParams.get("overdueOnly") === "true");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("q", search.trim());
      if (groupId) qs.set("groupId", groupId);
      if (teamId) qs.set("teamId", teamId);
      if (status) qs.set("status", status);
      if (urgency) qs.set("urgency", urgency);
      if (overdueOnly) qs.set("overdueOnly", "true");
      const data = await apiFetch<MissionRow[]>(`/api/v1/missions?${qs.toString()}`);
      setMissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được danh sách nhiệm vụ.");
    } finally {
      setLoading(false);
    }
  }, [search, groupId, teamId, status, urgency, overdueOnly]);

  useEffect(() => {
    Promise.all([
      apiFetch<OptionItem[]>("/api/v1/groups").then(setGroups),
      apiFetch<OptionItem[]>("/api/v1/teams").then(setTeams),
    ]).catch(() => {});
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

  // Nhóm liên tiếp theo Khối nhiệm vụ (mục 2.2)
  const grouped = useMemo(() => {
    const map = new Map<string, { groupName: string; items: MissionRow[] }>();
    for (const m of missions) {
      const cur = map.get(m.groupId) ?? { groupName: m.groupName, items: [] };
      cur.items.push(m);
      map.set(m.groupId, cur);
    }
    return [...map.entries()];
  }, [missions]);

  const exportQs = new URLSearchParams({ allTime: "true" });
  if (groupId) exportQs.set("groupId", groupId);
  if (teamId) exportQs.set("teamId", teamId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isObserver ? "Kết quả nhiệm vụ đã hoàn thành" : "Bảng nhiệm vụ theo khối"}
          </h1>
          <p className="text-sm text-slate-500">
            {isObserver
              ? "Tài khoản Ngoại lệ (Bậc 06) — Chỉ hiển thị sản phẩm đã hoàn thành và phê duyệt cuối cùng của Ban Biên tập"
              : "Nhóm liên tiếp theo khối nhiệm vụ · Ưu tiên việc chưa hoàn thành và sắp đến hạn"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isObserver && (
            <a
              href={`/api/v1/reports/export?${exportQs.toString()}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Xuất Excel
            </a>
          )}
          {capabilities?.canCreateMission && (
            <Link
              href="/missions/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              Tạo &amp; giao nhiệm vụ
            </Link>
          )}
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="grid gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo mã hoặc tên nhiệm vụ..."
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Tất cả khối nhiệm vụ</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Tất cả tổ</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="ASSIGNED">Đã giao, chưa thực hiện</option>
          <option value="IN_PROGRESS">Đang thực hiện</option>
          <option value="AWAITING_REVIEW">Chờ nghiệm thu</option>
          <option value="AWAITING_PUBLICATION">Chờ đăng tải</option>
          <option value="COMPLETED">Đã hoàn thành</option>
          <option value="ON_HOLD">Tạm hoãn</option>
          <option value="CANCELLED">Đã hủy</option>
        </select>
        <div className="flex items-center gap-2">
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
          >
            <option value="">Độ khẩn</option>
            <option value="FLASH">Hỏa tốc</option>
            <option value="VERY_URGENT">Thượng khẩn</option>
            <option value="URGENT">Khẩn</option>
            <option value="NORMAL">Thông thường</option>
          </select>
          <label className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-red-700">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Trễ hạn
          </label>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      {/* Bảng dạng Excel */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="excel-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên nhiệm vụ</th>
                <th>Tổ phụ trách</th>
                <th>Chủ trì</th>
                <th>Deadline (giờ VN)</th>
                <th>Độ khẩn / Nội dung</th>
                <th>Tiến độ task</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Đang tải danh sách nhiệm vụ...
                  </td>
                </tr>
              ) : grouped.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    Chưa có nhiệm vụ nào phù hợp bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                grouped.map(([gId, grp]) => (
                  <GroupRows key={gId} groupName={grp.groupName} items={grp.items} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupRows({ groupName, items }: { groupName: string; items: MissionRow[] }) {
  return (
    <>
      <tr className="bg-blue-50/70">
        <td colSpan={9} className="font-bold text-blue-950">
          Khối: {groupName} ({items.length} nhiệm vụ)
        </td>
      </tr>
      {items.map((m) => (
        <tr key={m.id}>
          <td className="whitespace-nowrap font-mono text-xs font-semibold text-blue-700">
            <Link href={`/missions/${m.id}`} className="hover:underline">
              {m.code}
            </Link>
          </td>
          <td className="min-w-[220px] font-medium text-slate-900">
            <Link href={`/missions/${m.id}`} className="hover:text-blue-700 hover:underline">
              {m.title}
            </Link>
          </td>
          <td className="text-xs text-slate-600">{m.teamNames || "—"}</td>
          <td className="whitespace-nowrap text-xs text-slate-700">{m.ownerName}</td>
          <td className={`whitespace-nowrap text-xs font-medium ${m.isOverdue ? "text-red-700" : "text-slate-700"}`}>
            {formatVnDateTime(m.deadlineCurrent)}
            {m.isOverdue && <div className="text-[11px] font-bold text-red-600">QUÁ HẠN</div>}
          </td>
          <td>
            <div className="flex flex-wrap gap-1">
              <UrgencyBadge urgency={m.urgency} />
              <ImportanceBadge importance={m.importance} />
              <ConfidentialityBadge level={m.confidentiality} />
            </div>
          </td>
          <td className="whitespace-nowrap text-xs font-semibold text-slate-800">
            {m.progress.total > 0 ? `${m.progress.completed}/${m.progress.total} task` : "Chưa có task"}
          </td>
          <td>
            <StatusBadge status={m.status} kind="mission" />
          </td>
          <td className="whitespace-nowrap">
            <Link
              href={`/missions/${m.id}`}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              Chi tiết
            </Link>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function MissionsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Đang tải...</div>}>
      <MissionsContent />
    </Suspense>
  );
}
