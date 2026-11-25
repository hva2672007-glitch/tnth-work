import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { resetLocalMemberPassword } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ResetPasswordSchema = z.object({
  newPassword: z.string().min(8, "Mật khẩu mới cần tối thiểu 8 ký tự.").max(120),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const { id } = await params;
    const input = ResetPasswordSchema.parse(await request.json());
    const res = await resetLocalMemberPassword(actor, id, input.newPassword);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
