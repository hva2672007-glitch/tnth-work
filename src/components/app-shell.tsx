"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  BookOpenCheck,
  Briefcase,
  CheckSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { ROLE_LABELS, type MemberRole } from "@/lib/constants";
import { RoleBadge } from "@/components/badges";

export interface SessionActor {
  memberId: string;
  memberCode: string;
  provider?: string;
  externalAccountId: string;
  username: string;
  displayName: string;
  role: MemberRole;
  accessEnabled: boolean;
  activityStatus: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
  leadTeamIds: string[];
  teamIds: string[];
  memberships: { teamId: string; teamCode: string; teamName: string; isPrimary: boolean; teamTitle: string }[];
}

export interface SessionCapabilities {
  canCreateMission: boolean;
  canManageTeams: boolean;
  canManageGroups: boolean;
  canManageChannels: boolean;
  canGrantAccess: boolean;
  canSearchPortal: boolean;
  canRequestPortalPerms: boolean;
  canProposeRegulation: boolean;
  canPromoteHead: boolean;
  canFinalizeKpi: boolean;
  canViewAudit: boolean;
  canManageSettings: boolean;
}

interface AuthContextValue {
  actor: SessionActor | null;
  capabilities: SessionCapabilities | null;
  authMode: string;
  loading: boolean;
  unreadNotifications: number;
  refreshAuth: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  actor: null,
  capabilities: null,
  authMode: "mock",
  loading: true,
  unreadNotifications: 0,
  refreshAuth: async () => {},
  refreshNotifications: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const NAV_ITEMS = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard, match: (p: string) => p === "/" },
  { href: "/missions", label: "Nhiệm vụ", icon: Briefcase, match: (p: string) => p.startsWith("/missions") },
  { href: "/my-work", label: "Việc của tôi", icon: CheckSquare, match: (p: string) => p.startsWith("/my-work") },
  { href: "/members", label: "Thành viên", icon: Users, match: (p: string) => p.startsWith("/members") },
  { href: "/reports", label: "KPI & báo cáo", icon: BarChart3, match: (p: string) => p.startsWith("/reports") },
  {
    href: "/regulations",
    label: "Quy chế",
    icon: BookOpenCheck,
    match: (p: string) => p.startsWith("/regulations") || p.startsWith("/approvals"),
  },
  { href: "/settings", label: "Cài đặt", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [capabilities, setCapabilities] = useState<SessionCapabilities | null>(null);
  const [authMode, setAuthMode] = useState("mock");
  const [loading, setLoading] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refreshAuth = useCallback(async () => {
    try {
      const data = await apiFetch<{
        authenticated: boolean;
        authMode: string;
        actor: SessionActor | null;
        capabilities?: SessionCapabilities;
      }>("/api/v1/auth/me");
      setAuthMode(data.authMode);
      if (!data.authenticated || !data.actor) {
        setActor(null);
        setCapabilities(null);
        router.replace("/login");
        return;
      }
      setActor(data.actor);
      setCapabilities(data.capabilities ?? null);
    } catch {
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await apiFetch<{ unreadCount: number }>("/api/v1/notifications?unreadOnly=true");
      setUnreadNotifications(data.unreadCount);
    } catch {
      // ignore transient polling failure
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void refreshAuth();
    });
    return () => {
      active = false;
    };
  }, [refreshAuth]);

  // Polling 15 giây cho chuông thông báo khi tab đang active, dừng khi tab hidden (mục 9)
  useEffect(() => {
    if (!actor) return;
    let active = true;
    Promise.resolve().then(() => {
      if (active) void refreshNotifications();
    });

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (document.visibilityState === "visible") {
          void refreshNotifications();
        }
      }, 15_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshNotifications();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [actor, refreshNotifications]);

  const handleLogout = async () => {
    await apiFetch("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-sm text-slate-600">Đang xác thực phiên làm việc...</p>
        </div>
      </div>
    );
  }

  if (!actor) return null;

  return (
    <AuthContext.Provider
      value={{ actor, capabilities, authMode, loading, unreadNotifications, refreshAuth, refreshNotifications }}
    >
      <div className="flex min-h-screen bg-slate-50">
        {/* Mobile Drawer Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Sidebar 7 mục chính */}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
            <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white shadow-sm">
                TN
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold text-slate-900">Ban Biên tập TNTH</div>
                <div className="text-[11px] text-slate-500">Phân công nội bộ</div>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Đóng menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-blue-600" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-3">
            {authMode === "mock" && (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                Chế độ DEV MOCK — tài khoản nguồn giả lập
              </div>
            )}
            <div className="rounded-lg bg-slate-50 p-2.5">
              <div className="truncate text-xs font-semibold text-slate-900">{actor.displayName}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <RoleBadge role={actor.role} />
                <span className="truncate text-[11px] text-slate-500">{actor.memberCode}</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-slate-500">{ROLE_LABELS[actor.role].name}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-3.5 w-3.5" />
              Đăng xuất
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Mở menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="hidden text-sm font-medium text-slate-600 sm:block">
                Cổng phân công nội bộ · Ban Biên tập Thanh niên Trường học
              </div>
            </div>

            <div className="flex items-center gap-3">
              {capabilities?.canCreateMission && (
                <Link
                  href="/missions/new"
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 sm:text-sm"
                >
                  + Giao nhiệm vụ
                </Link>
              )}
              <Link
                href="/notifications"
                className="relative rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Thông báo"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                )}
              </Link>
              <Link
                href={`/members/${actor.memberId}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700"
                title={actor.displayName}
              >
                {actor.displayName.split(" ").slice(-1)[0]?.[0] ?? "U"}
              </Link>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </AuthContext.Provider>
  );
}
