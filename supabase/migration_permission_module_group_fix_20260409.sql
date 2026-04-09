-- ============================================
-- 權限分組修正：每月人員狀態 / 業績管理
-- 2026-04-09
-- ============================================

-- 1) 每月人員各式獎金明細：放到每月人員狀態
UPDATE permissions
SET module = 'monthly'
WHERE code = 'monthly.status.bonus_detail.view';

-- 2) 匯入每月獎金相關：放到業績管理
UPDATE permissions
SET module = 'performance'
WHERE code IN ('performance.bonus.import', 'performance.bonus.view');
