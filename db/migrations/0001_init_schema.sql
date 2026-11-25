-- 0001_init_schema.sql
-- Schema khởi tạo cho Web Phân công Công việc Ban Biên tập — Thanh niên Trường học (tnth_work)
-- Tương thích PostgreSQL 16+ (và PGlite trong dev/test). Không phụ thuộc extension ngoài.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. Thành viên & Hồ sơ
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_code TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'tnth',
  external_account_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('HEAD', 'ACTING_HEAD', 'DEPUTY', 'TEAM_LEAD', 'MEMBER')),
  access_enabled BOOLEAN NOT NULL DEFAULT true,
  activity_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (activity_status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
  identity_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  role_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (provider, external_account_id)
);

-- Ràng buộc tối đa 1 HEAD và 1 ACTING_HEAD đang hiệu lực
CREATE UNIQUE INDEX uq_members_single_active_head
  ON members (role)
  WHERE role = 'HEAD' AND access_enabled = true AND archived_at IS NULL AND activity_status <> 'INACTIVE';

CREATE UNIQUE INDEX uq_members_single_active_acting_head
  ON members (role)
  WHERE role = 'ACTING_HEAD' AND access_enabled = true AND archived_at IS NULL AND activity_status <> 'INACTIVE';

CREATE INDEX idx_members_role_status ON members (role, access_enabled, activity_status);

CREATE TABLE member_profiles (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL,
  avatar_file_id UUID,
  dob DATE,
  birthplace TEXT NOT NULL DEFAULT '',
  hometown TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_org TEXT NOT NULL DEFAULT '',
  education JSONB NOT NULL DEFAULT '[]'::jsonb,
  academic_achievements TEXT NOT NULL DEFAULT 'Chưa có',
  youth_achievements TEXT NOT NULL DEFAULT 'Chưa có',
  joined_on DATE,
  profile_complete_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lịch sử chức vụ thành viên
CREATE TABLE member_role_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  old_role TEXT,
  new_role TEXT NOT NULL CHECK (new_role IN ('HEAD', 'ACTING_HEAD', 'DEPUTY', 'TEAM_LEAD', 'MEMBER')),
  reason TEXT NOT NULL DEFAULT '',
  changed_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  approval_request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tổ chuyên môn & phân tổ
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  team_title TEXT NOT NULL DEFAULT 'MEMBER' CHECK (team_title IN ('MEMBER', 'LEADER', 'DEPUTY_LEADER')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mỗi thành viên chỉ có 1 membership đang hiệu lực trên 1 tổ
CREATE UNIQUE INDEX uq_team_memberships_active_pair
  ON team_memberships (member_id, team_id)
  WHERE effective_to IS NULL;

-- Mỗi thành viên chỉ có 1 tổ chính đang hiệu lực
CREATE UNIQUE INDEX uq_team_memberships_single_primary
  ON team_memberships (member_id)
  WHERE is_primary = true AND effective_to IS NULL;

CREATE INDEX idx_team_memberships_team ON team_memberships (team_id) WHERE effective_to IS NULL;
CREATE INDEX idx_team_memberships_member ON team_memberships (member_id) WHERE effective_to IS NULL;

-- 3. Phiên đăng nhập (opaque token hash)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_member_active ON sessions (member_id, expires_at) WHERE revoked_at IS NULL;

-- 4. Khối nhiệm vụ & Nhiệm vụ định kỳ
CREATE TABLE task_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  group_id UUID NOT NULL REFERENCES task_groups(id) ON DELETE RESTRICT,
  template JSONB NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')),
  interval_count INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month SMALLINT CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year SMALLINT CHECK (month_of_year BETWEEN 1 AND 12),
  run_time TEXT NOT NULL DEFAULT '08:00',
  deadline_offset_hours INTEGER NOT NULL DEFAULT 48 CHECK (deadline_offset_hours >= 1),
  auto_assign BOOLEAN NOT NULL DEFAULT false,
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  missed_count INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  creator_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Nhiệm vụ (Missions)
CREATE TABLE missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  group_id UUID NOT NULL REFERENCES task_groups(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expected_outcome TEXT NOT NULL DEFAULT '',
  refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  creator_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'AWAITING_PUBLICATION', 'COMPLETED', 'ON_HOLD', 'CANCELLED')
  ),
  previous_status TEXT,
  importance TEXT NOT NULL DEFAULT 'NORMAL' CHECK (importance IN ('KEY', 'NORMAL')),
  urgency TEXT NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('FLASH', 'VERY_URGENT', 'URGENT', 'NORMAL')),
  urgency_override_reason TEXT,
  deadline_original TIMESTAMPTZ NOT NULL,
  deadline_current TIMESTAMPTZ NOT NULL,
  starts_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  completion_mode TEXT NOT NULL DEFAULT 'TASKS_ONLY' CHECK (
    completion_mode IN ('TASKS_ONLY', 'TASKS_AND_PUBLICATIONS', 'PUBLICATIONS_ONLY')
  ),
  completion_mode_reason TEXT,
  schedule_id UUID REFERENCES recurring_schedules(id) ON DELETE RESTRICT,
  occurrence_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  hold_until TIMESTAMPTZ,
  hold_reason TEXT,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_missions_schedule_occurrence
  ON missions (schedule_id, occurrence_at)
  WHERE schedule_id IS NOT NULL AND occurrence_at IS NOT NULL;

