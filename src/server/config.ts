import path from "node:path";

export type AppEnv = "development" | "test" | "preview" | "production";
export type PortalAuthMode = "mock" | "sso" | "bridge";

export interface AppConfig {
  appEnv: AppEnv;
  appUrl: string;
  databaseUrl: string;
  dbPoolMax: number;
  portalAuthMode: PortalAuthMode;
  portalBaseUrl: string;
  portalClientId: string;
  portalClientSecret: string;
  portalAllowedRedirectUri: string;
  portalTimeoutMs: number;
  sessionTtlSeconds: number;
  identityRecheckSeconds: number;
  uploadDir: string;
  maxAvatarBytes: number;
  maxUploadBytes: number;
  maxSubmissionBytes: number;
  maxSubmissionFiles: number;
  storageQuotaBytes: number;
  allowHeadBootstrap: boolean;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getConfig(): AppConfig {
  const rawEnv = (process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
  const appEnv: AppEnv =
    rawEnv === "production"
      ? "production"
      : rawEnv === "preview"
        ? "preview"
        : rawEnv === "test"
          ? "test"
          : "development";

  const databaseUrl =
    process.env.DATABASE_URL ||
    (appEnv === "test"
      ? "pglite://memory"
      : appEnv === "preview"
        ? "pglite:///tmp/tnth-work-pglite"
        : "pglite://./.data/pglite");

  const portalAuthMode = (process.env.PORTAL_AUTH_MODE ||
    (appEnv === "production" ? "sso" : "mock")) as PortalAuthMode;

  // Ràng buộc an toàn production theo mục 4.2 & 15.3:
  // Khi APP_ENV=production (hoặc không đặt APP_ENV mà NODE_ENV=production), cấm tuyệt đối mock auth và pglite.
  // Chỉ chế độ preview tường minh (APP_ENV=preview) mới được chạy bản xem thử có dữ liệu mẫu.
  if (appEnv === "production") {
    if (portalAuthMode === "mock") {
      throw new Error("SECURITY_CONFIG_ERROR: PORTAL_AUTH_MODE=mock bị cấm trong môi trường production.");
    }
    if (databaseUrl.startsWith("pglite://")) {
      throw new Error("SECURITY_CONFIG_ERROR: DATABASE_URL=pglite:// bị cấm trong môi trường production.");
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("SECURITY_CONFIG_ERROR: Thiếu DATABASE_URL trong môi trường production.");
    }
    if (!process.env.PORTAL_CLIENT_SECRET || process.env.PORTAL_CLIENT_SECRET === "replace-in-production") {
      throw new Error("SECURITY_CONFIG_ERROR: Thiếu PORTAL_CLIENT_SECRET hợp lệ trong môi trường production.");
    }
  }

  const uploadDirRaw = process.env.UPLOAD_DIR || "./uploads";
  const uploadDir = path.isAbsolute(uploadDirRaw)
    ? uploadDirRaw
    : path.resolve(process.cwd(), uploadDirRaw);

  return {
    appEnv,
    appUrl: process.env.APP_URL || "http://localhost:3001",
    databaseUrl,
    dbPoolMax: intEnv("DB_POOL_MAX", 5),
    portalAuthMode,
    portalBaseUrl: process.env.PORTAL_BASE_URL || "https://thanhnientruonghoc.io.vn",
    portalClientId: process.env.PORTAL_CLIENT_ID || "tnth-work-local",
    portalClientSecret: process.env.PORTAL_CLIENT_SECRET || "",
    portalAllowedRedirectUri:
      process.env.PORTAL_ALLOWED_REDIRECT_URI || "http://localhost:3001/auth/callback",
    portalTimeoutMs: intEnv("PORTAL_TIMEOUT_MS", 5000),
    sessionTtlSeconds: intEnv("SESSION_TTL_SECONDS", 7 * 24 * 60 * 60),
    identityRecheckSeconds: intEnv("IDENTITY_RECHECK_SECONDS", 300),
    uploadDir,
    maxAvatarBytes: intEnv("MAX_AVATAR_BYTES", 5 * 1024 * 1024),
    maxUploadBytes: intEnv("MAX_UPLOAD_BYTES", 50 * 1024 * 1024),
    maxSubmissionBytes: intEnv("MAX_SUBMISSION_BYTES", 100 * 1024 * 1024),
    maxSubmissionFiles: intEnv("MAX_SUBMISSION_FILES", 20),
    storageQuotaBytes: intEnv("STORAGE_QUOTA_BYTES", 5 * 1024 * 1024 * 1024),
    allowHeadBootstrap: process.env.ALLOW_HEAD_BOOTSTRAP === "true",
  };
}
