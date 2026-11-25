-- 0002_deadline_extensions_and_local_accounts.sql
-- Bổ sung:
-- 1) Quy trình đăng ký xin dời deadline (có duyệt/từ chối và lưu dấu vết đầy đủ)
-- 2) Tài khoản nội bộ trực tiếp (provider = 'local') cho CTV / thành viên không còn Đoàn trực thuộc

-- 1. Thông tin mật khẩu băm scrypt cho tài khoản nội bộ (tách khỏi bảng members)
CREATE TABLE IF NOT EXISTS local_credentials (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES members(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_members_local_username_lower
  ON members (lower(username))
  WHERE provider = 'local' AND archived_at IS NULL;

-- 2. Đơn đăng ký xin dời deadline theo từng phân công cá nhân
CREATE TABLE IF NOT EXISTS deadline_extension_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES task_assignments(id) ON DELETE RESTRICT,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  requester_id UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  current_deadline TIMESTAMPTZ NOT NULL,
  requested_deadline TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  approved_deadline TIMESTAMPTZ,
  resolver_id UUID REFERENCES members(id) ON DELETE RESTRICT,
  resolver_note TEXT NOT NULL DEFAULT '',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (requested_deadline > current_deadline)
);

-- Mỗi phân công chỉ có tối đa 01 đơn xin dời đang chờ duyệt tại một thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS uq_deadline_ext_one_pending_per_assignment
  ON deadline_extension_requests (assignment_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_deadline_ext_mission_status
  ON deadline_extension_requests (mission_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deadline_ext_task_status
  ON deadline_extension_requests (task_id, status);
