import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateChannelSchema = z.object({
  code: z.string().min(2).max(40).optional(),
  name: z.string().min(2).max(200),
  allowCustomName: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireRequestActor(request);
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const rows = await query<{
      id: string;
      code: string;
      name: string;
      allow_custom_name: boolean;
      active: boolean;
      sort_order: number;
    }>(
      `SELECT * FROM publication_channels ${includeInactive ? "" : "WHERE active = true"} ORDER BY sort_order ASC, name ASC`,
    );
    return okJson(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        allowCustomName: r.allow_custom_name,
        active: r.active,
        sortOrder: r.sort_order,
      })),
    );
  } catch (err) {
    return errorJson(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    requirePermission(actor, "channel.manage", {}, "Chỉ Trưởng Ban (01.01) và Phó Ban (02) mới được quản lý kênh đăng tải.");
    const input = CreateChannelSchema.parse(await request.json());
    const code = input.code?.trim().toUpperCase() || `CH_${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const rows = await query<{ id: string }>(
      `INSERT INTO publication_channels (code, name, allow_custom_name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
      [code, input.name.trim(), input.allowCustomName ?? false, input.sortOrder ?? 20],
    );
    await writeAudit({ actorId: actor.memberId, action: "CHANNEL_CREATED", targetType: "CHANNEL", targetId: rows[0].id, safeDiff: { code, name: input.name } });
    return okJson({ id: rows[0].id, code, name: input.name.trim() }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
