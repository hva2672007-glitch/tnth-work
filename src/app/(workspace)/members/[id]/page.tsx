"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { RoleBadge, StatusBadge } from "@/components/badges";
import { ROLE_LABELS, TEAM_TITLE_LABELS, type ActivityStatus, type MemberRole, type TeamTitle } from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface MemberDetailData {
  id: string;
  memberCode: string;
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

  // Editable form state (đủ 100% trường hồ sơ trong Word gốc)
  const [fullName, setFullName] = useState("");
  const [avatarFileId, setAvatarFileId] = useState<string | null>(null);
  const [dob, setDob] = useState("");
  const [birthplace, setBirthplace] = useState("");
  const [hometown, setHometown] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [socialText, setSocialText] = useState("");
  const [currentOrg, setCurrentOrg] = useState("");
  const [educationText, setEducationText] = useState("");
  const [academicAchievements, setAcademicAchievements] = useState("Chưa có");
  const [youthAchievements, setYouthAchievements] = useState("Chưa có");
  const [joinedOn, setJoinedOn] = useState("");

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
        setSocialText(res.profile.socialLinks.map((s) => `${s.platform}: ${s.handle}`).join("\n"));
        setCurrentOrg(res.profile.currentOrg);
        setEducationText(
          res.profile.education.map((e) => `${e.period} | ${e.school}${e.major ? ` | ${e.major}` : ""}`).join("\n"),
        );
        setAcademicAchievements(res.profile.academicAchievements || "Chưa có");
        setYouthAchievements(res.profile.youthAchievements || "Chưa có");
        setJoinedOn(res.profile.joinedOn);
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
      const socialLinks = socialText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [platform, ...rest] = line.split(":");
          return { platform: (platform || "MXH").trim(), handle: rest.join(":").trim() || platform.trim() };
        });

      const education = educationText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [period, school, major] = line.split("|").map((s) => s.trim());
          return { period: period || "", school: school || period || "", major: major || "" };
        });

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
          academicAchievements,
          youthAchievements,
          joinedOn: joinedOn || null,
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
            {data.memberCode} · Tài khoản nguồn: @{data.username} (ID #{data.externalAccountId}) · {ROLE_LABELS[data.role].name}
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

      {/* Form đầy đủ trường gốc trong Word */}
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
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
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Mạng xã hội (mỗi dòng định dạng Nền tảng: Link/Tài khoản)</label>
          <textarea disabled={!canEdit} rows={2} value={socialText} onChange={(e) => setSocialText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Quá trình học tập (mỗi dòng: Giai đoạn | Trường | Ngành)</label>
          <textarea disabled={!canEdit} rows={2} value={educationText} onChange={(e) => setEducationText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Thành tích học tập / nghiên cứu khoa học</label>
          <textarea disabled={!canEdit} rows={2} value={academicAchievements} onChange={(e) => setAcademicAchievements(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-700">Thành tích công tác Đoàn và phong trào thanh thiếu nhi</label>
          <textarea disabled={!canEdit} rows={2} value={youthAchievements} onChange={(e) => setYouthAchievements(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50" />
        </div>
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
