#!/usr/bin/env node
/**
 * Kiểm thử khói (HTTP smoke test) trên server đang chạy ở cổng 3001 (hoặc PORT truyền vào):
 * - Kiểm tra /api/v1/health/live và /api/v1/health/ready
 * - Kiểm tra chặn truy cập 401 khi chưa đăng nhập
 * - Kiểm tra chặn tài khoản chưa được cấp quyền (403) và tài khoản nguồn bị khóa (403)
 * - Đăng nhập mock Trưởng Ban (1001) -> kiểm tra dashboard, missions, members, kpi, bottlenecks, regulations, approvals, xuất Excel (.xlsx)
 */

const baseUrl = process.argv[2] || "http://127.0.0.1:3001";

function assert(cond, msg) {
  if (!cond) throw new Error(`SMOKE_FAIL: ${msg}`);
}

async function main() {
  // 1. Health endpoints
  const live = await fetch(`${baseUrl}/api/v1/health/live`);
  assert(live.status === 200, `/health/live returned ${live.status}`);
  const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
  assert(ready.status === 200, `/health/ready returned ${ready.status}`);

  // 2. Unauthenticated blocked with 401
  const unauth = await fetch(`${baseUrl}/api/v1/missions`);
  assert(unauth.status === 401, `Unauthenticated /missions returned ${unauth.status}`);

  // 3. Unassigned portal account (2001) & DISABLED account (2004) rejected with 403
  const denied1 = await fetch(`${baseUrl}/api/v1/auth/mock-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalAccountId: "2001" }),
  });
  assert(denied1.status === 403, `Unassigned 2001 expected 403, got ${denied1.status}`);

  const denied2 = await fetch(`${baseUrl}/api/v1/auth/mock-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalAccountId: "2004" }),
  });
  assert(denied2.status === 403, `Disabled 2004 expected 403, got ${denied2.status}`);

  // 4. Login as HEAD (1001)
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/mock-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalAccountId: "1001" }),
  });
  assert(loginRes.status === 200, `Login 1001 expected 200, got ${loginRes.status}`);
  const setCookie = loginRes.headers.get("set-cookie") || "";
  const cookiePair = setCookie.split(";")[0];
  assert(cookiePair.startsWith("tnth_work_session="), "Missing tnth_work_session cookie");

  const authHeaders = { Cookie: cookiePair };

  // 5. Verify core authenticated APIs + UI routes
  for (const ep of [
    "/api/v1/auth/me",
    "/api/v1/dashboard?allTime=true",
    "/api/v1/missions",
    "/api/v1/my-work",
    "/api/v1/members",
    "/api/v1/teams",
    "/api/v1/groups",
    "/api/v1/channels",
    "/api/v1/kpi",
    "/api/v1/bottlenecks",
    "/api/v1/regulations",
    "/api/v1/approvals",
    "/api/v1/notifications",
    "/api/v1/audit-logs",
  ]) {
    const r = await fetch(`${baseUrl}${ep}`, { headers: authHeaders });
    assert(r.status === 200, `GET ${ep} returned ${r.status}`);
  }

  // 6. Verify Excel export returns valid ZIP/XLSX magic bytes (PK..)
  const xlsxRes = await fetch(`${baseUrl}/api/v1/reports/export?allTime=true`, { headers: authHeaders });
  assert(xlsxRes.status === 200, `Excel export returned ${xlsxRes.status}`);
  const buf = Buffer.from(await xlsxRes.arrayBuffer());
  assert(buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, "Excel output is not a valid XLSX archive");

  // 7. Verify HTML pages render HTTP 200
  for (const page of ["/login", "/", "/missions", "/missions/new", "/my-work", "/members", "/reports", "/regulations", "/approvals", "/notifications", "/settings"]) {
    const r = await fetch(`${baseUrl}${page}`, { headers: authHeaders });
    assert(r.status === 200, `Page ${page} returned ${r.status}`);
  }

  console.log("ALL HTTP SMOKE CHECKS PASSED (health, auth, 401/403 guards, 14 APIs, XLSX binary, 11 UI pages).");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
