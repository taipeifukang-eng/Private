-- =============================================
-- 門市搬遷排程表
-- 用於儲存已排程但尚未執行的搬遷任務
-- =============================================

-- 建立搬遷排程表
CREATE TABLE IF NOT EXISTS store_relocation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  -- 保存所有搬遷所需的參數（JSON 格式）
  scheduled_data JSONB NOT NULL,
  -- 搬遷生效日期
  effective_date DATE NOT NULL,
  -- 狀態：pending=待執行, completed=已完成, cancelled=已取消
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  -- 建立者
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 執行時間（完成後填入）
  executed_at TIMESTAMPTZ,
  -- 取消時間
  cancelled_at TIMESTAMPTZ
);

-- 建立索引提升查詢效能
CREATE INDEX IF NOT EXISTS idx_store_relocation_schedules_status
  ON store_relocation_schedules(status);

CREATE INDEX IF NOT EXISTS idx_store_relocation_schedules_effective_date
  ON store_relocation_schedules(effective_date);

CREATE INDEX IF NOT EXISTS idx_store_relocation_schedules_source_store
  ON store_relocation_schedules(source_store_id);

-- 啟用 RLS
ALTER TABLE store_relocation_schedules ENABLE ROW LEVEL SECURITY;

-- 允許 admin 完整操作
CREATE POLICY "admin_full_access_store_relocation_schedules"
  ON store_relocation_schedules
  FOR ALL
  TO authenticated
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

-- 允許營業部主管讀取與建立
CREATE POLICY "business_supervisor_manage_store_relocation_schedules"
  ON store_relocation_schedules
  FOR ALL
  TO authenticated
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
