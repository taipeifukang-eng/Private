-- ============================================================
-- Task 1C-1 人工驗收 SQL（請在 DEV 測試環境執行）
-- 會建立 DEV-1C-1-* 測試資料；不得在 Production 執行。
-- 清理方式見檔案底部「H. DEV 測試資料清理」。
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.inventory_location.view',
  'general_affairs.inventory_location.manage'
)
ORDER BY code;

-- B. 資料表 / RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_locations', 'ga_inventory_location_parts')
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
    'current_user_manages_store',
    'ga_inventory_location_is_visible',
    'ga_validate_inventory_location',
    'ga_validate_inventory_location_part',
    'ga_soft_delete_inventory_location',
    'ga_soft_delete_inventory_location_part'
  )
ORDER BY p.proname;

-- D. 建立測試庫存位置
WITH store_pick AS (
  SELECT id FROM stores WHERE store_code = 'DEV001' LIMIT 1
)
INSERT INTO ga_inventory_locations(
  code,
  name,
  location_type,
  store_id,
  description,
  is_default,
  allow_negative_stock
)
SELECT
  ' dev-1c-1-store ',
  'DEV 1C-1 門市庫存位置',
  'STORE',
  s.id,
  'DEV Task 1C-1 store location',
  true,
  false
FROM store_pick s
ON CONFLICT DO NOTHING;

INSERT INTO ga_inventory_locations(
  code,
  name,
  location_type,
  description,
  is_default
)
VALUES (
  ' dev-1c-1-central ',
  'DEV 1C-1 中央總倉',
  'CENTRAL_WAREHOUSE',
  'DEV Task 1C-1 central warehouse',
  true
)
ON CONFLICT DO NOTHING;

-- E. 建立位置料件設定
WITH location_pick AS (
  SELECT id FROM ga_inventory_locations WHERE code = 'DEV-1C-1-STORE' AND deleted_at IS NULL LIMIT 1
), part_pick AS (
  SELECT id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' AND deleted_at IS NULL LIMIT 1
)
INSERT INTO ga_inventory_location_parts(
  location_id,
  part_id,
  safety_stock_qty,
  reorder_point_qty,
  maximum_stock_qty,
  preferred_issue_unit_type,
  notes
)
SELECT
  l.id,
  p.id,
  5,
  10,
  30,
  'PURCHASE',
  'DEV Task 1C-1 location part'
FROM location_pick l
CROSS JOIN part_pick p
ON CONFLICT DO NOTHING;

-- F. 正規化與資料確認
SELECT
  code,
  name,
  location_type,
  store_id,
  is_active,
  is_default,
  allow_negative_stock,
  deleted_at
FROM ga_inventory_locations
WHERE code IN ('DEV-1C-1-STORE', 'DEV-1C-1-CENTRAL')
ORDER BY code;

SELECT
  lp.safety_stock_qty,
  lp.reorder_point_qty,
  lp.maximum_stock_qty,
  lp.preferred_issue_unit_type,
  p.base_unit,
  p.purchase_unit,
  CASE lp.preferred_issue_unit_type
    WHEN 'BASE' THEN p.base_unit
    WHEN 'PURCHASE' THEN p.purchase_unit
    ELSE NULL
  END AS resolved_preferred_issue_unit
FROM ga_inventory_location_parts lp
JOIN ga_parts p ON p.id = lp.part_id
JOIN ga_inventory_locations l ON l.id = lp.location_id
WHERE l.code = 'DEV-1C-1-STORE'
  AND lp.deleted_at IS NULL;

-- G. RLS policy 摘要，確認沒有 DELETE policy
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_locations', 'ga_inventory_location_parts')
ORDER BY tablename, policyname;

SELECT count(*) AS delete_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_locations', 'ga_inventory_location_parts')
  AND cmd = 'DELETE';

-- H. DEV 測試資料清理（驗收完成後如需清理，請在 DEV 手動執行）
-- UPDATE ga_inventory_location_parts
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1C-1 cleanup')
-- WHERE location_id IN (
--   SELECT id FROM ga_inventory_locations WHERE code IN ('DEV-1C-1-STORE', 'DEV-1C-1-CENTRAL')
-- );
--
-- UPDATE ga_inventory_locations
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     is_default = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1C-1 cleanup')
-- WHERE code IN ('DEV-1C-1-STORE', 'DEV-1C-1-CENTRAL');
