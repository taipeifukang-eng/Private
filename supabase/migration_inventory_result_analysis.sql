-- 盤點結果分析報表
-- 日期: 2026-07-08

CREATE TABLE IF NOT EXISTS inventory_result_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id) NOT NULL,
  store_code VARCHAR(50) NOT NULL,
  store_name VARCHAR(100),
  inventory_order_no VARCHAR(100) NOT NULL,
  closed_text VARCHAR(50),
  source_file_name TEXT,
  imported_by UUID REFERENCES profiles(id),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  row_count INTEGER DEFAULT 0,
  total_difference_qty NUMERIC(14,2) DEFAULT 0,
  total_difference_amount_member NUMERIC(14,2) DEFAULT 0,
  shortage_count INTEGER DEFAULT 0,
  surplus_count INTEGER DEFAULT 0,
  zero_difference_count INTEGER DEFAULT 0,
  UNIQUE(store_id, inventory_order_no)
);

CREATE TABLE IF NOT EXISTS inventory_result_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES inventory_result_batches(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) NOT NULL,
  row_number INTEGER,
  closed_text VARCHAR(50),
  product_code VARCHAR(100),
  product_name TEXT,
  unit VARCHAR(50),
  storage_location_1 TEXT,
  storage_location_2 TEXT,
  difference_qty NUMERIC(14,2) DEFAULT 0,
  difference_amount_member NUMERIC(14,2) DEFAULT 0,
  cost NUMERIC(14,2) DEFAULT 0,
  unit_cost NUMERIC(14,4) DEFAULT 0,
  stock_qty NUMERIC(14,2) DEFAULT 0,
  stock_amount NUMERIC(14,2) DEFAULT 0,
  raw_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_store ON inventory_result_batches(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_order ON inventory_result_batches(inventory_order_no);
CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_imported_at ON inventory_result_batches(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_result_items_batch ON inventory_result_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_result_items_product ON inventory_result_items(product_code);

ALTER TABLE inventory_result_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_result_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory result batches admin service access" ON inventory_result_batches;
CREATE POLICY "Inventory result batches admin service access" ON inventory_result_batches
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

DROP POLICY IF EXISTS "Inventory result items admin service access" ON inventory_result_items;
CREATE POLICY "Inventory result items admin service access" ON inventory_result_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

COMMENT ON TABLE inventory_result_batches IS '盤點結果分析報表匯入批次';
COMMENT ON TABLE inventory_result_items IS '盤點結果分析報表匯入明細';
