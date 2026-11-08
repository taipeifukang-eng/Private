-- ============================================================================
-- pharm_onboard_A_preview.sql  （唯讀預覽：不修改任何資料）
-- 目的：列出「入職勾是藥師、但員工主檔 is_pharmacist 不是 true、且從未出現在任何月份藥師快照」的在職人員，
--       以及套用 B 時會新增的 (年月, 門市, 員編) 快照列。預期結果：3 人 × 2026-05..2026-11 = 21 列。
-- 條件通用（不寫死員編）：
--   人員 = 主檔在職 + 最近一筆入職異動 onboarding_is_pharmacist=true + 主檔 is_pharmacist 不是 true
--          + 在 pharmacist_monthly_snapshot 完全沒有任何列 + 有所屬門市
--   月份 = 範圍內、該月底前已入職、未關帳（pharmacist_snapshot_locks）、該員該月尚無快照列
-- 範圍在下方 params 修改（預設 2026-05 ~ 2026-11）。逐段執行，每段各是一個結果表。
-- ============================================================================

-- 【1】受影響人員（預期 3 人：FK1178 黃意文、FK1160 林妤芳、FK1179 陳裕庭）
WITH latest_onb AS (
  SELECT DISTINCT ON (upper(employee_code))
         upper(employee_code) AS code, movement_date, onboarding_is_pharmacist
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
  ORDER BY upper(employee_code), movement_date DESC, created_at DESC
)
SELECT upper(se.employee_code) AS employee_code, se.employee_name,
       s.store_code, s.store_name,
       se.position, se.current_position,
       se.is_pharmacist AS master_is_pharmacist_now,
       l.movement_date AS onboarding_date,
       se.is_active
FROM store_employees se
JOIN latest_onb l ON l.code = upper(se.employee_code)
LEFT JOIN stores s ON s.id = se.store_id
WHERE se.is_active IS TRUE
  AND se.is_pharmacist IS NOT TRUE
  AND l.onboarding_is_pharmacist IS TRUE
  AND se.store_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE upper(ps.employee_code) = upper(se.employee_code))
ORDER BY s.store_code, employee_code;

-- 【2】將新增的快照列（預期 21 列 = 3 人 × 7 個月）
WITH params AS (SELECT '2026-05'::text AS from_ym, '2026-11'::text AS to_ym),
latest_onb AS (
  SELECT DISTINCT ON (upper(employee_code))
         upper(employee_code) AS code, movement_date, onboarding_is_pharmacist
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
  ORDER BY upper(employee_code), movement_date DESC, created_at DESC
),
targets AS (
  SELECT upper(se.employee_code) AS code, se.employee_name, se.store_id,
         COALESCE(se.current_position, se.position) AS position, l.movement_date AS onboarding_date
  FROM store_employees se
  JOIN latest_onb l ON l.code = upper(se.employee_code)
  WHERE se.is_active IS TRUE AND se.is_pharmacist IS NOT TRUE AND l.onboarding_is_pharmacist IS TRUE
    AND se.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE upper(ps.employee_code) = upper(se.employee_code))
)
SELECT to_char(m, 'YYYY-MM') AS year_month, s.store_code, s.store_name, t.code AS employee_code, t.employee_name,
       t.position, t.onboarding_date,
       'backfilled: onboarding not synced' AS notes
FROM targets t
JOIN stores s ON s.id = t.store_id
CROSS JOIN params p
CROSS JOIN generate_series(to_date(p.from_ym || '-01', 'YYYY-MM-DD'), to_date(p.to_ym || '-01', 'YYYY-MM-DD'), interval '1 month') m
WHERE (m + interval '1 month' - interval '1 day')::date >= t.onboarding_date
  AND NOT EXISTS (SELECT 1 FROM pharmacist_snapshot_locks k WHERE k.year_month = to_char(m, 'YYYY-MM'))
  AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE ps.year_month = to_char(m, 'YYYY-MM') AND upper(ps.employee_code) = t.code)
ORDER BY year_month, s.store_code, t.code;

-- 【3】範圍內已關帳的月份（這些月份 B 不會動；預期 0 列）
SELECT k.year_month, k.locked_at
FROM pharmacist_snapshot_locks k
WHERE k.year_month BETWEEN '2026-05' AND '2026-11'
ORDER BY k.year_month;

-- 【4】每人摘要（人數、每人幾個月）
WITH params AS (SELECT '2026-05'::text AS from_ym, '2026-11'::text AS to_ym),
latest_onb AS (
  SELECT DISTINCT ON (upper(employee_code))
         upper(employee_code) AS code, movement_date, onboarding_is_pharmacist
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
  ORDER BY upper(employee_code), movement_date DESC, created_at DESC
),
targets AS (
  SELECT upper(se.employee_code) AS code, se.employee_name, se.store_id, l.movement_date AS onboarding_date
  FROM store_employees se
  JOIN latest_onb l ON l.code = upper(se.employee_code)
  WHERE se.is_active IS TRUE AND se.is_pharmacist IS NOT TRUE AND l.onboarding_is_pharmacist IS TRUE
    AND se.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE upper(ps.employee_code) = upper(se.employee_code))
)
SELECT t.code AS employee_code, t.employee_name, count(*) AS months_to_add,
       min(to_char(m, 'YYYY-MM')) AS first_month, max(to_char(m, 'YYYY-MM')) AS last_month
FROM targets t
CROSS JOIN params p
CROSS JOIN generate_series(to_date(p.from_ym || '-01', 'YYYY-MM-DD'), to_date(p.to_ym || '-01', 'YYYY-MM-DD'), interval '1 month') m
WHERE (m + interval '1 month' - interval '1 day')::date >= t.onboarding_date
  AND NOT EXISTS (SELECT 1 FROM pharmacist_snapshot_locks k WHERE k.year_month = to_char(m, 'YYYY-MM'))
  AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE ps.year_month = to_char(m, 'YYYY-MM') AND upper(ps.employee_code) = t.code)
GROUP BY t.code, t.employee_name
ORDER BY t.code;
