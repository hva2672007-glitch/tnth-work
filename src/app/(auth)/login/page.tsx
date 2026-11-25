"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ShieldCheck, UserCheck } from "lucide-react";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { ROLE_LABELS, type MemberRole } from "@/lib/constants";

interface MockAccount {
  externalAccountId: string;
  username: string;
  displayName: string;
  email?: string;
  status: string;
  hasWorkAccess: boolean;
  workRole: MemberRole | null;
}

export default function LoginPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<string>("mock");
  const [accounts, setAccounts] = useState<MockAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<{ authenticated: boolean; authMode: string }>("/api/v1/auth/me");
        setAuthMode(me.authMode);
        if (me.authenticated) {
          router.replace("/");
          return;
        }
        if (me.authMode === "mock") {
          const res = await apiFetch<{ accounts: MockAccount[] }>("/api/v1/auth/mock-login");
          setAccounts(res.accounts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không thể kiểm tra trạng thái đăng nhập.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const handleMockLogin = async (externalAccountId: string) => {
    setError(null);
    setSubmittingId(externalAccountId);
    try {
      await apiFetch("/api/v1/auth/mock-login", {
        method: "POST",
        body: JSON.stringify({ externalAccountId }),
      });
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError("Đăng nhập thất bại. Vui lòng thử lại.");
      }
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white shadow">
            TN
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Web Phân công Ban Biên tập — Thanh niên Trường học
            </h1>
            <p className="text-sm text-slate-500">
              01 tài khoản thanhnientruonghoc.io.vn · Chỉ dành cho thành viên được cấp quyền nội bộ
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Đang tải cấu hình đăng nhập...</div>
        ) : authMode === "mock" ? (
          <div className="mt-6">
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Môi trường phát triển (DEV MOCK):</strong> Chọn một tài khoản cổng thông tin mô phỏng để kiểm thử
              xác thực, phân quyền 5 cấp bậc và cơ chế chặn tài khoản chưa được cấp quyền / bị khóa.
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {accounts.map((acc) => (
                <button
                  key={acc.externalAccountId}
                  type="button"
                  disabled={submittingId !== null}
                  onClick={() => handleMockLogin(acc.externalAccountId)}
                  className={`flex flex-col rounded-xl border p-3 text-left transition-all ${
                    acc.hasWorkAccess && acc.status === "ACTIVE"
                      ? "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40"
                      : "border-dashed border-slate-200 bg-slate-50 hover:border-red-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">{acc.displayName}</span>
                    {acc.workRole ? (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
                        {ROLE_LABELS[acc.workRole].code}
                      </span>
                    ) : (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                        Chưa cấp quyền
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                    <span>@{acc.username}</span>
                    <span
                      className={
                        acc.status === "ACTIVE" ? "text-emerald-700" : "font-medium text-red-600"
                      }
                    >
                      Nguồn: {acc.status}
                    </span>
                  </div>
                  {submittingId === acc.externalAccountId && (
                    <span className="mt-1 text-xs font-medium text-blue-600">Đang đăng nhập...</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-5 w-5" />
                Đăng nhập bằng tài khoản Cổng thông tin Thanh niên Trường học
              </div>
              <p className="mt-1 text-xs text-blue-800">
                Hệ thống sử dụng chung tài khoản đã đăng ký tại thanhnientruonghoc.io.vn. Không tạo mật khẩu thứ hai.
              </p>
            </div>
            <a
              href="/api/v1/auth/start"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              <UserCheck className="h-4 w-4" />
              Tiếp tục với tài khoản thanhnientruonghoc.io.vn
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
