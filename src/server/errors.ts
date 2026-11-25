import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
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

export function okJson<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function errorJson(err: unknown, requestId = randomUUID()) {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...(err.fields ? { fields: err.fields } : {}),
        },
      },
      { status: err.status, headers: { "X-Request-Id": requestId } },
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_root";
      fields[key] = issue.message;
    }
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại các trường đánh dấu.",
          requestId,
          fields,
        },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  // PostgreSQL unique/check errors
  const pgCode = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code) : "";
  if (pgCode === "23505") {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "Dữ liệu đã tồn tại hoặc vi phạm ràng buộc duy nhất.",
          requestId,
        },
      },
      { status: 409, headers: { "X-Request-Id": requestId } },
    );
  }
  if (pgCode === "23503") {
    return NextResponse.json(
      {
        error: {
          code: "REFERENCE_ERROR",
          message: "Không thể thực hiện do dữ liệu liên quan không tồn tại hoặc đang được sử dụng.",
          requestId,
        },
      },
      { status: 409, headers: { "X-Request-Id": requestId } },
    );
  }
  if (pgCode === "23514") {
    return NextResponse.json(
      {
        error: {
          code: "CONSTRAINT_ERROR",
          message: "Giá trị không thỏa mãn điều kiện nghiệp vụ.",
          requestId,
        },
      },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  console.error(`[TNTH-WORK][${requestId}]`, err instanceof Error ? err.message : err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Hệ thống gặp sự cố nội bộ. Vui lòng thử lại sau.",
        requestId,
      },
    },
    { status: 500, headers: { "X-Request-Id": requestId } },
  );
}
