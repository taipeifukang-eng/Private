-- ========================================================
-- 修正 2026-01 藥師快照：FK0985 郭政峰 → FKF01501 郭政峰
-- 修正日期：2026-03-31
-- 問題：0015B 百福新豐活力藥局 1 月份藥師員編錯誤
-- ========================================================

-- 1. 查詢目前狀態（執行前檢查）
DO $$
DECLARE
  v_store_id uuid;
  v_old_count int;
  v_new_count int;
BEGIN
  -- 找出新豐店 store_id (store_code = '0015B')
  SELECT id INTO v_store_id
  FROM stores
  WHERE store_code = '0015B'
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION '找不到門市代碼 0015B（百福新豐活力藥局），請確認 store_code';
  END IF;

  RAISE NOTICE '✓ 百福新豐活力藥局 store_id: %', v_store_id;

  -- 檢查是否存在 FK0985 的記錄
  SELECT COUNT(*) INTO v_old_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-01'
    AND store_id = v_store_id
    AND employee_code = 'FK0985';

  IF v_old_count = 0 THEN
    RAISE EXCEPTION '✗ 找不到 2026-01 新豐店 FK0985 的記錄，請確認資料';
  END IF;

  RAISE NOTICE '✓ 找到 % 筆 FK0985 記錄', v_old_count;

  -- 檢查是否已存在 FKF01501
  SELECT COUNT(*) INTO v_new_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-01'
    AND store_id = v_store_id
    AND employee_code = 'FKF01501';

  IF v_new_count > 0 THEN
    RAISE WARNING '⚠ 已存在 % 筆 FKF01501 記錄，將會被覆蓋', v_new_count;
  END IF;
END $$;

-- 2. 執行更新（將 FK0985 改為 FKF01501）
UPDATE pharmacist_monthly_snapshot
SET 
  employee_code = 'FKF01501',
  employee_name = '郭政峰',
  notes = COALESCE(notes || '; ', '') || 'corrected from FK0985 to FKF01501 on 2026-03-31',
  updated_at = NOW()
WHERE year_month = '2026-01'
  AND store_id = (SELECT id FROM stores WHERE store_code = '0015B' LIMIT 1)
  AND employee_code = 'FK0985';

-- 3. 驗證結果
DO $$
DECLARE
  v_store_id uuid;
  v_updated_count int;
BEGIN
  SELECT id INTO v_store_id
  FROM stores
  WHERE store_code = '0015B'
  LIMIT 1;

  -- 確認 FK0985 已刪除
  SELECT COUNT(*) INTO v_updated_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-01'
    AND store_id = v_store_id
    AND employee_code = 'FK0985';

  IF v_updated_count > 0 THEN
    RAISE EXCEPTION '✗ 更新失敗：仍存在 % 筆 FK0985 記錄', v_updated_count;
  END IF;

  -- 確認 FKF01501 存在
  SELECT COUNT(*) INTO v_updated_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-01'
    AND store_id = v_store_id
    AND employee_code = 'FKF01501';

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '✗ 更新失敗：找不到 FKF01501 記錄';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ 修正完成！';
  RAISE NOTICE '  2026-01 百福新豐活力藥局 (0015B)';
  RAISE NOTICE '  FK0985 郭政峰 → FKF01501 郭政峰';
  RAISE NOTICE '  共 % 筆記錄已更新', v_updated_count;
  RAISE NOTICE '========================================';
END $$;

-- 4. 查詢最終結果（供確認）
SELECT 
  pms.year_month,
  s.store_code,
  s.store_name,
  pms.employee_code,
  pms.employee_name,
  pms.position,
  pms.is_active,
  pms.source,
  pms.notes
FROM pharmacist_monthly_snapshot pms
JOIN stores s ON s.id = pms.store_id
WHERE pms.year_month = '2026-01'
  AND s.store_code = '0015B'
ORDER BY pms.employee_code;
