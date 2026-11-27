import { getConfig } from "@/server/config";
import { AppError } from "@/server/errors";

export type PortalAccountStatus = "ACTIVE" | "PENDING" | "DISABLED" | "LOCKED" | "UNKNOWN";

export interface PortalIdentity {
  provider: "tnth";
  externalAccountId: string;
  username: string;
  displayName: string;
  email?: string;
  status: PortalAccountStatus;
}

export interface PortalPermissionRequestInput {
  externalAccountId: string;
  requestedPermissions: string[];
  reason: string;
  expiresAt?: string | null;
}

export interface PortalPermissionResult {
  mode: "API" | "MANUAL_FALLBACK";
  status: "PENDING" | "APPLIED" | "REJECTED" | "FAILED";
  externalRequestId?: string;
  message: string;
}

export interface PortalIdentityProvider {
  readonly mode: "mock" | "sso" | "bridge";
  exchangeCode(code: string, verifier?: string): Promise<PortalIdentity>;
  getAccountStatus(externalAccountId: string): Promise<PortalIdentity>;
  searchAccounts(query: string, cursor?: string): Promise<{ items: PortalIdentity[]; nextCursor?: string }>;
  requestPortalPermissionChange?(request: PortalPermissionRequestInput): Promise<PortalPermissionResult>;
}

