import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phân công Công việc — Ban Biên tập Thanh niên Trường học",
  description: "Hệ thống quản lý, giao việc, nộp sản phẩm, nghiệm thu và thống kê KPI nội bộ Ban Biên tập Thanh niên Trường học.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
