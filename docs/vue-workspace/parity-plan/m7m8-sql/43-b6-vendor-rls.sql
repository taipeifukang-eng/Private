-- 43-b6-vendor-rls.sql
-- 正式區草稿（尚未執行，僅供使用者審閱；名單確認前不得套用，要最後套用）。內容與 DEV 已測過的 supabase/workspace-dev/20261118090000_m7m8_b6_vendor_columns_rls.sql 第 3 段（RLS 收緊）相同。
-- 第 6 批 B（Q22、V1 廠商資料機密）（2026-11-17 第 6 批問卷）。
-- 性質：改 3 張表的 RLS 政策，影響舊 Next 廠商頁與所有直連資料表的程式（新版一律走 SECURITY DEFINER 函式，不受影響）：
--   ga_vendors：只留「廠商檢視／管理」讀、「廠商管理」新增與修改；沒有 DELETE 政策（廠商不可刪除，不合作改停用）。原本「有服務中心入口（甚至店長）就能讀寫全部、含統編與付款條件、可刪除」。
--   ga_service_categories、ga_service_regions：讀取給自己的檢視／管理或廠商檢視／管理（廠商表單下拉）；寫入只給自己的管理；沒有 DELETE 政策。
-- 重要（未經使用者確認 41 第 6、7 區名單前，不得套用）：套用後，只有分類、區域、合作紀錄權限者與店長在舊版廠商頁讀不到廠商資料（新版 44 的遮蔽函式會讓他們看到不含帳務的下拉）。
--   舊版需求單採購評估頁（app/api/general-affairs/requests/[id]/purchase-review）直接讀廠商，對沒有廠商檢視權限者下拉會變空（舊頁不動，已登記白名單 m7m8-b6-legacy-purchase-review-vendors-empty）。
-- 先決條件：先套 42、44、47 並完成驗收；第 5 區的現行政策全文先存檔。撤回檔把政策還原成「有服務中心入口即可讀寫」（若正式區原本不是這樣，以 41 第 5 區存檔為準）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：43-b6-vendor-rls-rollback.sql。套用前先跑 41-b6-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

-- 現行政策存檔成可直接執行的 CREATE POLICY 語句（審查 A3：43 撤回直接執行這份，不靠人工改寫；ON CONFLICT DO NOTHING 保留最初原況）。
CREATE TABLE IF NOT EXISTS public.ga_m7m8_b6_apply_log (k text PRIMARY KEY, v jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ga_m7m8_b6_apply_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_m7m8_b6_apply_log FROM PUBLIC, anon, authenticated;
INSERT INTO public.ga_m7m8_b6_apply_log (k, v)
SELECT 'b43.policies.' || t.n, jsonb_build_object(
  'rls_enabled', (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = ('public.' || t.n)::regclass),
  'statements', COALESCE((SELECT jsonb_agg(format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s', p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd, array_to_string(p.roles, ', '),
                                      CASE WHEN p.qual IS NOT NULL THEN ' USING (' || p.qual || ')' ELSE '' END, CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || p.with_check || ')' ELSE '' END) ORDER BY p.policyname)
                            FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.n), '[]'::jsonb))
  FROM (VALUES ('ga_vendors'), ('ga_service_categories'), ('ga_service_regions')) t(n)
ON CONFLICT (k) DO NOTHING;

ALTER TABLE public.ga_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_regions ENABLE ROW LEVEL SECURITY;

-- 廠商
DROP POLICY IF EXISTS p1e_ga_vendors_read ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_write ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_insert ON public.ga_vendors;
DROP POLICY IF EXISTS p1e_ga_vendors_update ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_read ON public.ga_vendors FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_vendors_insert ON public.ga_vendors FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_vendors_update ON public.ga_vendors FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.vendor.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.vendor.manage'));

-- 服務分類
DROP POLICY IF EXISTS p1e_ga_service_categories_read ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_write ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_insert ON public.ga_service_categories;
DROP POLICY IF EXISTS p1e_ga_service_categories_update ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_read ON public.ga_service_categories FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_category.view') OR public.current_user_has_permission('general_affairs.service_category.manage')
  OR public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_service_categories_insert ON public.ga_service_categories FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.service_category.manage'));
CREATE POLICY p1e_ga_service_categories_update ON public.ga_service_categories FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.service_category.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_category.manage'));

-- 服務區域
DROP POLICY IF EXISTS p1e_ga_service_regions_read ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_write ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_insert ON public.ga_service_regions;
DROP POLICY IF EXISTS p1e_ga_service_regions_update ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_read ON public.ga_service_regions FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_region.view') OR public.current_user_has_permission('general_affairs.service_region.manage')
  OR public.current_user_has_permission('general_affairs.vendor.view') OR public.current_user_has_permission('general_affairs.vendor.manage'));
CREATE POLICY p1e_ga_service_regions_insert ON public.ga_service_regions FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.service_region.manage'));
CREATE POLICY p1e_ga_service_regions_update ON public.ga_service_regions FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.service_region.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_region.manage'));

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 核對：三張表都不應有 DELETE（cmd = DELETE 或 ALL）政策
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('ga_vendors', 'ga_service_categories', 'ga_service_regions') ORDER BY 1, 2;
