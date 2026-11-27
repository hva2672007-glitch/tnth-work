import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { createLocalMember } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateLocalMemberSchema = z.object({
  username: z.string().trim().min(4).max(40),
  displayName: z.string().trim().min(2).max(160),
  password: z.string().min(8, "Mật khẩu tạm cần tối thiểu 8 ký tự.").max(120),
  email: z.string().email("Email không hợp lệ.").optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  currentOrg: z.string().max(240).optional(),
  role: z.enum([
    "ACTING_HEAD",
    "DEPUTY_INSPECTOR",
    "DEPUTY",
    "TEAM_LEAD",
    "TEAM_DEPUTY",
    "MEMBER",
    "COLLABORATOR",
    "OBSERVER",
  ]),
  primaryTeamId: z.string().uuid("Chọn tổ chuyên môn chính hợp lệ."),
  primaryTeamTitle: z.enum(["MEMBER", "LEADER", "DEPUTY_LEADER"]).optional(),
  secondaryTeamIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    const input = CreateLocalMemberSchema.parse(await request.json());
    const created = await createLocalMember(actor, input);
    return okJson(created, 201);
  } catch (err) {
    return errorJson(err);
  }
}
