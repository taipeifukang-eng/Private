-- ============================================================
-- Task 1B-3 人工驗收 SQL（請在 DEV 測試環境執行）
-- 會建立 DEV-1B-3-* 測試資料；不得在 Production 執行。
-- 清理方式見檔案底部「I. DEV 測試資料清理」。
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.part.view',
  'general_affairs.part.manage'
)
ORDER BY code;

-- B. 資料表 / RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('ga_parts', 'ga_part_compatibilities')
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
    'current_user_is_store_manager',
    'ga_is_active_part_category',
    'ga_part_is_visible',
    'ga_validate_part',
    'ga_validate_part_compatibility',
    'ga_soft_delete_part',
    'ga_soft_delete_part_compatibility'
  )
ORDER BY p.proname;

-- D. 建立測試料件分類與料件
WITH category AS (
  INSERT INTO ga_part_categories(name, code, default_base_unit)
  VALUES ('DEV 1B-3 料件分類', 'DEV-1B-3-PART', '個')
  ON CONFLICT DO NOTHING
  RETURNING id
), category_pick AS (
  SELECT id FROM category
  UNION ALL
  SELECT id FROM ga_part_categories WHERE code = 'DEV-1B-3-PART' AND deleted_at IS NULL
  LIMIT 1
)
INSERT INTO ga_parts(
  category_id,
  name,
  part_code,
  barcode,
  brand,
  model,
  specification,
  base_unit,
  purchase_unit,
  purchase_to_base_rate,
  minimum_issue_qty,
  allow_fractional_issue,
  allow_unpacking,
  specs,
  tags
)
SELECT
  c.id,
  'DEV 1B-3 料件',
  ' dev-1b-3-part-code ',
  ' DEV-1B-3-BARCODE ',
  'DAIKIN',
  'API-TEST',
  '白色掛勾',
  '個',
  '箱',
  100,
  1,
  false,
  true,
  '{"color":"white"}'::jsonb,
  ARRAY['DEV', '驗收']::text[]
FROM category_pick c
ON CONFLICT DO NOTHING;

-- E. 建立三種相容性資料
WITH part_pick AS (
  SELECT id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' AND deleted_at IS NULL LIMIT 1
), template_pick AS (
  SELECT id FROM ga_equipment_templates WHERE deleted_at IS NULL AND is_active = true ORDER BY created_at LIMIT 1
)
INSERT INTO ga_part_compatibilities(part_id, compatibility_type, equipment_template_id)
SELECT p.id, 'EQUIPMENT_TEMPLATE', t.id
FROM part_pick p
CROSS JOIN template_pick t
WHERE t.id IS NOT NULL
ON CONFLICT DO NOTHING;

WITH part_pick AS (
  SELECT id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' AND deleted_at IS NULL LIMIT 1
)
INSERT INTO ga_part_compatibilities(part_id, compatibility_type, vendor_name, series_name)
SELECT id, 'VENDOR_SERIES', 'DAIKIN', '冷氣保養系列'
FROM part_pick
ON CONFLICT DO NOTHING;

WITH part_pick AS (
  SELECT id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' AND deleted_at IS NULL LIMIT 1
)
INSERT INTO ga_part_compatibilities(part_id, compatibility_type, brand, model)
SELECT id, 'BRAND_MODEL', 'DAIKIN', 'API-TEST'
FROM part_pick
ON CONFLICT DO NOTHING;

-- F. 正規化與唯一性觀察
SELECT
  part_code,
  barcode,
  base_unit,
  purchase_unit,
  purchase_to_base_rate,
  minimum_issue_qty,
  allow_fractional_issue,
  allow_unpacking,
  count(*) FILTER (WHERE deleted_at IS NULL) AS active_count
FROM ga_parts
WHERE part_code = 'DEV-1B-3-PART-CODE'
GROUP BY
  part_code,
  barcode,
  base_unit,
  purchase_unit,
  purchase_to_base_rate,
  minimum_issue_qty,
  allow_fractional_issue,
  allow_unpacking;

-- G. RLS policy 摘要，確認沒有 DELETE policy
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_parts', 'ga_part_compatibilities')
ORDER BY tablename, policyname;

SELECT count(*) AS delete_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_parts', 'ga_part_compatibilities')
  AND cmd = 'DELETE';

-- H. 預期失敗案例（逐段取消註解測試）
-- specs 非 object 應失敗
-- INSERT INTO ga_parts(category_id, name, base_unit, specs)
-- SELECT id, 'DEV SHOULD FAIL SPECS', '個', '[]'::jsonb
-- FROM ga_part_categories
-- WHERE code = 'DEV-1B-3-PART';
--
-- purchase_unit 有值但 rate 缺少應失敗
-- INSERT INTO ga_parts(category_id, name, base_unit, purchase_unit)
-- SELECT id, 'DEV SHOULD FAIL RATE', '個', '箱'
-- FROM ga_part_categories
-- WHERE code = 'DEV-1B-3-PART';
--
-- 不允許小數領用時 minimum_issue_qty 小數應失敗
-- INSERT INTO ga_parts(category_id, name, base_unit, minimum_issue_qty, allow_fractional_issue)
-- SELECT id, 'DEV SHOULD FAIL FRACTIONAL MIN', '個', 0.5, false
-- FROM ga_part_categories
-- WHERE code = 'DEV-1B-3-PART';
--
-- 不安全 image_path 應失敗
-- INSERT INTO ga_parts(category_id, name, base_unit, image_path)
-- SELECT id, 'DEV SHOULD FAIL IMAGE', '個', '../bad.jpg'
-- FROM ga_part_categories
-- WHERE code = 'DEV-1B-3-PART';
--
-- BRAND_MODEL 缺 brand 應失敗
-- INSERT INTO ga_part_compatibilities(part_id, compatibility_type, model)
-- SELECT id, 'BRAND_MODEL', 'API-TEST'
-- FROM ga_parts
-- WHERE part_code = 'DEV-1B-3-PART-CODE'
-- LIMIT 1;

-- I. DEV 測試資料清理（驗收完成後如需清理，請在 DEV 手動執行）
-- UPDATE ga_part_compatibilities
-- SET deleted_at = COALESCE(deleted_at, now()),
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1B-3 cleanup')
-- WHERE part_id IN (
--   SELECT id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' OR name LIKE 'DEV 1B-3%'
-- );
--
-- UPDATE ga_parts
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1B-3 cleanup')
-- WHERE part_code = 'DEV-1B-3-PART-CODE'
--    OR name LIKE 'DEV 1B-3%';
--
-- UPDATE ga_part_categories
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deleted_by = COALESCE(deleted_by, created_by)
-- WHERE code = 'DEV-1B-3-PART';
