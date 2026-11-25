#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(path.join(rootDir, ".env.local"));
loadEnvFile(path.join(rootDir, ".env"));

const isDemo = process.argv.includes("--demo");
const isProd = process.env.APP_ENV === "production" || process.env.NODE_ENV === "production";

if (isDemo && isProd) {
  console.error("LỖI BẢO MẬT: Cấm chạy --demo seed trong môi trường production.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL || "pglite://./.data/pglite";

const SEED_TEAMS = [
  { code: "NOI_DUNG", name: "Tổ Xây dựng Nội dung", sort_order: 1 },
  { code: "PHONG_VIEN", name: "Tổ Phóng viên – Công tác cơ sở", sort_order: 2 },
  { code: "MEDIA", name: "Tổ Media", sort_order: 3 },
  { code: "KY_THUAT", name: "Tổ Kỹ thuật", sort_order: 4 },
  { code: "CONG_TAC_35", name: "Tổ Công tác 35", sort_order: 5 },
  { code: "VIETGENIUS", name: "Tổ VietGENIUS", sort_order: 6 },
  { code: "THAM_TRA", name: "Tổ Thẩm tra – Giám sát", sort_order: 7 },
];

const SEED_CHANNELS = [
  { code: "FB_TW_DOAN", name: "Trang cộng đồng Facebook Cổng thông tin Trung ương Đoàn TNCS Hồ Chí Minh", allow_custom_name: false, sort_order: 1 },
  { code: "FB_TNTH", name: "Trang cộng đồng Facebook Thanh niên Trường học", allow_custom_name: false, sort_order: 2 },
  { code: "IG_TNTH", name: "Trang cộng đồng Instagram Thanh niên Trường học", allow_custom_name: false, sort_order: 3 },
  { code: "TIKTOK_TNTH", name: "Trang cộng đồng TikTok Thanh niên Trường học", allow_custom_name: false, sort_order: 4 },
  { code: "FB_ANH_SAO", name: "Trang cộng đồng Facebook Ánh Sao", allow_custom_name: false, sort_order: 5 },
  { code: "WEB_TNTH", name: "Trang web Thanh niên Trường học", allow_custom_name: false, sort_order: 6 },
  { code: "FB_DOI_TTTH", name: "Trang cộng đồng Facebook Đội Công tác Truyền thông Trường học", allow_custom_name: false, sort_order: 7 },
  { code: "OTHER", name: "Khác", allow_custom_name: true, sort_order: 8 },
];

async function createDb() {
  if (databaseUrl.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const target = databaseUrl.slice("pglite://".length);
    const resolved = path.isAbsolute(target) ? target : path.resolve(rootDir, target);
    mkdirSync(path.dirname(resolved), { recursive: true });
    const db = new PGlite(resolved);
    await db.waitReady;
    return {
      query: async (sql, params = []) => (await db.query(sql, params)).rows,
      close: async () => db.close(),
    };
  }
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: databaseUrl, max: 2 });
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    close: async () => pool.end(),
  };
}

