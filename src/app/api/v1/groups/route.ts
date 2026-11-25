import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateGroupSchema = z.object({
  code: z.string().min(2).max(40).optional(),
  name: z.string().min(2, "Tên khối nhiệm vụ tối thiểu 2 ký tự.").max(140),
  description: z.string().max(400).optional(),
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
      description: string;
      active: boolean;
      sort_order: number;
      mission_count: string | number;
    }>(
      `SELECT tg.*, (SELECT count(*) FROM missions m WHERE m.group_id = tg.id) AS mission_count
       FROM task_groups tg
       ${includeInactive ? "" : "WHERE tg.active = true"}
       ORDER BY tg.sort_order ASC, tg.name ASC`,
    );
    return okJson(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        active: r.active,
        sortOrder: r.sort_order,
        missionCount: Number(r.mission_count),
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
    requirePermission(actor, "group.manage", {}, "Chỉ Trưởng Ban (01.01) và Phó Ban (02) mới được thêm khối nhiệm vụ.");
    const input = CreateGroupSchema.parse(await request.json());
    const code =
      input.code?.trim().toUpperCase() ||
      `KHOI-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    const rows = await query<{ id: string }>(
      `INSERT INTO task_groups (code, name, description, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [code, input.name.trim(), (input.description ?? "").trim(), input.sortOrder ?? 10, actor.memberId],
    );
    await writeAudit({
      actorId: actor.memberId,
      action: "TASK_GROUP_CREATED",
      targetType: "TASK_GROUP",
      targetId: rows[0].id,
      safeDiff: { code, name: input.name.trim() },
    });
    return okJson({ id: rows[0].id, code, name: input.name.trim() }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
