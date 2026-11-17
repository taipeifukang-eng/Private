-- 還原 20261118090000_m7m8_b6_vendor_columns_rls.sql：依 ga_m7m8_b6_apply_log 的「套用前存檔」還原（政策原文、套用前已存在的區域／索引／預設值／updated_by），
-- 先還原 RLS 政策（b43），再還原欄位與固定資料（b42，最後清掉存檔表）。13 個廠商擴充欄位在 DEV 原本就存在，不移除。
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
END $$;
NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_type text;
  v_t text;
  v_d text;
  v_n text;
BEGIN
  IF to_regclass('public.ga_m7m8_b6_apply_log') IS NULL OR NOT EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log WHERE k = 'b42.region_ids_before') THEN
    RAISE EXCEPTION '找不到 42 的套用前存檔（ga_m7m8_b6_apply_log），無法依原況撤回；請改用套用前的資料庫備份';
  END IF;
  -- 區域：只刪「42 套用前不存在」的列（依 id 清單），由下往上，跳過被廠商使用或有下層的。
  FOREACH v_type IN ARRAY ARRAY['district', 'city', 'region', 'country'] LOOP
    DELETE FROM public.ga_service_regions r
     WHERE r.region_type = v_type
       AND r.id::text NOT IN (SELECT jsonb_array_elements_text(l.v) FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.region_ids_before')
       AND NOT EXISTS (SELECT 1 FROM public.ga_vendors v WHERE r.id = ANY (v.service_region_ids))
       AND NOT EXISTS (SELECT 1 FROM public.ga_service_regions c WHERE c.parent_id = r.id);
  END LOOP;
  -- 索引：只移除 42 新建的。
  FOREACH v_n IN ARRAY ARRAY['idx_ga_vendors_contract_due', 'uq_ga_service_regions_code', 'uq_ga_service_categories_code'] LOOP
    IF v_n NOT IN (SELECT jsonb_array_elements_text(l.v) FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.indexes_before') THEN EXECUTE format('DROP INDEX IF EXISTS public.%I', v_n); END IF;
  END LOOP;
  -- 預設值：還原成存檔的原預設（原本沒有預設就移除）。
  FOREACH v_n IN ARRAY ARRAY['contract_required', 'preferred_vendor'] LOOP
    SELECT l.v #>> '{}' INTO v_d FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.default.' || v_n;
    IF v_d IS NOT NULL THEN EXECUTE format('ALTER TABLE public.ga_vendors ALTER COLUMN %I SET DEFAULT %s', v_n, v_d);
    ELSIF EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.default.' || v_n) THEN EXECUTE format('ALTER TABLE public.ga_vendors ALTER COLUMN %I DROP DEFAULT', v_n); END IF;
  END LOOP;
  -- 42 一次性改成 false 的廠商，改回原本的 true。
  UPDATE public.ga_vendors v SET contract_required = true
   WHERE v.id::text IN (SELECT jsonb_array_elements_text(l.v) FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.contract_required_true_ids');
  -- updated_by：只有 42 新增的才移除（原本就存在的保留，避免丟資料）。
  FOREACH v_t IN ARRAY ARRAY['ga_vendors', 'ga_service_categories', 'ga_service_regions'] LOOP
    IF EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log l WHERE l.k = 'b42.updated_by_existed.' || v_t AND l.v = 'false'::jsonb) THEN EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS updated_by', v_t); END IF;
  END LOOP;
  DELETE FROM public.ga_m7m8_b6_apply_log WHERE k LIKE 'b42.%';
  IF NOT EXISTS (SELECT 1 FROM public.ga_m7m8_b6_apply_log) THEN DROP TABLE public.ga_m7m8_b6_apply_log; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