/** Danh sách tài khoản mô phỏng chỉ dùng cho development/test (bao gồm tài khoản chưa cấp quyền & bị khóa) */
const MOCK_PORTAL_ACCOUNTS: PortalIdentity[] = [
  { provider: "tnth", externalAccountId: "1001", username: "truongban.bbt", displayName: "Nguyễn Minh Quân", email: "quan.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1002", username: "quyentruongban.bbt", displayName: "Trần Thảo Vy", email: "vy.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1010", username: "phoban.thamtra", displayName: "Lý Bảo Khánh", email: "khanh.thamtra@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1003", username: "phoban.bbt", displayName: "Lê Hoàng Nam", email: "nam.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1004", username: "truongto.noidung", displayName: "Phạm Lan Anh", email: "lananh.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1005", username: "truongto.media", displayName: "Đỗ Gia Huy", email: "giahuy.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1006", username: "truongto.kythuat", displayName: "Vũ Đức Anh", email: "ducanh.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1011", username: "photo.noidung", displayName: "Nguyễn Hà Trang", email: "hatrang.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1007", username: "mem.noidung1", displayName: "Bùi Khánh Linh", email: "khanhlinh.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1008", username: "mem.media1", displayName: "Ngô Quang Minh", email: "quangminh.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1009", username: "mem.ct35", displayName: "Đặng Thu Hà", email: "thuha.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1012", username: "mem.thamtra1", displayName: "Trịnh Minh Khôi", email: "minhkhoi.bbt@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1013", username: "ctv.media1", displayName: "Phan Gia Bảo", email: "giabao.ctv@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "1014", username: "chuyenvien.twdoan", displayName: "Đ/c Nguyễn Thanh Tùng (TW Đoàn)", email: "tung.twdoan@demo.local", status: "ACTIVE" },
  // Các tài khoản cổng thông tin CHƯA được cấp quyền vào Web Phân công (dùng để test tra cứu & cấp quyền / chặn truy cập)
  { provider: "tnth", externalAccountId: "2001", username: "ctv.moi1", displayName: "Hoàng Nhật Minh", email: "nhatminh@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "2002", username: "ctv.moi2", displayName: "Nguyễn Ngọc Diệp", email: "ngocdiep@demo.local", status: "ACTIVE" },
  { provider: "tnth", externalAccountId: "2003", username: "dv.chua_duyet", displayName: "Trương Văn An", email: "vanan@demo.local", status: "PENDING" },
  { provider: "tnth", externalAccountId: "2004", username: "tk.bi_khoa", displayName: "Lý Gia Bảo", email: "giabao@demo.local", status: "DISABLED" },
];

// Cho phép test unit/integration giả lập mất kết nối nguồn hoặc đổi trạng thái tài khoản nguồn
const mockStatusOverrides = new Map<string, PortalAccountStatus>();
let mockSourceDown = false;

export function setMockPortalSourceDown(down: boolean) {
  mockSourceDown = down;
}

export function setMockPortalAccountStatus(externalAccountId: string, status: PortalAccountStatus | null) {
  if (status === null) mockStatusOverrides.delete(externalAccountId);
  else mockStatusOverrides.set(externalAccountId, status);
}

export function resetMockPortalState() {
  mockSourceDown = false;
  mockStatusOverrides.clear();
}

export function listMockPortalAccounts(): PortalIdentity[] {
  return MOCK_PORTAL_ACCOUNTS.map((a) => ({
    ...a,
    status: mockStatusOverrides.get(a.externalAccountId) ?? a.status,
  }));
}

class MockPortalAdapter implements PortalIdentityProvider {
  readonly mode = "mock" as const;

  private ensureUp() {
    if (mockSourceDown) {
      throw new AppError(503, "PORTAL_UNAVAILABLE", "Không thể kết nối cổng thông tin xác thực nguồn.");
    }
  }

  async exchangeCode(code: string): Promise<PortalIdentity> {
    this.ensureUp();
    // Trong dev/test, code định dạng "mock:<externalAccountId>" hoặc "<username>"
    const key = code.startsWith("mock:") ? code.slice(5) : code;
    const found = listMockPortalAccounts().find(
      (a) => a.externalAccountId === key || a.username.toLowerCase() === key.toLowerCase(),
    );
    if (!found) {
      throw new AppError(401, "INVALID_AUTH_CODE", "Mã xác thực không hợp lệ hoặc đã hết hạn.");
    }
    return found;
  }

  async getAccountStatus(externalAccountId: string): Promise<PortalIdentity> {
    this.ensureUp();
    const found = listMockPortalAccounts().find((a) => a.externalAccountId === externalAccountId);
    if (!found) {
      return {
        provider: "tnth",
        externalAccountId,
        username: `unknown_${externalAccountId}`,
        displayName: "Tài khoản không tồn tại ở nguồn",
        status: "UNKNOWN",
      };
    }
    return found;
  }

  async searchAccounts(search: string, cursor?: string): Promise<{ items: PortalIdentity[]; nextCursor?: string }> {
    this.ensureUp();
    const q = search.trim().toLowerCase();
    const offset = Math.max(0, Number(cursor) || 0);
    const limit = 20;
    const filtered = listMockPortalAccounts().filter(
      (a) =>
        !q ||
        a.externalAccountId.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q),
    );
    const items = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? String(offset + limit) : undefined;
    return { items, nextCursor };
  }

  async requestPortalPermissionChange(): Promise<PortalPermissionResult> {
    this.ensureUp();
    // Theo mục 4.5: không tự gắn nhãn APPLIED nếu chưa có API nguồn chính thức
    return {
      mode: "MANUAL_FALLBACK",
      status: "PENDING",
      message: "Yêu cầu đã được ghi nhận ở trạng thái chờ quản trị viên cổng thông tin xác nhận thực thi.",
    };
  }
}

class HttpPortalAdapter implements PortalIdentityProvider {
  readonly mode: "sso" | "bridge";

  constructor(mode: "sso" | "bridge") {
    this.mode = mode;
  }

  private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
    const cfg = getConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.portalTimeoutMs);
    try {
      const res = await fetch(`${cfg.portalBaseUrl.replace(/\/$/, "")}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": cfg.portalClientId,
          Authorization: `Bearer ${cfg.portalClientSecret}`,
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        throw new AppError(
          res.status === 401 || res.status === 403 ? 401 : 503,
          "PORTAL_REQUEST_FAILED",
          "Không thể xác minh thông tin từ cổng thông tin nguồn.",
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, "PORTAL_UNAVAILABLE", "Không thể kết nối cổng thông tin nguồn.");
    } finally {
      clearTimeout(timer);
    }
  }

  async exchangeCode(code: string, verifier?: string): Promise<PortalIdentity> {
    const cfg = getConfig();
    return this.request<PortalIdentity>("/api/internal/sso/exchange", {
      method: "POST",
      body: JSON.stringify({
        code,
        codeVerifier: verifier,
        redirectUri: cfg.portalAllowedRedirectUri,
      }),
    });
  }

  async getAccountStatus(externalAccountId: string): Promise<PortalIdentity> {
    return this.request<PortalIdentity>(
      `/api/internal/accounts/${encodeURIComponent(externalAccountId)}/status`,
      { method: "GET" },
    );
  }

  async searchAccounts(search: string, cursor?: string): Promise<{ items: PortalIdentity[]; nextCursor?: string }> {
    const qs = new URLSearchParams({ q: search });
    if (cursor) qs.set("cursor", cursor);
    return this.request<{ items: PortalIdentity[]; nextCursor?: string }>(
      `/api/internal/accounts/search?${qs.toString()}`,
      { method: "GET" },
    );
  }

  async requestPortalPermissionChange(req: PortalPermissionRequestInput): Promise<PortalPermissionResult> {
    return this.request<PortalPermissionResult>("/api/internal/account-permissions/requests", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }
}

export function getPortalProvider(): PortalIdentityProvider {
  const cfg = getConfig();
  if (cfg.portalAuthMode === "mock") {
    return new MockPortalAdapter();
  }
  return new HttpPortalAdapter(cfg.portalAuthMode);
}
