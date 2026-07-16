-- 盤點結果分析報表：店長填寫盤差原因與系統門檻設定
-- 日期: 2026-07-16

ALTER TABLE inventory_result_items
ADD COLUMN IF NOT EXISTS difference_reason TEXT,
ADD COLUMN IF NOT EXISTS difference_reason_updated_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS difference_reason_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN inventory_result_items.difference_reason IS '店長填寫盤差原因';
COMMENT ON COLUMN inventory_result_items.difference_reason_updated_by IS '最後更新盤差原因的人員';
COMMENT ON COLUMN inventory_result_items.difference_reason_updated_at IS '最後更新盤差原因時間';

CREATE TABLE IF NOT EXISTS inventory_result_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO inventory_result_settings (key, value)
VALUES ('difference_reason_cost_threshold', '{"amount": 100}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE inventory_result_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory result settings admin service access" ON inventory_result_settings;
CREATE POLICY "Inventory result settings admin service access" ON inventory_result_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

COMMENT ON TABLE inventory_result_settings IS '盤點結果分析報表設定';
