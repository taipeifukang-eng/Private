-- Migration: 添加員編欄位到 profiles 表
-- 日期: 2026-01-25
-- 說明: 為 profiles 表添加 employee_code 欄位以支援員工編號搜尋

-- 添加 employee_code 欄位
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_code VARCHAR(20);

-- 為 employee_code 欄位添加索引以提升搜尋效能
CREATE INDEX IF NOT EXISTS idx_profiles_employee_code ON profiles(employee_code);

-- 添加註解說明
COMMENT ON COLUMN profiles.employee_code IS '員工編號（例如: FK0171, FKPT0171）';
