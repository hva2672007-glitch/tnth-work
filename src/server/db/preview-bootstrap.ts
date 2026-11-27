import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { SEED_CHANNELS, SEED_TEAMS } from "@/lib/constants";

/**
 * Tự động khởi tạo schema + áp dụng toàn bộ SQL migrations + dữ liệu mẫu cho chế độ APP_ENV=preview (VD Render free preview).
 * KHÔNG BAO GIỜ chạy trong APP_ENV=production (bị chặn tại src/server/config.ts).
 */
export async function bootstrapPreviewPglite(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const appliedRows = (await db.query<{ version: string }>(`SELECT version FROM schema_migrations`)).rows;
  const applied = new Set(appliedRows.map((r) => r.version));

  const migrationsDir = path.resolve(process.cwd(), "db", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
    await db.query(`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, [file]);
  }

  const memberCount = await db.query<{ c: string }>(`SELECT count(*)::text AS c FROM members`);
  if (Number(memberCount.rows[0]?.c ?? 0) > 0) return;

  for (const t of SEED_TEAMS) {
    await db.query(
      `INSERT INTO teams (code, name, sort_order) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
      [t.code, t.name, t.sort_order],
    );
  }
  for (const c of SEED_CHANNELS) {
    await db.query(
      `INSERT INTO publication_channels (code, name, allow_custom_name, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
      [c.code, c.name, c.allow_custom_name, c.sort_order],
    );
  }
  await db.query(
    `INSERT INTO kpi_policies (version_code, completion_weight, ontime_weight) VALUES ('KPI-V1', 60.00, 40.00) ON CONFLICT (version_code) DO NOTHING`,
  );

  const defaultSettings = [
    ["approval_thresholds", { regulation_head: { DEPUTY: "ANY_ONE" }, regulation_acting: { DEPUTY: "ANY_ONE", TEAM_LEAD: "ANY_ONE" }, regulation_deputy: { HEAD: "ANY_ONE" }, promotion_head: { TEAM_LEAD: "ALL" } }],
    ["sla_minutes", { FLASH: 30, VERY_URGENT: 120, URGENT: 360, NORMAL: 1440, APPROVAL_HOURS: 72 }],
    ["reminder_offsets_minutes", { FLASH: [30, 10], VERY_URGENT: [120, 30], URGENT: [360, 60], NORMAL: [1440, 120] }],
  ] as const;
  for (const [key, value] of defaultSettings) {
    await db.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(value)],
    );
  }

  const teamsRows = (await db.query<{ id: string; code: string }>(`SELECT id, code FROM teams`)).rows;
  const teamByCode = Object.fromEntries(teamsRows.map((t) => [t.code, t.id]));

  const demoMembers = [
    { code: "BBT-001", extId: "1001", username: "truongban.bbt", name: "Nguyễn Minh Quân", role: "HEAD", primaryTeam: "NOI_DUNG", teamTitle: "MEMBER", org: "Trung ương Đoàn TNCS Hồ Chí Minh", email: "quan.bbt@demo.local", joinedOn: "2024-01-10" },
    { code: "BBT-002", extId: "1002", username: "quyentruongban.bbt", name: "Trần Thảo Vy", role: "ACTING_HEAD", primaryTeam: "NOI_DUNG", teamTitle: "MEMBER", org: "Học viện Báo chí và Tuyên truyền", email: "vy.bbt@demo.local", joinedOn: "2024-03-15" },
    { code: "BBT-010", extId: "1010", username: "phoban.thamtra", name: "Lý Bảo Khánh", role: "DEPUTY_INSPECTOR", primaryTeam: "THAM_TRA", teamTitle: "LEADER", org: "Ban Biên tập Thanh niên Trường học", email: "khanh.thamtra@demo.local", joinedOn: "2024-01-20" },
    { code: "BBT-003", extId: "1003", username: "phoban.bbt", name: "Lê Hoàng Nam", role: "DEPUTY", primaryTeam: "MEDIA", teamTitle: "MEMBER", org: "ĐH Khoa học Xã hội & Nhân văn", email: "nam.bbt@demo.local", joinedOn: "2024-02-01" },
    { code: "BBT-004", extId: "1004", username: "truongto.noidung", name: "Phạm Lan Anh", role: "TEAM_LEAD", primaryTeam: "NOI_DUNG", teamTitle: "LEADER", org: "ĐH Ngoại thương", email: "lananh.bbt@demo.local", joinedOn: "2024-05-01" },
    { code: "BBT-005", extId: "1005", username: "truongto.media", name: "Đỗ Gia Huy", role: "TEAM_LEAD", primaryTeam: "MEDIA", teamTitle: "LEADER", org: "ĐH FPT", email: "giahuy.bbt@demo.local", joinedOn: "2024-05-10" },
    { code: "BBT-006", extId: "1006", username: "truongto.kythuat", name: "Vũ Đức Anh", role: "TEAM_LEAD", primaryTeam: "KY_THUAT", teamTitle: "LEADER", org: "ĐH Bách khoa Hà Nội", email: "ducanh.bbt@demo.local", joinedOn: "2024-06-01" },
    { code: "BBT-011", extId: "1011", username: "photo.noidung", name: "Nguyễn Hà Trang", role: "TEAM_DEPUTY", primaryTeam: "NOI_DUNG", teamTitle: "DEPUTY_LEADER", org: "ĐH Kinh tế Quốc dân", email: "hatrang.bbt@demo.local", joinedOn: "2024-07-01" },
    { code: "BBT-007", extId: "1007", username: "mem.noidung1", name: "Bùi Khánh Linh", role: "MEMBER", primaryTeam: "NOI_DUNG", secondaryTeams: ["PHONG_VIEN"], teamTitle: "MEMBER", org: "THPT Chu Văn An", email: "khanhlinh.bbt@demo.local", joinedOn: "2025-01-12" },
    { code: "BBT-008", extId: "1008", username: "mem.media1", name: "Ngô Quang Minh", role: "MEMBER", primaryTeam: "MEDIA", secondaryTeams: ["KY_THUAT"], teamTitle: "MEMBER", org: "ĐH Kiến trúc Hà Nội", email: "quangminh.bbt@demo.local", joinedOn: "2025-02-18" },
    { code: "BBT-009", extId: "1009", username: "mem.ct35", name: "Đặng Thu Hà", role: "MEMBER", primaryTeam: "CONG_TAC_35", teamTitle: "MEMBER", org: "Học viện Ngoại giao", email: "thuha.bbt@demo.local", joinedOn: "2025-03-01" },
    { code: "BBT-012", extId: "1012", username: "mem.thamtra1", name: "Trịnh Minh Khôi", role: "MEMBER", primaryTeam: "THAM_TRA", teamTitle: "MEMBER", org: "ĐH Luật Hà Nội", email: "minhkhoi.bbt@demo.local", joinedOn: "2025-03-15" },
    { code: "BBT-013", extId: "1013", username: "ctv.media1", name: "Phan Gia Bảo", role: "COLLABORATOR", primaryTeam: "MEDIA", teamTitle: "MEMBER", org: "Cộng tác viên thiết kế", email: "giabao.ctv@demo.local", joinedOn: "2025-09-01" },
    { code: "BBT-014", extId: "1014", username: "chuyenvien.twdoan", name: "Đ/c Nguyễn Thanh Tùng (TW Đoàn)", role: "OBSERVER", primaryTeam: "NOI_DUNG", teamTitle: "MEMBER", org: "Ban Công tác Thanh thiếu nhi TW Đoàn", email: "tung.twdoan@demo.local", joinedOn: "2024-01-01" },
  ];

  const memberByUser: Record<string, string> = {};
  for (const m of demoMembers) {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO members (member_code, provider, external_account_id, username, display_name, role, access_enabled, activity_status)
       VALUES ($1, 'tnth', $2, $3, $4, $5, true, 'ACTIVE')
       RETURNING id`,
      [m.code, m.extId, m.username, m.name, m.role],
    );
    const id = ins.rows[0].id;
    memberByUser[m.username] = id;
    await db.query(
      `INSERT INTO member_profiles (
         member_id, full_name, dob, birthplace, hometown, email, phone, social_links,
         current_org, education, academic_achievements, youth_achievements, joined_on, profile_complete_at
       ) VALUES ($1, $2, '2003-05-15', 'Hà Nội', 'Hà Nội', $3, '0900000000', $4::jsonb, $5, $6::jsonb, 'Giải Khuyến khích NCKH sinh viên', 'Bằng khen BCH Trung ương Đoàn', $7, now())`,
      [
        id,
        m.name,
        m.email,
        JSON.stringify([{ platform: "Facebook", handle: `https://facebook.com/${m.username}` }]),
        m.org,
        JSON.stringify([{ period: "2021-2025", school: m.org, major: "Truyền thông / Công nghệ" }]),
        m.joinedOn,
      ],
    );
    await db.query(
      `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title) VALUES ($1, $2, true, $3)`,
      [id, teamByCode[m.primaryTeam], m.teamTitle],
    );
    for (const sec of m.secondaryTeams ?? []) {
      await db.query(
        `INSERT INTO team_memberships (member_id, team_id, is_primary, team_title) VALUES ($1, $2, false, 'MEMBER')`,
        [id, teamByCode[sec]],
      );
    }
  }

  const headId = memberByUser["truongban.bbt"];
  const deputyId = memberByUser["phoban.bbt"];
  const leadNdId = memberByUser["truongto.noidung"];
  const leadMediaId = memberByUser["truongto.media"];
  const memNdId = memberByUser["mem.noidung1"];
  const memMediaId = memberByUser["mem.media1"];

  const g1 = (await db.query<{ id: string }>(
    `INSERT INTO task_groups (code, name, sort_order, created_by) VALUES ('KHOI-TT-T11', 'Truyền thông tháng 11', 1, $1) RETURNING id`,
    [headId],
  )).rows[0].id;
  const g2 = (await db.query<{ id: string }>(
    `INSERT INTO task_groups (code, name, sort_order, created_by) VALUES ('KHOI-HS3T', 'Chiến dịch Học sinh 3 tốt 2026', 2, $1) RETURNING id`,
    [headId],
  )).rows[0].id;
  const g3 = (await db.query<{ id: string }>(
    `INSERT INTO task_groups (code, name, sort_order, created_by) VALUES ('KHOI-DINH-KY', 'Điểm tin định kỳ hàng tuần', 3, $1) RETURNING id`,
    [headId],
  )).rows[0].id;

  await db.query(
    `INSERT INTO regulation_versions (version_code, title, body, reason, status, effective_at, created_by, approved_at)
     VALUES (
       'QC-1.0',
       'Quy chế tổ chức và hoạt động Ban Biên tập Thanh niên Trường học',
       E'Điều 1. Phạm vi áp dụng\nQuy chế này quy định nguyên tắc phân công, tiếp nhận, nộp sản phẩm, nghiệm thu và đánh giá KPI nội bộ Ban Biên tập.\n\nĐiều 2. Cơ cấu cấp bậc\nBan Biên tập gồm 5 cấp bậc (01.01, 01.02, 02, 03, 04) và 7 tổ chuyên môn.\n\nĐiều 3. Thời hạn và nghiệm thu\nMọi nhiệm vụ phải có deadline cụ thể. Lãnh đạo tổ phụ trách trực tiếp nghiệm thu sản phẩm của thành viên trong tổ.',
       'Ban hành bản quy chế nền tảng',
       'APPROVED',
       now() - interval '30 days',
       $1,
       now() - interval '30 days'
     )`,
    [headId],
  );

  const now = Date.now();
  const due36h = new Date(now + 36 * 3600 * 1000).toISOString();
  const due18h = new Date(now + 18 * 3600 * 1000).toISOString();
  const due5h = new Date(now + 5 * 3600 * 1000).toISOString();
  const past2h = new Date(now - 2 * 3600 * 1000).toISOString();

  const m1 = (await db.query<{ id: string }>(
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
    [g1, JSON.stringify([{ label: "Kế hoạch truyền thông T11", url: "https://thanhnientruonghoc.io.vn" }]), headId, due36h],
  )).rows[0].id;

  await db.query(`INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2), ($1, $3)`, [m1, teamByCode["NOI_DUNG"], teamByCode["MEDIA"]]);
  const t1 = (await db.query<{ id: string }>(
    `INSERT INTO tasks (mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id, sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status)
     VALUES ($1, 'NV-2026-0001-T1', 'Biên soạn nội dung bài viết & kịch bản slide', 'Viết bài 800-1000 chữ và khung nội dung 5 slide.', 'File Word/Google Docs nội dung', $2, $3, $3, 1, 'INDIVIDUAL', true, 2, 'URGENT', 'KEY', $4, $4, 'IN_PROGRESS') RETURNING id`,
    [m1, teamByCode["NOI_DUNG"], leadNdId, due18h],
  )).rows[0].id;
  const t2 = (await db.query<{ id: string }>(
    `INSERT INTO tasks (mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id, sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status)
     VALUES ($1, 'NV-2026-0001-T2', 'Thiết kế bộ 5 ảnh infographic theo bộ nhận diện', 'Thiết kế 1080x1350 theo nội dung đã duyệt.', 'Link Canva + bộ ảnh PNG/JPG', $2, $3, $3, 2, 'INDIVIDUAL', true, 3, 'URGENT', 'KEY', $4, $4, 'ASSIGNED') RETURNING id`,
    [m1, teamByCode["MEDIA"], leadMediaId, due36h],
  )).rows[0].id;
  await db.query(`INSERT INTO task_dependencies (task_id, predecessor_task_id) VALUES ($1, $2)`, [t2, t1]);
  await db.query(`INSERT INTO task_supervisors (task_id, member_id) VALUES ($1, $2), ($3, $4)`, [t1, deputyId, t2, deputyId]);
  await db.query(`INSERT INTO task_assignments (task_id, member_id, assigned_by, status, accepted_at, original_deadline, evaluation_deadline, weight) VALUES ($1, $2, $3, 'ACCEPTED', now(), $4, $4, 2)`, [t1, memNdId, headId, due18h]);
  await db.query(`INSERT INTO task_assignments (task_id, member_id, assigned_by, status, original_deadline, evaluation_deadline, weight) VALUES ($1, $2, $3, 'PENDING', $4, $4, 3)`, [t2, memMediaId, headId, due36h]);

  const channels = (await db.query<{ id: string }>(`SELECT id FROM publication_channels WHERE code IN ('FB_TNTH', 'WEB_TNTH')`)).rows;
  for (const ch of channels) {
    await db.query(`INSERT INTO mission_publication_requirements (mission_id, channel_id, required, required_count) VALUES ($1, $2, true, 1)`, [m1, ch.id]);
  }

  const m2 = (await db.query<{ id: string }>(
    `INSERT INTO missions (code, group_id, title, description, expected_outcome, owner_id, creator_id, status, importance, urgency, deadline_original, deadline_current, starts_at, assigned_at, completion_mode)
     VALUES ('NV-2026-0002', $1, 'Tổng hợp danh sách gương mặt Học sinh 3 tốt tiêu biểu tuần 4', 'Rà soát hồ sơ nổi bật từ các tỉnh, lập danh sách giới thiệu chuyên mục.', 'Bảng tổng hợp Excel tối thiểu 10 hồ sơ.', $2, $3, 'IN_PROGRESS', 'KEY', 'VERY_URGENT', $4, $4, now() - interval '10 hours', now() - interval '10 hours', 'TASKS_ONLY') RETURNING id`,
    [g2, deputyId, headId, due5h],
  )).rows[0].id;
  await db.query(`INSERT INTO mission_teams (mission_id, team_id) VALUES ($1, $2)`, [m2, teamByCode["NOI_DUNG"]]);
  const t3 = (await db.query<{ id: string }>(
    `INSERT INTO tasks (mission_id, code, title, description, deliverable, owner_team_id, owner_id, reviewer_id, sort_order, submission_mode, required, weight, urgency, importance, deadline_original, deadline_current, status)
     VALUES ($1, 'NV-2026-0002-T1', 'Tổng hợp và kiểm tra thông tin 10 hồ sơ tiêu biểu', 'Đối chiếu minh chứng và tóm tắt thành tích.', 'Bảng tổng hợp Excel', $2, $3, $3, 1, 'INDIVIDUAL', true, 2, 'FLASH', 'KEY', $4, $4, 'IN_PROGRESS') RETURNING id`,
    [m2, teamByCode["NOI_DUNG"], leadNdId, past2h],
  )).rows[0].id;
  await db.query(`INSERT INTO task_assignments (task_id, member_id, assigned_by, status, accepted_at, original_deadline, evaluation_deadline, weight) VALUES ($1, $2, $3, 'ACCEPTED', now() - interval '9 hours', $4, $4, 2)`, [t3, memNdId, deputyId, past2h]);

  await db.query(
    `INSERT INTO recurring_schedules (name, group_id, template, frequency, interval_count, day_of_week, run_time, deadline_offset_hours, auto_assign, starts_at, next_run_at, enabled, creator_id)
     VALUES ('Bản tin điểm nhấn Thanh niên Trường học hàng tuần', $1, $2::jsonb, 'WEEKLY', 1, 1, '08:00', 36, false, now(), now() + interval '3 days', true, $3)`,
    [
      g3,
      JSON.stringify({
        title: "Bản tin điểm nhấn Thanh niên Trường học tuần",
        description: "Tổng hợp 5 tin hoạt động nổi bật trong tuần.",
        ownerId: deputyId,
        importance: "NORMAL",
        completionMode: "TASKS_ONLY",
        tasks: [{ title: "Biên tập 5 tin nổi bật trong tuần", ownerTeamId: teamByCode["NOI_DUNG"], ownerId: leadNdId, reviewerId: leadNdId, weight: 1, assigneeIds: [memNdId] }],
      }),
      headId,
    ],
  );
}
