import { createHash } from "node:crypto";
import { query, type DbClient } from "@/server/db";
import { AppError } from "@/server/errors";

export interface AuditInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  safeDiff?: Record<string, unknown>;
  requestId?: string | null;
  ipAddress?: string | null;
}

const REDACT_KEYS = new Set(["password", "passwordHash", "token", "tokenHash", "secret", "cookie", "authorization"]);

function sanitizeDiff(obj?: Record<string, unknown>): Record<string, unknown> {
  if (!obj) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) {
      out[k] = "[REDACTED]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeDiff(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeAudit(input: AuditInput, tx?: DbClient): Promise<void> {
  const sql = `
    INSERT INTO audit_logs (actor_id, action, target_type, target_id, safe_diff, request_id, ip_address)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
  `;
  const params = [
    input.actorId,
    input.action,
    input.targetType,
    input.targetId ?? null,
    JSON.stringify(sanitizeDiff(input.safeDiff)),
    input.requestId ?? null,
    input.ipAddress ?? null,
  ];
  if (tx) {
    await tx.query(sql, params);
  } else {
    await query(sql, params);
  }
}

export interface ActivityInput {
  missionId?: string | null;
  taskId?: string | null;
  assignmentId?: string | null;
  actorId: string | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export async function writeActivity(input: ActivityInput, tx?: DbClient): Promise<void> {
  const sql = `
    INSERT INTO activity_logs (mission_id, task_id, assignment_id, actor_id, action, summary, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
  `;
  const params = [
    input.missionId ?? null,
    input.taskId ?? null,
    input.assignmentId ?? null,
    input.actorId,
    input.action,
    input.summary,
    JSON.stringify(input.metadata ?? {}),
  ];
  if (tx) {
    await tx.query(sql, params);
  } else {
    await query(sql, params);
  }
}

/**
 * Kiểm tra Idempotency-Key cho các mutation nhạy cảm (mục 13 & 14.3):
 * - Cùng actor + action + key + payload hash → trả kết quả đã lưu.
 * - Cùng key nhưng payload khác → trả 409 IDEMPOTENCY_CONFLICT.
 */
export async function checkIdempotency(
  actorId: string,
  action: string,
  key: string | null,
  body: unknown,
): Promise<{ hit: true; status: number; body: unknown } | { hit: false; hash: string }> {
  const hash = createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
  if (!key) return { hit: false, hash };

  const rows = await query<{ request_hash: string; response_status: number; response_body: unknown }>(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_keys
     WHERE actor_id = $1 AND action = $2 AND key = $3 AND expires_at > now()`,
    [actorId, action, key],
  );
  const existing = rows[0];
  if (!existing) return { hit: false, hash };

  if (existing.request_hash !== hash) {
    throw new AppError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key đã được sử dụng với nội dung khác.");
  }
  return { hit: true, status: existing.response_status, body: existing.response_body };
}

export async function saveIdempotency(
  actorId: string,
  action: string,
  key: string | null,
  hash: string,
  status: number,
  body: unknown,
  tx?: DbClient,
): Promise<void> {
  if (!key) return;
  const sql = `
    INSERT INTO idempotency_keys (actor_id, action, key, request_hash, response_status, response_body, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, now() + interval '24 hours')
    ON CONFLICT (actor_id, action, key) DO NOTHING
  `;
  const params = [actorId, action, key, hash, status, JSON.stringify(body)];
  if (tx) {
    await tx.query(sql, params);
  } else {
    await query(sql, params);
  }
}
