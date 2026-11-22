-- 43-b6-vendor-rls-rollback.sql
-- 撤回 43（審查 A3 改版）：43 套用時已把三張表的現行政策與 RLS 開關存成可直接執行的 CREATE POLICY 語句（ga_m7m8_b6_apply_log，k 以 b43. 開頭），這份直接執行它們，不再假設原況、不需人工改寫。
-- 找不到存檔會中止（改用 41 第 5 區存檔或資料庫備份）。撤回順序：先 43、再 42（42 撤回時會清掉存檔表）。
BEGIN;
DO $$
DECLARE
  v_t text;
  r record;
  s text;
  j jsonb;
BEGIN
  IF to_regclass('public.ga_m7m8_b6_apply_log') IS NULL THEN RAISE EXCEPTION '找不到 43 的政策存檔（ga_m7m8_b6_apply_log），無法依原況撤回；請改用 41 第 5 區存檔或資料庫備份'; END IF;
  FOREACH v_t IN ARRAY ARRAY['ga_vendors', 'ga_service_categories', 'ga_service_regions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b43.policies.' || v_t) THEN RAISE EXCEPTION '找不到 % 的政策存檔，無法依原況撤回', v_t; END IF;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['ga_vendors', 'ga_service_categories', 'ga_service_regions'] LOOP
    SELECT l.v INTO j FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b43.policies.' || v_t;
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t LOOP EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, v_t); END LOOP;
    FOR s IN SELECT jsonb_array_elements_text(j -> 'statements') LOOP EXECUTE s; END LOOP;
    EXECUTE format('ALTER TABLE public.%I %s ROW LEVEL SECURITY', v_t, CASE WHEN (j ->> 'rls_enabled')::boolean THEN 'ENABLE' ELSE 'DISABLE' END);
  END LOOP;
  DELETE FROM public.ga_m7m8_b6_apply_log WHERE k LIKE 'b43.%';
  IF NOT EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log) THEN DROP TABLE public.ga_m7m8_b6_apply_log; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
