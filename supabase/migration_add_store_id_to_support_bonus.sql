-- ============================================================
-- 為 support_staff_bonus 表添加 store_id 欄位
-- 說明: 記錄支援人員獎金是在哪個門市登記的
-- 執行日期: 2026-02-03
-- ============================================================

-- 1. 添加 store_id 欄位
ALTER TABLE support_staff_bonus 
ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id);

-- 2. 創建索引
CREATE INDEX IF NOT EXISTS idx_support_bonus_store_id 
ON support_staff_bonus(store_id);

-- 3. 創建複合索引（提升查詢效率）
CREATE INDEX IF NOT EXISTS idx_support_bonus_store_year_month 
ON support_staff_bonus(store_id, year_month);

-- 4. 添加註釋
COMMENT ON COLUMN support_staff_bonus.store_id IS '登記門市 ID（記錄在哪個門市登記此獎金）';
