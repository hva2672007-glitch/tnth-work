import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requestDeadlineExtension } from "@/server/missions/workflow";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const RequestExtensionSchema = z.object({
  requestedDeadline: z.string().min(1, "Vui lòng chọn thời hạn mới đề xuất."),
  reason: z.string().trim().min(5, "Vui lòng ghi rõ lý do xin dời deadline (tối thiểu 5 ký tự).").max(1000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = RequestExtensionSchema.parse(await request.json());
    const res = await requestDeadlineExtension(actor, id, input);
    return okJson(res, 201);
  } catch (err) {
    return errorJson(err);
  }
}
