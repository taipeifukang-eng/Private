-- ============================================================
-- Task 1B-1 Rollback SQL
-- 僅建議在尚未正式使用設備主檔時執行。
-- 不回滾 Task 1A 分類基礎。
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ga_equipment_templates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ga_equipment_templates_general_read" ON ga_equipment_templates;
    DROP POLICY IF EXISTS "ga_equipment_templates_manage_read" ON ga_equipment_templates;
    DROP POLICY IF EXISTS "ga_equipment_templates_insert" ON ga_equipment_templates;
    DROP POLICY IF EXISTS "ga_equipment_templates_update" ON ga_equipment_templates;
    DROP TRIGGER IF EXISTS trg_ga_equipment_templates_before_write ON ga_equipment_templates;
  END IF;

  IF to_regclass('public.ga_equipment') IS NOT NULL THEN
    DROP POLICY IF EXISTS "ga_equipment_scope_read" ON ga_equipment;
    DROP POLICY IF EXISTS "ga_equipment_insert" ON ga_equipment;
    DROP POLICY IF EXISTS "ga_equipment_update" ON ga_equipment;
    DROP TRIGGER IF EXISTS trg_ga_equipment_before_write ON ga_equipment;
  END IF;
END $$;

DROP FUNCTION IF EXISTS ga_soft_delete_equipment(UUID, TEXT);
DROP FUNCTION IF EXISTS ga_soft_delete_equipment_template(UUID, TEXT);
DROP FUNCTION IF EXISTS ga_validate_equipment();
DROP FUNCTION IF EXISTS ga_validate_equipment_template();
DROP FUNCTION IF EXISTS ga_next_equipment_asset_code(UUID, DATE);
DROP FUNCTION IF EXISTS ga_equipment_level2_category_code(UUID);
DROP FUNCTION IF EXISTS ga_is_active_equipment_category(UUID);
DROP FUNCTION IF EXISTS ga_is_store_active(UUID);
DROP FUNCTION IF EXISTS ga_normalize_optional_text(TEXT);

DROP TABLE IF EXISTS ga_equipment;
DROP TABLE IF EXISTS ga_equipment_templates;
DROP TABLE IF EXISTS ga_asset_code_sequences;

DELETE FROM permissions
WHERE code IN (
  'general_affairs.equipment_template.view',
  'general_affairs.equipment_template.manage',
  'general_affairs.equipment.view',
  'general_affairs.equipment.manage'
);
