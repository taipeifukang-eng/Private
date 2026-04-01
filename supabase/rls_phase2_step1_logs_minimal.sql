-- ============================================================
-- Phase 2 - Step 1: logs 最小權限收斂（不影響既有任務流程）
-- 目標：
-- 1) authenticated 保留 SELECT + INSERT（任務打勾寫 log 需要）
-- 2) 禁止 authenticated UPDATE/DELETE（降低誤改歷史紀錄風險）
-- 3) service_role 保留 ALL
-- 4) anon 全封鎖
-- ============================================================

BEGIN;

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- 先移除 Phase 1 的寬鬆策略
DROP POLICY IF EXISTS "rls_v1_logs_authenticated_all" ON public.logs;

-- 若之前已有相同命名策略，先清掉避免重複
DROP POLICY IF EXISTS "rls_v2_logs_authenticated_select" ON public.logs;
DROP POLICY IF EXISTS "rls_v2_logs_authenticated_insert" ON public.logs;
DROP POLICY IF EXISTS "rls_v2_logs_service_role_all" ON public.logs;
DROP POLICY IF EXISTS "rls_v2_logs_anon_deny" ON public.logs;

-- service_role 維持全權限
CREATE POLICY "rls_v2_logs_service_role_all"
ON public.logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- authenticated 僅可讀
CREATE POLICY "rls_v2_logs_authenticated_select"
ON public.logs
FOR SELECT
TO authenticated
USING (true);

-- authenticated 僅可新增（logAction 需要）
CREATE POLICY "rls_v2_logs_authenticated_insert"
ON public.logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- anon 全封鎖
CREATE POLICY "rls_v2_logs_anon_deny"
ON public.logs
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

COMMIT;

-- ============================================================
-- 驗證 SQL
-- ============================================================
-- 1) RLS 開啟
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'logs';
--
-- 2) 策略列表
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'logs'
-- ORDER BY policyname;
--
-- 3) 功能驗證（手動）
-- - 任務詳情頁勾選/取消任一步驟 -> 應成功（INSERT logs）
-- - 我的任務/儀表板進度顯示 -> 應正常（SELECT logs）
-- - 不應存在前台更新或刪除 logs 的流程
