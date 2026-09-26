-- 一次性正式資料修復工具：依升職異動紀錄校正每月人員狀態職位
--
-- 用途：
-- 1. 全面找出 employee_movement_history 中已存在升職紀錄，
--    但 monthly_staff_status.position 未反映該月份應顯示職位的資料。
-- 2. 經人工確認後，受控更新 monthly_staff_status.position。
--
-- 規則：
-- - 只使用 movement_type = 'promotion' 且 new_value 非空白的異動紀錄。
-- - 某月應顯示職位 = 該員工在該 year_month 當下最新一筆升職紀錄的 new_value。
-- - 生效日 2026-05-01 會套用到 2026-05 及之後月份，直到下一筆升職月份前。
-- - 不新增、刪除資料。
-- - 不修改 employee_movement_history。
-- - 不修改 store_employees。
-- - 不修改 migration history。

-- ============================================================
-- A. 全面 dry-run：列出所有待修正資料
-- ============================================================
WITH mismatches AS (
  SELECT
    mss.id AS monthly_staff_status_id,
    mss.year_month,
    mss.store_id,
    s.store_code,
    s.store_name,
    mss.employee_code,
    mss.employee_name,
    mss.position AS current_monthly_position,
    promo.expected_position,
    promo.movement_date AS promotion_effective_date,
    promo.movement_history_id,
    promo.created_at AS promotion_created_at
  FROM public.monthly_staff_status AS mss
  JOIN LATERAL (
    SELECT
      emh.id AS movement_history_id,
      emh.movement_date,
      NULLIF(BTRIM(emh.new_value), '') AS expected_position,
      emh.created_at
    FROM public.employee_movement_history AS emh
    WHERE UPPER(BTRIM(emh.employee_code::text)) = UPPER(BTRIM(mss.employee_code::text))
      AND emh.movement_type = 'promotion'
      AND NULLIF(BTRIM(COALESCE(emh.new_value, '')), '') IS NOT NULL
      AND TO_CHAR(emh.movement_date, 'YYYY-MM') <= mss.year_month
    ORDER BY emh.movement_date DESC, emh.created_at DESC NULLS LAST, emh.id DESC
    LIMIT 1
  ) AS promo ON TRUE
  LEFT JOIN public.stores AS s ON s.id = mss.store_id
  WHERE NULLIF(BTRIM(COALESCE(mss.employee_code, '')), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(mss.position, '')), '') IS DISTINCT FROM promo.expected_position
)
SELECT
  year_month,
  store_code,
  store_name,
  employee_code,
  employee_name,
  current_monthly_position,
  expected_position,
  promotion_effective_date,
  promotion_created_at,
  monthly_staff_status_id,
  movement_history_id
FROM mismatches
ORDER BY year_month, store_code, employee_code;

-- ============================================================
-- B. dry-run summary：依月份 / 員工統計待修正筆數
-- ============================================================
WITH mismatches AS (
  SELECT
    mss.id,
    mss.year_month,
    mss.employee_code,
    mss.employee_name,
    mss.position AS current_monthly_position,
    promo.expected_position
  FROM public.monthly_staff_status AS mss
  JOIN LATERAL (
    SELECT NULLIF(BTRIM(emh.new_value), '') AS expected_position
    FROM public.employee_movement_history AS emh
    WHERE UPPER(BTRIM(emh.employee_code::text)) = UPPER(BTRIM(mss.employee_code::text))
      AND emh.movement_type = 'promotion'
      AND NULLIF(BTRIM(COALESCE(emh.new_value, '')), '') IS NOT NULL
      AND TO_CHAR(emh.movement_date, 'YYYY-MM') <= mss.year_month
    ORDER BY emh.movement_date DESC, emh.created_at DESC NULLS LAST, emh.id DESC
    LIMIT 1
  ) AS promo ON TRUE
  WHERE NULLIF(BTRIM(COALESCE(mss.employee_code, '')), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(mss.position, '')), '') IS DISTINCT FROM promo.expected_position
)
SELECT
  COUNT(*) AS mismatch_row_count,
  COUNT(DISTINCT employee_code) AS affected_employee_count,
  MIN(year_month) AS first_affected_year_month,
  MAX(year_month) AS last_affected_year_month
FROM mismatches;

