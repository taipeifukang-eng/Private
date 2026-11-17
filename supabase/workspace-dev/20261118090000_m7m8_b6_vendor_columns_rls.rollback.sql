-- 還原 20261118090000_m7m8_b6_vendor_columns_rls.sql：政策還原成備份原文（有服務中心入口即可讀寫）、移除縣市行政區固定資料（只刪沒被廠商使用的）、移除 updated_by 與新增的索引、預設值還原。
-- 13 個廠商擴充欄位在 DEV 原本就存在，不移除；既有廠商 contract_required 的值不還原。
DROP POLICY IF EXISTS p1e_ga_vendors_insert ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_update ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_service_categories_insert ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_update ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_regions_insert ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_update ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_vendors_read ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_read ON public.ga_vendors FOR SELECT TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access'));
DROP POLICY IF EXISTS p1e_ga_vendors_write ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_write ON public.ga_vendors FOR ALL TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access')) WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));
DROP POLICY IF EXISTS p1e_ga_service_categories_read ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_read ON public.ga_service_categories FOR SELECT TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access'));
DROP POLICY IF EXISTS p1e_ga_service_categories_write ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_write ON public.ga_service_categories FOR ALL TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access')) WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));
DROP POLICY IF EXISTS p1e_ga_service_regions_read ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_read ON public.ga_service_regions FOR SELECT TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access'));
DROP POLICY IF EXISTS p1e_ga_service_regions_write ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_write ON public.ga_service_regions FOR ALL TO authenticated USING (public.current_user_has_permission('general_affairs.service_center.access')) WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));

-- 固定資料：由下往上刪（行政區、縣市、大區、國家），跳過被廠商使用的；只依固定資料的 code 認定。
DO $$
DECLARE
  v_type text;
BEGIN
  FOREACH v_type IN ARRAY ARRAY['district', 'city', 'region', 'country'] LOOP
    DELETE FROM public.ga_service_regions r
     WHERE r.region_type = v_type
       AND (r.code IN ('TW', 'TW-N', 'TW-C', 'TW-S', 'TW-E', 'TW-O') OR r.code ~ '^(KEE|TPE|TPH|TYC|HSZ|HSQ|ILA|MIA|TXG|CHA|NAN|YUN|CYI|CYQ|TNN|KHH|PIF|HUA|TTT|PEN|KIN|LIE)(-[0-9]{2})?$')
       AND NOT EXISTS (SELECT 1 FROM public.ga_vendors v WHERE r.id = ANY (v.service_region_ids))
       AND NOT EXISTS (SELECT 1 FROM public.ga_service_regions c WHERE c.parent_id = r.id);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.idx_ga_vendors_contract_due;
DROP INDEX IF EXISTS public.uq_ga_service_regions_code;
DROP INDEX IF EXISTS public.uq_ga_service_categories_code;
ALTER TABLE public.ga_vendors ALTER COLUMN contract_required SET DEFAULT true;
ALTER TABLE public.ga_vendors ALTER COLUMN preferred_vendor SET DEFAULT true;
ALTER TABLE public.ga_vendors DROP COLUMN IF EXISTS updated_by;
ALTER TABLE public.ga_service_categories DROP COLUMN IF EXISTS updated_by;
ALTER TABLE public.ga_service_regions DROP COLUMN IF EXISTS updated_by;
NOTIFY pgrst, 'reload schema';
