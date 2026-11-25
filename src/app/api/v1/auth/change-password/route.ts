import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { changeOwnLocalPassword } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại."),
  newPassword: z.string().min(8, "Mật khẩu mới cần tối thiểu 8 ký tự.").max(120),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const input = ChangePasswordSchema.parse(await request.json());
    const res = await changeOwnLocalPassword(actor, input.currentPassword, input.newPassword);
    return okJson(res);
  } catch (err) {
    return errorJson(err);
  }
}
