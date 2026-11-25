"use client";

import { useState } from "react";
import { Award, Flag, Globe, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  formatAcademicAchievement,
  formatEducationPreview,
  formatYouthAchievement,
  SOCIAL_PLATFORMS,
  type AcademicAchievementDraft,
  type AcademicTemplateKind,
  type EducationEntry,
  type SocialEntry,
  type YouthAchievementDraft,
  type YouthTemplateKind,
} from "@/lib/profile-formatters";

/* -------------------------------------------------------------------------- */
/* 1. Quá trình học tập, công tác (từng giai đoạn + nút + Thêm giai đoạn)     */
/* -------------------------------------------------------------------------- */
export function EducationTimelineField({
  items,
  onChange,
  disabled,
}: {
  items: EducationEntry[];
  onChange: (next: EducationEntry[]) => void;
  disabled: boolean;
}) {
  const updateAt = (idx: number, patch: Partial<EducationEntry>) => {
    onChange(items.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, { fromYear: "", toYear: "", place: "", detail: "" }]);
  };

  const removeAt = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Quá trình học tập, công tác
          </label>
          <p className="text-[11px] text-slate-500">
            Tự động định dạng chuẩn theo mẫu: <em>Từ [năm] đến [năm]: [Nơi học tập, công tác]</em>
          </p>
        </div>
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
          Chưa khai báo giai đoạn nào.{!disabled && " Bấm nút bên dưới để thêm giai đoạn học tập, công tác."}
        </div>
      )}

      <div className="space-y-2.5">
        {items.map((item, idx) => {
          const preview = formatEducationPreview(item);
          return (
            <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-800">
                  <Flag className="h-3.5 w-3.5" /> Giai đoạn {idx + 1}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAt(idx)}
                    title="Xóa giai đoạn này"
                    className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid gap-2.5 sm:grid-cols-12">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Từ năm</label>
                  <input
                    disabled={disabled}
                    type="text"
                    value={item.fromYear}
                    onChange={(e) => updateAt(idx, { fromYear: e.target.value })}
                    placeholder="2021"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Đến năm</label>
                  <input
                    disabled={disabled}
                    type="text"
                    value={item.toYear}
                    onChange={(e) => updateAt(idx, { toYear: e.target.value })}
                    placeholder="2025 / nay"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Nơi học tập, công tác</label>
                  <input
                    disabled={disabled}
                    type="text"
                    value={item.place}
                    onChange={(e) => updateAt(idx, { place: e.target.value })}
                    placeholder="VD: ĐH Ngoại thương / Trung ương Đoàn"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Ngành / Chức vụ (tuỳ chọn)</label>
                  <input
                    disabled={disabled}
                    type="text"
                    value={item.detail}
                    onChange={(e) => updateAt(idx, { detail: e.target.value })}
                    placeholder="VD: Truyền thông / CTV"
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100"
                  />
                </div>
              </div>

              {preview && (
                <div className="mt-2 rounded-md bg-white px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200/80">
                  <span className="text-slate-400">Hiển thị: </span>
                  <strong className="font-medium text-slate-900">{preview}</strong>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={addItem}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-4 py-2.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          <Plus className="h-4 w-4" /> Thêm giai đoạn
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Mạng xã hội (dropdown chọn nền tảng + ô điền link/tài khoản)            */
/* -------------------------------------------------------------------------- */
const SOCIAL_PLACEHOLDERS: Record<string, string> = {
  Facebook: "https://facebook.com/ten.ban",
  Instagram: "https://instagram.com/username hoặc @username",
  Locket: "Username Locket hoặc link kết bạn Locket",
  Threads: "https://threads.net/@username",
  TikTok: "https://tiktok.com/@username",
  Zalo: "Số điện thoại Zalo hoặc https://zalo.me/...",
  Khác: "Đường dẫn hoặc tên tài khoản...",
};

export function SocialLinksField({
  items,
  onChange,
  disabled,
}: {
  items: SocialEntry[];
  onChange: (next: SocialEntry[]) => void;
  disabled: boolean;
}) {
  const updateAt = (idx: number, patch: Partial<SocialEntry>) => {
    onChange(items.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, { platform: "Facebook", customPlatform: "", handle: "" }]);
  };

  const removeAt = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2.5">
      <div>
        <label className="block text-xs font-semibold text-slate-700">Mạng xã hội</label>
        <p className="text-[11px] text-slate-500">
          Chọn nền tảng thông dụng (Facebook, Instagram, Locket, Threads, TikTok, Zalo...) và điền link hoặc tài khoản của bạn.
        </p>
      </div>

      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
          Chưa khai báo mạng xã hội.
        </div>
      )}

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <select
                disabled={disabled}
                value={item.platform}
                onChange={(e) => updateAt(idx, { platform: e.target.value })}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:bg-slate-100"
              >
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {item.platform === "Khác" && (
              <input
                disabled={disabled}
                type="text"
                value={item.customPlatform}
                onChange={(e) => updateAt(idx, { customPlatform: e.target.value })}
                placeholder="Tên nền tảng..."
                className="w-36 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs disabled:bg-slate-100"
              />
            )}

            <input
              disabled={disabled}
              type="text"
              value={item.handle}
              onChange={(e) => updateAt(idx, { handle: e.target.value })}
              placeholder={SOCIAL_PLACEHOLDERS[item.platform] ?? SOCIAL_PLACEHOLDERS.Khác}
              className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:bg-slate-100"
            />

            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(idx)}
                title="Xóa dòng này"
                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={addItem}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-4 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
        >
          <Plus className="h-4 w-4" /> Thêm mạng xã hội
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Thành tích công tác Đoàn và phong trào thanh thiếu nhi (theo cú pháp)   */
/* -------------------------------------------------------------------------- */
const INITIAL_YOUTH_DRAFT: YouthAchievementDraft = {
  kind: "COMMENDATION",
  awardType: "Giấy khen",
  content: "công tác Đoàn và phong trào thanh niên trường học",
  schoolYear: "2025 - 2026",
  level: "Trường",
  docType: "Quyết định",
  docNumber: "",
  issuer: "",
  issueDate: "",
};

export function YouthAchievementsField({
  items,
  onChange,
  disabled,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [draft, setDraft] = useState<YouthAchievementDraft>(INITIAL_YOUTH_DRAFT);
  const preview = formatYouthAchievement(draft);

  const addFormatted = () => {
    if (!preview) return;
    onChange([...items, preview]);
    setDraft(INITIAL_YOUTH_DRAFT);
    setShowBuilder(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Thành tích công tác Đoàn và phong trào thanh thiếu nhi
          </label>
          <p className="text-[11px] text-slate-500">
            Điền theo mẫu cú pháp sẵn để văn bản đồng nhất, đều đẹp (nếu chưa có để trống sẽ tự lưu &quot;Chưa có&quot;).
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {showBuilder ? "Đóng mẫu điền" : "+ Thêm thành tích theo mẫu"}
          </button>
        )}
      </div>

      {/* Danh sách thành tích đã lưu */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          Chưa có
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((text, idx) => (
            <div key={idx} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs">
              <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-700">
                {idx + 1}
              </span>
              {disabled ? (
                <p className="flex-1 py-0.5 text-slate-800">{text}</p>
              ) : (
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => onChange(items.map((x, i) => (i === idx ? e.target.value : x)))}
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Khung điền cú pháp mẫu (giống ảnh mẫu trái) */}
      {showBuilder && !disabled && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-bold text-blue-950">
              <Award className="h-4 w-4 text-blue-600" />
              Mẫu cú pháp Thành tích công tác Đoàn
            </span>
            <div className="inline-flex rounded-lg border border-blue-200 bg-white p-0.5">
              {[
                { key: "COMMENDATION", label: "Khen thưởng (Giấy khen / Bằng khen)" },
                { key: "TITLE", label: "Danh hiệu (HS3T / SV5T...)" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      kind: opt.key as YouthTemplateKind,
                      content:
                        opt.key === "TITLE"
                          ? "Học sinh 3 tốt"
                          : "công tác Đoàn và phong trào thanh niên trường học",
                    }))
                  }
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                    draft.kind === opt.key ? "bg-blue-600 text-white" : "text-slate-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Ví dụ: <em>Được tặng Giấy khen có thành tích xuất sắc trong công tác Đoàn và phong trào thanh niên trường học năm học 2025 - 2026 cấp Phường (Quyết định số 31-QĐ/ĐTN do Ban Chấp hành Đoàn phường Bắc Cam Ranh cấp ngày 31/05/2026)</em>
          </p>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 leading-relaxed">
            {draft.kind === "COMMENDATION" ? (
              <>
                <span className="font-medium text-slate-700">Được tặng</span>
                <select
                  value={draft.awardType}
                  onChange={(e) => setDraft({ ...draft, awardType: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium"
                >
                  <option value="Giấy khen">Giấy khen</option>
                  <option value="Bằng khen">Bằng khen</option>
                  <option value="Kỷ niệm chương">Kỷ niệm chương</option>
                  <option value="Giấy chứng nhận">Giấy chứng nhận</option>
                </select>
                <span className="text-slate-700">có thành tích xuất sắc trong</span>
                <input
                  type="text"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  placeholder="công tác Đoàn và phong trào thanh niên trường học"
                  className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                />
              </>
            ) : (
              <>
                <span className="font-medium text-slate-700">Đạt danh hiệu</span>
                <input
                  type="text"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  placeholder="VD: Học sinh 3 tốt / Sinh viên 5 tốt / Thanh niên tiên tiến làm theo lời Bác"
                  className="min-w-[260px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                />
              </>
            )}

            <span className="text-slate-700">năm học</span>
            <input
              type="text"
              value={draft.schoolYear}
              onChange={(e) => setDraft({ ...draft, schoolYear: e.target.value })}
              placeholder="2025 - 2026"
              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-slate-700">cấp</span>
            <select
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="Trường">Trường</option>
              <option value="Xã, Phường">Xã, Phường</option>
              <option value="Quận, Huyện">Quận, Huyện</option>
              <option value="Tỉnh, Thành phố">Tỉnh, Thành phố</option>
              <option value="Trung ương">Trung ương</option>
            </select>

            <span className="text-slate-500">(</span>
            <select
              value={draft.docType}
              onChange={(e) => setDraft({ ...draft, docType: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="Quyết định">Quyết định</option>
              <option value="Giấy chứng nhận">Giấy chứng nhận</option>
            </select>
            <span className="text-slate-700">số</span>
            <input
              type="text"
              value={draft.docNumber}
              onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
              placeholder="VD: 66-QĐ/ĐTN"
              className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-slate-700">do</span>
            <input
              type="text"
              value={draft.issuer}
              onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
              placeholder="VD: BTV Đoàn phường / BCH Trung ương Đoàn"
              className="min-w-[200px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
            />
            <span className="text-slate-700">cấp ngày</span>
            <input
              type="date"
              value={draft.issueDate}
              onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-slate-500">)</span>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
            <span className="font-semibold">Câu chuẩn tạo ra: </span>
            {preview || <span className="text-slate-400">Vui lòng điền thông tin phía trên...</span>}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!preview}
              onClick={addFormatted}
              className="rounded-lg bg-blue-600 px-3.5 py-1.5 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Thêm vào hồ sơ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Thành tích học tập / nghiên cứu khoa học (5 nhóm cú pháp chuẩn)         */
/* -------------------------------------------------------------------------- */
const ACADEMIC_TEMPLATE_OPTIONS: Array<{ key: AcademicTemplateKind; label: string; example: string }> = [
  {
    key: "COMPETITION",
    label: "Giải thưởng cuộc thi học thuật",
    example:
      'Đạt giải Ba (Cá nhân) lĩnh vực Kỹ thuật, công nghệ tại cuộc thi "Khoa học kỹ thuật dành cho học sinh trung học" cấp Tỉnh, Thành phố năm học 2025 - 2026 (Quyết định số 1715/QĐ-SGDĐT do Sở Giáo dục và Đào tạo cấp ngày 12/12/2025)',
  },
  {
    key: "JOURNAL",
    label: "Bài đăng tạp chí chuyên ngành",
    example:
      'Bài đăng tạp chí chuyên ngành: "Ứng dụng AI trong truyền thông học đường", Vai trò: Tác giả chính, đăng trên Tạp chí Giáo dục (Số 12, ISSN 2354-0753), năm 2026',
  },
  {
    key: "CONFERENCE",
    label: "Bài đăng Kỷ yếu Hội nghị, Hội thảo",
    example:
      'Bài đăng Kỷ yếu Hội nghị, Hội thảo: "Chuyển đổi số trong công tác Đoàn trường học", Vai trò: Tác giả chính, tại Hội thảo Khoa học Sinh viên toàn quốc, cấp Quốc gia, do Học viện Báo chí và Tuyên truyền tổ chức, ngày 20/05/2026 (ISBN 978-604-...)',
  },
  {
    key: "BOOK",
    label: "Sách (Chuyên khảo / Tham khảo / Giáo trình)",
    example:
      'Sách: "Cẩm nang Kỹ năng truyền thông Thanh niên Trường học", Vai trò: Đồng tác giả, Nhà xuất bản Thanh niên, năm xuất bản 2026 (ISBN: 978-604-...)',
  },
  {
    key: "RESEARCH_PROJECT",
    label: "Công trình nghiên cứu khoa học",
    example:
      'Công trình nghiên cứu khoa học: "Hệ thống cảnh báo sạt lở đất IoT", Vai trò: Chủ nhiệm đề tài, kết quả: Giải Nhì, cấp Trường, năm học 2025 - 2026 (Giấy chứng nhận số 156/QĐ-ĐH do Trường ĐH cấp ngày 11/02/2026)',
  },
];

const INITIAL_ACADEMIC_DRAFT: AcademicAchievementDraft = {
  kind: "COMPETITION",
  prize: "Nhì",
  scope: "Cá nhân",
  field: "",
  title: "",
  level: "Tỉnh, Thành phố",
  schoolYear: "2025 - 2026",
  authorRole: "Tác giả chính",
  venue: "",
  issueOrCode: "",
  yearOrDate: "2026",
  docType: "Giấy chứng nhận",
  docNumber: "",
  issuer: "",
  issueDate: "",
};

export function AcademicAchievementsField({
  items,
  onChange,
  disabled,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [draft, setDraft] = useState<AcademicAchievementDraft>(INITIAL_ACADEMIC_DRAFT);
  const preview = formatAcademicAchievement(draft);
  const activeMeta = ACADEMIC_TEMPLATE_OPTIONS.find((o) => o.key === draft.kind) ?? ACADEMIC_TEMPLATE_OPTIONS[0];

  const addFormatted = () => {
    if (!preview) return;
    onChange([...items, preview]);
    setDraft({ ...INITIAL_ACADEMIC_DRAFT, kind: draft.kind });
    setShowBuilder(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Thành tích học tập / nghiên cứu khoa học
          </label>
          <p className="text-[11px] text-slate-500">
            Hỗ trợ sẵn 5 mẫu cú pháp chuẩn: Giải cuộc thi, Tạp chí chuyên ngành, Kỷ yếu Hội nghị/Hội thảo, Sách và Công trình NCKH.
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowBuilder((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {showBuilder ? "Đóng mẫu điền" : "+ Thêm thành tích theo mẫu"}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          Chưa có
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((text, idx) => (
            <div key={idx} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs">
              <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-bold text-indigo-700">
                {idx + 1}
              </span>
              {disabled ? (
                <p className="flex-1 py-0.5 text-slate-800">{text}</p>
              ) : (
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => onChange(items.map((x, i) => (i === idx ? e.target.value : x)))}
                  className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, i) => i !== idx))}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showBuilder && !disabled && (
        <div className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-bold text-indigo-950">
              <Award className="h-4 w-4 text-indigo-600" />
              Chọn loại thành tích học tập / nghiên cứu khoa học
            </span>
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...INITIAL_ACADEMIC_DRAFT,
                  kind: e.target.value as AcademicTemplateKind,
                  authorRole:
                    e.target.value === "RESEARCH_PROJECT"
                      ? "Chủ nhiệm đề tài"
                      : e.target.value === "BOOK"
                        ? "Đồng tác giả"
                        : "Tác giả chính",
                  prize: e.target.value === "RESEARCH_PROJECT" ? "Giải Khuyến khích" : "Nhì",
                })
              }
              className="rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-950"
            >
              {ACADEMIC_TEMPLATE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <p className="text-[11px] text-slate-500">
            Ví dụ: <em>{activeMeta.example}</em>
          </p>

          {/* 1. Giải thưởng cuộc thi học thuật */}
          {draft.kind === "COMPETITION" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <span className="font-medium text-slate-700">Đạt giải</span>
              <select
                value={draft.prize}
                onChange={(e) => setDraft({ ...draft, prize: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="Đặc biệt">Đặc biệt</option>
                <option value="Nhất">Nhất</option>
                <option value="Nhì">Nhì</option>
                <option value="Ba">Ba</option>
                <option value="Khuyến khích">Khuyến khích</option>
              </select>
              <select
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="Cá nhân">Cá nhân</option>
                <option value="Tập thể">Tập thể</option>
              </select>
              <span className="text-slate-700">lĩnh vực</span>
              <input
                type="text"
                value={draft.field}
                onChange={(e) => setDraft({ ...draft, field: e.target.value })}
                placeholder="VD: Ý tưởng khởi nghiệp / Kỹ thuật, công nghệ"
                className="min-w-[180px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
              />
              <span className="text-slate-700">tại cuộc thi *</span>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="VD: Học sinh, sinh viên với ý tưởng khởi nghiệp"
                className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
              />
              <span className="text-slate-700">cấp</span>
              <select
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="Trường">Trường</option>
                <option value="Quận, Huyện">Quận, Huyện</option>
                <option value="Tỉnh, Thành phố">Tỉnh, Thành phố</option>
                <option value="Quốc gia">Quốc gia</option>
                <option value="Quốc tế">Quốc tế</option>
              </select>
              <span className="text-slate-700">năm học</span>
              <input
                type="text"
                value={draft.schoolYear}
                onChange={(e) => setDraft({ ...draft, schoolYear: e.target.value })}
                placeholder="2025 - 2026"
                className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-500">(</span>
              <select
                value={draft.docType}
                onChange={(e) => setDraft({ ...draft, docType: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="Giấy chứng nhận">Giấy chứng nhận</option>
                <option value="Quyết định">Quyết định</option>
              </select>
              <span className="text-slate-700">số</span>
              <input
                type="text"
                value={draft.docNumber}
                onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
                placeholder="VD: 156/QĐ-SGDĐT"
                className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-700">do</span>
              <input
                type="text"
                value={draft.issuer}
                onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
                placeholder="Đơn vị cấp"
                className="min-w-[160px] flex-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs"
              />
              <span className="text-slate-700">cấp ngày</span>
              <input
                type="date"
                value={draft.issueDate}
                onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-500">)</span>
            </div>
          )}

          {/* 2. Bài đăng tạp chí chuyên ngành */}
          {draft.kind === "JOURNAL" && (
            <div className="grid gap-2.5 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên bài báo khoa học *</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Nhập đầy đủ tên bài báo..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên tạp chí chuyên ngành</label>
                <input
                  type="text"
                  value={draft.venue}
                  onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
                  placeholder="VD: Tạp chí Giáo dục / Tạp chí Lý luận Chính trị..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Vai trò tác giả</label>
                <select
                  value={draft.authorRole}
                  onChange={(e) => setDraft({ ...draft, authorRole: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="Tác giả chính">Tác giả chính</option>
                  <option value="Đồng tác giả">Đồng tác giả</option>
                  <option value="Tác giả liên hệ">Tác giả liên hệ</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Số / Tập / ISSN / DOI</label>
                <input
                  type="text"
                  value={draft.issueOrCode}
                  onChange={(e) => setDraft({ ...draft, issueOrCode: e.target.value })}
                  placeholder="VD: Số 12, Tập 24, ISSN 2354-0753"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Năm xuất bản</label>
                <input
                  type="text"
                  value={draft.yearOrDate}
                  onChange={(e) => setDraft({ ...draft, yearOrDate: e.target.value })}
                  placeholder="2026"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>
          )}

          {/* 3. Bài đăng Kỷ yếu Hội nghị, Hội thảo */}
          {draft.kind === "CONFERENCE" && (
            <div className="grid gap-2.5 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên bài tham luận / bài viết *</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Nhập tên bài đăng Kỷ yếu..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên Hội nghị, Hội thảo</label>
                <input
                  type="text"
                  value={draft.venue}
                  onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
                  placeholder="VD: Hội thảo Khoa học Sinh viên toàn quốc..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Vai trò &amp; Cấp Hội thảo</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={draft.authorRole}
                    onChange={(e) => setDraft({ ...draft, authorRole: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="Tác giả chính">Tác giả chính</option>
                    <option value="Đồng tác giả">Đồng tác giả</option>
                  </select>
                  <select
                    value={draft.level}
                    onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="Trường">Cấp Trường</option>
                    <option value="Tỉnh, Thành phố">Cấp Tỉnh/TP</option>
                    <option value="Quốc gia">Cấp Quốc gia</option>
                    <option value="Quốc tế">Cấp Quốc tế</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Đơn vị tổ chức</label>
                <input
                  type="text"
                  value={draft.issuer}
                  onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
                  placeholder="VD: Học viện Báo chí và Tuyên truyền"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Ngày tổ chức</label>
                  <input
                    type="date"
                    value={draft.issueDate}
                    onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Mã ISBN (nếu có)</label>
                  <input
                    type="text"
                    value={draft.issueOrCode}
                    onChange={(e) => setDraft({ ...draft, issueOrCode: e.target.value })}
                    placeholder="ISBN 978-..."
                    className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 4. Sách */}
          {draft.kind === "BOOK" && (
            <div className="grid gap-2.5 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên sách *</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Nhập tên đầy đủ của sách..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Vai trò</label>
                <select
                  value={draft.authorRole}
                  onChange={(e) => setDraft({ ...draft, authorRole: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="Chủ biên">Chủ biên</option>
                  <option value="Tác giả">Tác giả</option>
                  <option value="Đồng tác giả">Đồng tác giả</option>
                  <option value="Biên dịch">Biên dịch</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Nhà xuất bản</label>
                <input
                  type="text"
                  value={draft.venue}
                  onChange={(e) => setDraft({ ...draft, venue: e.target.value })}
                  placeholder="VD: Thanh niên / Giáo dục Việt Nam"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Năm xuất bản</label>
                <input
                  type="text"
                  value={draft.yearOrDate}
                  onChange={(e) => setDraft({ ...draft, yearOrDate: e.target.value })}
                  placeholder="2026"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Mã ISBN (nếu có)</label>
                <input
                  type="text"
                  value={draft.issueOrCode}
                  onChange={(e) => setDraft({ ...draft, issueOrCode: e.target.value })}
                  placeholder="978-604-..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>
          )}

          {/* 5. Công trình nghiên cứu khoa học */}
          {draft.kind === "RESEARCH_PROJECT" && (
            <div className="grid gap-2.5 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Tên đề tài / công trình NCKH *</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Nhập tên đề tài nghiên cứu khoa học..."
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Vai trò thực hiện</label>
                <select
                  value={draft.authorRole}
                  onChange={(e) => setDraft({ ...draft, authorRole: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="Chủ nhiệm đề tài">Chủ nhiệm đề tài</option>
                  <option value="Thành viên thực hiện">Thành viên thực hiện</option>
                  <option value="Thư ký đề tài">Thư ký đề tài</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Kết quả / Giải thưởng</label>
                <input
                  type="text"
                  value={draft.prize}
                  onChange={(e) => setDraft({ ...draft, prize: e.target.value })}
                  placeholder="VD: Giải Nhì / Giải Khuyến khích / Nghiệm thu loại Xuất sắc"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Cấp thực hiện</label>
                <select
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  <option value="Khoa">Khoa</option>
                  <option value="Trường">Trường</option>
                  <option value="Tỉnh, Thành phố">Tỉnh, Thành phố</option>
                  <option value="Bộ, Ngành">Bộ, Ngành</option>
                  <option value="Quốc gia">Quốc gia</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Năm học</label>
                <input
                  type="text"
                  value={draft.schoolYear}
                  onChange={(e) => setDraft({ ...draft, schoolYear: e.target.value })}
                  placeholder="2025 - 2026"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2">
                <select
                  value={draft.docType}
                  onChange={(e) => setDraft({ ...draft, docType: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="Quyết định">Quyết định</option>
                  <option value="Giấy chứng nhận">Giấy chứng nhận</option>
                </select>
                <input
                  type="text"
                  value={draft.docNumber}
                  onChange={(e) => setDraft({ ...draft, docNumber: e.target.value })}
                  placeholder="Số QĐ/GCN"
                  className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <input
                  type="text"
                  value={draft.issuer}
                  onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
                  placeholder="Cơ quan / Trường cấp"
                  className="min-w-[160px] flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <input
                  type="date"
                  value={draft.issueDate}
                  onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-950">
            <span className="font-semibold">Câu chuẩn tạo ra: </span>
            {preview || <span className="text-slate-400">Vui lòng điền tiêu đề / nội dung phía trên...</span>}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBuilder(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!preview}
              onClick={addFormatted}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Thêm vào hồ sơ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
