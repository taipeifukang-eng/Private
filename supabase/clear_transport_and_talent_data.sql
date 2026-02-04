-- 清空所有員工的交通費用和育才獎金資料
-- 執行此 SQL 前請確認要清空的資料範圍
-- 建議：先執行 SELECT 查詢確認影響範圍，再執行 UPDATE

-- ============================================
-- 1. 查看目前有交通費用的記錄（先確認）
-- ============================================
SELECT 
  year_month,
  store_id,
  employee_code,
  employee_name,
  monthly_transport_expense,
  transport_expense_notes
FROM monthly_staff_status
WHERE monthly_transport_expense IS NOT NULL
ORDER BY year_month DESC, store_id, employee_code;

-- ============================================
-- 2. 查看目前有育才獎金的記錄（先確認）
-- ============================================
SELECT 
  year_month,
  store_id,
  employee_code,
  employee_name,
  talent_cultivation_bonus,
  talent_cultivation_target
FROM monthly_staff_status
WHERE talent_cultivation_bonus IS NOT NULL
ORDER BY year_month DESC, store_id, employee_code;

-- ============================================
-- 3. 清空所有交通費用資料（執行後無法復原）
-- ============================================
UPDATE monthly_staff_status
SET 
  monthly_transport_expense = NULL,
  transport_expense_notes = NULL,
  updated_at = NOW()
WHERE monthly_transport_expense IS NOT NULL;

-- ============================================
-- 4. 清空所有育才獎金資料（執行後無法復原）
-- ============================================
UPDATE monthly_staff_status
SET 
  talent_cultivation_bonus = NULL,
  talent_cultivation_target = NULL,
  updated_at = NOW()
WHERE talent_cultivation_bonus IS NOT NULL;

-- ============================================
-- 5. 驗證清空結果
-- ============================================
-- 檢查交通費用是否已清空（應該返回 0）
SELECT COUNT(*) as remaining_transport_records
FROM monthly_staff_status
WHERE monthly_transport_expense IS NOT NULL;

-- 檢查育才獎金是否已清空（應該返回 0）
SELECT COUNT(*) as remaining_talent_records
FROM monthly_staff_status
WHERE talent_cultivation_bonus IS NOT NULL;

-- ============================================
-- 如果只想清空特定月份或特定門市，請使用以下範例：
-- ============================================

-- 範例：只清空 2026-01 的交通費用
/*
UPDATE monthly_staff_status
SET 
  monthly_transport_expense = NULL,
  transport_expense_notes = NULL,
  updated_at = NOW()
WHERE year_month = '2026-01' 
  AND monthly_transport_expense IS NOT NULL;
*/

-- 範例：只清空特定門市的育才獎金
/*
UPDATE monthly_staff_status
SET 
  talent_cultivation_bonus = NULL,
  talent_cultivation_target = NULL,
  updated_at = NOW()
WHERE store_id = 'YOUR_STORE_ID' 
  AND talent_cultivation_bonus IS NOT NULL;
*/
