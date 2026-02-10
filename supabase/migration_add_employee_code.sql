-- ============================================================
-- 新增員工編號欄位到 profiles 表
-- 說明: 為 profiles 表添加 employee_code 欄位，用於使用者管理頁面
-- 執行日期: 2026-02-10
-- ============================================================

-- 1. 新增 employee_code 欄位
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_code VARCHAR(20);

-- 2. 為 employee_code 欄位添加索引以提升搜尋效能
CREATE INDEX IF NOT EXISTS idx_profiles_employee_code ON profiles(employee_code);

-- 3. 添加註解說明
COMMENT ON COLUMN profiles.employee_code IS '員工編號（例如: FK0171, FKPT0171）';

-- 4. 驗證：查看 profiles 表結構
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'profiles'
ORDER BY ordinal_position;
