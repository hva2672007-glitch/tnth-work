"use client";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function apiFetch<T>(
  url: string,
  options?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options?.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const json = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string; fields?: Record<string, string> } }
    | null;

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      json?.error?.code ?? "REQUEST_FAILED",
      json?.error?.message ?? `Yêu cầu thất bại (HTTP ${res.status}).`,
      json?.error?.fields,
    );
  }
  return json?.data as T;
}

export function randomIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
