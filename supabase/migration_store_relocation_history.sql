-- =============================================
-- 門市搬遷歷史記錄表
-- 記錄每次門市代號/名稱/負責人等基本資料的變更歷程
-- 門市實體（UUID）不變，員工/管理關係不受影響
-- =============================================

CREATE TABLE IF NOT EXISTS store_relocation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 門市 ID（永遠指向同一門市實體）
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- 搬遷生效日期（由使用者填入，用於歷史查詢）
  relocation_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- 變更前後的欄位值
  old_store_code    TEXT,
  new_store_code    TEXT,
  old_store_name    TEXT,
  new_store_name    TEXT,
  old_short_name    TEXT,
  new_short_name    TEXT,
  old_hr_store_code TEXT,
  new_hr_store_code TEXT,
  old_manager_name  TEXT,
  new_manager_name  TEXT,

  -- 備註
  note TEXT,

  -- 操作人員
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_store_relocation_history_store_id
  ON store_relocation_history(store_id);

CREATE INDEX IF NOT EXISTS idx_store_relocation_history_relocation_date
  ON store_relocation_history(relocation_date DESC);

-- 啟用 RLS
ALTER TABLE store_relocation_history ENABLE ROW LEVEL SECURITY;

-- admin 完整存取
CREATE POLICY "admin_full_access_store_relocation_history"
  ON store_relocation_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- 營業部主管/助理可讀取與建立
CREATE POLICY "business_staff_manage_store_relocation_history"
  ON store_relocation_history
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.department LIKE '營業%'
        AND profiles.role IN ('manager', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.department LIKE '營業%'
        AND profiles.role IN ('manager', 'member')
    )
  );
