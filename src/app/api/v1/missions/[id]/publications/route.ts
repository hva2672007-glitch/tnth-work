import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { addPublicationLink } from "@/server/submissions/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const AddPublicationSchema = z.object({
  requirementId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  customChannelName: z.string().max(160).optional(),
  url: z.string().url("Link đăng tải không hợp lệ."),
  title: z.string().max(240).optional(),
  postedAt: z.string().optional(),
  note: z.string().max(500).optional(),
  confirmChannel: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = AddPublicationSchema.parse(await request.json());
    const res = await addPublicationLink(actor, id, input);
    return okJson(res, 201);
  } catch (err) {
    return errorJson(err);
  }
}
