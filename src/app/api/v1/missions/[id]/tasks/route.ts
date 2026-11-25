import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { addTaskToMission } from "@/server/missions/workflow";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const AddTaskSchema = z.object({
  title: z.string().min(2, "Tên task tối thiểu 2 ký tự.").max(200),
  description: z.string().max(4000).optional(),
  deliverable: z.string().max(1000).optional(),
  ownerTeamId: z.string().uuid("Chọn tổ phụ trách hợp lệ."),
  reviewerId: z.string().uuid().nullable().optional(),
  supervisorIds: z.array(z.string().uuid()).optional(),
  assigneeIds: z.array(z.string().uuid()).optional(),
  submissionMode: z.enum(["INDIVIDUAL", "SHARED"]).optional(),
  weight: z.number().positive().max(20).optional(),
  deadline: z.string().min(1, "Bắt buộc nhập deadline task."),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = AddTaskSchema.parse(await request.json());
    const res = await addTaskToMission(actor, id, input);
    return okJson(res, 201);
  } catch (err) {
    return errorJson(err);
  }
}
