-- =====================================================
-- 修復 inspection_masters UPDATE RLS 策略
-- =====================================================
-- 問題：原策略缺少 WITH CHECK，導致 PostgreSQL 自動使用 USING 條件
--       當 status 從 draft → completed 時，更新後不符合 USING 條件
--       （status IN ('draft', 'in_progress')），因此被 RLS 拒絕
-- 修復：加入 WITH CHECK 只檢查 inspector_id，允許狀態從 draft → completed
-- =====================================================

DROP POLICY IF EXISTS "督導可以更新自己的巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以更新自己的巡店記錄"
ON inspection_masters
FOR UPDATE
TO authenticated
USING (
  -- 更新前：必須是自己建立的 + 狀態為 draft 或 in_progress
  inspector_id = auth.uid()
  AND status IN ('draft', 'in_progress')
)
WITH CHECK (
  -- 更新後：只要是自己建立的即可（允許 status 變為 completed）
  inspector_id = auth.uid()
);
