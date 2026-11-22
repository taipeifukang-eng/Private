-- M6 第 2 批 W29（2026-11-22）：商品部缺貨回報的兩個交易函式（DEV）。只給 workspace API 以 service_role 呼叫。
--   workspace_stockout_respond：商品部回覆「以商品編號 upsert 目前回覆」與「寫入回覆歷程」在同一個交易（舊版是兩次獨立寫入，歷程失敗會留下沒有歷程的回覆；allowlist m6-w29-reply-transaction）。
--   workspace_stockout_delete_report：刪除一筆回報，並在該商品已無任何回報時一起清掉目前回覆（歷程保留），與舊版規則相同，但在同一個交易內，不會在「數到零」與「清回覆」之間被新回報插進來。
-- 資料表 stockout_reports / stockout_product_responses / stockout_product_response_history 在 DEV 與正式區都已存在，本檔不動它們。
-- 還原：20261122110000_m6_stockout_rpc.rollback.sql。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.stockout_reports') IS NULL
     OR to_regclass('public.stockout_product_responses') IS NULL
     OR to_regclass('public.stockout_product_response_history') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: stockout_* 資料表不存在';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.workspace_stockout_respond(p_code text, p_name text, p_content text, p_eta date, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_row public.stockout_product_responses%ROWTYPE;
BEGIN
  IF coalesce(btrim(p_code), '') = '' OR coalesce(btrim(p_name), '') = '' OR coalesce(btrim(p_content), '') = '' OR p_eta IS NULL THEN
    RAISE EXCEPTION 'MISSING_FIELDS';
  END IF;
  INSERT INTO public.stockout_product_responses (product_code, product_name, response_content, eta_date, responded_by, responded_at)
  VALUES (btrim(p_code), btrim(p_name), btrim(p_content), p_eta, p_user, now())
  ON CONFLICT (product_code) DO UPDATE
    SET product_name = EXCLUDED.product_name,
        response_content = EXCLUDED.response_content,
        eta_date = EXCLUDED.eta_date,
        responded_by = EXCLUDED.responded_by,
        responded_at = EXCLUDED.responded_at
  RETURNING * INTO v_row;
  INSERT INTO public.stockout_product_response_history (response_id, product_code, product_name, response_content, eta_date, responded_by, responded_at)
  VALUES (v_row.id, v_row.product_code, v_row.product_name, v_row.response_content, v_row.eta_date, v_row.responded_by, v_row.responded_at);
  RETURN to_jsonb(v_row);
END;
$f$;

CREATE OR REPLACE FUNCTION public.workspace_stockout_delete_report(p_id uuid, p_user uuid, p_can_manage boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_code text;
  v_left integer;
  v_cleared boolean := false;
BEGIN
  -- 同一商品編號的刪除與回覆互相序列化
  SELECT product_code INTO v_code FROM public.stockout_reports
   WHERE id = p_id AND (p_can_manage OR reported_by = p_user);
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('found', false, 'cleared', false);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace_stockout:' || v_code, 0));
  DELETE FROM public.stockout_reports WHERE id = p_id AND (p_can_manage OR reported_by = p_user);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'cleared', false);
  END IF;
  SELECT count(*) INTO v_left FROM public.stockout_reports WHERE product_code = v_code;
  IF v_left = 0 THEN
    DELETE FROM public.stockout_product_responses WHERE product_code = v_code;
    v_cleared := true;
  END IF;
  RETURN jsonb_build_object('found', true, 'cleared', v_cleared, 'product_code', v_code);
END;
$f$;

REVOKE ALL ON FUNCTION public.workspace_stockout_respond(text, text, text, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_stockout_delete_report(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_stockout_respond(text, text, text, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_stockout_delete_report(uuid, uuid, boolean) TO service_role;