CREATE INDEX idx_missions_group_status_deadline ON missions (group_id, status, deadline_current);
CREATE INDEX idx_missions_status_deadline ON missions (status, deadline_current);
CREATE INDEX idx_missions_owner ON missions (owner_id);

CREATE TABLE mission_teams (
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  PRIMARY KEY (mission_id, team_id)
);

-- 6. Task & Phân công cá nhân (Assignments)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  deliverable TEXT NOT NULL DEFAULT '',
  requires_artifact BOOLEAN NOT NULL DEFAULT true,
  owner_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  reviewer_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  submission_mode TEXT NOT NULL DEFAULT 'INDIVIDUAL' CHECK (submission_mode IN ('INDIVIDUAL', 'SHARED')),
  required BOOLEAN NOT NULL DEFAULT true,
  weight NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0),
  urgency TEXT NOT NULL DEFAULT 'NORMAL' CHECK (urgency IN ('FLASH', 'VERY_URGENT', 'URGENT', 'NORMAL')),
  importance TEXT NOT NULL DEFAULT 'NORMAL' CHECK (importance IN ('KEY', 'NORMAL')),
  deadline_original TIMESTAMPTZ NOT NULL,
  deadline_current TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (
    status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUIRED', 'COMPLETED', 'ON_HOLD', 'CANCELLED')
  ),
  previous_status TEXT,
  hold_until TIMESTAMPTZ,
  hold_reason TEXT,
  cancel_reason TEXT,
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_mission ON tasks (mission_id, sort_order);
CREATE INDEX idx_tasks_team_status_deadline ON tasks (owner_team_id, status, deadline_current);

CREATE TABLE task_supervisors (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, member_id)
);

CREATE TABLE task_collaborating_teams (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, team_id)
);

CREATE TABLE task_dependencies (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  predecessor_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, predecessor_task_id),
  CHECK (task_id <> predecessor_task_id)
);

CREATE TABLE task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL DEFAULT 'ASSIGNEE' CHECK (assignment_role IN ('ASSIGNEE', 'LEAD')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'SUBMITTED', 'REVISION_REQUIRED', 'COMPLETED', 'TRANSFERRED', 'CANCELLED')
  ),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  deadline_override TIMESTAMPTZ,
  original_deadline TIMESTAMPTZ NOT NULL,
  evaluation_deadline TIMESTAMPTZ NOT NULL,
  late_against_original_deadline BOOLEAN NOT NULL DEFAULT false,
  weight NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0),
  submitted_at TIMESTAMPTZ,
  effective_submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES task_assignments(id) ON DELETE RESTRICT,
  transfer_from UUID REFERENCES task_assignments(id) ON DELETE RESTRICT,
  transfer_reason TEXT,
  exclusion_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Một tài khoản chỉ có 1 assignment đang hiệu lực trên cùng task
CREATE UNIQUE INDEX uq_task_assignments_active_pair
  ON task_assignments (task_id, member_id)
  WHERE status NOT IN ('TRANSFERRED', 'CANCELLED', 'DECLINED');

CREATE INDEX idx_task_assignments_member_status ON task_assignments (member_id, status, evaluation_deadline);
CREATE INDEX idx_task_assignments_task ON task_assignments (task_id, status);

-- 7. Kho tệp private & Sản phẩm nộp & Nghiệm thu
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  private_storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  relative_path TEXT,
  safe_mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  uploader_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL DEFAULT 'SUBMISSION' CHECK (purpose IN ('AVATAR', 'SUBMISSION', 'MISSION_ATTACHMENT', 'COMMENT', 'REGULATION')),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('PENDING', 'ACTIVE', 'ORPHANED', 'DELETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_uploader ON files (uploader_id, created_at);

-- Gắn khóa ngoại avatar_file_id của member_profiles sau khi bảng files đã tồn tại
ALTER TABLE member_profiles
  ADD CONSTRAINT fk_member_profiles_avatar_file
  FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES task_assignments(id) ON DELETE RESTRICT,
  submitter_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_submissions_task ON submissions (task_id);
CREATE INDEX idx_submissions_assignment ON submissions (assignment_id);

CREATE TABLE submission_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE RESTRICT,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  submission_type TEXT NOT NULL DEFAULT 'LINK' CHECK (submission_type IN ('LINK', 'FILE', 'FOLDER', 'TEXT', 'MIXED')),
  note TEXT NOT NULL DEFAULT '',
  text_content TEXT NOT NULL DEFAULT '',
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (state IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REVISION_REQUIRED', 'SUPERSEDED')),
  UNIQUE (submission_id, version_no)
);

CREATE TABLE submission_contributors (
  submission_version_id UUID NOT NULL REFERENCES submission_versions(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES task_assignments(id) ON DELETE RESTRICT,
  review_confirmed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (submission_version_id, assignment_id)
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_version_id UUID NOT NULL UNIQUE REFERENCES submission_versions(id) ON DELETE RESTRICT,
  reviewer_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REVISION_REQUIRED')),
  note TEXT NOT NULL DEFAULT '',
  override_reason TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Kênh đăng tải & Link đăng tải
CREATE TABLE publication_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  allow_custom_name BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mission_publication_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  channel_id UUID NOT NULL REFERENCES publication_channels(id) ON DELETE RESTRICT,
  custom_channel_name TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  required_count INTEGER NOT NULL DEFAULT 1 CHECK (required_count >= 1),
  confirmed_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, channel_id, custom_channel_name)
);

CREATE INDEX idx_mission_pub_req_mission ON mission_publication_requirements (mission_id);

CREATE TABLE publication_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES mission_publication_requirements(id) ON DELETE RESTRICT,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  posted_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true
);

