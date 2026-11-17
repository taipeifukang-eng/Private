-- 備份：M7/M8 第 6 批套用前，DEV 上廠商、分類、區域三個資料表的政策原文（2026-11-17 實測 pg_policies）。rollback 以此還原。
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
