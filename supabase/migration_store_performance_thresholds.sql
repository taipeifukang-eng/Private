-- =========================================================
-- 建立門市業績獎金門檻設定表
-- 每間門市可獨立設定月/季各級門檻獎金金額
-- =========================================================

CREATE TABLE IF NOT EXISTS store_performance_thresholds (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID         NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  period_type   VARCHAR(10)  NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
  threshold_level INTEGER    NOT NULL CHECK (threshold_level BETWEEN 1 AND 5),
  multiplier    NUMERIC(4,2) NOT NULL,   -- 達標倍率，如 1.00 / 1.10 / 1.20 / 1.30 / 1.40
  base_amount   INTEGER      NOT NULL DEFAULT 0,  -- 該級別基本獎金金額（元/人）
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (store_id, period_type, threshold_level)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_store_perf_thresholds_store
  ON store_performance_thresholds(store_id);

-- RLS
ALTER TABLE store_performance_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated select" ON store_performance_thresholds;
CREATE POLICY "Allow authenticated select"
  ON store_performance_thresholds FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow managers to insert" ON store_performance_thresholds;
CREATE POLICY "Allow managers to insert"
  ON store_performance_thresholds FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager', 'supervisor', 'area_manager')
          OR job_title IN ('店長', '代理店長', '督導', '督導(代理店長)')
        )
    )
  );

DROP POLICY IF EXISTS "Allow managers to update" ON store_performance_thresholds;
CREATE POLICY "Allow managers to update"
  ON store_performance_thresholds FOR UPDATE
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow managers to delete" ON store_performance_thresholds;
CREATE POLICY "Allow managers to delete"
  ON store_performance_thresholds FOR DELETE
  TO authenticated USING (true);

-- 說明
COMMENT ON TABLE store_performance_thresholds IS '門市業績獎金門檻設定，每間門市可獨立設定月/季各級金額';
COMMENT ON COLUMN store_performance_thresholds.period_type    IS 'monthly=月門檻, quarterly=季門檻';
COMMENT ON COLUMN store_performance_thresholds.threshold_level IS '門檻級別 1~5';
COMMENT ON COLUMN store_performance_thresholds.multiplier      IS '毛利達標倍率，如 1.00 代表 100%';
COMMENT ON COLUMN store_performance_thresholds.base_amount     IS '該級別基本獎金金額（元/人）';

-- 完成提示
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ store_performance_thresholds 表建立完成！';
  RAISE NOTICE '每間門市可在業績管理頁面單獨設定各級門檻金額。';
  RAISE NOTICE '若門市未設定，系統將使用預設值。';
  RAISE NOTICE '================================================';
END $$;
