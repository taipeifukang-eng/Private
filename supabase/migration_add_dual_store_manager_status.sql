-- =========================================================
-- 新增「擔任雙店長」本月狀態值
-- 解決 monthly_staff_status_monthly_status_check 約束錯誤
-- =========================================================

-- 先查看現有的 CHECK 約束內容（確認名稱）
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'monthly_staff_status'::regclass
  AND contype = 'c'
  AND conname LIKE '%monthly_status%';

-- 刪除舊的 CHECK 約束，加入新值後重建
ALTER TABLE monthly_staff_status
  DROP CONSTRAINT IF EXISTS monthly_staff_status_monthly_status_check;

ALTER TABLE monthly_staff_status
  ADD CONSTRAINT monthly_staff_status_monthly_status_check
  CHECK (monthly_status IN (
    'full_month',
    'new_hire',
    'resigned',
    'leave_of_absence',
    'transferred_in',
    'transferred_out',
    'promoted',
    'support_rotation',
    'dual_store_manager',
    'leave_return'
  ));

-- 驗證
DO $$
BEGIN
  RAISE NOTICE '✅ monthly_staff_status CHECK 約束已更新，新增 dual_store_manager';
END $$;