async function seedReference(db) {
  for (const t of SEED_TEAMS) {
    await db.query(
      `INSERT INTO teams (code, name, sort_order) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
      [t.code, t.name, t.sort_order],
    );
  }
  for (const c of SEED_CHANNELS) {
    await db.query(
      `INSERT INTO publication_channels (code, name, allow_custom_name, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, allow_custom_name = EXCLUDED.allow_custom_name, sort_order = EXCLUDED.sort_order`,
      [c.code, c.name, c.allow_custom_name, c.sort_order],
    );
  }
  await db.query(
    `INSERT INTO kpi_policies (version_code, completion_weight, ontime_weight)
     VALUES ('KPI-V1', 60.00, 40.00)
     ON CONFLICT (version_code) DO NOTHING`,
  );

  const defaultSettings = [
    ["approval_thresholds", { regulation_head: { DEPUTY: "ANY_ONE" }, regulation_acting: { DEPUTY: "ANY_ONE", TEAM_LEAD: "ANY_ONE" }, regulation_deputy: { HEAD: "ANY_ONE" }, promotion_head: { TEAM_LEAD: "ALL" } }],
    ["sla_minutes", { FLASH: 30, VERY_URGENT: 120, URGENT: 360, NORMAL: 1440, APPROVAL_HOURS: 72 }],
    ["reminder_offsets_minutes", { FLASH: [30, 10], VERY_URGENT: [120, 30], URGENT: [360, 60], NORMAL: [1440, 120] }],
  ];
  for (const [key, value] of defaultSettings) {
    await db.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)],
    );
  }
  console.log("Đã nạp dữ liệu tham chiếu (7 tổ, 8 kênh đăng tải, KPI policy 60/40, cấu hình SLA mặc định).");
}

async function seedDemo(db) {
  const demoMembers = [
    { code: "BBT-001", extId: "1001", username: "truongban.bbt", name: "Nguyễn Minh Quân", role: "HEAD", primaryTeam: "NOI_DUNG", teamTitle: "MEMBER", org: "Trung ương Đoàn TNCS Hồ Chí Minh", email: "quan.bbt@demo.local", joinedOn: "2024-01-10" },
    { code: "BBT-002", extId: "1002", username: "quyentruongban.bbt", name: "Trần Thảo Vy", role: "ACTING_HEAD", primaryTeam: "NOI_DUNG", teamTitle: "MEMBER", org: "Học viện Báo chí và Tuyên truyền", email: "vy.bbt@demo.local", joinedOn: "2024-03-15" },
    { code: "BBT-003", extId: "1003", username: "phoban.bbt", name: "Lê Hoàng Nam", role: "DEPUTY", primaryTeam: "MEDIA", teamTitle: "MEMBER", org: "ĐH Khoa học Xã hội & Nhân văn", email: "nam.bbt@demo.local", joinedOn: "2024-02-01" },
    { code: "BBT-004", extId: "1004", username: "truongto.noidung", name: "Phạm Lan Anh", role: "TEAM_LEAD", primaryTeam: "NOI_DUNG", teamTitle: "LEADER", org: "ĐH Ngoại thương", email: "lananh.bbt@demo.local", joinedOn: "2024-05-01" },
    { code: "BBT-005", extId: "1005", username: "truongto.media", name: "Đỗ Gia Huy", role: "TEAM_LEAD", primaryTeam: "MEDIA", teamTitle: "LEADER", org: "ĐH FPT", email: "giahuy.bbt@demo.local", joinedOn: "2024-05-10" },
    { code: "BBT-006", extId: "1006", username: "truongto.kythuat", name: "Vũ Đức Anh", role: "TEAM_LEAD", primaryTeam: "KY_THUAT", teamTitle: "LEADER", org: "ĐH Bách khoa Hà Nội", email: "ducanh.bbt@demo.local", joinedOn: "2024-06-01" },
    { code: "BBT-007", extId: "1007", username: "mem.noidung1", name: "Bùi Khánh Linh", role: "MEMBER", primaryTeam: "NOI_DUNG", secondaryTeams: ["PHONG_VIEN"], teamTitle: "MEMBER", org: "THPT Chu Văn An", email: "khanhlinh.bbt@demo.local", joinedOn: "2025-01-12" },
    { code: "BBT-008", extId: "1008", username: "mem.media1", name: "Ngô Quang Minh", role: "MEMBER", primaryTeam: "MEDIA", secondaryTeams: ["KY_THUAT"], teamTitle: "MEMBER", org: "ĐH Kiến trúc Hà Nội", email: "quangminh.bbt@demo.local", joinedOn: "2025-02-18" },
    { code: "BBT-009", extId: "1009", username: "mem.ct35", name: "Đặng Thu Hà", role: "MEMBER", primaryTeam: "CONG_TAC_35", teamTitle: "MEMBER", org: "Học viện Ngoại giao", email: "thuha.bbt@demo.local", joinedOn: "2025-03-01" },
  ];

  const teamsRows = await db.query("SELECT id, code FROM teams");
  const teamByCode = Object.fromEntries(teamsRows.map((t) => [t.code, t.id]));
  const memberByUser = {};

  for (const m of demoMembers) {
    const existing = await db.query(
      "SELECT id FROM members WHERE provider = 'tnth' AND external_account_id = $1",
      [m.extId],
    );
    let memberId;
    if (existing[0]) {
      memberId = existing[0].id;
    } else {
      const inserted = await db.query(
        `INSERT INTO members (member_code, provider, external_account_id, username, display_name, role, access_enabled, activity_status)
         VALUES ($1, 'tnth', $2, $3, $4, $5, true, 'ACTIVE')
         RETURNING id`,
        [m.code, m.extId, m.username, m.name, m.role],
      );
      memberId = inserted[0].id;
      await db.query(
        `INSERT INTO member_profiles (
           member_id, full_name, dob, birthplace, hometown, email, phone, social_links,
           current_org, education, academic_achievements, youth_achievements, joined_on, profile_complete_at
         ) VALUES ($1, $2, '2003-05-15', 'Hà Nội', 'Hà Nội', $3, '0900000000', $4::jsonb, $5, $6::jsonb, 'Giải Khuyến khích NCKH sinh viên', 'Bằng khen BCH Trung ương Đoàn', $7, now())
         ON CONFLICT (member_id) DO NOTHING`,
        [
          memberId,
          m.name,
          m.email,
          JSON.stringify([{ platform: "Facebook", handle: `https://facebook.com/${m.username}` }]),
          m.org,
          JSON.stringify([{ period: "2021-2025", school: m.org, major: "Truyền thông / Công nghệ" }]),
          m.joinedOn,
        ],
      );
    }
    memberByUser[m.username] = memberId;

    const primaryTeamId = teamByCode[m.primaryTeam];
    if (primaryTeamId) {
      await db.query(
        `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title)
         VALUES ($1, $2, true, $3)
         ON CONFLICT DO NOTHING`,
        [memberId, primaryTeamId, m.teamTitle],
      );
    }
    for (const sec of m.secondaryTeams ?? []) {
      const secId = teamByCode[sec];
      if (secId) {
        await db.query(
          `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title)
           VALUES ($1, $2, false, 'MEMBER')
           ON CONFLICT DO NOTHING`,
          [memberId, secId],
        );
      }
    }
  }

  const headId = memberByUser["truongban.bbt"];
  const deputyId = memberByUser["phoban.bbt"];
  const leadNdId = memberByUser["truongto.noidung"];
  const leadMediaId = memberByUser["truongto.media"];
  const memNdId = memberByUser["mem.noidung1"];
  const memMediaId = memberByUser["mem.media1"];

  // Khối nhiệm vụ mẫu
  const groups = [
    { code: "KHOI-TT-T11", name: "Truyền thông tháng 11", sort_order: 1 },
    { code: "KHOI-HS3T", name: "Chiến dịch Học sinh 3 tốt 2026", sort_order: 2 },
    { code: "KHOI-DINH-KY", name: "Điểm tin định kỳ hàng tuần", sort_order: 3 },
  ];
  const groupByCode = {};
  for (const g of groups) {
    const r = await db.query(
      `INSERT INTO task_groups (code, name, sort_order, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [g.code, g.name, g.sort_order, headId],
    );
    groupByCode[g.code] = r[0].id;
  }

  // Quy chế hiện hành v1.0
  await db.query(
    `INSERT INTO regulation_versions (version_code, title, body, reason, status, effective_at, created_by, approved_at)
     VALUES (
       'QC-1.0',
       'Quy chế tổ chức và hoạt động Ban Biên tập Thanh niên Trường học',
       E'Điều 1. Phạm vi áp dụng\nQuy chế này quy định nguyên tắc phân công, tiếp nhận, nộp sản phẩm, nghiệm thu và đánh giá KPI nội bộ Ban Biên tập.\n\nĐiều 2. Cơ cấu cấp bậc\nBan Biên tập gồm 5 cấp bậc (01.01, 01.02, 02, 03, 04) và 7 tổ chuyên môn.\n\nĐiều 3. Thời hạn và nghiệm thu\nMọi nhiệm vụ phải có deadline cụ thể. Lãnh đạo tổ phụ trách trực tiếp nghiệm thu sản phẩm của thành viên trong tổ.',
       'Ban hành bản quy chế nền tảng cho hệ thống phân công',
       'APPROVED',
       now() - interval '30 days',
       $1,
       now() - interval '30 days'
     )
     ON CONFLICT (version_code) DO NOTHING`,
    [headId],
  );

  // Mission mẫu (chỉ tạo nếu chưa có)
  const existingMission = await db.query("SELECT id FROM missions WHERE code = 'NV-2026-0001'");
  if (!existingMission[0]) {
    const now = Date.now();
    const due36h = new Date(now + 36 * 3600 * 1000).toISOString();
    const due18h = new Date(now + 18 * 3600 * 1000).toISOString();
    const due5h = new Date(now + 5 * 3600 * 1000).toISOString();
    const past2h = new Date(now - 2 * 3600 * 1000).toISOString();

    const m1 = await db.query(
      `INSERT INTO missions (
         code, group_id, title, description, expected_outcome, refs, owner_id, creator_id,
         status, importance, urgency, deadline_original, deadline_current, starts_at, assigned_at, completion_mode
       ) VALUES (
         'NV-2026-0001', $1,
         'Bộ bài truyền thông Chào mừng Ngày Nhà giáo Việt Nam 20/11',
         'Xây dựng tuyến bài viết và bộ ảnh infographic tri ân thầy cô giáo trên các kênh Thanh niên Trường học.',
         '01 bài viết chuẩn văn phong Đoàn + 01 bộ thiết kế 5 slide đăng Facebook và Website.',
         $2::jsonb, $3, $3, 'IN_PROGRESS', 'KEY', 'URGENT', $4, $4, now(), now(), 'TASKS_AND_PUBLICATIONS'
       ) RETURNING id`,
      [
        groupByCode["KHOI-TT-T11"],
        JSON.stringify([{ label: "Kế hoạch truyền thông T11", url: "https://thanhnientruonghoc.io.vn" }]),
        headId,
        due36h,
      ],
    );
    const mission1Id = m1[0].id;
    await db.query("INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING", [
      mission1Id,
      teamByCode["NOI_DUNG"],
      teamByCode["MEDIA"],
    ]);

    const t1 = await db.query(
      `INSERT INTO tasks (
         mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id,
         sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status
       ) VALUES (
         $1, 'NV-2026-0001-T1', 'Biên soạn nội dung bài viết & kịch bản slide',
         'Viết bài 800-1000 chữ và khung nội dung cho 5 slide infographic.',
         'File Word/Google Docs nội dung hoàn chỉnh',
         $2, $3, $3, 1, 'INDIVIDUAL', true, 2, 'URGENT', 'KEY', $4, $4, 'IN_PROGRESS'
       ) RETURNING id`,
      [mission1Id, teamByCode["NOI_DUNG"], leadNdId, due18h],
    );
    const t2 = await db.query(
      `INSERT INTO tasks (
         mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id,
         sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status
       ) VALUES (
         $1, 'NV-2026-0001-T2', 'Thiết kế bộ 5 ảnh infographic theo bộ nhận diện',
         'Thiết kế kích thước 1080x1350 theo nội dung đã duyệt từ Tổ Nội dung.',
         'Link Canva + bộ ảnh PNG/JPG',
         $2, $3, $3, 2, 'INDIVIDUAL', true, 3, 'URGENT', 'KEY', $4, $4, 'ASSIGNED'
       ) RETURNING id`,
      [mission1Id, teamByCode["MEDIA"], leadMediaId, due36h],
    );

    await db.query("INSERT INTO task_dependencies (task_id, predecessor_task_id) VALUES ($1, $2)", [t2[0].id, t1[0].id]);
    await db.query("INSERT INTO task_supervisors (task_id, member_id) VALUES ($1, $2), ($3, $4)", [
      t1[0].id,
      deputyId,
      t2[0].id,
      deputyId,
    ]);

    await db.query(
      `INSERT INTO task_assignments (task_id, member_id, assigned_by, status, accepted_at, original_deadline, evaluation_deadline, weight)
       VALUES ($1, $2, $3, 'ACCEPTED', now(), $4, $4, 2)`,
      [t1[0].id, memNdId, headId, due18h],
    );
    await db.query(
      `INSERT INTO task_assignments (task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline, weight)
       VALUES ($1, $2, $3, 'PENDING', $4, $4, 3)`,
      [t2[0].id, memMediaId, headId, due36h],
    );

    const channels = await db.query("SELECT id, code FROM publication_channels WHERE code IN ('FB_TNTH', 'WEB_TNTH')");
    for (const ch of channels) {
      await db.query(
        `INSERT INTO mission_publication_requirements (mission_id, channel_id, required, required_count)
         VALUES ($1, $2, true, 1) ON CONFLICT DO NOTHING`,
        [mission1Id, ch.id],
      );
    }

    // Mission 2: có 1 task đã quá hạn để dashboard/bottleneck hiển thị sinh động
    const m2 = await db.query(
      `INSERT INTO missions (
         code, group_id, title, description, expected_outcome, owner_id, creator_id,
         status, importance, urgency, deadline_original, deadline_current, starts_at, assigned_at, completion_mode
       ) VALUES (
         'NV-2026-0002', $1,
         'Tổng hợp danh sách gương mặt Học sinh 3 tốt tiêu biểu tuần 4',
         'Rà soát hồ sơ nổi bật từ các tỉnh, lập danh sách giới thiệu chuyên mục.',
         'Bảng tổng hợp Excel tối thiểu 10 hồ sơ tiêu biểu.',
         $2, $3, 'IN_PROGRESS', 'KEY', 'VERY_URGENT', $4, $4, now() - interval '10 hours', now() - interval '10 hours', 'TASKS_ONLY'
       ) RETURNING id`,
      [groupByCode["KHOI-HS3T"], deputyId, headId, due5h],
    );
    await db.query("INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2)", [m2[0].id, teamByCode["NOI_DUNG"]]);
    const t3 = await db.query(
      `INSERT INTO tasks (
         mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id,
         sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status
       ) VALUES (
         $1, 'NV-2026-0002-T1', 'Tổng hợp và kiểm tra thông tin 10 hồ sơ tiêu biểu',
         'Đối chiếu minh chứng và tóm tắt thành tích từng học sinh.',
         'Bảng tổng hợp Excel',
         $2, $3, $3, 1, 'INDIVIDUAL', true, 2, 'FLASH', 'KEY', $4, $4, 'IN_PROGRESS'
       ) RETURNING id`,
      [m2[0].id, teamByCode["NOI_DUNG"], leadNdId, past2h],
    );
    await db.query(
      `INSERT INTO task_assignments (task_id, member_id, assigned_by, status, accepted_at, original_deadline, evaluation_deadline, weight)
       VALUES ($1, $2, $3, 'ACCEPTED', now() - interval '9 hours', $4, $4, 2)`,
      [t3[0].id, memNdId, deputyId, past2h],
    );

    // Lịch định kỳ mẫu
    await db.query(
      `INSERT INTO recurring_schedules (
         name, group_id, template, frequency, interval_count, day_of_week, run_time,
         deadline_offset_hours, auto_assign, starts_at, next_run_at, enabled, creator_id
       ) VALUES (
         'Bản tin điểm nhấn Thanh niên Trường học hàng tuần', $1, $2::jsonb,
         'WEEKLY', 1, 1, '08:00', 36, false, now(), now() + interval '3 days', true, $3
       )`,
      [
        groupByCode["KHOI-DINH-KY"],
        JSON.stringify({
          title: "Bản tin điểm nhấn Thanh niên Trường học tuần",
          description: "Tổng hợp 5 tin hoạt động nổi bật trong tuần từ các cơ sở Đoàn trường.",
          expectedOutcome: "01 bài tổng hợp + 01 ảnh bìa",
          ownerId: deputyId,
          importance: "NORMAL",
          completionMode: "TASKS_ONLY",
          tasks: [
            {
              title: "Biên tập 5 tin nổi bật trong tuần",
              ownerTeamId: teamByCode["NOI_DUNG"],
              ownerId: leadNdId,
              reviewerId: leadNdId,
              weight: 1,
              assigneeIds: [memNdId],
            },
          ],
        }),
        headId,
      ],
    );
  }

  console.log("Đã nạp dữ liệu demo phát triển (9 thành viên đủ 5 cấp bậc, 3 khối nhiệm vụ, 2 nhiệm vụ mẫu, quy chế QC-1.0, 1 lịch định kỳ).");
}

async function main() {
  const db = await createDb();
  try {
    await seedReference(db);
    if (isDemo) {
      await seedDemo(db);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error("Lỗi seed:", err);
  process.exit(1);
});
