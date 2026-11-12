-- 34-b4-receipt-dispatch-rollback.sql
-- 撤回 34：移除第 4 批 C 新增的 4 張表、ga_parts.equipment_template_id（含觸發器）、ga_equipment 的 8 個來源與保固欄位與相關函式，並把 ga_ws_update_part_guarded 還原成 10-g01 的版本。會刪除：進貨紀錄與明細、配發單、設備序號補填紀錄、料件的對應設備型號、設備的來源連結與保固起算日。
-- 不會刪除：已經由配發或直接到貨建立的設備本身與庫存流水（只是失去來源連結與保固起算日）；庫存餘額不會被回沖。要先撤回 35，且撤回後採購單的「登錄到貨」與「配發」無法使用。
-- 撤回前備份（只備份會被刪掉的表與欄位）：
--   CREATE TABLE public.zz_bak_b4_34_receipts AS SELECT * FROM public.ga_purchase_receipts;
--   CREATE TABLE public.zz_bak_b4_34_receipt_items AS SELECT * FROM public.ga_purchase_receipt_items;
--   CREATE TABLE public.zz_bak_b4_34_dispatches AS SELECT * FROM public.ga_stock_dispatches;
--   CREATE TABLE public.zz_bak_b4_34_serial_events AS SELECT * FROM public.ga_equipment_serial_events;
--   CREATE TABLE public.zz_bak_b4_34_part_templates AS SELECT id, equipment_template_id FROM public.ga_parts WHERE equipment_template_id IS NOT NULL;
--   CREATE TABLE public.zz_bak_b4_34_equipment_src AS SELECT id, source_purchase_order_id, source_po_item_id, source_receipt_item_id, source_dispatch_id, source_request_id, vendor_id, vendor_name_snapshot, warranty_start_date FROM public.ga_equipment WHERE source_purchase_order_id IS NOT NULL OR warranty_start_date IS NOT NULL;
BEGIN;

DROP FUNCTION IF EXISTS public.ga_ws_onboarding_set_serial(uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_po_receipts_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_po_dispatch(uuid, uuid, numeric, uuid, text, uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_po_receive(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.ga_po_request_timeline(uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.ga_po_dispatch_data(uuid);
DROP FUNCTION IF EXISTS public.ga_po_receipt_data(uuid);
DROP FUNCTION IF EXISTS public.ga_po_make_equipment(uuid, uuid, text, date, numeric, uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_po_serial_conflict(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.ga_po_unit_type(uuid, text);
DROP FUNCTION IF EXISTS public.ga_next_dispatch_no();
DROP FUNCTION IF EXISTS public.ga_next_receipt_no();
DROP INDEX IF EXISTS public.idx_ga_equipment_source_dispatch;
DROP INDEX IF EXISTS public.idx_ga_equipment_source_po;
ALTER TABLE public.ga_equipment
  DROP COLUMN IF EXISTS source_purchase_order_id, DROP COLUMN IF EXISTS source_po_item_id, DROP COLUMN IF EXISTS source_receipt_item_id,
  DROP COLUMN IF EXISTS source_dispatch_id, DROP COLUMN IF EXISTS source_request_id, DROP COLUMN IF EXISTS vendor_id,
  DROP COLUMN IF EXISTS vendor_name_snapshot, DROP COLUMN IF EXISTS warranty_start_date;
DROP TABLE IF EXISTS public.ga_equipment_serial_events;
DROP TABLE IF EXISTS public.ga_stock_dispatches;
DROP TABLE IF EXISTS public.ga_purchase_receipt_items;
DROP TABLE IF EXISTS public.ga_purchase_receipts;
DROP TRIGGER IF EXISTS trg_ga_parts_check_equipment_template ON public.ga_parts;
DROP FUNCTION IF EXISTS public.ga_parts_check_equipment_template();
DROP INDEX IF EXISTS public.idx_ga_parts_equipment_template;
ALTER TABLE public.ga_parts DROP COLUMN IF EXISTS equipment_template_id;

-- 料件修改函式還原為 20261109130000 的版本（允許修改欄位清單不含 equipment_template_id）。
CREATE OR REPLACE FUNCTION public.ga_ws_update_part_guarded(p_part_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur ga_parts%ROWTYPE;
  v_usage jsonb;
  v_allowed text[] := ARRAY['category_id','name','part_code','barcode','brand','model','specification','description','notes','base_unit',
    'purchase_unit','purchase_to_base_rate','minimum_issue_qty','allow_fractional_issue','allow_unpacking','is_active','specs','tags','image_path'];
  v_unit text[] := ARRAY['base_unit','purchase_unit','purchase_to_base_rate'];
  v_key text;
  v_sets text := '';
  v_changed boolean := false;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '修改內容格式錯誤'); END IF;
  SELECT * INTO v_cur FROM ga_parts WHERE id = p_part_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到料件'); END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這個料件已被其他人修改，請重新載入後再儲存');
  END IF;
  FOR v_key IN SELECT k FROM jsonb_object_keys(p_patch) AS k LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('不可修改的欄位：%s', v_key)); END IF;
    v_sets := v_sets || CASE WHEN v_sets = '' THEN '' ELSE ', ' END || format('%I = r.%I', v_key, v_key);
    IF v_key = ANY(v_unit) AND (to_jsonb(v_cur) -> v_key) IS DISTINCT FROM (p_patch -> v_key)
       AND NOT (v_key = 'purchase_to_base_rate' AND (to_jsonb(v_cur) ->> v_key) IS NOT NULL AND (p_patch ->> v_key) IS NOT NULL
                AND (to_jsonb(v_cur) ->> v_key)::numeric = (p_patch ->> v_key)::numeric) THEN
      v_changed := true;
    END IF;
  END LOOP;
  IF v_sets = '' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '沒有要修改的欄位'); END IF;
  IF v_changed THEN
    v_usage := (ga_ws_part_usage(p_part_id))->'data';
    IF (v_usage->>'unit_locked')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'UNIT_LOCKED', 'usage', v_usage,
        'error', '這個料件已有庫存或庫存交易紀錄，基本單位、採購單位與換算率不能再修改；若單位真的要改，請新增另一個料件。');
    END IF;
  END IF;
  EXECUTE format('UPDATE ga_parts p SET %s, updated_by = $2 FROM jsonb_populate_record(NULL::ga_parts, $1) r WHERE p.id = $3', v_sets)
    USING p_patch, v_uid, p_part_id;
  SELECT to_jsonb(p) INTO v_row FROM ga_parts p WHERE p.id = p_part_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_row);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
