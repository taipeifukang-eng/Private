-- ============================================================
-- 新增「生日」欄位到 store_employees 表
-- 說明: 讓員工管理可以記錄員工生日
-- ============================================================

-- 1. 新增 birthday 欄位
ALTER TABLE store_employees
ADD COLUMN IF NOT EXISTS birthday DATE;

-- 2. 新增 COMMENT
COMMENT ON COLUMN store_employees.birthday IS '員工生日';
