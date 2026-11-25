import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const CreateTeamSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireRequestActor(request);
    const rows = await query<{
      id: string;
      code: string;
      name: string;
      description: string;
      active: boolean;
      sort_order: number;
      member_count: string | number;
    }>(
      `SELECT t.id, t.code, t.name, t.description, t.active, t.sort_order,
              (SELECT count(*) FROM team_memberships tm JOIN members m ON m.id = tm.member_id
               WHERE tm.team_id = t.id AND tm.effective_to IS NULL AND m.access_enabled = true) AS member_count
       FROM teams t
       ORDER BY t.sort_order ASC, t.name ASC`,
    );
    return okJson(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        active: r.active,
        sortOrder: r.sort_order,
        memberCount: Number(r.member_count),
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
    requirePermission(actor, "team.manage", {}, "Chỉ Trưởng Ban (01.01) và Phó Ban (02) được tạo tổ chuyên môn.");
    const input = CreateTeamSchema.parse(await request.json());
    const rows = await query<{ id: string }>(
      `INSERT INTO teams (code, name, description, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.code.trim(), input.name.trim(), (input.description ?? "").trim(), input.sortOrder ?? 10],
    );
    await writeAudit({ actorId: actor.memberId, action: "TEAM_CREATED", targetType: "TEAM", targetId: rows[0].id, safeDiff: input });
    return okJson({ id: rows[0].id, ...input }, 201);
  } catch (err) {
    return errorJson(err);
  }
}
