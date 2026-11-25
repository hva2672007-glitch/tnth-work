import { NextResponse } from "next/server";
import { checkDbReady } from "@/server/db";
import { getStorageUsage } from "@/server/storage/local-storage";

export const runtime = "nodejs";

export async function GET() {
  const db = await checkDbReady();
  if (!db.ok) {
    return NextResponse.json(
      { error: { code: "DB_UNAVAILABLE", message: "Cơ sở dữ liệu chưa sẵn sàng." } },
      { status: 503 },
    );
  }
  const storage = await getStorageUsage().catch(() => null);
  return NextResponse.json({
    data: {
      status: "ready",
      dbLatencyMs: db.latencyMs,
      storageWarning: storage?.warning ?? false,
      storageBlocked: storage?.blocked ?? false,
    },
  });
}
