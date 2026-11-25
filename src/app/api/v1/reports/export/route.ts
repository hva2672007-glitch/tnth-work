import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { generateReportWorkbook } from "@/server/reports/excel";
import { errorJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const { buffer, filename } = await generateReportWorkbook(actor, {
      periodKey: url.searchParams.get("periodKey") ?? undefined,
      allTime: url.searchParams.get("allTime") === "true",
      groupId: url.searchParams.get("groupId") ?? undefined,
      teamId: url.searchParams.get("teamId") ?? undefined,
      compact: url.searchParams.get("compact") === "true",
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorJson(err);
  }
}
