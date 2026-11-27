"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { RoleBadge, StatusBadge } from "@/components/badges";
import {
  AcademicAchievementsField,
  EducationTimelineField,
  SocialLinksField,
  YouthAchievementsField,
} from "@/components/profile-structured-fields";
import { ROLE_LABELS, TEAM_TITLE_LABELS, type ActivityStatus, type MemberRole, type TeamTitle } from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";
import {
  parseAchievementLines,
  parseEducationRecord,
  parseSocialRecord,
  serializeAchievementLines,
  serializeEducationEntry,
  type EducationEntry,
  type SocialEntry,
} from "@/lib/profile-formatters";

interface MemberDetailData {
  id: string;
  memberCode: string;
  provider?: string;
  externalAccountId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  accessEnabled: boolean;
  activityStatus: ActivityStatus;
  teams: { id: string; code: string; name: string; isPrimary: boolean; title: TeamTitle }[];
  profile: {
    fullName: string;
    avatarFileId: string | null;
    dob: string;
    birthplace: string;
    hometown: string;
    email: string;
    phone: string;
    socialLinks: { platform: string; handle: string }[];
    currentOrg: string;
    education: { period: string; school: string; major?: string }[];
    academicAchievements: string;
    youthAchievements: string;
    joinedOn: string;
    isUnionMember?: boolean;
    unionJoinedOn?: string;
    isPartyMember?: boolean;
    partyProbationaryOn?: string;
    partyOfficialOn?: string;
    youthUnionPosition?: string;
  } | null;
  roleHistory: { id: string; oldRole: string | null; newRole: string; reason: string; changedByName: string | null; createdAt: string }[];
  openAssignments: { id: string; taskTitle: string; missionId: string; missionCode: string; status: string; deadline: string }[];
  permissions: { canEdit: boolean; canRevoke: boolean; canChangeStatus: boolean };
}

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<MemberDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editable form state (đủ 100% trường hồ sơ + nhập liệu trực quan theo mẫu cú pháp chuẩn)
  const [fullName, setFullName] = useState("");
  const [avatarFileId, setAvatarFileId] = useState<string | null>(null);
  const [dob, setDob] = useState("");
  const [birthplace, setBirthplace] = useState("");
  const [hometown, setHometown] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [socialEntries, setSocialEntries] = useState<SocialEntry[]>([]);
  const [currentOrg, setCurrentOrg] = useState("");
  const [educationEntries, setEducationEntries] = useState<EducationEntry[]>([]);
  const [academicItems, setAcademicItems] = useState<string[]>([]);
  const [youthItems, setYouthItems] = useState<string[]>([]);
  const [joinedOn, setJoinedOn] = useState("");
  const [isUnionMember, setIsUnionMember] = useState(false);
  const [unionJoinedOn, setUnionJoinedOn] = useState("");
  const [isPartyMember, setIsPartyMember] = useState(false);
  const [partyProbationaryOn, setPartyProbationaryOn] = useState("");
  const [partyOfficialOn, setPartyOfficialOn] = useState("");
  const [youthUnionPosition, setYouthUnionPosition] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<MemberDetailData>(`/api/v1/members/${id}`);
      setData(res);
      if (res.profile) {
        setFullName(res.profile.fullName);
        setAvatarFileId(res.profile.avatarFileId);
        setDob(res.profile.dob);
        setBirthplace(res.profile.birthplace);
        setHometown(res.profile.hometown);
        setEmail(res.profile.email);
        setPhone(res.profile.phone);
        setSocialEntries((res.profile.socialLinks ?? []).map(parseSocialRecord));
        setCurrentOrg(res.profile.currentOrg);
        setEducationEntries((res.profile.education ?? []).map(parseEducationRecord));
        setAcademicItems(parseAchievementLines(res.profile.academicAchievements));
        setYouthItems(parseAchievementLines(res.profile.youthAchievements));
        setJoinedOn(res.profile.joinedOn);
        setIsUnionMember(Boolean(res.profile.isUnionMember));
        setUnionJoinedOn(res.profile.unionJoinedOn ?? "");
        setIsPartyMember(Boolean(res.profile.isPartyMember));
        setPartyProbationaryOn(res.profile.partyProbationaryOn ?? "");
        setPartyOfficialOn(res.profile.partyOfficialOn ?? "");
        setYouthUnionPosition(res.profile.youthUnionPosition ?? "");
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được hồ sơ thành viên.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("purpose", "AVATAR");
      form.append("file", file);
      const res = await apiFetch<{ files: Array<{ id: string }> }>("/api/v1/files", { method: "POST", body: form });
      if (res.files[0]) setAvatarFileId(res.files[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải ảnh đại diện thất bại.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const socialLinks = socialEntries
        .filter((s) => s.handle.trim())
        .map((s) => ({
          platform: s.platform === "Khác" ? s.customPlatform.trim() || "Khác" : s.platform,
          handle: s.handle.trim(),
        }));

      const education = educationEntries
        .filter((e) => e.fromYear.trim() || e.toYear.trim() || e.place.trim())
        .map(serializeEducationEntry);

      await apiFetch(`/api/v1/members/${id}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          fullName,
          avatarFileId,
          dob: dob || null,
          birthplace,
          hometown,
          email,
          phone,
          socialLinks,
          currentOrg,
          education,
          academicAchievements: serializeAchievementLines(academicItems),
          youthAchievements: serializeAchievementLines(youthItems),
          joinedOn: joinedOn || null,
          isUnionMember,
          unionJoinedOn: isUnionMember ? (unionJoinedOn || null) : null,
          isPartyMember,
          partyProbationaryOn: isPartyMember ? (partyProbationaryOn || null) : null,
          partyOfficialOn: isPartyMember ? (partyOfficialOn || null) : null,
          youthUnionPosition,
        }),
      });
      setNotice("Đã lưu cập nhật hồ sơ thành viên.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu hồ sơ thất bại.");
    } finally {
      setSaving(false);
    }
  };

  const changeActivity = async (activityStatus: ActivityStatus) => {
    const reason = window.prompt("Nhập lý do thay đổi tình trạng hoạt động (bắt buộc):");
    if (!reason) return;
    setError(null);
    try {
      await apiFetch(`/api/v1/members/${id}/activity`, {
        method: "POST",
        body: JSON.stringify({ activityStatus, reason }),
      });
      setNotice("Đã cập nhật tình trạng hoạt động.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật tình trạng thất bại.");
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Đang tải hồ sơ...</div>;
  if (!data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{error}</div>;

  const canEdit = data.permissions.canEdit;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/members" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-600">
            <ArrowLeft className="h-3.5 w-3.5" /> Quay lại danh bạ
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900">{data.displayName}</h1>
            <RoleBadge role={data.role} />
            <StatusBadge status={data.activityStatus} kind="activity" />
          </div>
          <p className="text-xs text-slate-500">
            {data.memberCode} · {data.provider === "local" ? "Tài khoản nội bộ" : "Tài khoản nguồn"}: @{data.username} ·{" "}
            {ROLE_LABELS[data.role].name}
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? "Đang lưu..." : "Lưu hồ sơ"}
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {/* Ảnh đại diện nội bộ + Tổ + Tình trạng */}
      <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {avatarFileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/files/${avatarFileId}/download?inline=1`}
              alt={data.displayName}
              className="h-20 w-20 rounded-xl border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-blue-100 text-2xl font-bold text-blue-700">
              {data.displayName.split(" ").slice(-1)[0]?.[0] ?? "U"}
            </div>
          )}
          <div className="space-y-1 text-xs">
            <div className="font-semibold text-slate-900">Ảnh cá nhân rõ mặt (lưu kho nội bộ private)</div>
            <div className="text-slate-500">Không bắt buộc phông nền chuẩn. Hỗ trợ PNG/JPG/WebP ≤ 5MB.</div>
            {canEdit && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" /> Đổi ảnh cá nhân
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleAvatarUpload(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="font-semibold text-slate-700">Tổ chuyên môn:</div>
          {data.teams.map((t) => (
            <div key={t.id} className="text-slate-800">
              {t.isPrimary ? "★ Tổ chính: " : "· Tổ phụ: "}
              <strong>{t.name}</strong> ({TEAM_TITLE_LABELS[t.title]})
            </div>
          ))}
          {data.permissions.canChangeStatus && (
            <div className="flex flex-wrap gap-1 pt-2">
              {(["ACTIVE", "ON_LEAVE", "INACTIVE"] as ActivityStatus[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={data.activityStatus === st}
                  onClick={() => void changeActivity(st)}
                  className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-medium hover:bg-slate-100 disabled:opacity-40"
                >
                  Đặt {st === "ACTIVE" ? "Hoạt động" : st === "ON_LEAVE" ? "Tạm nghỉ" : "Đã dừng"}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Thông tin cá nhân cơ bản */}
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <h2 className="text-sm font-bold text-slate-900">Thông tin cá nhân &amp; liên hệ</h2>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Họ và tên *</label>
          <input disabled={!canEdit} value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Ngày tháng năm sinh</label>
          <input disabled={!canEdit} type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Nơi sinh</label>
          <input disabled={!canEdit} value={birthplace} onChange={(e) => setBirthplace(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Quê quán</label>
          <input disabled={!canEdit} value={hometown} onChange={(e) => setHometown(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Email liên hệ</label>
          <input disabled={!canEdit} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Số điện thoại</label>
          <input disabled={!canEdit} value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Đơn vị học tập / công tác hiện tại</label>
          <input disabled={!canEdit} value={currentOrg} onChange={(e) => setCurrentOrg(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">Ngày bắt đầu công tác tại Ban</label>
          <input disabled={!canEdit} type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>

        {/* Thông tin Đoàn viên, Đảng viên & Chức vụ Đoàn - Hội - Đội */}
        <div className="border-t border-slate-100 pt-4 sm:col-span-2 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-blue-800">Thông tin Đoàn – Đảng &amp; Chức vụ Đoàn – Hội – Đội</h3>
          </div>
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800">
              <input
                disabled={!canEdit}
                type="checkbox"
                checked={isUnionMember}
                onChange={(e) => setIsUnionMember(e.target.checked)}
              />
              Là Đoàn viên TNCS Hồ Chí Minh
            </label>
            {isUnionMember && (
              <div>
                <label className="mb-1 block text-xs text-slate-600">Ngày vào Đoàn</label>
                <input
                  disabled={!canEdit}
                  type="date"
                  value={unionJoinedOn}
                  onChange={(e) => setUnionJoinedOn(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                />
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800">
              <input
                disabled={!canEdit}
                type="checkbox"
                checked={isPartyMember}
                onChange={(e) => setIsPartyMember(e.target.checked)}
              />
              Là Đảng viên Đảng Cộng sản Việt Nam
            </label>
            {isPartyMember && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-slate-600">Ngày vào Đảng (dự bị)</label>
                  <input
                    disabled={!canEdit}
                    type="date"
                    value={partyProbationaryOn}
                    onChange={(e) => setPartyProbationaryOn(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600">Ngày vào Đảng (chính thức)</label>
                  <input
                    disabled={!canEdit}
                    type="date"
                    value={partyOfficialOn}
                    onChange={(e) => setPartyOfficialOn(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-50"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700">Chức vụ Đoàn – Hội – Đội hiện nay</label>
            <input
              disabled={!canEdit}
              value={youthUnionPosition}
              onChange={(e) => setYouthUnionPosition(e.target.value)}
              placeholder="VD: Ủy viên Ban Chấp hành Đoàn trường, Chủ tịch Hội Sinh viên trường..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 sm:col-span-2">
          <SocialLinksField items={socialEntries} onChange={setSocialEntries} disabled={!canEdit} />
        </div>
      </section>

      {/* Quá trình học tập, công tác (dạng từng giai đoạn) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <EducationTimelineField items={educationEntries} onChange={setEducationEntries} disabled={!canEdit} />
      </section>

      {/* Thành tích học tập / NCKH & Thành tích công tác Đoàn (theo mẫu cú pháp chuẩn) */}
      <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5">
        <AcademicAchievementsField items={academicItems} onChange={setAcademicItems} disabled={!canEdit} />
        <div className="border-t border-slate-100 pt-5">
          <YouthAchievementsField items={youthItems} onChange={setYouthItems} disabled={!canEdit} />
        </div>
        {canEdit && (
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? "Đang lưu..." : "Lưu toàn bộ hồ sơ"}
            </button>
          </div>
        )}
      </section>

      {/* Việc đang mở & lịch sử chức vụ */}
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">Phân công đang mở ({data.openAssignments.length})</h2>
          <div className="mt-2 space-y-2 text-xs">
            {data.openAssignments.length === 0 ? (
              <p className="text-slate-400">Không có phân công nào đang mở.</p>
            ) : (
              data.openAssignments.map((a) => (
                <Link key={a.id} href={`/missions/${a.missionId}`} className="block rounded border border-slate-100 p-2 hover:bg-slate-50">
                  <div className="font-semibold text-blue-700">{a.missionCode} — {a.taskTitle}</div>
                  <div className="text-slate-500">Hạn: {formatVnDateTime(a.deadline)}</div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">Lịch sử thay đổi chức vụ</h2>
          <div className="mt-2 space-y-2 text-xs">
            {data.roleHistory.length === 0 ? (
              <p className="text-slate-400">Chưa có lịch sử thay đổi.</p>
            ) : (
              data.roleHistory.map((h) => (
                <div key={h.id} className="border-b border-slate-100 pb-1.5">
                  <span className="font-semibold">{h.oldRole ?? "Mới"} → {h.newRole}</span>
                  <div className="text-slate-500">{h.reason} · {formatVnDateTime(h.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
