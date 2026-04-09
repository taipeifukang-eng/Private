-- ============================================================
-- Phase 2 - Step 3: campaign_department_publish 最小權限收斂
-- 目標：
-- 1) authenticated：保留 SELECT + INSERT + UPDATE（現有 API 的 upsert 需要）
-- 2) 禁止 authenticated DELETE
-- 3) service_role：保留 ALL
-- 4) anon：全封鎖
--
-- 備註：
-- - API 已有 hasPermission() 檢查 activity.marketing.publish / activity.merchandise.publish
-- - 此處是資料庫層第二道防線
-- ============================================================

BEGIN;

ALTER TABLE public.campaign_department_publish ENABLE ROW LEVEL SECURITY;

-- 移除 Phase 1 的寬鬆策略
DROP POLICY IF EXISTS "rls_v1_campaign_department_publish_authenticated_all" ON public.campaign_department_publish;

-- 清理舊版 v2 策略（可重跑）
DROP POLICY IF EXISTS "rls_v2_campaign_department_publish_service_role_all" ON public.campaign_department_publish;
DROP POLICY IF EXISTS "rls_v2_campaign_department_publish_authenticated_select" ON public.campaign_department_publish;
DROP POLICY IF EXISTS "rls_v2_campaign_department_publish_authenticated_insert" ON public.campaign_department_publish;
DROP POLICY IF EXISTS "rls_v2_campaign_department_publish_authenticated_update" ON public.campaign_department_publish;
DROP POLICY IF EXISTS "rls_v2_campaign_department_publish_anon_deny" ON public.campaign_department_publish;

-- service_role 維持全權限
CREATE POLICY "rls_v2_campaign_department_publish_service_role_all"
ON public.campaign_department_publish
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- authenticated 可讀
CREATE POLICY "rls_v2_campaign_department_publish_authenticated_select"
ON public.campaign_department_publish
FOR SELECT
TO authenticated
USING (true);

-- authenticated 可新增（建立者與更新者需為自己）
CREATE POLICY "rls_v2_campaign_department_publish_authenticated_insert"
ON public.campaign_department_publish
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND updated_by = auth.uid()
);

-- authenticated 可更新（目前列可見 + 更新者需為自己）
CREATE POLICY "rls_v2_campaign_department_publish_authenticated_update"
ON public.campaign_department_publish
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (updated_by = auth.uid());

-- anon 全封鎖
CREATE POLICY "rls_v2_campaign_department_publish_anon_deny"
ON public.campaign_department_publish
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

COMMIT;

-- ============================================================
-- 驗證 SQL
-- ============================================================
-- 1) RLS 開啟
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'campaign_department_publish';
--
-- 2) 策略列表
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'campaign_department_publish'
-- ORDER BY policyname;
--
-- 3) 功能驗證（手動）
-- - 活動管理 > 部門發布資料可正常讀取（GET）
-- - 行銷/商品部有權限者可正常發布（POST upsert）
-- - 無權限者仍被 API 的 hasPermission 擋下（403）
