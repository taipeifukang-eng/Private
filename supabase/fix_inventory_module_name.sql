-- ============================================
-- 修正盤點管理權限的模組名稱
-- ============================================
-- 將所有 inventory 相關權限的 module 從 'inventory' 改為 '盤點管理'

UPDATE permissions 
SET module = '盤點管理'
WHERE code LIKE 'inventory.%' 
  AND module != '盤點管理';

-- 確認修正結果
SELECT 
  module,
  feature,
  code,
  description
FROM permissions
WHERE code LIKE 'inventory.%'
ORDER BY code;

-- 顯示結果
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM permissions
  WHERE code LIKE 'inventory.%' AND module = '盤點管理';
  
  RAISE NOTICE '✅ 已更新盤點管理權限';
  RAISE NOTICE '共 % 筆權限的模組名稱為「盤點管理」', updated_count;
END $$;
