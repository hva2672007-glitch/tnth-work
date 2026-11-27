import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createCouncilItem, listCouncilItems } from "@/server/governance/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateCouncilItemSchema = z.object({
  itemType: z.enum(["PERSONNEL_DOSSIER", "GENERAL_DOCUMENT"]),
  title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự.").max(300),
  description: z.string().optional(),
  subjectMemberId: z.string().uuid().optional(),
  inspectorProposal: z.string().optional(),
  conductReportIds: z.array(z.string().uuid()).optional(),
  links: z
    .array(z.object({ label: z.string().min(1).max(200), url: z.string().url("Link tài liệu không hợp lệ.") }))
    .optional(),
  fileIds: z.array(z.string().uuid()).optional(),
  opinionDeadlineDays: z.number().int().min(1).max(14).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const data = await listCouncilItems(actor);
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = CreateCouncilItemSchema.parse(await request.json());
    const created = await createCouncilItem(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
