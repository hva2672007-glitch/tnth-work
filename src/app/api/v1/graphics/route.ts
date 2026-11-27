import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createGraphicAsset, listGraphicAssets } from "@/server/kpi-extras/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateGraphicSchema = z.object({
  title: z.string().min(2, "Tên tài nguyên tối thiểu 2 ký tự.").max(200),
  category: z.enum(["LOGO", "FRAME", "TEMPLATE", "BRAND_GUIDELINE", "FONT", "ICON", "OTHER"]).default("OTHER"),
  description: z.string().max(2000).optional(),
  externalUrl: z.string().max(1000).optional(),
  fileId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(60)).max(15).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const items = await listGraphicAssets(actor, {
      category: url.searchParams.get("category") ?? undefined,
      search: url.searchParams.get("q") ?? undefined,
    });
    return okJson(items);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = CreateGraphicSchema.parse(await request.json());
    const created = await createGraphicAsset(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