-- ============================================================
-- C. FK0979 / 李芃辰 專項 dry-run
-- ============================================================
WITH mismatches AS (
  SELECT
    mss.id AS monthly_staff_status_id,
    mss.year_month,
    s.store_code,
    s.store_name,
    mss.employee_code,
    mss.employee_name,
    mss.position AS current_monthly_position,
    promo.expected_position,
    promo.movement_date AS promotion_effective_date,
    promo.movement_history_id
  FROM public.monthly_staff_status AS mss
  JOIN LATERAL (
    SELECT
      emh.id AS movement_history_id,
      emh.movement_date,
      NULLIF(BTRIM(emh.new_value), '') AS expected_position
    FROM public.employee_movement_history AS emh
    WHERE UPPER(BTRIM(emh.employee_code::text)) = UPPER(BTRIM(mss.employee_code::text))
      AND emh.movement_type = 'promotion'
      AND NULLIF(BTRIM(COALESCE(emh.new_value, '')), '') IS NOT NULL
      AND TO_CHAR(emh.movement_date, 'YYYY-MM') <= mss.year_month
    ORDER BY emh.movement_date DESC, emh.created_at DESC NULLS LAST, emh.id DESC
    LIMIT 1
  ) AS promo ON TRUE
  LEFT JOIN public.stores AS s ON s.id = mss.store_id
  WHERE UPPER(BTRIM(COALESCE(mss.employee_code, ''))) = 'FK0979'
    AND NULLIF(BTRIM(COALESCE(mss.position, '')), '') IS DISTINCT FROM promo.expected_position
)
SELECT *
FROM mismatches
ORDER BY year_month, store_code;

-- ============================================================
-- D. 受控修正段
--    請先確認 A/B/C 的結果合理，再單獨執行本段。
--    若 RETURNING 結果不合理，請在同一交易中改執行 ROLLBACK。
-- ============================================================
-- BEGIN;
--
-- CREATE TEMP TABLE repair_monthly_staff_position_changes (
--   year_month text,
--   store_code text,
--   store_name text,
--   employee_code text,
--   employee_name text,
--   old_monthly_position text,
--   new_monthly_position text,
--   promotion_effective_date date,
--   monthly_staff_status_id uuid,
--   movement_history_id uuid
-- ) ON COMMIT DROP;
--
-- WITH mismatches AS (
--   SELECT
--     mss.id AS monthly_staff_status_id,
--     mss.year_month,
--     s.store_code,
--     s.store_name,
--     mss.employee_code,
--     mss.employee_name,
--     mss.position AS old_monthly_position,
--     promo.expected_position,
--     promo.movement_date AS promotion_effective_date,
--     promo.movement_history_id
--   FROM public.monthly_staff_status AS mss
--   JOIN LATERAL (
--     SELECT
--       emh.id AS movement_history_id,
--       emh.movement_date,
--       NULLIF(BTRIM(emh.new_value), '') AS expected_position
--     FROM public.employee_movement_history AS emh
--     WHERE UPPER(BTRIM(emh.employee_code::text)) = UPPER(BTRIM(mss.employee_code::text))
--       AND emh.movement_type = 'promotion'
--       AND NULLIF(BTRIM(COALESCE(emh.new_value, '')), '') IS NOT NULL
--       AND TO_CHAR(emh.movement_date, 'YYYY-MM') <= mss.year_month
--     ORDER BY emh.movement_date DESC, emh.created_at DESC NULLS LAST, emh.id DESC
--     LIMIT 1
--   ) AS promo ON TRUE
--   LEFT JOIN public.stores AS s ON s.id = mss.store_id
--   WHERE NULLIF(BTRIM(COALESCE(mss.employee_code, '')), '') IS NOT NULL
--     AND NULLIF(BTRIM(COALESCE(mss.position, '')), '') IS DISTINCT FROM promo.expected_position
-- ),
-- updated_rows AS (
-- UPDATE public.monthly_staff_status AS mss
-- SET
--   position = mismatches.expected_position,
--   updated_at = TIMEZONE('utc', NOW())
-- FROM mismatches
-- WHERE mss.id = mismatches.monthly_staff_status_id
-- RETURNING
--   mismatches.year_month,
--   mismatches.store_code,
--   mismatches.store_name,
--   mismatches.employee_code,
--   mismatches.employee_name,
--   mismatches.old_monthly_position,
--   mss.position AS new_monthly_position,
--   mismatches.promotion_effective_date,
--   mss.id AS monthly_staff_status_id,
--   mismatches.movement_history_id
-- )
-- INSERT INTO repair_monthly_staff_position_changes
-- SELECT *
-- FROM updated_rows;
--
-- SELECT
--   COUNT(*) AS updated_row_count,
--   COUNT(DISTINCT employee_code) AS affected_employee_count,
--   MIN(year_month) AS first_updated_year_month,
--   MAX(year_month) AS last_updated_year_month
-- FROM repair_monthly_staff_position_changes;
--
-- SELECT
--   year_month,
--   store_code,
--   store_name,
--   employee_code,
--   employee_name,
--   old_monthly_position,
--   new_monthly_position,
--   promotion_effective_date,
--   monthly_staff_status_id,
--   movement_history_id
-- FROM repair_monthly_staff_position_changes
-- ORDER BY year_month, store_code, employee_code;
--
-- COMMIT;
