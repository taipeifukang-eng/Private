-- M7/M8 第 4 批：DEV 專用測試清除函式（不套正式區，沒有對應的正式區草稿）。
-- 採購單事件表有「不可修改或刪除」觸發器，採購單、進貨、配發、設備互相參照，測試真的走完採購流程留下的資料無法用一般方式清掉。
-- 這個函式只處理「帶 [自動測試]M7M8 T 標記」的測試資料（採購單備註、品項名稱、供應商名稱、料件名稱任一帶標記，或開單人是 m7m8-test-* 測試帳號）：
--   暫停事件表的不可改刪觸發器 → 刪除這些採購單（品項與事件隨之連帶刪除；若第 4 批 C 的進貨、配發資料表與設備來源欄位已存在，也一併先清掉，含「由這些採購單配發或到貨建立的設備」與它們用掉的資產編號流水）→ 立刻恢復觸發器，
--   最後刪除帶標記的測試供應商與測試帳號留下的設定變更紀錄。同一個交易內任何錯誤整個回復，觸發器不會停留在停用狀態。
-- 只有 service_role 能呼叫；authenticated／anon 都不能。測試的 cleanup 會在刪除料件、位置、需求單之前呼叫它。
-- 還原：20261112140000_m7m8_b4_dev_test_cleanup.rollback.sql。可重複執行。

CREATE OR REPLACE FUNCTION public.ga_dev_cleanup_m7m8_purchasing(p_marker text DEFAULT '[自動測試]M7M8 T%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_po uuid[];
  v_n integer := 0;
  v_vendors integer := 0;
  v_settings integer := 0;
  v_tests uuid[];
  v_codes jsonb := '[]'::jsonb;
  v_c jsonb;
  v_eq integer := 0;
BEGIN
  IF p_marker IS NULL OR left(p_marker, 12) <> '[自動測試]M7M8 T' THEN
    RAISE EXCEPTION '只能清除帶 [自動測試]M7M8 T 標記的測試資料';
  END IF;
  IF to_regclass('public.ga_purchase_orders') IS NULL THEN RETURN jsonb_build_object('purchase_orders', 0); END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_tests FROM public.profiles WHERE email LIKE 'm7m8-test-%@example.test';
  SELECT COALESCE(array_agg(DISTINCT o.id), '{}') INTO v_po
    FROM public.ga_purchase_orders o
   WHERE o.notes LIKE p_marker
      OR o.vendor_name_snapshot LIKE p_marker
      OR o.created_by = ANY (v_tests)
      OR EXISTS (SELECT 1 FROM public.ga_vendors v WHERE v.id = o.vendor_id AND v.name LIKE p_marker)
      OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i LEFT JOIN public.ga_parts p ON p.id = i.part_id
                  WHERE i.po_id = o.id AND (i.item_name LIKE p_marker OR p.name LIKE p_marker));
  IF COALESCE(array_length(v_po, 1), 0) > 0 THEN
    -- 第 4 批 C（到貨驗入與配發）建立的資料表與欄位：存在才處理（動態 SQL，避免函式在 C 套用前就綁死不存在的物件）。
    IF to_regclass('public.ga_stock_dispatches') IS NOT NULL THEN
      -- 配發與直接到貨建立的設備（來源是這些採購單，屬測試資料）：先記下它們用掉的資產編號流水，刪設備與附件紀錄，再清掉沒有設備使用的編號流水。
      EXECUTE 'SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(''c'', left(asset_code, 4), ''d'', purchased_at)), ''[]''::jsonb) FROM public.ga_equipment WHERE source_purchase_order_id = ANY ($1) AND asset_code IS NOT NULL AND purchased_at IS NOT NULL' INTO v_codes USING v_po;
      EXECUTE 'DELETE FROM public.ga_resource_attachments WHERE resource_id IN (SELECT id FROM public.ga_equipment WHERE source_purchase_order_id = ANY ($1))' USING v_po;
      EXECUTE 'DELETE FROM public.ga_equipment WHERE source_purchase_order_id = ANY ($1)' USING v_po;
      GET DIAGNOSTICS v_eq = ROW_COUNT;
      FOR v_c IN SELECT value FROM jsonb_array_elements(v_codes) LOOP
        DELETE FROM public.ga_asset_code_sequences s WHERE s.resource_type = 'EQUIPMENT' AND s.level2_category_code = v_c->>'c' AND s.purchase_date = (v_c->>'d')::date
          AND NOT EXISTS (SELECT 1 FROM public.ga_equipment e WHERE e.deleted_at IS NULL AND e.asset_code LIKE (v_c->>'c') || to_char((v_c->>'d')::date, 'YYYYMMDD') || '%');
      END LOOP;
      EXECUTE 'DELETE FROM public.ga_stock_dispatches WHERE po_item_id IN (SELECT id FROM public.ga_purchase_order_items WHERE po_id = ANY ($1))' USING v_po;
    END IF;
    IF to_regclass('public.ga_purchase_receipts') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.ga_purchase_receipt_items WHERE receipt_id IN (SELECT id FROM public.ga_purchase_receipts WHERE po_id = ANY ($1))' USING v_po;
      EXECUTE 'DELETE FROM public.ga_purchase_receipts WHERE po_id = ANY ($1)' USING v_po;
    END IF;
    ALTER TABLE public.ga_purchase_order_events DISABLE TRIGGER trg_ga_po_events_immutable;
    DELETE FROM public.ga_purchase_orders WHERE id = ANY (v_po);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    ALTER TABLE public.ga_purchase_order_events ENABLE TRIGGER trg_ga_po_events_immutable;
  END IF;
  DELETE FROM public.ga_vendors WHERE name LIKE p_marker AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.vendor_id = ga_vendors.id);
  GET DIAGNOSTICS v_vendors = ROW_COUNT;
  IF to_regclass('public.ga_workflow_setting_events') IS NOT NULL THEN
    DELETE FROM public.ga_workflow_setting_events WHERE actor_id = ANY (v_tests);
    GET DIAGNOSTICS v_settings = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('purchase_orders', v_n, 'vendors', v_vendors, 'setting_events', v_settings, 'equipment', v_eq);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_dev_cleanup_m7m8_purchasing(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_dev_cleanup_m7m8_purchasing(text) TO service_role;

NOTIFY pgrst, 'reload schema';
