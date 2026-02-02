-- ============================================================
-- 移除支援人員獎金唯一約束
-- 說明: 允許同一員工在同一月份有多筆獎金記錄
-- 執行日期: 2026-02-03
-- ============================================================

-- 移除唯一約束（如果存在）
ALTER TABLE support_staff_bonus 
DROP CONSTRAINT IF EXISTS support_staff_bonus_employee_code_year_month_key;

-- 或者使用這個命令（根據實際約束名稱）
ALTER TABLE support_staff_bonus 
DROP CONSTRAINT IF EXISTS support_staff_bonus_employee_code_year_month_key1;
