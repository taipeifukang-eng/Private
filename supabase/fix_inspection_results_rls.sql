-- =====================================================
-- 修復 inspection_results 的 RLS 策略
-- =====================================================
-- 問題: WITH CHECK 條件過於嚴格，不允許在 completed 狀態下插入明細
-- 解決: 移除狀態限制，只要是督導本人創建的巡店記錄就可以插入明細
-- =====================================================

-- 刪除舊的策略
DROP POLICY IF EXISTS "督導可以管理自己巡店記錄的結果明細" ON inspection_results;

-- 策略 3.2 (修復版)：督導可以插入/更新/刪除自己巡店記錄的結果明細
CREATE POLICY "督導可以管理自己巡店記錄的結果明細"
ON inspection_results
FOR ALL
TO authenticated
USING (
  -- 查詢/更新/刪除：只能操作自己的巡店記錄，且狀態不是已結案
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status != 'closed'  -- 除了已結案，其他狀態都可以操作
  )
)
WITH CHECK (
  -- 插入/更新：只要是督導本人創建的巡店記錄就可以
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
  )
);

-- 驗證：測試查詢
-- 如果有 inspection_masters 記錄，這應該返回結果
SELECT 
  im.id,
  im.inspector_id,
  im.status,
  COUNT(ir.id) as results_count
FROM inspection_masters im
LEFT JOIN inspection_results ir ON ir.inspection_id = im.id
WHERE im.inspector_id = auth.uid()
GROUP BY im.id, im.inspector_id, im.status
ORDER BY im.created_at DESC
LIMIT 5;
