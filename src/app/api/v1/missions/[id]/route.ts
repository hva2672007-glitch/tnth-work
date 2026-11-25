import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { getMissionDetail, updateMission } from "@/server/missions/workflow";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PatchMissionSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().min(3).max(240).optional(),
  description: z.string().min(3).max(8000).optional(),
  expectedOutcome: z.string().max(4000).optional(),
  refs: z.array(z.object({ label: z.string().min(1), url: z.string().url() })).optional(),
  importance: z.enum(["KEY", "NORMAL"]).optional(),
  urgency: z.enum(["FLASH", "VERY_URGENT", "URGENT", "NORMAL"]).optional(),
  deadline: z.string().optional(),
  deadlineReason: z.string().max(500).optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const detail = await getMissionDetail(actor, id);
    return okJson(detail);
  } catch (err) {
    return errorJson(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = PatchMissionSchema.parse(await request.json());
    const updated = await updateMission(actor, id, input);
    return okJson(updated);
  } catch (err) {
    return errorJson(err);
  }
}
