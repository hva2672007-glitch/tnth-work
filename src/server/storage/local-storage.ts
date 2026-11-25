import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/server/config";
import { query, queryOne } from "@/server/db";
import { AppError } from "@/server/errors";

export interface StoragePutResult {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  safeMime: string;
}

export interface StorageAdapter {
  put(input: {
    buffer: Buffer;
    originalName: string;
    purpose: "AVATAR" | "SUBMISSION" | "MISSION_ATTACHMENT" | "COMMENT" | "REGULATION";
  }): Promise<StoragePutResult>;
  open(storageKey: string): Promise<{ stream: ReadStream; sizeBytes: number }>;
  delete(storageKey: string): Promise<void>;
  stat(storageKey: string): Promise<{ exists: boolean; sizeBytes: number }>;
}

const ALLOWED_EXTENSIONS: Record<string, { mime: string; inlineAllowed: boolean }> = {
  png: { mime: "image/png", inlineAllowed: true },
  jpg: { mime: "image/jpeg", inlineAllowed: true },
  jpeg: { mime: "image/jpeg", inlineAllowed: true },
  webp: { mime: "image/webp", inlineAllowed: true },
  pdf: { mime: "application/pdf", inlineAllowed: true },
  doc: { mime: "application/msword", inlineAllowed: false },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inlineAllowed: false },
  xls: { mime: "application/vnd.ms-excel", inlineAllowed: false },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inlineAllowed: false },
  ppt: { mime: "application/vnd.ms-powerpoint", inlineAllowed: false },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inlineAllowed: false },
  mp4: { mime: "video/mp4", inlineAllowed: true },
  m4v: { mime: "video/x-m4v", inlineAllowed: true },
  mov: { mime: "video/quicktime", inlineAllowed: true },
  zip: { mime: "application/zip", inlineAllowed: false },
  txt: { mime: "text/plain; charset=utf-8", inlineAllowed: false },
  csv: { mime: "text/csv; charset=utf-8", inlineAllowed: false },
};

const AVATAR_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const FORBIDDEN_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "sh", "bash", "zsh", "ps1", "msi", "dll", "so", "dylib",
  "js", "mjs", "cjs", "ts", "jsx", "tsx", "html", "htm", "svg", "php", "py", "rb", "pl", "jar",
]);

function startsWithBytes(buf: Buffer, bytes: number[], offset = 0): boolean {
  return buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
}

export function sanitizeFilename(rawName: string): string {
  const base = path.basename(rawName || "file").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").trim();
  return base.slice(0, 180) || "file";
}

export function sanitizeRelativePath(rawPath?: string | null): string | null {
  if (!rawPath) return null;
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => sanitizeFilename(s));
  return segments.length > 0 ? segments.join("/").slice(0, 400) : null;
}

export function validateFileBuffer(
  buffer: Buffer,
  originalName: string,
  purpose: "AVATAR" | "SUBMISSION" | "MISSION_ATTACHMENT" | "COMMENT" | "REGULATION",
): { ext: string; safeMime: string; inlineAllowed: boolean } {
  if (buffer.length === 0) {
    throw new AppError(400, "EMPTY_FILE", "Tệp tải lên đang rỗng.");
  }

  const cfg = getConfig();
  const limit = purpose === "AVATAR" ? cfg.maxAvatarBytes : cfg.maxUploadBytes;
  if (buffer.length > limit) {
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      `Tệp vượt quá giới hạn dung lượng (${Math.round(limit / (1024 * 1024))} MB).`,
    );
  }

  const clean = sanitizeFilename(originalName);
  const match = clean.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  const ext = match ? match[1] : "";

  if (!ext || FORBIDDEN_EXTENSIONS.has(ext) || !(ext in ALLOWED_EXTENSIONS)) {
    throw new AppError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Định dạng tệp không được phép tải lên. Hỗ trợ ảnh (PNG/JPG/WebP), PDF, Office (DOCX/XLSX/PPTX), video (MP4/MOV), ZIP, TXT/CSV.",
    );
  }

  if (purpose === "AVATAR" && !AVATAR_EXTENSIONS.has(ext)) {
    throw new AppError(415, "INVALID_AVATAR_TYPE", "Ảnh đại diện chỉ hỗ trợ PNG, JPG, JPEG hoặc WebP.");
  }

  // Kiểm tra magic bytes cho các định dạng chính để chống giả mạo đuôi tệp
  if (ext === "png" && !startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp định dạng PNG.");
  }
  if ((ext === "jpg" || ext === "jpeg") && !startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp định dạng JPEG.");
  }
  if (ext === "webp" && !(startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8))) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp định dạng WebP.");
  }
  if (ext === "pdf" && !startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp định dạng PDF.");
  }
  if ((ext === "zip" || ext === "docx" || ext === "xlsx" || ext === "pptx") && !startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp chữ ký nén ZIP/Office.");
  }
  if ((ext === "mp4" || ext === "mov" || ext === "m4v") && !startsWithBytes(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    throw new AppError(415, "INVALID_MAGIC_BYTES", "Nội dung tệp không khớp định dạng video MP4/MOV.");
  }
  if ((ext === "txt" || ext === "csv") && buffer.subarray(0, 4096).includes(0)) {
    throw new AppError(415, "INVALID_TEXT_FILE", "Tệp văn bản chứa dữ liệu nhị phân không hợp lệ.");
  }

  const meta = ALLOWED_EXTENSIONS[ext];
  return { ext, safeMime: meta.mime, inlineAllowed: meta.inlineAllowed };
}

