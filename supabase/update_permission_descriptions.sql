-- ============================================
-- 更新權限描述為白話說明
-- ============================================
-- 目的：為現有權限添加詳細的白話說明

-- ========================================
-- 任務管理模組
-- ========================================
UPDATE permissions SET description = '查看自己的任務 - 允許查看指派給自己的所有任務'
WHERE code = 'task.view_own';

UPDATE permissions SET description = '管理任務模板 - 允許新增、編輯、刪除任務範本和指派任務給他人'
WHERE code = 'task.manage';

UPDATE permissions SET description = '查看已封存任務 - 允許查看歷史已完成或已封存的任務記錄'
WHERE code = 'task.view_archived';

-- ========================================
-- 系統管理模組
-- ========================================
UPDATE permissions SET description = '查看儀表板 - 允許訪問系統主儀表板，查看統計數據和概覽'
WHERE code = 'dashboard.view';

-- ========================================
-- 門市管理模組
-- ========================================
UPDATE permissions SET description = '管理門市資料 - 允許新增、編輯門市基本資料（名稱、地址、聯絡方式）'
WHERE code = 'store.manage';

UPDATE permissions SET description = '指派店長 - 允許為門市指派或更換店長'
WHERE code = 'store.manager.assign';

UPDATE permissions SET description = '指派督導/區經理 - 允許為門市指派督導或區經理進行管理'
WHERE code = 'store.supervisor.assign';

-- ========================================
-- 員工與人事管理模組
-- ========================================
UPDATE permissions SET description = '管理員工資料 - 允許新增、編輯、查看員工基本資料（姓名、員工編號、聯絡方式等）'
WHERE code = 'employee.manage';

UPDATE permissions SET description = '批次匯入員工 - 允許透過 Excel 檔案批次匯入多筆員工資料'
WHERE code = 'employee.import';

UPDATE permissions SET description = '管理人員異動 - 允許記錄和管理員工的調動、升遷、離職等異動紀錄'
WHERE code = 'employee.movement.manage';

-- ========================================
-- 活動管理模組
-- ========================================
UPDATE permissions SET description = '管理活動 - 允許新增、編輯、刪除公司活動或促銷活動'
WHERE code = 'activity.manage';

-- ========================================
-- 盤點管理模組
-- ========================================
UPDATE permissions SET description = '管理盤點 - 允許建立、執行、查看門市盤點作業和盤點結果'
WHERE code = 'inventory.manage';

-- ========================================
-- 每月人員狀態管理模組
-- ========================================
UPDATE permissions SET description = '查看自己管理門市狀態 - 店長可查看自己負責門市的每月人員狀態'
WHERE code = 'monthly.status.view_own';

UPDATE permissions SET description = '查看所有門市狀態 - 督導/管理員可查看所有門市的每月人員狀態'
WHERE code = 'monthly.status.view_all';

UPDATE permissions SET description = '查看門市統計資料 - 允許查看門市人員統計、支援時數、獎金等統計數據'
WHERE code = 'monthly.status.view_stats';

UPDATE permissions SET description = '編輯門市狀態 - 允許編輯每月人員狀態資料（出勤、請假、獎金等）'
WHERE code = 'monthly.status.edit';

UPDATE permissions SET description = '提交門市狀態 - 允許將編輯完成的每月狀態提交審核'
WHERE code = 'monthly.status.submit';

UPDATE permissions SET description = '確認/核簽門市狀態 - 督導/主管可審核並確認店長提交的每月狀態'
WHERE code = 'monthly.status.confirm';

UPDATE permissions SET description = '匯出門市資料 - 允許將每月人員狀態匯出成 Excel 報表'
WHERE code = 'monthly.export.stores';

-- ============================================
-- 驗證更新結果
-- ============================================
SELECT 
  code,
  description,
  module,
  CASE 
    WHEN description LIKE '%-%' THEN '✅ 已更新為白話說明'
    ELSE '⚠️ 仍為舊描述'
  END as status
FROM permissions
WHERE code IN (
  'task.view_own', 'task.manage', 'task.view_archived', 'dashboard.view',
  'store.manager.assign', 'store.supervisor.assign', 'store.manage',
  'employee.manage', 'employee.movement.manage', 'employee.import',
  'activity.manage', 'inventory.manage',
  'monthly.status.view_own', 'monthly.status.view_all', 'monthly.status.view_stats',
  'monthly.status.edit', 'monthly.status.submit', 'monthly.status.confirm', 'monthly.export.stores'
)
ORDER BY module, code;

-- ============================================
-- 完成提示
-- ============================================
DO $$
DECLARE
  v_updated_count INT;
BEGIN
  SELECT COUNT(*) INTO v_updated_count
  FROM permissions
  WHERE code IN (
    'task.view_own', 'task.manage', 'task.view_archived', 'dashboard.view',
    'store.manager.assign', 'store.supervisor.assign', 'store.manage',
    'employee.manage', 'employee.movement.manage', 'employee.import',
    'activity.manage', 'inventory.manage',
    'monthly.status.view_own', 'monthly.status.view_all', 'monthly.status.view_stats',
    'monthly.status.edit', 'monthly.status.submit', 'monthly.status.confirm', 'monthly.export.stores'
  )
  AND description LIKE '%-%';
  
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ 權限描述更新完成！';
  RAISE NOTICE '';
  RAISE NOTICE '更新統計：';
  RAISE NOTICE '- 已更新 % 個權限的描述為白話說明', v_updated_count;
  RAISE NOTICE '';
  RAISE NOTICE '下一步：';
  RAISE NOTICE '1. 重新整理權限管理頁面';
  RAISE NOTICE '2. 檢查權限列表是否顯示完整說明';
  RAISE NOTICE '3. 確認格式為「功能名稱 - 具體影響說明」';
  RAISE NOTICE '================================================';
END $$;
