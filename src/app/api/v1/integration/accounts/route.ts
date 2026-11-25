import type { NextRequest } from "next/server";
import { requireRequestActor } from "@/server/auth/session";
import { requirePermission } from "@/server/authorization/policy";
import { getPortalProvider } from "@/server/auth/portal-adapter";
import { query } from "@/server/db";
import { writeAudit } from "@/server/audit/service";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

/** GET /api/v1/integration/accounts?q=... — tra cứu tài khoản nguồn theo thẩm quyền */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request, { forceRecheck: true });
    requirePermission(actor, "portal.accounts.search", {}, "Bạn không có quyền tra cứu tài khoản cổng thông tin.");

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const portal = getPortalProvider();
    const result = await portal.searchAccounts(q, cursor);

    const extIds = result.items.map((i) => i.externalAccountId);
    const existing =
      extIds.length > 0
        ? await query<{ id: string; external_account_id: string; role: string; access_enabled: boolean }>(
            `SELECT id, external_account_id, role, access_enabled FROM members WHERE provider = 'tnth' AND external_account_id = ANY($1::text[])`,
            [extIds],
          )
        : [];
    const byExt = new Map(existing.map((e) => [e.external_account_id, e]));

    await writeAudit({
      actorId: actor.memberId,
      action: "PORTAL_ACCOUNTS_SEARCHED",
      targetType: "INTEGRATION",
      safeDiff: { query: q.slice(0, 64), resultCount: result.items.length },
    });

    return okJson({
      mode: portal.mode,
      items: result.items.map((item) => {
        const m = byExt.get(item.externalAccountId);
        return {
          ...item,
          internalMemberId: m?.id ?? null,
          internalRole: m?.role ?? null,
          hasAccess: Boolean(m?.access_enabled),
        };
      }),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    return errorJson(err);
  }
}
