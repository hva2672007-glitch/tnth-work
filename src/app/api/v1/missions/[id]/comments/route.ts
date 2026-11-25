import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { addMissionComment } from "@/server/submissions/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CommentSchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  body: z.string().min(1, "Nội dung trao đổi không được trống.").max(4000),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = CommentSchema.parse(await request.json());
    const comment = await addMissionComment(actor, id, input);
    return okJson(comment, 201);
  } catch (err) {
    return errorJson(err);
  }
}
