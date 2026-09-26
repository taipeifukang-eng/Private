-- ============================================================
-- DEV General Affairs Test Parts Cleanup
-- Scope: DEV only. Soft delete test-created ga_parts and related active settings.
-- Never run on Production.
--
-- This script does NOT hard delete rows.
-- It soft-deletes:
--   - ga_resource_attachments for PART resources, when table exists
--   - ga_inventory_location_parts linked to candidate parts, when table exists
--   - ga_part_compatibilities linked to candidate parts
--   - ga_parts candidate rows
--
-- It does NOT delete inventory transactions or balances, because those are
-- append-only / audit-oriented records.
-- ============================================================

DO $$
DECLARE
  v_actor_id UUID;
  v_deleted_at TIMESTAMPTZ := now();
  v_reason TEXT := 'DEV cleanup: 測試料件清理';
  v_part_count INTEGER := 0;
  v_compat_count INTEGER := 0;
  v_location_part_count INTEGER := 0;
  v_attachment_count INTEGER := 0;
BEGIN
  SELECT id INTO v_actor_id
  FROM public.profiles
  WHERE email = 'dev-full-admin@example.test'
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION '找不到 dev-full-admin@example.test profile，停止清理。';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS tmp_dev_test_part_cleanup_candidates ON COMMIT DROP AS
  SELECT p.id
  FROM public.ga_parts p
  WHERE p.deleted_at IS NULL
    AND (
      upper(coalesce(p.part_code, '')) LIKE 'DEV-%'
      OR upper(coalesce(p.part_code, '')) LIKE 'TEST-%'
      OR upper(coalesce(p.barcode, '')) LIKE 'DEV-%'
      OR upper(coalesce(p.name, '')) LIKE 'DEV %'
      OR p.name ILIKE '%測試%'
      OR p.created_by IN (
        SELECT id FROM public.profiles
        WHERE email IN (
          'dev-full-admin@example.test',
          'dev-ga-access@example.test',
          'dev-ga-manage@example.test',
          'dev-ga-view@example.test',
          'dev-no-ga@example.test'
        )
        OR email LIKE 'dev-%@example.test'
      )
      OR p.updated_by IN (
        SELECT id FROM public.profiles
        WHERE email IN (
          'dev-full-admin@example.test',
          'dev-ga-access@example.test',
          'dev-ga-manage@example.test',
          'dev-ga-view@example.test',
          'dev-no-ga@example.test'
        )
        OR email LIKE 'dev-%@example.test'
      )
    );

  SELECT count(*) INTO v_part_count FROM tmp_dev_test_part_cleanup_candidates;

  IF v_part_count = 0 THEN
    RAISE NOTICE '沒有找到符合條件的未刪除測試料件。';
    RETURN;
  END IF;

  IF to_regclass('public.ga_resource_attachments') IS NOT NULL THEN
    PERFORM set_config('app.ga_resource_attachment_soft_delete', 'on', true);

    UPDATE public.ga_resource_attachments a
    SET
      deleted_at = v_deleted_at,
      deleted_by = v_actor_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at
    WHERE a.resource_type = 'PART'
      AND a.resource_id IN (SELECT id FROM tmp_dev_test_part_cleanup_candidates)
      AND a.deleted_at IS NULL;

    GET DIAGNOSTICS v_attachment_count = ROW_COUNT;
  END IF;

  IF to_regclass('public.ga_inventory_location_parts') IS NOT NULL THEN
    PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);

    UPDATE public.ga_inventory_location_parts lp
    SET
      is_active = false,
      deleted_at = v_deleted_at,
      deleted_by = v_actor_id,
      deletion_reason = v_reason,
      updated_by = v_actor_id
    WHERE lp.part_id IN (SELECT id FROM tmp_dev_test_part_cleanup_candidates)
      AND lp.deleted_at IS NULL;

    GET DIAGNOSTICS v_location_part_count = ROW_COUNT;
  END IF;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);

  UPDATE public.ga_part_compatibilities c
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_actor_id,
    deletion_reason = v_reason,
    updated_by = v_actor_id
  WHERE c.part_id IN (SELECT id FROM tmp_dev_test_part_cleanup_candidates)
    AND c.deleted_at IS NULL;

  GET DIAGNOSTICS v_compat_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_part', 'true', true);

  UPDATE public.ga_parts p
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_actor_id,
    deletion_reason = v_reason,
    updated_by = v_actor_id
  WHERE p.id IN (SELECT id FROM tmp_dev_test_part_cleanup_candidates)
    AND p.deleted_at IS NULL;

  GET DIAGNOSTICS v_part_count = ROW_COUNT;

  RAISE NOTICE 'DEV test parts cleanup completed. parts=%, compatibilities=%, location_parts=%, attachments=%',
    v_part_count,
    v_compat_count,
    v_location_part_count,
    v_attachment_count;
END $$;

-- Post-cleanup summary
SELECT
  count(*) AS remaining_active_test_part_count
FROM public.ga_parts p
WHERE p.deleted_at IS NULL
  AND (
    upper(coalesce(p.part_code, '')) LIKE 'DEV-%'
    OR upper(coalesce(p.part_code, '')) LIKE 'TEST-%'
    OR upper(coalesce(p.barcode, '')) LIKE 'DEV-%'
    OR upper(coalesce(p.name, '')) LIKE 'DEV %'
    OR p.name ILIKE '%測試%'
    OR p.created_by IN (
      SELECT id FROM public.profiles
      WHERE email LIKE 'dev-%@example.test'
    )
    OR p.updated_by IN (
      SELECT id FROM public.profiles
      WHERE email LIKE 'dev-%@example.test'
    )
  );
