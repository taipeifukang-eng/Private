-- ============================================================
-- Task 1B-1 人工驗收 SQL（請在 DEV 測試環境執行）
-- 會建立 DEV-1B-* 測試資料；不得在 Production 執行。
-- 清理方式見檔案底部「I. DEV 測試資料清理」。
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.equipment_template.view',
  'general_affairs.equipment_template.manage',
  'general_affairs.equipment.view',
  'general_affairs.equipment.manage'
)
ORDER BY code;

-- B. 資料表 / RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('ga_equipment_templates', 'ga_equipment')
ORDER BY tablename;

-- C. Functions are SECURITY DEFINER and search_path pinned
SELECT
  p.proname,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ga_validate_equipment_template',
    'ga_validate_equipment',
    'ga_soft_delete_equipment_template',
    'ga_soft_delete_equipment'
  )
ORDER BY p.proname;

-- D. 建立測試設備分類、範本、設備
WITH category AS (
  INSERT INTO ga_equipment_categories(name, code, requires_brand, requires_model)
  VALUES ('DEV 1B 設備分類', 'DEV-1B-EQUIPMENT', true, true)
  ON CONFLICT DO NOTHING
  RETURNING id
), category_pick AS (
  SELECT id FROM category
  UNION ALL
  SELECT id FROM ga_equipment_categories WHERE code = 'DEV-1B-EQUIPMENT' AND deleted_at IS NULL
  LIMIT 1
), template AS (
  INSERT INTO ga_equipment_templates(category_id, name, brand, model, specs)
  SELECT id, 'DEV 1B 範本', 'DAIKIN', 'FTXM50NVLT', '{"capacity":"5kw"}'::jsonb
  FROM category_pick
  RETURNING id, category_id
), store_pick AS (
  SELECT id FROM stores WHERE store_code = 'DEV001' LIMIT 1
)
INSERT INTO ga_equipment(
  store_id,
  category_id,
  template_id,
  name,
  asset_code,
  brand,
  model,
  status,
  has_warranty,
  warranty_end_date
)
SELECT
  s.id,
  t.category_id,
  t.id,
  'DEV 1B 門市設備',
  'DEV-1B-ASSET',
  'DAIKIN',
  'FTXM50NVLT',
  'ACTIVE',
  true,
  NULL
FROM template t
CROSS JOIN store_pick s;

-- E. JSON constraint 應拒絕（手動取消註解測試）
-- INSERT INTO ga_equipment_templates(category_id, name, specs)
-- SELECT id, 'Bad JSON', '[]'::jsonb
-- FROM ga_equipment_categories WHERE code = 'DEV-1B-EQUIPMENT';

-- F. category requires_brand/model 應拒絕（手動取消註解測試）
-- INSERT INTO ga_equipment(store_id, category_id, name)
-- SELECT s.id, c.id, '缺品牌型號'
-- FROM stores s, ga_equipment_categories c
-- WHERE s.store_code = 'DEV001'
--   AND c.code = 'DEV-1B-EQUIPMENT';

-- G. soft delete 後 asset_code 可重用
UPDATE ga_equipment
SET deleted_at = now(), deleted_by = created_by, deletion_reason = 'DEV manual test'
WHERE asset_code = 'DEV-1B-ASSET'
  AND deleted_at IS NULL;

INSERT INTO ga_equipment(store_id, category_id, name, asset_code, brand, model)
SELECT s.id, c.id, 'DEV 1B 門市設備重建', 'DEV-1B-ASSET', 'DAIKIN', 'FTXM50NVLT'
FROM stores s, ga_equipment_categories c
WHERE s.store_code = 'DEV001'
  AND c.code = 'DEV-1B-EQUIPMENT';

-- H. RLS policy 摘要
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_equipment_templates', 'ga_equipment')
ORDER BY tablename, policyname;

-- I. DEV 測試資料清理（驗收完成後如需清理，請在 DEV 手動執行）
-- UPDATE ga_equipment
-- SET deleted_at = COALESCE(deleted_at, now()),
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1B-1 cleanup')
-- WHERE asset_code = 'DEV-1B-ASSET'
--    OR name IN ('DEV 1B 門市設備', 'DEV 1B 門市設備重建');
--
-- UPDATE ga_equipment_templates
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1B-1 cleanup')
-- WHERE name = 'DEV 1B 範本';
--
-- UPDATE ga_equipment_categories
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deleted_by = COALESCE(deleted_by, created_by)
-- WHERE code = 'DEV-1B-EQUIPMENT';
