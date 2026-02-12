-- ============================================
-- 統一權限模組分組
-- ============================================
-- 目的：將相關性高的權限放在同一個模組下，避免分散顯示

-- 【診斷】先查看目前的權限分組狀況
SELECT 
  module,
  COUNT(*) as permission_count,
  STRING_AGG(code, ', ' ORDER BY code) as permission_codes
FROM permissions
WHERE code LIKE 'task.%' 
   OR code LIKE 'employee.%' 
   OR code LIKE 'activity.%' 
   OR code LIKE 'store.%' 
   OR code LIKE 'inventory.%' 
   OR code LIKE 'monthly.%'
   OR code LIKE 'dashboard.%'
GROUP BY module
ORDER BY module;

-- ========================================
-- 統一任務管理模組
-- ========================================
-- 所有 task.* 開頭的權限都歸類到「任務管理」
UPDATE permissions 
SET module = '任務管理'
WHERE code LIKE 'task.%';

-- ========================================
-- 統一員工/人事管理模組
-- ========================================
-- 所有 employee.* 開頭的權限都歸類到「人事管理」
UPDATE permissions 
SET module = '人事管理'
WHERE code LIKE 'employee.%';

-- ========================================
-- 統一活動管理模組
-- ========================================
-- 所有 activity.* 開頭的權限都歸類到「活動管理」
UPDATE permissions 
SET module = '活動管理'
WHERE code LIKE 'activity.%';

-- ========================================
-- 統一門市管理模組
-- ========================================
-- 所有 store.* 開頭的權限都歸類到「門市管理」
UPDATE permissions 
SET module = '門市管理'
WHERE code LIKE 'store.%';

-- ========================================
-- 統一盤點管理模組
-- ========================================
-- 所有 inventory.* 開頭的權限都歸類到「盤點管理」
UPDATE permissions 
SET module = '盤點管理'
WHERE code LIKE 'inventory.%';

-- ========================================
-- 統一每月人員狀態模組
-- ========================================
-- 所有 monthly.* 開頭的權限都歸類到「每月人員狀態」
UPDATE permissions 
SET module = '每月人員狀態'
WHERE code LIKE 'monthly.%';

-- ========================================
-- 統一系統管理模組
-- ========================================
-- dashboard 和其他系統級權限歸類到「系統」
UPDATE permissions 
SET module = '系統'
WHERE code LIKE 'dashboard.%' OR code LIKE 'system.%';

-- ============================================
-- 【驗證】檢查更新後的分組
-- ============================================
SELECT 
  module as 模組名稱,
  COUNT(*) as 權限數量,
  STRING_AGG(
    code || ' (' || 
    CASE 
      WHEN description LIKE '%-%' THEN SPLIT_PART(description, ' - ', 1)
      ELSE description
    END || ')',
    E'\n  ' 
    ORDER BY code
  ) as 權限清單
FROM permissions
WHERE code LIKE 'task.%' 
   OR code LIKE 'employee.%' 
   OR code LIKE 'activity.%' 
   OR code LIKE 'store.%' 
   OR code LIKE 'inventory.%' 
   OR code LIKE 'monthly.%'
   OR code LIKE 'dashboard.%'
GROUP BY module
ORDER BY 
  CASE module
    WHEN '任務管理' THEN 1
    WHEN '系統' THEN 2
    WHEN '門市管理' THEN 3
    WHEN '人事管理' THEN 4
    WHEN '活動管理' THEN 5
    WHEN '盤點管理' THEN 6
    WHEN '每月人員狀態' THEN 7
    ELSE 99
  END;

-- ============================================
-- 【統計】各模組權限數量
-- ============================================
SELECT 
  module,
  COUNT(*) as total_permissions,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_permissions,
  '✅ 已統一分組' as status
FROM permissions
WHERE code LIKE 'task.%' 
   OR code LIKE 'employee.%' 
   OR code LIKE 'activity.%' 
   OR code LIKE 'store.%' 
   OR code LIKE 'inventory.%' 
   OR code LIKE 'monthly.%'
   OR code LIKE 'dashboard.%'
GROUP BY module
ORDER BY module;

-- ============================================
-- 完成提示
-- ============================================
DO $$
DECLARE
  v_task_count INT;
  v_employee_count INT;
  v_activity_count INT;
  v_store_count INT;
  v_inventory_count INT;
  v_monthly_count INT;
BEGIN
  SELECT COUNT(*) INTO v_task_count FROM permissions WHERE code LIKE 'task.%' AND module = '任務管理';
  SELECT COUNT(*) INTO v_employee_count FROM permissions WHERE code LIKE 'employee.%' AND module = '人事管理';
  SELECT COUNT(*) INTO v_activity_count FROM permissions WHERE code LIKE 'activity.%' AND module = '活動管理';
  SELECT COUNT(*) INTO v_store_count FROM permissions WHERE code LIKE 'store.%' AND module = '門市管理';
  SELECT COUNT(*) INTO v_inventory_count FROM permissions WHERE code LIKE 'inventory.%' AND module = '盤點管理';
  SELECT COUNT(*) INTO v_monthly_count FROM permissions WHERE code LIKE 'monthly.%' AND module = '每月人員狀態';
  
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ 權限模組統一完成！';
  RAISE NOTICE '';
  RAISE NOTICE '統一結果：';
  RAISE NOTICE '- 任務管理：% 個權限', v_task_count;
  RAISE NOTICE '- 人事管理：% 個權限（包含所有 employee.* 權限）', v_employee_count;
  RAISE NOTICE '- 活動管理：% 個權限', v_activity_count;
  RAISE NOTICE '- 門市管理：% 個權限', v_store_count;
  RAISE NOTICE '- 盤點管理：% 個權限', v_inventory_count;
  RAISE NOTICE '- 每月人員狀態：% 個權限', v_monthly_count;
  RAISE NOTICE '';
  RAISE NOTICE '下一步：';
  RAISE NOTICE '1. 重新整理權限管理頁面';
  RAISE NOTICE '2. 確認「人事管理」下包含所有員工相關權限';
  RAISE NOTICE '3. 確認其他模組也正確分組';
  RAISE NOTICE '================================================';
END $$;
