import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createConductReport, listConductReports } from "@/server/governance/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateConductSchema = z.object({
  subjectMemberId: z.string().uuid("Chọn thành viên hợp lệ."),
  issueSummary: z.string().min(5, "Mô tả vấn đề tối thiểu 5 ký tự."),
  evidenceText: z.string().optional(),
  evidenceLinks: z
    .array(z.object({ label: z.string().min(1).max(200), url: z.string().url("Link minh chứng không hợp lệ.") }))
    .optional(),
  evidenceFileIds: z.array(z.string().uuid()).optional(),
  proposedSolution: z.string().min(3, "Nhập phương hướng giải quyết đề xuất."),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const data = await listConductReports(actor, {
      subjectMemberId: url.searchParams.get("subjectMemberId") ?? undefined,
    });
    return okJson(data);
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = CreateConductSchema.parse(await request.json());
    const created = await createConductReport(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
