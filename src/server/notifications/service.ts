import { query, type DbClient } from "@/server/db";

export interface NotificationInput {
  recipientId: string;
  eventType: string;
  targetType: string;
  targetId?: string | null;
  title: string;
  message: string;
  link?: string;
  dedupeKey?: string | null;
  payload?: Record<string, unknown>;
}

export async function createNotification(input: NotificationInput, tx?: DbClient): Promise<void> {
  const sql = `
    INSERT INTO notifications (recipient_id, event_type, target_type, target_id, title, message, link, dedupe_key, payload)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  `;
  const params = [
    input.recipientId,
    input.eventType,
    input.targetType,
    input.targetId ?? null,
    input.title,
    input.message,
    input.link ?? "/",
    input.dedupeKey ?? null,
    JSON.stringify(input.payload ?? {}),
  ];
  if (tx) {
    await tx.query(sql, params);
  } else {
    await query(sql, params);
  }
}

export async function createNotifications(
  recipientIds: string[],
  template: Omit<NotificationInput, "recipientId">,
  tx?: DbClient,
): Promise<void> {
  const uniqueIds = [...new Set(recipientIds.filter(Boolean))];
  for (const recipientId of uniqueIds) {
    await createNotification({ ...template, recipientId }, tx);
  }
}
