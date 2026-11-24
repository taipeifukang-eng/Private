-- ============================================================================
-- 正式區草稿 04（套用）。內容與 DEV 已實測的 supabase/workspace-dev/20261124130000_ga_utility_payment_request_hooks.sql 相同。
-- 狀態：草稿，尚未套用到正式區；須老闆核可後，依 README.md 的順序執行。上線時間：12/8 全面切換之後（約 12/15 週）。
-- 不授權給任何角色（不含任何 GRANT 給角色、不新增權限碼）；可重複執行（已套用的部分略過）。
-- ============================================================================
-- 水電話費請款（G46）階段 4：對既有請款單函式的最小加掛（正式區草稿）。
-- 每處都以「來源是水電才分流或多做事」為條件，採購路徑的程式碼與行為不變；讀現行定義＋文字替換，形狀不符就中止、已套用就略過、不整支覆蓋。
-- 加掛內容：
--   ga_pay_request_json     輸出多水電欄位與明細（bill_count、bills_masked、auto_marked_count…；p_detail 且有水電檢視權限時多 bill_lines）；source、bill_month、auto_mark_paid 隨 to_jsonb(q) 自動輸出；採購單的 lines 輸出不變
--   ga_ws_pay_request_list  篩選多 source（PURCHASE／UTILITY，空＝全部）
--   ga_ws_pay_request_update 開頭加：來源是水電就轉呼叫 ga_ws_pay_ub_update
--   ga_ws_pay_request_action 送出分支的「沒有任何明細」檢查多認水電明細（其餘不動）
--   ga_ws_pay_export        篩選多 source；UTILITY 轉呼叫 ga_ws_pay_export_ub；未帶 source 或 PURCHASE 行為完全不變
-- 加掛文字以 GAUP-BEGIN／GAUP-END（或行內 /* GAUP */）標記；撤回時依標記移除。
-- 先決：20261124100000 至 20261124120000。可重複執行。還原：04-ga-utility-payment-request-hooks.rollback.sql。

DO $$
BEGIN
  IF to_regprocedure('public.ga_pay_ub_json_ext(uuid,boolean)') IS NULL OR to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)') IS NULL OR to_regprocedure('public.ga_ws_pay_export_ub(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261124120000_ga_utility_payment_request_core';
  END IF;
  IF to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NULL OR to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)') IS NULL
     OR to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)') IS NULL OR to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.ga_ws_pay_export(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 第 4.5 批請款單函式';
  END IF;
END $$;

-- 文字替換輔助（本檔結尾會刪除）：找不到、或出現不只一次就中止。
CREATE OR REPLACE FUNCTION public.ga_gaup_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- 1. 請款單 JSON
  v_def := pg_get_functiondef('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'::regprocedure);
  IF position('GAUP' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  RETURN v_out;$a$,
$a$  -- GAUP-BEGIN
  IF q.source = 'UTILITY' THEN v_out := v_out || public.ga_pay_ub_json_ext(q.id, p_detail); END IF;
  -- GAUP-END
  RETURN v_out;$a$, 'ga_pay_request_json');
    EXECUTE v_new;
  END IF;

  -- 2. 請款單列表：來源篩選
  v_def := pg_get_functiondef('public.ga_ws_pay_request_list(jsonb,integer,integer)'::regprocedure);
  IF position('GAUP' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;$a$,
$a$  -- GAUP-BEGIN
  IF upper(COALESCE(v_f ->> 'source', '')) NOT IN ('', 'PURCHASE', 'UTILITY') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '來源篩選值錯誤'); END IF;
  -- GAUP-END
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;$a$, 'ga_ws_pay_request_list 驗證');
    v_new := public.ga_gaup_swap(v_new, $a$OR q.vendor_name_snapshot ILIKE v_pat ESCAPE '\')$a$,
$a$OR q.vendor_name_snapshot ILIKE v_pat ESCAPE '\')
       -- GAUP-BEGIN
       AND (COALESCE(v_f ->> 'source', '') = '' OR q.source = upper(v_f ->> 'source'))
       -- GAUP-END$a$, 'ga_ws_pay_request_list 條件');
    EXECUTE v_new;
  END IF;

  -- 3. 修改草稿：水電單轉呼叫水電版本
  v_def := pg_get_functiondef('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)'::regprocedure);
  IF position('GAUP' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;$a$,
$a$  -- GAUP-BEGIN
  IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE id = p_id AND source = 'UTILITY') THEN
    RETURN public.ga_ws_pay_ub_update(p_id, p_payload, p_expected_updated_at);
  END IF;
  -- GAUP-END
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;$a$, 'ga_ws_pay_request_update');
    EXECUTE v_new;
  END IF;

  -- 4. 動作：送出時的「沒有任何明細」檢查多認水電明細
  v_def := pg_get_functiondef('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'::regprocedure);
  IF position('GAUP' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$a$,
$a$IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines WHERE pr_id = q.id) /* GAUP */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$a$, 'ga_ws_pay_request_action');
    EXECUTE v_new;
  END IF;

  -- 5. 對帳匯出：來源為水電時轉呼叫水電版本（未帶來源或 PURCHASE 行為不變）
  v_def := pg_get_functiondef('public.ga_ws_pay_export(jsonb)'::regprocedure);
  IF position('GAUP' IN v_def) = 0 THEN
    v_new := public.ga_gaup_swap(v_def, $a$  v_can_vendor := public.ga_pay_can_vendor(v_uid);$a$,
$a$  v_can_vendor := public.ga_pay_can_vendor(v_uid);
  -- GAUP-BEGIN
  IF upper(COALESCE(v_f ->> 'source', '')) NOT IN ('', 'PURCHASE', 'UTILITY') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '來源篩選值錯誤'); END IF;
  IF upper(COALESCE(v_f ->> 'source', '')) = 'UTILITY' THEN RETURN public.ga_ws_pay_export_ub(v_f); END IF;
  -- GAUP-END$a$, 'ga_ws_pay_export');
    EXECUTE v_new;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.ga_gaup_swap(text, text, text, text);
NOTIFY pgrst, 'reload schema';
