-- ============================================================
-- Task 1B-2 人工驗收 SQL（請在 DEV 測試環境執行）
-- 會建立 DEV-1B-2-* 測試資料；不得在 Production 執行。
-- 清理方式見檔案底部「H. DEV 測試資料清理」。
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.facility.view',
  'general_affairs.facility.manage'
)
ORDER BY code;

-- B. 資料表 / RLS
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'ga_facilities';

-- C. Functions are SECURITY DEFINER and search_path pinned
SELECT
  p.proname,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ga_is_active_facility_category',
    'ga_validate_facility',
    'ga_soft_delete_facility'
  )
ORDER BY p.proname;

-- D. 建立測試設施分類與設施
WITH category AS (
  INSERT INTO ga_facility_categories(name, code)
  VALUES ('DEV 1B-2 設施分類', 'DEV-1B-2-FACILITY')
  ON CONFLICT DO NOTHING
  RETURNING id
), category_pick AS (
  SELECT id FROM category
  UNION ALL
  SELECT id FROM ga_facility_categories WHERE code = 'DEV-1B-2-FACILITY' AND deleted_at IS NULL
  LIMIT 1
), store_pick AS (
  SELECT id FROM stores WHERE store_code = 'DEV001' LIMIT 1
)
INSERT INTO ga_facilities(
  store_id,
  category_id,
  name,
  facility_code,
  status,
  area,
  location_detail,
  quantity,
  unit,
  specs,
  tags
)
SELECT
  s.id,
  c.id,
  'DEV 1B-2 門市設施',
  'DEV-1B-2-FACILITY-CODE',
  'ACTIVE',
  '一樓',
  '入口右側',
  2,
  '座',
  '{"material":"wood"}'::jsonb,
  ARRAY['DEV', '驗收']::text[]
FROM category_pick c
CROSS JOIN store_pick s
ON CONFLICT DO NOTHING;

-- E. soft delete 後 facility_code 可重用
-- Dashboard SQL Editor 沒有 authenticated JWT，auth.uid() 為 NULL。
-- 因此 ga_soft_delete_facility() 與 code 重用請在 API 驗收階段用 manage 帳號測試。
SELECT
  facility_code,
  count(*) FILTER (WHERE deleted_at IS NULL) AS active_count
FROM ga_facilities
WHERE facility_code = 'DEV-1B-2-FACILITY-CODE'
GROUP BY facility_code;

-- F. RLS policy 摘要
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'ga_facilities'
ORDER BY policyname;

-- G. 預期失敗案例（逐段取消註解測試）
-- specs 非 object 應失敗
-- INSERT INTO ga_facilities(store_id, category_id, name, specs)
-- SELECT s.id, c.id, 'DEV SHOULD FAIL SPECS', '[]'::jsonb
-- FROM stores s, ga_facility_categories c
-- WHERE s.store_code = 'DEV001' AND c.code = 'DEV-1B-2-FACILITY';
--
-- quantity 有值但 unit 缺少應失敗
-- INSERT INTO ga_facilities(store_id, category_id, name, quantity)
-- SELECT s.id, c.id, 'DEV SHOULD FAIL QUANTITY UNIT', 1
-- FROM stores s, ga_facility_categories c
-- WHERE s.store_code = 'DEV001' AND c.code = 'DEV-1B-2-FACILITY';
--
-- 不安全 image_path 應失敗
-- INSERT INTO ga_facilities(store_id, category_id, name, image_path)
-- SELECT s.id, c.id, 'DEV SHOULD FAIL IMAGE', '../bad.jpg'
-- FROM stores s, ga_facility_categories c
-- WHERE s.store_code = 'DEV001' AND c.code = 'DEV-1B-2-FACILITY';

-- H. DEV 測試資料清理（驗收完成後如需清理，請在 DEV 手動執行）
-- UPDATE ga_facilities
-- SET deleted_at = COALESCE(deleted_at, now()),
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1B-2 cleanup')
-- WHERE facility_code = 'DEV-1B-2-FACILITY-CODE'
--    OR name IN ('DEV 1B-2 門市設施', 'DEV 1B-2 門市設施重建');
--
-- UPDATE ga_facility_categories
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deleted_by = COALESCE(deleted_by, created_by)
-- WHERE code = 'DEV-1B-2-FACILITY';
