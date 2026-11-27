"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Palette, Plus, Search, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { GRAPHIC_CATEGORY_LABELS, type GraphicCategory } from "@/lib/constants";
import { formatVnDateTime } from "@/lib/date";

interface GraphicAsset {
  id: string;
  title: string;
  category: GraphicCategory;
  description: string;
  externalUrl: string;
  file: { id: string; originalName: string; safeMime: string; sizeBytes: number } | null;
  tags: string[];
  uploadedByName: string;
  createdAt: string;
}

export default function GraphicsPage() {
  const { capabilities } = useAuth();
  const canManage = Boolean(capabilities?.canManageGraphics);

  const [items, setItems] = useState<GraphicAsset[]>([]);
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [formCategory, setFormCategory] = useState<GraphicCategory>("LOGO");
  const [description, setDescription] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<{ id: string; originalName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (category) qs.set("category", category);
      if (search.trim()) qs.set("q", search.trim());
      const res = await apiFetch<GraphicAsset[]>(`/api/v1/graphics?${qs.toString()}`);
      setItems(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Kho Data đồ họa.");
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("purpose", "GRAPHIC_ASSET");
      form.append("file", file);
      const res = await apiFetch<{ files: { id: string; originalName: string }[] }>("/api/v1/files", {
        method: "POST",
        body: form,
      });
      if (res.files[0]) setUploadedFile(res.files[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải tệp lên thất bại.");
    }
  };

  const handleCreate = async () => {
    if (title.trim().length < 2 || (!uploadedFile && !externalUrl.trim())) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/api/v1/graphics", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          category: formCategory,
          description: description.trim(),
          externalUrl: externalUrl.trim(),
          fileId: uploadedFile?.id ?? null,
          tags: tagsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setTitle("");
      setDescription("");
      setExternalUrl("");
      setTagsText("");
      setUploadedFile(null);
      setShowForm(false);
      setNotice("Đã thêm tài nguyên mới vào Kho Data đồ họa cơ bản.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể thêm tài nguyên.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (asset: GraphicAsset) => {
    if (!window.confirm(`Xóa tài nguyên "${asset.title}" khỏi Kho đồ họa?`)) return;
    try {
      await apiFetch(`/api/v1/graphics/${asset.id}`, { method: "DELETE" });
      setNotice(`Đã xóa "${asset.title}".`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xóa tài nguyên.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kho Data đồ họa cơ bản</h1>
          <p className="text-sm text-slate-500">
            Logo, khung ảnh, template Canva/Slide, bộ nhận diện thương hiệu, font chữ và icon chuẩn phục vụ thiết kế sản phẩm của Ban Biên tập
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Thêm tài nguyên đồ họa
          </button>
        )}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {showForm && canManage && (
        <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
          <div className="text-sm font-bold text-blue-950">Thêm dữ liệu vào Kho Đồ họa cơ bản</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Tên tài nguyên *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Bộ Logo Ban Biên tập TNTH (PNG + Vector)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Danh mục</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as GraphicCategory)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {(Object.keys(GRAPHIC_CATEGORY_LABELS) as GraphicCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {GRAPHIC_CATEGORY_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Mô tả / Hướng dẫn sử dụng</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kích thước chuẩn, bảng mã màu, lưu ý đặt logo..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Link Canva / Drive / Figma (tuỳ chọn)</label>
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Thẻ từ khóa (phân cách bằng dấu phẩy)</label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="logo, png, 2026, chiến dịch"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Upload className="h-3.5 w-3.5" /> Tải file trực tiếp (PNG, JPG, PDF, ZIP...)
                <input type="file" className="hidden" onChange={(e) => void handleFileUpload(e.target.files?.[0])} />
              </label>
              {uploadedFile && (
                <span className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                  Đã tải: {uploadedFile.originalName}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || title.trim().length < 2 || (!uploadedFile && !externalUrl.trim())}
              onClick={() => void handleCreate()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Lưu vào Kho đồ họa
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
            >
              Hủy
            </button>
          </div>
        </section>
      )}

      {/* Bộ lọc */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên tài nguyên hoặc mô tả..."
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory("")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              category === "" ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            Tất cả
          </button>
          {(Object.keys(GRAPHIC_CATEGORY_LABELS) as GraphicCategory[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCategory(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                category === k ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {GRAPHIC_CATEGORY_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Danh sách tài nguyên */}
      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Đang tải Kho Data đồ họa...</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          <Palette className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          Chưa có tài nguyên đồ họa nào trong danh mục này.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                    {GRAPHIC_CATEGORY_LABELS[item.category]}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(item)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Xóa tài nguyên"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <h3 className="mt-2 text-base font-bold text-slate-900">{item.title}</h3>
                {item.description && <p className="mt-1 text-xs text-slate-600">{item.description}</p>}
                {item.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.tags.map((t) => (
                      <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap gap-2">
                  {item.file && (
                    <a
                      href={`/api/v1/files/${item.file.id}/download`}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      <Download className="h-3.5 w-3.5" /> Tải tệp ({item.file.originalName})
                    </a>
                  )}
                  {item.externalUrl && (
                    <a
                      href={item.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Mở liên kết
                    </a>
                  )}
                </div>
                <div className="text-[11px] text-slate-400">
                  Đăng bởi {item.uploadedByName} · {formatVnDateTime(item.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
