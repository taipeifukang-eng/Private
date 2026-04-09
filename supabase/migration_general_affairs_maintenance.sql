-- ============================================================
-- 跨部門管理 - 總務組維修回報模組
-- 說明：
--   maintenance_requests    : 門市回報維修
--   maintenance_updates     : 總務處理進度更新
--   maintenance_photos      : 維修照片檔案紀錄
-- ============================================================

-- 1. 維修回報表
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,                         -- 維修項目名稱
  description       TEXT,                                  -- 維修詳細說明
  reported_by       UUID NOT NULL REFERENCES auth.users(id),  -- 回報者用戶 ID
  reporter_name     TEXT NOT NULL,                         -- 回報者姓名（冗余儲存供查詢）
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'closed')),
  priority          TEXT DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 維修進度更新表
CREATE TABLE IF NOT EXISTS maintenance_updates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  status            TEXT NOT NULL
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'closed')),
  notes             TEXT NOT NULL,                         -- 更新說明
  updated_by        UUID NOT NULL REFERENCES auth.users(id),  -- 総務組更新者
  updated_by_name   TEXT NOT NULL,                         -- 更新者姓名
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 維修照片表
CREATE TABLE IF NOT EXISTS maintenance_photos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  storage_path      TEXT NOT NULL,                         -- Supabase storage 檔案路徑
  file_name         TEXT NOT NULL,                         -- 原始檔名
  uploaded_by       UUID NOT NULL REFERENCES auth.users(id),  -- 上傳者
  photo_type        TEXT DEFAULT 'before'
                    CHECK (photo_type IN ('before', 'progress', 'after', 'other')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maintenance_requests_updated_at
  BEFORE UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. RLS（Row Level Security）
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_photos ENABLE ROW LEVEL SECURITY;

-- 這邊先開啟簡單的 RLS，API 層再做細部權限控制
CREATE POLICY "maintenance_requests_read" ON maintenance_requests
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_requests_write" ON maintenance_requests
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "maintenance_updates_read" ON maintenance_updates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_updates_write" ON maintenance_updates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "maintenance_photos_read" ON maintenance_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_photos_write" ON maintenance_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. 新增 RBAC 權限代碼
-- cross_dept.maintenance.submit   : 店長 - 提交維修回報
-- cross_dept.maintenance.view_all : 総務組人員 - 查看所有維修回報
-- cross_dept.maintenance.update   : 総務組人員 - 更新維修進度

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.submit', 'submit', '可提交本門市的維修回報'),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.view_all', 'view_all', '可查看所有門市的維修回報'),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.update', 'update', '可更新維修進度')
ON CONFLICT (code) DO NOTHING;

-- 7. 將三項權限全部授予 system_admin 角色
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'system_admin'
  AND p.code IN (
    'cross_dept.maintenance.submit',
    'cross_dept.maintenance.view_all',
    'cross_dept.maintenance.update'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- 8. 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_store_id
ON maintenance_requests (store_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_reported_by
ON maintenance_requests (reported_by);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status
ON maintenance_requests (status);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_created_at
ON maintenance_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_updates_request_id
ON maintenance_updates (request_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_photos_request_id
ON maintenance_photos (request_id);
