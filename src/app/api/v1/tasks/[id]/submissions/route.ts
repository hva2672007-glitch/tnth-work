import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { submitTaskProduct } from "@/server/submissions/service";
import { checkIdempotency, saveIdempotency } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const SubmitSchema = z.object({
  submissionType: z.enum(["LINK", "FILE", "FOLDER", "TEXT", "MIXED"]).optional(),
  note: z.string().max(2000).optional(),
  textContent: z.string().max(10000).optional(),
  links: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        url: z.string().url("Link sản phẩm không hợp lệ."),
        kind: z.enum(["LINK", "FOLDER"]).optional(),
      }),
    )
    .optional(),
  fileIds: z.array(z.string().uuid()).optional(),
  contributorAssignmentIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const raw = await request.json();

    const idemKey = request.headers.get("idempotency-key");
    const idem = await checkIdempotency(actor.memberId, `task.submit:${id}`, idemKey, raw);
    if (idem.hit) {
      return NextResponse.json(idem.body, { status: idem.status });
    }

    const input = SubmitSchema.parse(raw);
    const result = await submitTaskProduct(actor, id, input);
    const responseBody = { data: result };
    await saveIdempotency(actor.memberId, `task.submit:${id}`, idemKey, idem.hash, 201, responseBody);
    return okJson(result, 201);
  } catch (err) {
    return errorJson(err);
  }
}
