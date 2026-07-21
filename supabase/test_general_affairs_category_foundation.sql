-- ============================================================
-- Task 1A 人工驗收 SQL（請在測試環境執行）
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.equipment_category.view',
  'general_affairs.equipment_category.manage',
  'general_affairs.facility_category.view',
  'general_affairs.facility_category.manage',
  'general_affairs.part_category.view',
  'general_affairs.part_category.manage'
)
ORDER BY code;

-- B. code trim + uppercase，未刪除範圍唯一
INSERT INTO ga_equipment_categories(name, code) VALUES ('空調設備', ' ac-test ');
SELECT name, code FROM ga_equipment_categories WHERE code = 'AC-TEST';
-- 再次建立相同 code 應失敗
-- INSERT INTO ga_equipment_categories(name, code) VALUES ('重複空調', 'ac-test');

-- C. 三層允許，第四層應失敗
WITH root AS (
  INSERT INTO ga_facility_categories(name, code) VALUES ('建築結構測試', 'BLD-TEST') RETURNING id
), child AS (
  INSERT INTO ga_facility_categories(name, code, parent_id)
  SELECT '天花板測試', 'CEIL-TEST', id FROM root RETURNING id
)
INSERT INTO ga_facility_categories(name, code, parent_id)
SELECT '前場天花板測試', 'CEIL-FRONT-TEST', id FROM child;

-- 以下應失敗：分類最多三層
-- INSERT INTO ga_facility_categories(name, code, parent_id)
-- SELECT '第四層測試', 'LEVEL4-TEST', id
-- FROM ga_facility_categories
-- WHERE code = 'CEIL-FRONT-TEST';

-- D. parent_id = self 應失敗
-- UPDATE ga_equipment_categories
-- SET parent_id = id
-- WHERE code = 'AC-TEST';

-- E. 移到 descendant 底下應失敗
-- UPDATE ga_facility_categories
-- SET parent_id = (SELECT id FROM ga_facility_categories WHERE code = 'CEIL-FRONT-TEST')
-- WHERE code = 'BLD-TEST';

-- F. 停用父分類後，子分類一般有效路徑應為 false
UPDATE ga_facility_categories SET is_active = false WHERE code = 'BLD-TEST';
SELECT
  code,
  ga_category_has_active_path('facility', id) AS has_active_path
FROM ga_facility_categories
WHERE code IN ('BLD-TEST', 'CEIL-TEST', 'CEIL-FRONT-TEST')
ORDER BY code;

-- G. soft delete 後 code 可重用
UPDATE ga_part_categories
SET deleted_at = now(), is_active = false
WHERE code = 'HOOK-TEST';

INSERT INTO ga_part_categories(name, code) VALUES ('掛勾測試', 'HOOK-TEST')
ON CONFLICT DO NOTHING;

-- H. RLS 直接存取測試建議
-- 1. 建立四個測試帳號/角色：
--    - 無權限 authenticated
--    - 只有 general_affairs.service_center.access
--    - 只有 general_affairs.equipment_category.view
--    - 只有 general_affairs.equipment_category.manage
-- 2. 使用各帳號登入後直接以 Supabase client 查詢/新增/更新：
--    - 無權限：SELECT/INSERT/UPDATE 都不可越權
--    - service_center.access：只能看到啟用且祖先啟用的未刪除分類
--    - view：只能看到啟用且祖先啟用的未刪除分類
--    - manage：可看到未刪除啟用/停用分類，可新增/更新/soft delete API
--    - service role：可完整查詢，僅供 API 管理查詢使用
