-- FK1050 曹庭菱：補正員工主檔與所有既有月度人員狀態的藥師標記。
-- 此腳本可重複執行，不會變更職位、門市、出勤、獎金或月度確認狀態。

BEGIN;

DO $$
DECLARE
  v_employee_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_employee_count
  FROM public.store_employees
  WHERE UPPER(TRIM(employee_code)) = 'FK1050'
    AND TRIM(employee_name) = '曹庭菱';

  IF v_employee_count = 0 THEN
    RAISE EXCEPTION '找不到 FK1050 曹庭菱，已取消更新';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.store_employees
    WHERE UPPER(TRIM(employee_code)) = 'FK1050'
      AND TRIM(employee_name) <> '曹庭菱'
  ) THEN
    RAISE EXCEPTION 'FK1050 存在姓名不一致資料，已取消更新';
  END IF;
END;
$$;

UPDATE public.store_employees
SET
  is_pharmacist = true,
  updated_at = NOW()
WHERE UPPER(TRIM(employee_code)) = 'FK1050'
  AND TRIM(employee_name) = '曹庭菱'
  AND is_pharmacist IS DISTINCT FROM true;

UPDATE public.monthly_staff_status
SET
  is_pharmacist = true,
  updated_at = NOW()
WHERE UPPER(TRIM(employee_code)) = 'FK1050'
  AND TRIM(employee_name) = '曹庭菱'
  AND is_pharmacist IS DISTINCT FROM true;

COMMIT;

-- 驗證：主檔應全部為 true，且所有既有月份皆應為 true。
SELECT
  'store_employees' AS source,
  employee_code,
  employee_name,
  NULL::text AS year_month,
  is_pharmacist
FROM public.store_employees
WHERE UPPER(TRIM(employee_code)) = 'FK1050'

UNION ALL

SELECT
  'monthly_staff_status' AS source,
  employee_code,
  employee_name,
  year_month,
  is_pharmacist
FROM public.monthly_staff_status
WHERE UPPER(TRIM(employee_code)) = 'FK1050'
ORDER BY source, year_month NULLS FIRST;
