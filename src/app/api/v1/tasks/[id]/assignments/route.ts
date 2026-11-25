import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { assignTaskMembers } from "@/server/missions/workflow";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const AssignMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1, "Vui lòng chọn ít nhất 01 thành viên."),
  weights: z.record(z.string(), z.number().positive()).optional(),
  submissionMode: z.enum(["INDIVIDUAL", "SHARED"]).optional(),
  replaceAssignmentIds: z.array(z.string().uuid()).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = AssignMembersSchema.parse(await request.json());
    const res = await assignTaskMembers(actor, id, input);
    return okJson(res, 201);
  } catch (err) {
    return errorJson(err);
  }
}
