-- Migration: 修改 store_employees 和 monthly_staff_status 表，讓員工不需要系統帳號
-- 日期: 2026-01
-- 說明: 新增 employee_name 欄位，並將 user_id 改為可選

-- =====================================================
-- Part 1: 修改 store_employees 表
-- =====================================================

-- 1. 新增 employee_name 欄位
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS employee_name VARCHAR(100);

-- 2. 修改 user_id 為可選（移除 NOT NULL 約束）
ALTER TABLE store_employees ALTER COLUMN user_id DROP NOT NULL;

-- 3. 移除原本的 UNIQUE 約束（store_id, user_id），因為 user_id 可能為 null
-- 先嘗試移除可能存在的約束
ALTER TABLE store_employees DROP CONSTRAINT IF EXISTS store_employees_store_id_user_id_key;

-- 4. 新增索引
CREATE INDEX IF NOT EXISTS idx_store_employees_employee_name ON store_employees(employee_name);

-- =====================================================
-- Part 2: 修改 monthly_staff_status 表
-- =====================================================

-- 1. 修改 user_id 為可選（移除 NOT NULL 約束）
ALTER TABLE monthly_staff_status ALTER COLUMN user_id DROP NOT NULL;

-- 2. 移除原本的 UNIQUE 約束（如果有基於 user_id 的）
ALTER TABLE monthly_staff_status DROP CONSTRAINT IF EXISTS monthly_staff_status_year_month_store_id_user_id_key;

-- 3. 新增基於 employee_code 的唯一約束（如果需要）
-- ALTER TABLE monthly_staff_status ADD CONSTRAINT monthly_staff_status_unique_employee 
--   UNIQUE (year_month, store_id, employee_code);

-- =====================================================
-- 驗證結構
-- =====================================================
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'store_employees';
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'monthly_staff_status';
