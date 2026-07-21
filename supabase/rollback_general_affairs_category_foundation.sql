-- ============================================================
-- Task 1A Rollback SQL
-- 僅建議在尚未正式使用分類資料時執行。
-- 若已有正式資料，請優先關閉權限/API，不要 drop tables。
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ga_equipment_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ga_equipment_categories_general_read" ON ga_equipment_categories;
    DROP POLICY IF EXISTS "ga_equipment_categories_manage_read" ON ga_equipment_categories;
    DROP POLICY IF EXISTS "ga_equipment_categories_insert" ON ga_equipment_categories;
    DROP POLICY IF EXISTS "ga_equipment_categories_update" ON ga_equipment_categories;
    DROP TRIGGER IF EXISTS trg_ga_equipment_categories_before_write ON ga_equipment_categories;
  END IF;

  IF to_regclass('public.ga_facility_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ga_facility_categories_general_read" ON ga_facility_categories;
    DROP POLICY IF EXISTS "ga_facility_categories_manage_read" ON ga_facility_categories;
    DROP POLICY IF EXISTS "ga_facility_categories_insert" ON ga_facility_categories;
    DROP POLICY IF EXISTS "ga_facility_categories_update" ON ga_facility_categories;
    DROP TRIGGER IF EXISTS trg_ga_facility_categories_before_write ON ga_facility_categories;
  END IF;

  IF to_regclass('public.ga_part_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ga_part_categories_general_read" ON ga_part_categories;
    DROP POLICY IF EXISTS "ga_part_categories_manage_read" ON ga_part_categories;
    DROP POLICY IF EXISTS "ga_part_categories_insert" ON ga_part_categories;
    DROP POLICY IF EXISTS "ga_part_categories_update" ON ga_part_categories;
    DROP TRIGGER IF EXISTS trg_ga_part_categories_before_write ON ga_part_categories;
  END IF;
END $$;

DROP FUNCTION IF EXISTS ga_soft_delete_category(ga_category_kind, UUID);
DROP FUNCTION IF EXISTS ga_category_before_write();
DROP FUNCTION IF EXISTS ga_validate_category_tree(ga_category_kind, UUID, UUID);
DROP FUNCTION IF EXISTS ga_active_category_path(ga_category_kind, UUID);
DROP FUNCTION IF EXISTS ga_category_has_active_path(ga_category_kind, UUID);
DROP FUNCTION IF EXISTS ga_category_depth(ga_category_kind, UUID);
DROP FUNCTION IF EXISTS ga_category_table_name(ga_category_kind);

DROP TABLE IF EXISTS ga_part_categories;
DROP TABLE IF EXISTS ga_facility_categories;
DROP TABLE IF EXISTS ga_equipment_categories;

DROP TYPE IF EXISTS ga_category_kind;

DELETE FROM permissions
WHERE code IN (
  'general_affairs.equipment_category.view',
  'general_affairs.equipment_category.manage',
  'general_affairs.facility_category.view',
  'general_affairs.facility_category.manage',
  'general_affairs.part_category.view',
  'general_affairs.part_category.manage'
);
