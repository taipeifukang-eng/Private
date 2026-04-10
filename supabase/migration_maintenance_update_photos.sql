-- ============================================================
-- 維修進度更新照片表
-- 說明：每次 maintenance_updates 可附多張圖片
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_update_photos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id      UUID NOT NULL REFERENCES maintenance_updates(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  uploaded_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE maintenance_update_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maintenance_update_photos_read" ON maintenance_update_photos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_update_photos_write" ON maintenance_update_photos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_maintenance_update_photos_update_id
ON maintenance_update_photos (update_id);