export async function getStorageUsage(): Promise<{
  usedBytes: number;
  quotaBytes: number;
  ratio: number;
  warning: boolean;
  blocked: boolean;
}> {
  const cfg = getConfig();
  const row = await queryOne<{ total: string | number }>(
    `SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files WHERE state IN ('PENDING', 'ACTIVE')`,
  );
  const usedBytes = Number(row?.total ?? 0);
  const ratio = cfg.storageQuotaBytes > 0 ? usedBytes / cfg.storageQuotaBytes : 0;
  return {
    usedBytes,
    quotaBytes: cfg.storageQuotaBytes,
    ratio,
    warning: ratio >= 0.75,
    blocked: ratio >= 0.85,
  };
}

class LocalPrivateStorage implements StorageAdapter {
  private resolveSafePath(storageKey: string): string {
    const cfg = getConfig();
    const cleaned = storageKey.replace(/^\/+/, "");
    const abs = path.resolve(cfg.uploadDir, cleaned);
    const root = path.resolve(cfg.uploadDir);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      throw new AppError(400, "INVALID_STORAGE_KEY", "Đường dẫn tệp không hợp lệ.");
    }
    return abs;
  }

  async put(input: {
    buffer: Buffer;
    originalName: string;
    purpose: "AVATAR" | "SUBMISSION" | "MISSION_ATTACHMENT" | "COMMENT" | "REGULATION";
  }): Promise<StoragePutResult> {
    const { ext, safeMime } = validateFileBuffer(input.buffer, input.originalName, input.purpose);

    // Kiểm tra quota toàn kho (chặn ở >= 85% hoặc vượt quota theo mục 8.3)
    const usage = await getStorageUsage();
    const cfg = getConfig();
    if (usage.blocked || usage.usedBytes + input.buffer.length > cfg.storageQuotaBytes) {
      throw new AppError(
        507,
        "STORAGE_QUOTA_EXCEEDED",
        "Kho lưu trữ nội bộ đã chạm ngưỡng an toàn. Vui lòng dùng link Drive/Canva hoặc liên hệ quản trị viên.",
      );
    }

    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const storageKey = `${input.purpose.toLowerCase()}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
    const finalPath = this.resolveSafePath(storageKey);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;

    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(tempPath, input.buffer, { mode: 0o600 });
    await rename(tempPath, finalPath);

    return {
      storageKey,
      sizeBytes: input.buffer.length,
      sha256,
      safeMime,
    };
  }

  async open(storageKey: string): Promise<{ stream: ReadStream; sizeBytes: number }> {
    const abs = this.resolveSafePath(storageKey);
    const info = await stat(abs);
    return {
      stream: createReadStream(abs),
      sizeBytes: info.size,
    };
  }

  async delete(storageKey: string): Promise<void> {
    const abs = this.resolveSafePath(storageKey);
    await unlink(abs).catch(() => {});
  }

  async stat(storageKey: string): Promise<{ exists: boolean; sizeBytes: number }> {
    const abs = this.resolveSafePath(storageKey);
    try {
      const info = await stat(abs);
      return { exists: true, sizeBytes: info.size };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }
}

export const storageAdapter: StorageAdapter = new LocalPrivateStorage();

export function isInlinePreviewAllowed(safeMime: string): boolean {
  return (
    safeMime === "image/png" ||
    safeMime === "image/jpeg" ||
    safeMime === "image/webp" ||
    safeMime === "application/pdf" ||
    safeMime === "video/mp4" ||
    safeMime === "video/quicktime"
  );
}

/** Ghi bản ghi tệp đã tải lên vào DB */
export async function saveUploadedFile(input: {
  buffer: Buffer;
  originalName: string;
  relativePath?: string | null;
  purpose: "AVATAR" | "SUBMISSION" | "MISSION_ATTACHMENT" | "COMMENT" | "REGULATION";
  uploaderId: string;
}) {
  const stored = await storageAdapter.put({
    buffer: input.buffer,
    originalName: input.originalName,
    purpose: input.purpose,
  });

  const cleanName = sanitizeFilename(input.originalName);
  const relPath = sanitizeRelativePath(input.relativePath);
  const rows = await query<{
    id: string;
    original_name: string;
    relative_path: string | null;
    safe_mime: string;
    size_bytes: string | number;
    sha256: string;
    purpose: string;
    created_at: Date;
  }>(
    `INSERT INTO files (private_storage_key, original_name, relative_path, safe_mime, size_bytes, sha256, uploader_id, purpose, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
     RETURNING id, original_name, relative_path, safe_mime, size_bytes, sha256, purpose, created_at`,
    [stored.storageKey, cleanName, relPath, stored.safeMime, stored.sizeBytes, stored.sha256, input.uploaderId, input.purpose],
  );
  const row = rows[0];
  return {
    id: row.id,
    originalName: row.original_name,
    relativePath: row.relative_path,
    safeMime: row.safe_mime,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    purpose: row.purpose,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
