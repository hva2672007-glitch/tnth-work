import type { NextRequest } from "next/server";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { getStorageUsage, saveUploadedFile } from "@/server/storage/local-storage";
import { getConfig } from "@/server/config";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireRequestActor(request);
    const usage = await getStorageUsage();
    return okJson(usage);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);

    const form = await request.formData().catch(() => null);
    if (!form) {
      throw new AppError(400, "INVALID_FORM_DATA", "Yêu cầu gửi dữ liệu dạng multipart/form-data.");
    }

    const purposeRaw = String(form.get("purpose") ?? "SUBMISSION").toUpperCase();
    const allowedPurposes = ["AVATAR", "SUBMISSION", "MISSION_ATTACHMENT", "COMMENT", "REGULATION"] as const;
    const purpose = allowedPurposes.includes(purposeRaw as (typeof allowedPurposes)[number])
      ? (purposeRaw as (typeof allowedPurposes)[number])
      : "SUBMISSION";

    const entries = form.getAll("files");
    const single = form.get("file");
    const files: File[] = [];
    for (const item of [...entries, single]) {
      if (item instanceof File) files.push(item);
    }

    if (files.length === 0) {
      throw new AppError(400, "NO_FILE", "Vui lòng chọn ít nhất 01 tệp để tải lên.");
    }

    const cfg = getConfig();
    if (files.length > cfg.maxSubmissionFiles) {
      throw new AppError(400, "TOO_MANY_FILES", `Tối đa ${cfg.maxSubmissionFiles} tệp cho mỗi lần tải lên.`);
    }

    let totalBytes = 0;
    const uploaded = [];
    for (const f of files) {
      totalBytes += f.size;
      if (totalBytes > cfg.maxSubmissionBytes) {
        throw new AppError(
          413,
          "SUBMISSION_TOO_LARGE",
          `Tổng dung lượng vượt quá giới hạn (${Math.round(cfg.maxSubmissionBytes / (1024 * 1024))} MB).`,
        );
      }
      const buffer = Buffer.from(await f.arrayBuffer());
      const relativePath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || null;
      const saved = await saveUploadedFile({
        buffer,
        originalName: f.name,
        relativePath,
        purpose,
        uploaderId: actor.memberId,
      });
      uploaded.push(saved);
    }

    return okJson({ files: uploaded }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
