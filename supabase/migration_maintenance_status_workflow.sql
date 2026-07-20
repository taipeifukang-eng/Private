-- ============================================================
-- 總務服務中心 - 維修工單狀態流程重構
-- 說明：
--   1. 主狀態改為 UNACCEPTED / ACCEPTED / PROCESSING / COMPLETED
--   2. 新增 progress_stage，將詳細處理進度從 status 分離
--   3. 新增可由後台維護的 maintenance_progress_stages
--   4. 新增 maintenance_ticket_events，保留狀態與進度歷程
--   5. 不刪除舊資料，並建立備份表供回滾參考
--
-- 執行前影響筆數查詢：
--   SELECT status, count(*) FROM maintenance_requests GROUP BY status ORDER BY status;
--   SELECT status, count(*) FROM maintenance_updates GROUP BY status ORDER BY status;
--
-- 建議回滾方向：
--   1. 優先使用 maintenance_status_migration_backup.old_request_status 還原 maintenance_requests.status
--   2. 使用 maintenance_status_migration_backup.old_update_status 還原 maintenance_updates.status
--   3. 將 maintenance_requests.progress_stage、accepted/completed 欄位保留不刪，以免遺失新流程資料
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_status_migration_backup (
  request_id           UUID PRIMARY KEY REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  old_request_status   TEXT,
  old_update_status    TEXT,
  migrated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO maintenance_status_migration_backup (request_id, old_request_status, old_update_status)
SELECT
  r.id,
  r.status,
  latest_update.status
FROM maintenance_requests r
LEFT JOIN LATERAL (
  SELECT u.status
  FROM maintenance_updates u
  WHERE u.request_id = r.id
  ORDER BY COALESCE(u.progress_date, (u.created_at AT TIME ZONE 'Asia/Taipei')::date) DESC, u.created_at DESC
  LIMIT 1
) latest_update ON true
ON CONFLICT (request_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS maintenance_progress_stages (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id)
);

INSERT INTO maintenance_progress_stages (code, name, sort_order, is_active) VALUES
  ('INITIAL_REVIEW', '初步評估', 10, true),
  ('WAITING_STORE_INFO', '等待門市補充資料', 20, true),
  ('INTERNAL_HANDLING', '總務自行處理', 30, true),
  ('SEARCHING_VENDOR', '尋找廠商', 40, true),
  ('WAITING_VENDOR_REPLY', '等待廠商回覆', 50, true),
  ('WAITING_VENDOR_QUOTE', '等待廠商報價', 60, true),
  ('QUOTE_REVIEW', '報價確認中', 70, true),
  ('VENDOR_ASSIGNED', '已安排廠商', 80, true),
  ('WAITING_VENDOR_VISIT', '等待廠商到場', 90, true),
  ('VENDOR_WORKING', '廠商施工中', 100, true),
  ('WAITING_PARTS', '等待料件', 110, true),
  ('PARTS_IN_TRANSIT', '料件配送中', 120, true),
  ('WAITING_INTERNAL_APPROVAL', '等待內部確認', 130, true),
  ('WAITING_STORE_CONFIRMATION', '處理完成待門市確認', 140, true),
  ('REOPENED', '門市反映仍有問題', 150, true),
  ('OTHER', '其他', 999, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS progress_stage TEXT REFERENCES maintenance_progress_stages(code) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_name TEXT,
  ADD COLUMN IF NOT EXISTS handling_method TEXT,
  ADD COLUMN IF NOT EXISTS vendor_id UUID,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_method TEXT,
  ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unresolved_reason TEXT;

DO $$
BEGIN
  IF to_regclass('public.ga_vendors') IS NOT NULL THEN
    ALTER TABLE maintenance_requests
      DROP CONSTRAINT IF EXISTS maintenance_requests_vendor_id_fkey;
    ALTER TABLE maintenance_requests
      ADD CONSTRAINT maintenance_requests_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES ga_vendors(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE maintenance_updates
  ADD COLUMN IF NOT EXISTS progress_stage TEXT REFERENCES maintenance_progress_stages(code) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_status_check;
ALTER TABLE maintenance_updates DROP CONSTRAINT IF EXISTS maintenance_updates_status_check;
ALTER TABLE maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_completion_method_check;
ALTER TABLE maintenance_updates DROP CONSTRAINT IF EXISTS maintenance_updates_visibility_check;

UPDATE maintenance_requests
SET status = CASE status
  WHEN 'pending' THEN 'UNACCEPTED'
  WHEN 'in_progress' THEN 'PROCESSING'
  WHEN 'completed' THEN 'COMPLETED'
  WHEN 'closed' THEN 'COMPLETED'
  ELSE status
END
WHERE status IN ('pending', 'in_progress', 'completed', 'closed');

UPDATE maintenance_updates
SET status = CASE status
  WHEN 'pending' THEN 'UNACCEPTED'
  WHEN 'in_progress' THEN 'PROCESSING'
  WHEN 'completed' THEN 'COMPLETED'
  WHEN 'closed' THEN 'COMPLETED'
  ELSE status
END
WHERE status IN ('pending', 'in_progress', 'completed', 'closed');

UPDATE maintenance_requests
SET progress_stage = CASE
  WHEN status = 'PROCESSING' THEN COALESCE(progress_stage, 'OTHER')
  WHEN status = 'COMPLETED' THEN COALESCE(progress_stage, 'WAITING_STORE_CONFIRMATION')
  ELSE progress_stage
END
WHERE progress_stage IS NULL
  AND status IN ('PROCESSING', 'COMPLETED');

UPDATE maintenance_updates
SET progress_stage = CASE
  WHEN status = 'PROCESSING' THEN COALESCE(progress_stage, 'OTHER')
  WHEN status = 'COMPLETED' THEN COALESCE(progress_stage, 'WAITING_STORE_CONFIRMATION')
  ELSE progress_stage
END
WHERE progress_stage IS NULL
  AND status IN ('PROCESSING', 'COMPLETED');

UPDATE maintenance_requests
SET completed_at = COALESCE(completed_at, updated_at, reported_at, created_at, NOW()),
    completion_method = COALESCE(completion_method, 'ADMIN_FORCE_CLOSED')
WHERE status = 'COMPLETED'
  AND completed_at IS NULL;

ALTER TABLE maintenance_requests
  ALTER COLUMN status SET DEFAULT 'UNACCEPTED';

ALTER TABLE maintenance_requests
  ADD CONSTRAINT maintenance_requests_status_check
  CHECK (status IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED'));

ALTER TABLE maintenance_requests
  ADD CONSTRAINT maintenance_requests_completion_method_check
  CHECK (completion_method IS NULL OR completion_method IN ('STORE_CONFIRMED', 'ADMIN_FORCE_CLOSED'));

ALTER TABLE maintenance_updates
  ADD CONSTRAINT maintenance_updates_status_check
  CHECK (status IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED'));

ALTER TABLE maintenance_updates
  ADD CONSTRAINT maintenance_updates_visibility_check
  CHECK (visibility IN ('PUBLIC', 'INTERNAL'));

CREATE TABLE IF NOT EXISTS maintenance_ticket_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id                UUID NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  event_type               TEXT NOT NULL,
  previous_status          TEXT,
  new_status               TEXT,
  previous_progress_stage  TEXT,
  new_progress_stage       TEXT,
  description              TEXT NOT NULL,
  visibility               TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO maintenance_ticket_events (
  ticket_id,
  event_type,
  previous_status,
  new_status,
  previous_progress_stage,
  new_progress_stage,
  description,
  visibility,
  created_by,
  created_at,
  metadata
)
SELECT
  r.id,
  'MIGRATED',
  b.old_request_status,
  r.status,
  NULL,
  r.progress_stage,
  '舊維修工單狀態資料轉換',
  'INTERNAL',
  NULL,
  NOW(),
  jsonb_build_object('source', 'migration_maintenance_status_workflow')
FROM maintenance_requests r
JOIN maintenance_status_migration_backup b ON b.request_id = r.id
WHERE NOT EXISTS (
  SELECT 1
  FROM maintenance_ticket_events e
  WHERE e.ticket_id = r.id
    AND e.event_type = 'MIGRATED'
    AND e.metadata->>'source' = 'migration_maintenance_status_workflow'
);

DROP TRIGGER IF EXISTS trg_maintenance_progress_stages_updated_at ON maintenance_progress_stages;
CREATE TRIGGER trg_maintenance_progress_stages_updated_at
  BEFORE UPDATE ON maintenance_progress_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE maintenance_progress_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_progress_stages_read" ON maintenance_progress_stages;
CREATE POLICY "maintenance_progress_stages_read" ON maintenance_progress_stages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "maintenance_progress_stages_write" ON maintenance_progress_stages;
CREATE POLICY "maintenance_progress_stages_write" ON maintenance_progress_stages
  FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'cross_dept.maintenance.category.edit'))
  WITH CHECK (has_permission(auth.uid(), 'cross_dept.maintenance.category.edit'));

DROP POLICY IF EXISTS "maintenance_ticket_events_read" ON maintenance_ticket_events;
CREATE POLICY "maintenance_ticket_events_read" ON maintenance_ticket_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "maintenance_ticket_events_write" ON maintenance_ticket_events;
CREATE POLICY "maintenance_ticket_events_write" ON maintenance_ticket_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'service_center', 'general_affairs.service_center.force_close', 'force_close', '可強制結案總務服務中心維修工單')
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_progress_stage
ON maintenance_requests (progress_stage);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_accepted_by
ON maintenance_requests (accepted_by);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_completed_by
ON maintenance_requests (completed_by);

CREATE INDEX IF NOT EXISTS idx_maintenance_updates_progress_stage
ON maintenance_updates (progress_stage);

CREATE INDEX IF NOT EXISTS idx_maintenance_updates_visibility
ON maintenance_updates (visibility);

CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_ticket_id_created_at
ON maintenance_ticket_events (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_visibility
ON maintenance_ticket_events (visibility);

-- 執行後驗證 SQL：
--   SELECT status, count(*) FROM maintenance_requests GROUP BY status ORDER BY status;
--   SELECT status, count(*) FROM maintenance_updates GROUP BY status ORDER BY status;
--   SELECT progress_stage, count(*) FROM maintenance_requests GROUP BY progress_stage ORDER BY progress_stage;
--   SELECT count(*) AS invalid_status_count FROM maintenance_requests WHERE status NOT IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED');
--   SELECT count(*) AS missing_migration_event_count
--   FROM maintenance_requests r
--   WHERE NOT EXISTS (
--     SELECT 1 FROM maintenance_ticket_events e WHERE e.ticket_id = r.id AND e.event_type = 'MIGRATED'
--   );
