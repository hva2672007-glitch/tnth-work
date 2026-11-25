import type { NextRequest } from "next/server";
import { assertSameOrigin, requireRequestActor } from "@/server/auth/session";
import { query } from "@/server/db";
import { errorJson, okJson } from "@/server/errors";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRequestActor(request);
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";

    const rows = await query<{
      id: string;
      event_type: string;
      target_type: string;
      target_id: string | null;
      title: string;
      message: string;
      link: string;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, event_type, target_type, target_id, title, message, link, created_at, read_at
       FROM notifications
       WHERE recipient_id = $1 ${unreadOnly ? "AND read_at IS NULL" : ""}
       ORDER BY created_at DESC
       LIMIT 60`,
      [actor.memberId],
    );

    const unreadCountRes = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [actor.memberId],
    );

    return okJson({
      unreadCount: Number(unreadCountRes[0]?.c ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        targetType: r.target_type,
        targetId: r.target_id,
        title: r.title,
        message: r.message,
        link: r.link,
        createdAt: new Date(r.created_at).toISOString(),
        readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
      })),
    });
  } catch (err) {
    return errorJson(err);
  }
}

/** POST /api/v1/notifications — đánh dấu tất cả đã đọc */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireRequestActor(request);
    await query(
      `UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`,
      [actor.memberId],
    );
    return okJson({ markedAllRead: true });
  } catch (err) {
    return errorJson(err);
  }
}
