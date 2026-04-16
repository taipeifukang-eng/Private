-- ============================================================
-- 併購藥局商品主檔整理系統 - 共用資料表補齊
-- ============================================================

CREATE TABLE IF NOT EXISTS product_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL REFERENCES products_master(product_code) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 一條碼可對應多品號（掃描時跳選擇窗），以 (barcode, product_code) 為唯一鍵
  UNIQUE (barcode, product_code)
);

-- 若已建立舊的單欄唯一索引，先移除
DROP INDEX IF EXISTS product_barcodes_barcode_key;

CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_code ON product_barcodes(product_code);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);

ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_barcodes_read" ON product_barcodes;
CREATE POLICY "product_barcodes_read" ON product_barcodes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "product_barcodes_write" ON product_barcodes;
CREATE POLICY "product_barcodes_write" ON product_barcodes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS acquisition_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  barcode TEXT NOT NULL,
  product_code TEXT,
  product_name TEXT,
  unit TEXT,
  is_matched BOOLEAN NOT NULL DEFAULT false,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_scans_date ON acquisition_scans(scan_date);
CREATE INDEX IF NOT EXISTS idx_acquisition_scans_barcode ON acquisition_scans(barcode);

ALTER TABLE acquisition_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acquisition_scans_read" ON acquisition_scans;
CREATE POLICY "acquisition_scans_read" ON acquisition_scans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "acquisition_scans_write" ON acquisition_scans;
CREATE POLICY "acquisition_scans_write" ON acquisition_scans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS acquisition_unmatched (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  barcode TEXT,
  ocr_product_name TEXT,
  ocr_barcode TEXT,
  ocr_supplier TEXT,
  photos JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_date ON acquisition_unmatched(scan_date);
CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_resolved ON acquisition_unmatched(is_resolved);

CREATE OR REPLACE TRIGGER trg_acquisition_unmatched_updated_at
  BEFORE UPDATE ON acquisition_unmatched
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE acquisition_unmatched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acquisition_unmatched_read" ON acquisition_unmatched;
CREATE POLICY "acquisition_unmatched_read" ON acquisition_unmatched
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "acquisition_unmatched_write" ON acquisition_unmatched;
CREATE POLICY "acquisition_unmatched_write" ON acquisition_unmatched
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
