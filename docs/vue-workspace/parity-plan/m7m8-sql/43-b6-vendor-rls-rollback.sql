-- 43-b6-vendor-rls-rollback.sql
-- 撤回 43：把廠商、分類、區域三張表的政策還原成「有服務中心入口即可讀寫」（DEV 原況）。
-- 重要：正式區原本的政策可能與下列不同——以 41-b6-preview-before-apply.sql 第 5 區「現行政策」存檔為準；若不同，請依存檔改寫下面的 CREATE POLICY 再執行。
BEGIN;
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
NOTIFY pgrst, 'reload schema';
COMMIT;
