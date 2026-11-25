"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/components/app-shell";
import { formatVnDateTime } from "@/lib/date";

interface NotificationRow {
  id: string;
  eventType: string;
  title: string;
  message: string;
  link: string;
  createdAt: string;
  readAt: string | null;
}

export default function NotificationsPage() {
  const { refreshNotifications } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: NotificationRow[] }>("/api/v1/notifications");
      setItems(res.items);
      await refreshNotifications();
    } finally {
      setLoading(false);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const markRead = async (id: string) => {
    await apiFetch(`/api/v1/notifications/${id}/read`, { method: "PATCH" }).catch(() => {});
    await load();
  };

  const markAll = async () => {
    await apiFetch("/api/v1/notifications", { method: "POST" }).catch(() => {});
    await load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Thông báo</h1>
          <p className="text-sm text-slate-500">Cập nhật giao việc, nhắc deadline, nghiệm thu và phê duyệt</p>
        </div>
        <button
          type="button"
          onClick={() => void markAll()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CheckCheck className="h-4 w-4" /> Đánh dấu tất cả đã đọc
        </button>
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Đang tải thông báo...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            <Bell className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            Bạn chưa có thông báo nào.
          </div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              className={`flex items-start justify-between gap-3 p-4 ${n.readAt ? "bg-white" : "bg-blue-50/50"}`}
            >
              <Link
                href={n.link}
                onClick={() => {
                  if (!n.readAt) void markRead(n.id);
                }}
                className="flex-1"
              >
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                  <span className="text-sm font-semibold text-slate-900">{n.title}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{n.message}</p>
                <div className="mt-1 text-[11px] text-slate-400">{formatVnDateTime(n.createdAt)}</div>
              </Link>
              {!n.readAt && (
                <button
                  type="button"
                  onClick={() => void markRead(n.id)}
                  className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
                >
                  Đã đọc
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
