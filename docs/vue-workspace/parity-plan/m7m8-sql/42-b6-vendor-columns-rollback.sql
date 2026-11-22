-- 42-b6-vendor-columns-rollback.sql
-- 撤回 42（審查 A3 改版）：依 42 套用時存的「套用前現況」（ga_m7m8_b6_apply_log，k 以 b42. 開頭）還原——
--   區域固定資料：只刪 42 套用前不存在的列（依 id 清單；仍跳過被廠商使用或有下層的）；索引：只移除 42 新建的；contract_required、preferred_vendor 預設值還原成存檔的原預設；
--   42 一次性改成 false 的廠商 contract_required 依存檔的 id 清單改回 true；updated_by 只在 42 新增時才移除（原本就有的保留）。
-- 找不到存檔（例如 42 不是用本版套的）會中止並提示改用資料庫備份。不移除 13 個廠商擴充欄位。
-- 先撤回 44、47（它們會讀 updated_by）；43 若已套用先撤回 43。撤回前仍建議備份 ga_vendors、ga_service_categories、ga_service_regions。
BEGIN;
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
COMMIT;
