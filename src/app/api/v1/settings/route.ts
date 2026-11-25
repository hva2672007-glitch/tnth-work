import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { AppError, errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

const PatchSettingSchema = z.object({
  kpiWeights: z
    .object({
      completionWeight: z.number().min(0).max(100),
      ontimeWeight: z.number().min(0).max(100),
    })
    .optional(),
  slaMinutes: z
    .object({
      FLASH: z.number().int().min(5).max(1440),
      VERY_URGENT: z.number().int().min(15).max(2880),
      URGENT: z.number().int().min(30).max(4320),
      NORMAL: z.number().int().min(60).max(10080),
      APPROVAL_HOURS: z.number().int().min(12).max(720),
    })
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    requirePermission(actor, "audit.view");

    const settings = await query<{ key: string; value: unknown; updated_at: Date }>(
      `SELECT key, value, updated_at FROM system_settings ORDER BY key`,
    );
    const policies = await query<{
      id: string;
      version_code: string;
      completion_weight: string | number;
      ontime_weight: string | number;
      effective_from: Date;
    }>(`SELECT * FROM kpi_policies ORDER BY effective_from DESC, created_at DESC LIMIT 10`);

    return okJson({
      settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
      kpiPolicies: policies.map((p) => ({
        id: p.id,
        versionCode: p.version_code,
        completionWeight: Number(p.completion_weight),
        ontimeWeight: Number(p.ontime_weight),
        effectiveFrom: new Date(p.effective_from).toISOString(),
      })),
    });
  } catch (err) {
    return errorJson(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request, { forceRecheck: true });
    requirePermission(actor, "settings.manage", {}, "Chỉ Trưởng Ban (01.01) hoặc Phó Ban (02) được thay đổi cấu hình hệ thống.");

    const input = PatchSettingSchema.parse(await request.json());

    if (input.kpiWeights) {
      if (Math.round((input.kpiWeights.completionWeight + input.kpiWeights.ontimeWeight) * 100) !== 10000) {
        throw new AppError(400, "INVALID_KPI_WEIGHTS", "Tổng trọng số hoàn thành và đúng hạn phải bằng đúng 100%.");
      }
      const cnt = await query<{ c: string }>(`SELECT count(*)::text AS c FROM kpi_policies`);
      const nextCode = `KPI-V${Number(cnt[0]?.c ?? 0) + 1}`;
      await query(
        `INSERT INTO kpi_policies (version_code, completion_weight, ontime_weight, approved_by)
         VALUES ($1, $2, $3, $4)`,
        [nextCode, input.kpiWeights.completionWeight, input.kpiWeights.ontimeWeight, actor.memberId],
      );
      await writeAudit({
        actorId: actor.memberId,
        action: "KPI_POLICY_CREATED",
        targetType: "KPI_POLICY",
        targetId: nextCode,
        safeDiff: input.kpiWeights,
      });
    }

    if (input.slaMinutes) {
      await query(
        `INSERT INTO system_settings (key, value, updated_by, updated_at)
         VALUES ('sla_minutes', $1::jsonb, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = system_settings.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(input.slaMinutes), actor.memberId],
      );
      await writeAudit({
        actorId: actor.memberId,
        action: "SLA_SETTINGS_UPDATED",
        targetType: "SYSTEM_SETTING",
        targetId: "sla_minutes",
        safeDiff: input.slaMinutes,
      });
    }

    return okJson({ updated: true });
  } catch (err) {
    return errorJson(err);
  }
}
