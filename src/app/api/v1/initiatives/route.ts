import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createInitiative, listInitiatives } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateInitiativeSchema = z.object({
  kind: z.enum(["IDEA", "INITIATIVE", "PRODUCT"]).optional(),
  title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự.").max(300),
  description: z.string().min(5, "Mô tả chi tiết tối thiểu 5 ký tự."),
  links: z
    .array(z.object({ label: z.string().min(1).max(200), url: z.string().url("Link không hợp lệ.") }))
    .optional(),
  fileIds: z.array(z.string().uuid()).optional(),
  leadMemberId: z.string().uuid().optional(),
  participantIds: z.array(z.string().uuid()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const items = await listInitiatives(actor, { status: url.searchParams.get("status") ?? undefined });
    return okJson(items);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = CreateInitiativeSchema.parse(await request.json());
    const created = await createInitiative(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