-- 9. Trao đổi theo nhiệm vụ / task
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  author_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  hidden_by UUID REFERENCES members(id) ON DELETE RESTRICT
);

CREATE INDEX idx_comments_mission ON comments (mission_id, created_at);

-- 10. Quy chế & Phê duyệt đồng xác nhận
CREATE TABLE regulation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  previous_id UUID REFERENCES regulation_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

-- Liên kết file với đúng 1 đối tượng cha (không polymorphic ID không kiểm tra)
CREATE TABLE file_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  submission_version_id UUID REFERENCES submission_versions(id) ON DELETE CASCADE,
  mission_id UUID REFERENCES missions(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  regulation_version_id UUID REFERENCES regulation_versions(id) ON DELETE CASCADE,
  member_id UUID REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (CASE WHEN submission_version_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN mission_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN comment_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN regulation_version_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN member_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX idx_file_links_file ON file_links (file_id);
CREATE INDEX idx_file_links_sub_ver ON file_links (submission_version_id) WHERE submission_version_id IS NOT NULL;
CREATE INDEX idx_file_links_mission ON file_links (mission_id) WHERE mission_id IS NOT NULL;

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('REGULATION_AMENDMENT', 'ROLE_PROMOTION_HEAD')),
  proposer_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL,
  policy_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY_TO_APPLY', 'APPLIED', 'REJECTED', 'CANCELLED', 'STALE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_approval_requests_status ON approval_requests (status, created_at);

CREATE TABLE approval_eligible_voters (
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  required_group TEXT NOT NULL CHECK (required_group IN ('HEAD', 'DEPUTY', 'TEAM_LEAD')),
  PRIMARY KEY (request_id, member_id)
);

CREATE TABLE approval_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  reason TEXT NOT NULL DEFAULT '',
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, member_id)
);

-- 11. Yêu cầu phân quyền quản trị cổng thông tin nguồn
CREATE TABLE portal_permission_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  requested_permissions JSONB NOT NULL,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  requested_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  external_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'FAILED', 'REVOKED')),
  resolved_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  evidence TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. KPI Policies, Periods & Results
CREATE TABLE kpi_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code TEXT NOT NULL UNIQUE,
  completion_weight NUMERIC(5,2) NOT NULL CHECK (completion_weight >= 0 AND completion_weight <= 100),
  ontime_weight NUMERIC(5,2) NOT NULL CHECK (ontime_weight >= 0 AND ontime_weight <= 100),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completion_weight + ontime_weight = 100)
);

CREATE TABLE kpi_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  policy_id UUID NOT NULL REFERENCES kpi_policies(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FINALIZED')),
  revision INTEGER NOT NULL DEFAULT 1,
  finalized_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  finalized_at TIMESTAMPTZ,
  reopen_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE TABLE kpi_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES kpi_periods(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1,
  eligible_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
  completed_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
  ontime_weight NUMERIC(10,2) NOT NULL DEFAULT 0,
  completion_rate NUMERIC(6,2),
  ontime_rate NUMERIC(6,2),
  score NUMERIC(6,2),
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_id, member_id, revision)
);

-- 13. Thông báo, lịch sử deadline, timeline hoạt động, audit & jobs
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '/',
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_notifications_recipient_dedupe
  ON notifications (recipient_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (recipient_id, read_at, created_at DESC);

CREATE TABLE deadline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES missions(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES task_assignments(id) ON DELETE RESTRICT,
  old_deadline TIMESTAMPTZ NOT NULL,
  new_deadline TIMESTAMPTZ NOT NULL,
  previous_evaluation_deadline TIMESTAMPTZ,
  reason TEXT NOT NULL,
  approved_exception BOOLEAN NOT NULL DEFAULT false,
  changed_by UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES missions(id) ON DELETE RESTRICT,
  task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES task_assignments(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_logs_mission ON activity_logs (mission_id, created_at DESC);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  safe_diff JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_run_state ON jobs (state, run_at);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_id, action, key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);
