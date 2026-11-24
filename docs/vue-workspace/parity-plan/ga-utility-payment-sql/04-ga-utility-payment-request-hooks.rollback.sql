-- ============================================================================
-- 正式區草稿 04（撤回）。內容與 DEV 已實測的 supabase/workspace-dev/20261124130000_ga_utility_payment_request_hooks.rollback.sql 相同。
-- 狀態：草稿，尚未套用到正式區；須老闆核可後，依 README.md 的順序執行。上線時間：12/8 全面切換之後（約 12/15 週）。
-- 不授權給任何角色（不含任何 GRANT 給角色、不新增權限碼）；可重複執行（已套用的部分略過）。
-- ============================================================================
-- 還原 20261124130000_ga_utility_payment_request_hooks.sql（水電話費請款階段 4：既有請款單函式的加掛）。
-- 依 GAUP-BEGIN／GAUP-END 標記把加掛文字從 ga_pay_request_json、ga_ws_pay_request_list、ga_ws_pay_request_update、ga_ws_pay_export 移除；
-- ga_ws_pay_request_action 的行內加掛（/* GAUP */）還原成原本的檢查。不整支覆蓋，其他人後來的修改不受影響。可重複執行。
-- 去掉 GAUP-BEGIN／GAUP-END 標記包住的加掛文字（撤回用；也供本檔重跑時的判斷）。
CREATE OR REPLACE FUNCTION public.ga_gaup_strip(p_text text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  v text := p_text;
  v_b integer;
  v_e integer;
  v_ls integer;
  v_cut integer;
BEGIN
  LOOP
    v_b := position('-- GAUP-BEGIN' IN v);
    EXIT WHEN v_b = 0;
    v_e := position('-- GAUP-END' IN substr(v, v_b));
    IF v_e = 0 THEN RAISE EXCEPTION 'GAUP-BEGIN 沒有對應的 GAUP-END'; END IF;
    v_e := v_b + v_e - 1 + length('-- GAUP-END');
    v_ls := v_b;
    WHILE v_ls > 1 AND substr(v, v_ls - 1, 1) <> E'\n' LOOP v_ls := v_ls - 1; END LOOP;
    v_cut := v_e;
    IF substr(v, v_cut, 1) = E'\n' THEN v_cut := v_cut + 1; END IF;
    v := substr(v, 1, v_ls - 1) || substr(v, v_cut);
  END LOOP;
  RETURN v;
END;
$f$;


DO $$
DECLARE
  v_sig text;
  v_def text;
  v_old text := $a$IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$a$;
  v_new text := $a$IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) AND NOT EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines WHERE pr_id = q.id) /* GAUP */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$a$;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.ga_pay_request_json(uuid,boolean,boolean,boolean)', 'public.ga_ws_pay_request_list(jsonb,integer,integer)',
    'public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)', 'public.ga_ws_pay_export(jsonb)'] LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      v_def := pg_get_functiondef(v_sig::regprocedure);
      IF position('GAUP-BEGIN' IN v_def) > 0 THEN
        v_def := public.ga_gaup_strip(v_def);
        IF position('GAUP' IN v_def) > 0 THEN RAISE EXCEPTION '% 還有無法自動移除的 GAUP 標記，請人工處理', v_sig; END IF;
        EXECUTE v_def;
      END IF;
    END IF;
  END LOOP;
  v_sig := 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)';
  IF to_regprocedure(v_sig) IS NOT NULL THEN
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position(v_new IN v_def) > 0 THEN
      EXECUTE replace(v_def, v_new, v_old);
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.ga_gaup_strip(text);
NOTIFY pgrst, 'reload schema';
