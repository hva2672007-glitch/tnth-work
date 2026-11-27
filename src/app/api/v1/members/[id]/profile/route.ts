import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { updateMemberProfile } from "@/server/members/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const ProfilePatchSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  avatarFileId: z.string().uuid().nullable().optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")).optional(),
  birthplace: z.string().max(200).optional(),
  hometown: z.string().max(200).optional(),
  email: z.string().email().or(z.literal("")).optional(),
  phone: z.string().max(30).optional(),
  socialLinks: z.array(z.object({ platform: z.string().min(1), handle: z.string().min(1) })).optional(),
  currentOrg: z.string().max(250).optional(),
  isUnionMember: z.boolean().optional(),
  unionJoinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")).optional(),
  isPartyMember: z.boolean().optional(),
  partyProbationaryOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")).optional(),
  partyOfficialOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")).optional(),
  youthUnionPosition: z.string().max(250).optional(),
  education: z.array(z.object({ period: z.string(), school: z.string(), major: z.string().optional() })).optional(),
  academicAchievements: z.string().max(6000).optional(),
  youthAchievements: z.string().max(6000).optional(),
  joinedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("")).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    const { id } = await params;
    const input = ProfilePatchSchema.parse(await request.json());
    const updated = await updateMemberProfile(actor, id, input);
    return okJson(updated);
  } catch (err) {
    return errorJson(err);
  }
}
