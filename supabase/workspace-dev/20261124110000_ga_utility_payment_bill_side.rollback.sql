-- 還原 20261124110000_ga_utility_payment_bill_side.sql（水電話費請款階段 2：帳單端）。
-- 依 GAUP-BEGIN／GAUP-END 標記把加掛的文字從 ga_utility_bill_before_write、ga_ub_json、ga_ws_ub_save、ga_ws_ub_list 移除（不整支覆蓋，其他人後來的修改不受影響），並刪除本階段新增的函式與觸發器。
-- 先決：120000、130000、140000 已先撤回。可重複執行。
-- 注意：若有帳單位於已送出或已付款的水電請款單內，撤回前請先退回或作廢那些請款單（請款單內的帳單鎖定規則隨觸發器一起移除）。

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
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.ga_utility_bill_before_write()', 'public.ga_ub_json(uuid)',
    'public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)', 'public.ga_ws_ub_list(jsonb,integer,integer)'] LOOP
    IF to_regprocedure(v_sig) IS NOT NULL THEN
      v_def := pg_get_functiondef(v_sig::regprocedure);
      IF position('GAUP-BEGIN' IN v_def) > 0 THEN
        v_def := public.ga_gaup_strip(v_def);
        IF position('GAUP' IN v_def) > 0 THEN RAISE EXCEPTION '% 還有無法自動移除的 GAUP 標記，請人工處理', v_sig; END IF;
        EXECUTE v_def;
      END IF;
    END IF;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.ga_gaup_strip(text);

DROP TRIGGER IF EXISTS trg_ga_pay_ub_attachment_last_guard ON public.ga_resource_attachments;
DROP FUNCTION IF EXISTS public.ga_pay_ub_attachment_last_guard();
DROP FUNCTION IF EXISTS public.ga_ws_ub_set_payee(uuid[], uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ub_payees();
DROP FUNCTION IF EXISTS public.ga_ub_json_ext(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_ub_bill_lock_check(public.ga_utility_bills, public.ga_utility_bills);
DROP FUNCTION IF EXISTS public.ga_ub_check_payee(uuid);
DROP FUNCTION IF EXISTS public.ga_pay_ub_label(public.ga_utility_bills);
DROP FUNCTION IF EXISTS public.ga_pay_ub_ident(text, text, text);
NOTIFY pgrst, 'reload schema';
