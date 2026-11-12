-- 還原 20261112130000_m7m8_b4_asset_transfer_follow.sql：把「轉移確認收到」與「更正所屬門市」兩個函式還原成第 2 批原版（備份自 套用前的 pg_get_functiondef），並移除搬單新增的函式與資料表。
-- 會刪除：ga_asset_transfer_moved_requests（搬走的單與舊式工單清單紀錄）。已經被搬到新門市的需求單與工單「不會」搬回去（資料本身留在新門市）；需要的話請另行人工處理。
-- 還原前請先備份：CREATE TABLE public.zz_bak_b4_35_moved AS SELECT * FROM public.ga_asset_transfer_moved_requests;
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_confirm_receive(p_transfer_id uuid, p_note text DEFAULT NULL::text, p_photos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  t ga_asset_transfers%ROWTYPE;
  v_a jsonb;
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '備註不可超過 500 字'); END IF;
  SELECT * INTO t FROM ga_asset_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到轉移單'); END IF;
  IF NOT EXISTS (SELECT 1 FROM store_managers WHERE user_id = v_uid AND role_type = 'store_manager' AND store_id = t.to_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '只有轉入門市的店長可以確認收到');
  END IF;
  IF t.status <> 'PENDING_RECEIVE' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這張轉移單目前不是「待收到」狀態（A 店還沒確認交出，或已處理過），請重新載入');
  END IF;
  v_a := ga_ws_lock_asset(t.asset_type, t.asset_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產已被刪除，請通知總務取消轉移單');
  END IF;
  IF (v_a->>'store_id')::uuid <> t.from_store_id THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產的所屬門市已被更正，請通知總務取消並重新發起');
  END IF;
  IF NOT ga_is_store_active(t.to_store_id) THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '轉入門市已停用'); END IF;
  IF (v_a->>'qr_revoked_at') IS NOT NULL OR (t.asset_type = 'EQUIPMENT' AND v_a->>'status' = 'SCRAPPED') OR (t.asset_type = 'FACILITY' AND v_a->>'status' = 'RETIRED') THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產已報廢／作廢，不能再轉移，請通知總務取消轉移單');
  END IF;
  v_counts := ga_ws_open_order_count(t.asset_type, t.asset_id);
  IF t.asset_type = 'EQUIPMENT' THEN UPDATE ga_equipment SET store_id = t.to_store_id WHERE id = t.asset_id;
  ELSE UPDATE ga_facilities SET store_id = t.to_store_id WHERE id = t.asset_id; END IF;
  UPDATE ga_asset_transfers SET status = 'COMPLETED', received_by = v_uid, received_by_name = ga_ws_actor_name(v_uid),
         received_at = now(), receive_note = v_note, updated_at = now() WHERE id = p_transfer_id;
  PERFORM ga_ws_transfer_add_photos(p_transfer_id, 'RECEIVE', p_photos);
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, transfer_id, reason, note, open_request_count, actor_id, actor_name)
  VALUES (t.asset_type, t.asset_id, t.asset_name, t.asset_code, 'STORE_TRANSFER', t.from_store_id, t.to_store_id, t.id, t.reason, v_note,
          (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'COMPLETED', 'to_store_id', t.to_store_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.ga_ws_correct_asset_store(p_type text, p_id uuid, p_to_store_id uuid, p_reason text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_a jsonb;
  v_from uuid;
  v_counts jsonb;
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(p_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入更正原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '更正原因不可超過 200 字'); END IF;
  v_a := ga_ws_lock_asset(p_type, p_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  IF p_expected_updated_at IS NOT NULL AND (v_a->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆資料已被其他人修改，請重新載入後再操作');
  END IF;
  v_from := (v_a->>'store_id')::uuid;
  IF p_to_store_id IS NULL OR NOT ga_is_store_active(p_to_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請選擇啟用中的門市');
  END IF;
  IF p_to_store_id = v_from THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '新門市與目前所屬門市相同'); END IF;
  IF EXISTS (SELECT 1 FROM ga_asset_transfers WHERE asset_type = p_type AND asset_id = p_id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產有進行中的轉移單，請先完成或取消轉移單');
  END IF;
  v_counts := ga_ws_open_order_count(p_type, p_id);

  IF p_type = 'EQUIPMENT' THEN
    UPDATE ga_equipment SET store_id = p_to_store_id WHERE id = p_id RETURNING updated_at INTO v_updated;
  ELSE
    UPDATE ga_facilities SET store_id = p_to_store_id WHERE id = p_id RETURNING updated_at INTO v_updated;
  END IF;
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, reason, open_request_count, actor_id, actor_name)
  VALUES (p_type, p_id, v_a->>'name', v_a->>'code', 'STORE_CORRECTION', v_from, p_to_store_id, v_reason, (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'from_store_id', v_from, 'to_store_id', p_to_store_id, 'open_count', (v_counts->>'open_count')::integer, 'updated_at', v_updated));
END;
$function$;

REVOKE ALL ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) TO authenticated;
DROP FUNCTION IF EXISTS public.ga_ws_asset_moved_list(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_asset_move_preview(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_asset_move_open_requests(text, uuid, uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_asset_unlinked_work_orders(text, uuid, uuid);
DROP TABLE IF EXISTS public.ga_asset_transfer_moved_requests;

NOTIFY pgrst, 'reload schema';
