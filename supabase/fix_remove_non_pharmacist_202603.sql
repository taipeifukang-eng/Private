-- ========================================================
-- 清理 2026-03 藥師快照：移除非藥師人員
-- 修正日期：2026-03-31
-- 問題：FKF01504、FK1098、FK1096 誤標為藥師
-- ========================================================

-- 1. 查詢目前狀態（執行前檢查）
DO $$
DECLARE
  v_count int;
  r RECORD;
BEGIN
  -- 檢查這三個員編在 3 月快照中的記錄
  SELECT COUNT(*) INTO v_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-03'
    AND employee_code IN ('FKF01504', 'FK1098', 'FK1096');

  IF v_count = 0 THEN
    RAISE NOTICE '⚠ 2026-03 快照中沒有找到這三個員編的記錄';
  ELSE
    RAISE NOTICE '✓ 找到 % 筆記錄需要清理', v_count;
  END IF;

  -- 顯示詳細資訊
  RAISE NOTICE '========================================';
  RAISE NOTICE '即將清理的記錄：';
  FOR r IN (
    SELECT pms.employee_code, pms.employee_name, s.store_code, s.store_name, pms.notes
    FROM pharmacist_monthly_snapshot pms
    LEFT JOIN stores s ON s.id = pms.store_id
    WHERE pms.year_month = '2026-03'
      AND pms.employee_code IN ('FKF01504', 'FK1098', 'FK1096')
  ) LOOP
    RAISE NOTICE '  - % (%) @ %', r.employee_code, r.employee_name, r.store_code;
  END LOOP;
  RAISE NOTICE '========================================';
END $$;

-- 2. 清理 2026-03 快照中的錯誤記錄
DELETE FROM pharmacist_monthly_snapshot
WHERE year_month = '2026-03'
  AND employee_code IN ('FKF01504', 'FK1098', 'FK1096');

-- 3. 修正來源資料：employee_movement_history 的 onboarding_is_pharmacist
-- 將這三個人的入職記錄標記為非藥師
UPDATE employee_movement_history
SET onboarding_is_pharmacist = false
WHERE movement_type = 'onboarding'
  AND employee_code IN ('FKF01504', 'FK1098', 'FK1096')
  AND onboarding_is_pharmacist = true;

-- 4. 修正 store_employees 表（若存在）
UPDATE store_employees
SET is_pharmacist = false
WHERE employee_code IN ('FKF01504', 'FK1098', 'FK1096')
  AND is_pharmacist = true;

-- 5. 驗證結果
DO $$
DECLARE
  v_snapshot_count int;
  v_movement_count int;
  v_store_emp_count int;
BEGIN
  -- 確認快照已清理
  SELECT COUNT(*) INTO v_snapshot_count
  FROM pharmacist_monthly_snapshot
  WHERE year_month = '2026-03'
    AND employee_code IN ('FKF01504', 'FK1098', 'FK1096');

  IF v_snapshot_count > 0 THEN
    RAISE EXCEPTION '✗ 清理失敗：仍存在 % 筆記錄', v_snapshot_count;
  END IF;

  -- 檢查 movement_history 修正狀態
  SELECT COUNT(*) INTO v_movement_count
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
    AND employee_code IN ('FKF01504', 'FK1098', 'FK1096')
    AND onboarding_is_pharmacist = true;

  -- 檢查 store_employees 修正狀態
  SELECT COUNT(*) INTO v_store_emp_count
  FROM store_employees
  WHERE employee_code IN ('FKF01504', 'FK1098', 'FK1096')
    AND is_pharmacist = true;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ 修正完成！';
  RAISE NOTICE '  已從 2026-03 快照清除：FKF01504、FK1098、FK1096';
  RAISE NOTICE '  employee_movement_history 仍標記為藥師：% 筆', v_movement_count;
  RAISE NOTICE '  store_employees 仍標記為藥師：% 筆', v_store_emp_count;
  RAISE NOTICE '========================================';
END $$;

-- 6. 查詢 3 月快照最終狀態（供確認）
SELECT 
  pms.year_month,
  s.store_code,
  s.store_name,
  pms.employee_code,
  pms.employee_name,
  pms.position,
  pms.is_active,
  pms.source
FROM pharmacist_monthly_snapshot pms
JOIN stores s ON s.id = pms.store_id
WHERE pms.year_month = '2026-03'
  AND pms.employee_code IN ('FKF01504', 'FK1098', 'FK1096')
ORDER BY pms.employee_code;
-- 此查詢應該回傳 0 筆（確認已清理乾淨）
