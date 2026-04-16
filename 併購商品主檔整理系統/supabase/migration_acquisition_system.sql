-- ============================================================
-- 併購藥局商品主檔整理系統 - 資料庫建立
-- ============================================================
-- 【資料庫共用設計說明】
-- products_master（由菁英業務網建立）
--   product_code  TEXT UNIQUE  ← DB 層唯一約束，品號全域唯一
--   product_name  TEXT         ← 共用欄位，兩套系統應保持一致
--   unit          TEXT         ← 共用欄位
--
-- 此系統新增兩張獨立表格：
--   product_barcodes      → 品號 ↔ 多條碼對應（此系統專屬）
--   acquisition_scans     → 掃描紀錄（此系統專屬）
--   acquisition_unmatched → 未建立商品拍照/OCR（此系統專屬）
--
-- 隔離規則：
--   A) products_master：兩套系統共用，品號唯一由 DB UNIQUE 保證
--      DPOS 匯入使用 INSERT ON CONFLICT DO NOTHING（不覆蓋既有資料）
--   B) product_barcodes / acquisition_* 三表：僅此系統使用
--      菁英業務網不查詢這三張表，不受影響
-- ============================================================

-- ============================================================
-- 1. product_barcodes - 商品多條碼對應表
--    一個品號(product_code)可對應多個條碼
-- ============================================================
CREATE TABLE IF NOT EXISTS product_barcodes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL REFERENCES products_master(product_code) ON DELETE CASCADE,
  barcode      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (barcode)
);

CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_code ON product_barcodes(product_code);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode);

ALTER TABLE product_barcodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_barcodes_read" ON product_barcodes;
CREATE POLICY "product_barcodes_read" ON product_barcodes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "product_barcodes_write" ON product_barcodes;
CREATE POLICY "product_barcodes_write" ON product_barcodes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 2. acquisition_scans - 併購藥局掃描紀錄
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_scans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  barcode      TEXT NOT NULL,
  product_code TEXT,
  product_name TEXT,
  unit         TEXT,
  is_matched   BOOLEAN NOT NULL DEFAULT false,
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES auth.users(id)
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

-- ============================================================
-- 3. acquisition_unmatched - 未建立商品（掃描時找不到的商品）
-- ============================================================
CREATE TABLE IF NOT EXISTS acquisition_unmatched (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  barcode          TEXT,
  ocr_product_name TEXT,
  ocr_barcode      TEXT,
  ocr_supplier     TEXT,
  photos           JSONB NOT NULL DEFAULT '[]',
  notes            TEXT,
  is_resolved      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_date ON acquisition_unmatched(scan_date);
CREATE INDEX IF NOT EXISTS idx_acquisition_unmatched_resolved ON acquisition_unmatched(is_resolved);

-- 自動更新 updated_at
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

-- ============================================================
-- 說明：
-- products_master 表已由菁英業務網建立，欄位為：
--   product_code (TEXT UNIQUE) - 商品編號 = 品號
--   product_name (TEXT)        - 商品名稱 = 品名
--   unit (TEXT)                - 單位
--
-- 此 migration 不修改 products_master 結構，僅新增：
--   product_barcodes - 讓品號可對應多個條碼
--   acquisition_scans - 掃描進行中的紀錄
--   acquisition_unmatched - 找不到的商品拍照 OCR 資料
-- ============================================================
