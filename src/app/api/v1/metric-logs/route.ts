import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { listMetricLogs, submitMetricLog } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const MetricLogSchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  title: z.string().min(2, "Tên chỉ tiêu tối thiểu 2 ký tự.").max(240),
  metricUnit: z.string().min(1, "Đơn vị tính không được trống.").max(80),
  quantity: z.number().positive("Số lượng phải lớn hơn 0.").max(100000),
  pointsPerUnit: z.number().positive().max(100).optional(),
  evidenceUrl: z.string().max(1000).optional(),
  note: z.string().max(2000).optional(),
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const rows = await listMetricLogs(actor, { status: url.searchParams.get("status") ?? undefined });
    return okJson(rows);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = MetricLogSchema.parse(await request.json());
    const created = await submitMetricLog(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
