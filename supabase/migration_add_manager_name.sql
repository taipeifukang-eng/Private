-- Migration: 新增門市負責人欄位
-- 日期: 2024
-- 說明: 為 stores 表新增 manager_name 欄位，用於記錄門市負責人（店長）姓名

-- 新增 manager_name 欄位
ALTER TABLE stores ADD COLUMN IF NOT EXISTS manager_name TEXT;

-- 為現有門市設定預設值（可選）
-- UPDATE stores SET manager_name = NULL WHERE manager_name IS NULL;

-- 新增索引以便搜尋
CREATE INDEX IF NOT EXISTS idx_stores_manager_name ON stores(manager_name);

-- 驗證欄位是否新增成功
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'stores' AND column_name = 'manager_name';
