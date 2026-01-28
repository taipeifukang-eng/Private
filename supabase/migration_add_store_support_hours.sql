-- 為門市新增分店支援時數欄位（門市層級）
-- 2026-01-28

-- 添加支援時數欄位到 monthly_store_summary 表（門市月統計）
ALTER TABLE monthly_store_summary
ADD COLUMN IF NOT EXISTS support_to_other_stores_hours DECIMAL(5,1) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS support_from_other_stores_hours DECIMAL(5,1) DEFAULT NULL;

-- 添加註解說明
COMMENT ON COLUMN monthly_store_summary.support_to_other_stores_hours IS '支援分店時數：本店人員去其他分店支援的總時數';
COMMENT ON COLUMN monthly_store_summary.support_from_other_stores_hours IS '分店支援時數：其他分店來本店支援的總時數';
