-- Task 1C-1 forward fix: keep parent and child soft-delete reasons identical.
-- This migration intentionally only replaces public.ga_soft_delete_inventory_location.

CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location(
  p_location_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_child_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此庫存位置已被刪除');
  END IF;

  -- 後續建立交易表後，若位置已有任何交易紀錄，這裡必須拒絕 soft delete，改以 is_active=false 停用。
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE location_id = p_location_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_inventory_location', 'true', true);
  UPDATE public.ga_inventory_locations
  SET
    is_active = false,
    is_default = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_location_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '庫存位置 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_location_id,
      'is_active', false,
      'is_default', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_location_parts', v_child_count
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) TO authenticated;
