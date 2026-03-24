-- ============================================================
-- stores 表新增 source_store_id 欄位
-- 記錄門市搬遷時的來源門市 ID，用於初始化月人員狀態時回查歷史資料
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS source_store_id UUID REFERENCES stores(id) ON DELETE SET NULL;

COMMENT ON COLUMN stores.source_store_id IS '搬遷來源門市 ID（若由既有門市搬遷而來則填寫，用於月人員狀態初始化時繼承上月資料）';

-- 驗證欄位已新增
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'stores' AND column_name = 'source_store_id';
