-- 0003_v2_roles_governance_kpi.sql
-- Nâng cấp toàn diện theo Bảng mô tả web phân công (cập nhật 27/11):
-- 1) 9 cấp bậc tổ chức (01.01, 01.02, 02.01, 02.02, 03.01, 03.02, 04, 05, 06)
-- 2) Trường Đoàn viên / Đảng viên / Chức vụ Đoàn-Hội-Đội trong hồ sơ thành viên
-- 3) Sự chỉ đạo của & Mức độ mật (Thông thường / Mật / Tuyệt mật) trên nhiệm vụ; quy tắc trả lại tối đa 2 lần; task theo số liệu
-- 4) Phiếu ghi nhận thái độ (Tổ Thẩm tra - Giám sát) với ẩn danh & quy trình trình Hội đồng điều hành
-- 5) Tài liệu & Hồ sơ trình Hội đồng điều hành (hạn 5 ngày, ngưỡng 2/3, cảnh báo đỏ, kết luận cuộc họp)
-- 6) Ý tưởng/Sáng kiến chủ động, Cập nhật số liệu quy đổi KPI, Kho Data đồ họa cơ bản

-- 1. Mở rộng ràng buộc 9 cấp bậc trên members và member_role_history
DO $$
DECLARE
  c_name TEXT;
BEGIN
  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'members'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE members DROP CONSTRAINT %I', c_name);
  END LOOP;

  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'member_role_history'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%new_role%'
  LOOP
    EXECUTE format('ALTER TABLE member_role_history DROP CONSTRAINT %I', c_name);
  END LOOP;

  FOR c_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'files'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE files DROP CONSTRAINT %I', c_name);
  END LOOP;
END $$;

ALTER TABLE members
  ADD CONSTRAINT chk_members_role_v2 CHECK (
    role IN (
      'HEAD',
      'ACTING_HEAD',
      'DEPUTY_INSPECTOR',
      'DEPUTY',
      'TEAM_LEAD',
      'TEAM_DEPUTY',
      'MEMBER',
      'COLLABORATOR',
      'OBSERVER'
    )
  );

ALTER TABLE member_role_history
  ADD CONSTRAINT chk_member_role_history_new_role_v2 CHECK (
    new_role IN (
      'HEAD',
      'ACTING_HEAD',
      'DEPUTY_INSPECTOR',
      'DEPUTY',
      'TEAM_LEAD',
      'TEAM_DEPUTY',
      'MEMBER',
      'COLLABORATOR',
      'OBSERVER'
    )
  );

ALTER TABLE files
  ADD CONSTRAINT chk_files_purpose_v2 CHECK (
    purpose IN (
      'AVATAR',
      'SUBMISSION',
      'MISSION_ATTACHMENT',
      'COMMENT',
      'REGULATION',
      'CONDUCT_EVIDENCE',
      'COUNCIL_DOCUMENT',
      'INITIATIVE',
      'GRAPHIC_ASSET'
    )
  );

-- 2. Bổ sung trường Đoàn viên / Đảng viên / Chức vụ Đoàn - Hội - Đội trong member_profiles
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS is_union_member BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS union_joined_on DATE;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS is_party_member BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS party_probationary_on DATE;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS party_official_on DATE;
ALTER TABLE member_profiles ADD COLUMN IF NOT EXISTS youth_union_position TEXT NOT NULL DEFAULT '';

-- 3. Bổ sung Sự chỉ đạo của & Mức độ mật trên missions; cấu hình số liệu trên tasks; đếm số lần trả lại trên task_assignments
ALTER TABLE missions ADD COLUMN IF NOT EXISTS directive_authorities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS confidentiality TEXT NOT NULL DEFAULT 'NORMAL'
  CHECK (confidentiality IN ('NORMAL', 'CONFIDENTIAL', 'TOP_SECRET'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metric_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metric_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metric_target NUMERIC(10,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metric_points_per_unit NUMERIC(6,2) NOT NULL DEFAULT 1.00;

ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS needs_reassignment BOOLEAN NOT NULL DEFAULT false;

-- 4. Phiếu ghi nhận thái độ trong công việc (Tổ Thẩm tra - Giám sát)
CREATE TABLE IF NOT EXISTS conduct_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  subject_member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  issue_summary TEXT NOT NULL,
  evidence_text TEXT NOT NULL DEFAULT '',
  evidence_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_file_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_solution TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conduct_reports_subject ON conduct_reports (subject_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conduct_reports_reporter ON conduct_reports (reporter_id, created_at DESC);

-- 5. Tài liệu & Hồ sơ nhân sự trình Hội đồng điều hành (Bậc 01.01 - 03.02)
CREATE TABLE IF NOT EXISTS council_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  item_type TEXT NOT NULL CHECK (item_type IN ('PERSONNEL_DOSSIER', 'GENERAL_DOCUMENT')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject_member_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  inspector_proposal TEXT NOT NULL DEFAULT '',
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  opinion_deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN_FOR_OPINION' CHECK (
    status IN ('OPEN_FOR_OPINION', 'RED_ALERT', 'AWAITING_MEETING', 'COMPLETED')
  ),
  red_alert_notified_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  meeting_conclusion TEXT NOT NULL DEFAULT '',
  concluded_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_council_items_status ON council_items (status, created_at DESC);

CREATE TABLE IF NOT EXISTS council_item_reports (
  council_item_id UUID NOT NULL REFERENCES council_items(id) ON DELETE CASCADE,
  conduct_report_id UUID NOT NULL REFERENCES conduct_reports(id) ON DELETE RESTRICT,
  PRIMARY KEY (council_item_id, conduct_report_id)
);

CREATE TABLE IF NOT EXISTS council_opinions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  council_item_id UUID NOT NULL REFERENCES council_items(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  choice TEXT NOT NULL DEFAULT 'COMMENT' CHECK (choice IN ('AGREE', 'DISAGREE', 'OTHER', 'COMMENT')),
  opinion_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (council_item_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_council_opinions_item ON council_opinions (council_item_id, created_at ASC);

-- 6. Tự nộp ý tưởng, sáng kiến, sản phẩm chủ động (cộng điểm KPI khi 01.01 - 03.02 duyệt)
CREATE TABLE IF NOT EXISTS initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'INITIATIVE' CHECK (kind IN ('IDEA', 'INITIATIVE', 'PRODUCT')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  lead_member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  submitted_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  awarded_points_lead NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  awarded_points_participant NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  reviewer_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS initiative_participants (
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'PARTICIPANT' CHECK (role IN ('LEAD', 'PARTICIPANT')),
  awarded_points NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  PRIMARY KEY (initiative_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_initiatives_status ON initiatives (status, created_at DESC);

-- 7. Tự cập nhật số liệu thực hiện nhiệm vụ & tự quy đổi ra điểm KPI
CREATE TABLE IF NOT EXISTS metric_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  metric_unit TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  points_per_unit NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (points_per_unit > 0),
  computed_points NUMERIC(10,2) NOT NULL CHECK (computed_points > 0),
  evidence_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  period_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metric_logs_member_date ON metric_logs (member_id, period_date DESC);

-- 8. Kho Data đồ họa cơ bản phục vụ thiết kế sản phẩm
CREATE TABLE IF NOT EXISTS graphic_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'OTHER' CHECK (
    category IN ('LOGO', 'FRAME', 'TEMPLATE', 'BRAND_GUIDELINE', 'FONT', 'ICON', 'OTHER')
  ),
  description TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_graphic_assets_active ON graphic_assets (active, category, created_at DESC);
