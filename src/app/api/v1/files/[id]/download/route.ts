import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { assertCanAccessFile } from "@/server/submissions/service";
import { isInlinePreviewAllowed, storageAdapter } from "@/server/storage/local-storage";
import { errorJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const file = await assertCanAccessFile(actor, id);

    const { stream, sizeBytes } = await storageAdapter.open(file.private_storage_key);
    const url = new URL(request.url);
    const wantInline = url.searchParams.get("inline") === "1" && isInlinePreviewAllowed(file.safe_mime);
    const disposition = wantInline ? "inline" : "attachment";
    const encodedName = encodeURIComponent(file.original_name);

    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": file.safe_mime,
        "Content-Length": String(sizeBytes),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
      },
    });
  } catch (err) {
    return errorJson(err);
  }
}
