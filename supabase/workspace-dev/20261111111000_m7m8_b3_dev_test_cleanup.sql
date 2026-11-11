-- M7/M8 第 3 批：DEV 專用測試清除函式（不套正式區，沒有對應的正式區草稿）。
-- 庫存流水有「不可修改或刪除」觸發器，而且餘額、調撥單都指向流水，測試過帳（真的呼叫過帳函式）留下的資料沒辦法用一般方式清掉。
-- 這個函式只處理「位置名稱或料件名稱以 [自動測試]M7M8 T 開頭」的交易（測試自己建立的資料）：
--   先把這些餘額的「最後一筆流水」指標（與最後異動時間，兩者必須成對）清掉，暫停不可改刪觸發器、刪除這些流水、馬上恢復觸發器（同一個交易內，任何錯誤整個回復，觸發器不會停留在停用狀態）。
-- 只有 service_role 能呼叫；authenticated／anon 都不能。測試的 cleanupM7M8 會呼叫它，之後再照原順序刪除餘額、位置與料件。
-- 還原：20261111111000_m7m8_b3_dev_test_cleanup.rollback.sql。可重複執行。

CREATE OR REPLACE FUNCTION public.ga_dev_cleanup_m7m8_inventory(p_marker text DEFAULT '[自動測試]M7M8 T%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_loc uuid[];
  v_part uuid[];
  v_tx integer := 0;
  v_ids uuid[];
BEGIN
  IF p_marker IS NULL OR left(p_marker, 12) <> '[自動測試]M7M8 T' THEN
    RAISE EXCEPTION '只能清除帶 [自動測試]M7M8 T 標記的測試資料';
  END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_loc FROM public.ga_inventory_locations WHERE name LIKE p_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_part FROM public.ga_parts WHERE name LIKE p_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM public.ga_inventory_transactions WHERE location_id = ANY (v_loc) OR part_id = ANY (v_part);
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('transactions', 0);
  END IF;
  UPDATE public.ga_inventory_balances SET last_transaction_id = NULL, last_transaction_at = NULL WHERE last_transaction_id = ANY (v_ids);
  ALTER TABLE public.ga_inventory_transactions DISABLE TRIGGER trg_ga_inventory_transactions_immutable;
  DELETE FROM public.ga_inventory_transactions WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_tx = ROW_COUNT;
  ALTER TABLE public.ga_inventory_transactions ENABLE TRIGGER trg_ga_inventory_transactions_immutable;
  RETURN jsonb_build_object('transactions', v_tx);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_dev_cleanup_m7m8_inventory(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_dev_cleanup_m7m8_inventory(text) TO service_role;

NOTIFY pgrst, 'reload schema';
