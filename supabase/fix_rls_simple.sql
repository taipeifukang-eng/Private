-- =====================================================
-- 最簡化的 RLS 策略 - 確保督導能查看自己的記錄
-- =====================================================
-- 這個版本移除所有複雜條件，只保留核心邏輯
-- =====================================================

-- 1. 先完全停用 RLS（測試用）
ALTER TABLE inspection_masters DISABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results DISABLE ROW LEVEL SECURITY;

-- 測試查詢 1: 停用 RLS 後應該能看到所有記錄
SELECT 
  '=== 測試 1: 停用 RLS 後的查詢 ===' as test,
  COUNT(*) as total_records
FROM inspection_masters;

-- 測試查詢 2: 查詢當前用戶的記錄
SELECT 
  '=== 測試 2: 當前用戶的記錄 ===' as test,
  im.id,
  im.inspector_id,
  im.inspection_date,
  im.status,
  s.store_name
FROM inspection_masters im
LEFT JOIN stores s ON s.id = im.store_id
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;

-- 如果上面能查到記錄，代表 RLS 策略有問題
-- 如果仍然查不到，代表 stores JOIN 或其他問題

-- 2. 重新啟用 RLS 並使用最簡化策略
ALTER TABLE inspection_masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;

-- 刪除所有舊的 SELECT 策略
DROP POLICY IF EXISTS "用戶可以查看相關的巡店記錄" ON inspection_masters;
DROP POLICY IF EXISTS "可以查看巡店記錄的用戶可以查看結果明細" ON inspection_results;

-- inspection_masters: 最簡化的 SELECT 策略
CREATE POLICY "督導查看自己的巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  -- 只要是自己創建的就能查看，沒有任何其他條件
  inspector_id = auth.uid()
);

-- inspection_results: 最簡化的 SELECT 策略
CREATE POLICY "督導查看自己的巡店明細"
ON inspection_results
FOR SELECT
TO authenticated
USING (
  -- 只要主記錄是自己的就能查看明細
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
  )
);

-- 測試查詢 3: 啟用 RLS 後的查詢
SELECT 
  '=== 測試 3: 啟用 RLS 後的查詢 ===' as test,
  COUNT(*) as visible_records
FROM inspection_masters;

-- 測試查詢 4: 完整查詢
SELECT 
  '=== 測試 4: 完整查詢 ===' as test,
  im.id,
  im.inspection_date,
  im.status,
  im.grade,
  s.store_name,
  p.full_name as inspector_name
FROM inspection_masters im
LEFT JOIN stores s ON s.id = im.store_id
LEFT JOIN profiles p ON p.id = im.inspector_id
WHERE im.inspector_id = auth.uid()
ORDER BY im.created_at DESC
LIMIT 5;

-- 如果測試 4 有結果，代表修復成功！
