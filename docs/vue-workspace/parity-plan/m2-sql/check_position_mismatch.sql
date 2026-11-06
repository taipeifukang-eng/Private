-- M2 B.3：唯讀檢查。列出「員工主檔職位」和「最新升職異動」不一致的員工，交給使用者在正式區（Production）執行。
-- 只有 SELECT，不會修改任何資料；不要自動修正，請人工核對每一位後再決定怎麼處理。
--
-- 判斷規則（與新版 B.1、B.2 相同）：
--   * 只看今天（台北時間）以前的升職異動（movement_type = 'promotion'），代理店長只是註記，不算正式職位。
--   * 最新有效升職：生效日較晚者優先；生效日相同時取職等最高者（門市職等：新人未過階 < 一階 < 二階 < 專員 < 組長
--     < 主任 < 副店長 < 店長 < 督導 < 經理；行政未過階 < 過階；不在職等表內的職位排在最後，同日保留先登錄者）。
--   * 員工主檔（store_employees）的 position 或 current_position 和最新有效升職的職位不同，就列出。
-- 欄位 mismatch_kind：position（position 欄不同）、current_position（current_position 欄不同）、both。
-- 階段（M2 H.4）：員工主檔新增 store_employees.newbie_level 之後，下方第二段查詢（階段比對）才能執行；
--   請先執行 backfill_employee_stage.sql 的步驟 A（新增欄位）與步驟 C（回填）。第一段查詢（職位比對）不需要這個欄位，可以單獨執行。
--   階段規則：最新有效升職的職位是新人或行政、且和主檔職位相同時，主檔階段應等於該筆升職備註的階段；
--   主檔職位不是新人／行政時階段應為空。兩段查詢都只有 SELECT，不會修改任何資料。
-- ==== 第一段：職位比對 ====
WITH ranked AS (
  SELECT h.id, h.employee_code, h.movement_date, h.new_value AS promoted_position,
         substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS stage,
         h.created_at,
         CASE h.new_value
           WHEN '新人' THEN CASE WHEN h.notes LIKE '%二階%' THEN 2 WHEN h.notes LIKE '%一階%' THEN 1 ELSE 0 END
           WHEN '行政' THEN 100 + CASE WHEN h.notes LIKE '%未過階%' THEN 0 WHEN h.notes LIKE '%過階%' THEN 1 ELSE 0 END
           WHEN '專員' THEN 3 WHEN '組長' THEN 4 WHEN '主任' THEN 5 WHEN '副店長' THEN 6
           WHEN '店長' THEN 7 WHEN '督導' THEN 8 WHEN '經理' THEN 9
           ELSE NULL END AS rank_no
  FROM employee_movement_history h
  WHERE h.movement_type = 'promotion'
    AND h.new_value IS NOT NULL
    AND h.new_value <> '代理店長'
    AND h.movement_date <= (now() AT TIME ZONE 'Asia/Taipei')::date
), latest_day AS (
  SELECT r.* FROM ranked r
  WHERE r.movement_date = (SELECT max(x.movement_date) FROM ranked x WHERE x.employee_code = r.employee_code)
), latest AS (
  SELECT DISTINCT ON (employee_code) employee_code, movement_date, promoted_position, stage
  FROM latest_day l
  ORDER BY employee_code,
           -- 同日：同一軌道且都有職等時取最高；否則保留先登錄者。
           CASE WHEN (SELECT bool_and(y.rank_no IS NOT NULL AND y.rank_no / 100 = l.rank_no / 100)
                        FROM latest_day y WHERE y.employee_code = l.employee_code) THEN l.rank_no END DESC NULLS LAST,
           created_at ASC, id ASC
)
SELECT e.employee_code,
       e.employee_name,
       s.store_code,
       e.is_active,
       e.employment_status,
       e.position            AS master_position,
       e.current_position    AS master_current_position,
       l.promoted_position   AS latest_promotion_position,
       l.stage               AS latest_promotion_stage,
       l.movement_date       AS latest_promotion_date,
       CASE WHEN e.position IS DISTINCT FROM l.promoted_position AND e.current_position IS DISTINCT FROM l.promoted_position THEN 'both'
            WHEN e.position IS DISTINCT FROM l.promoted_position THEN 'position'
            ELSE 'current_position' END AS mismatch_kind
FROM store_employees e
JOIN latest l ON l.employee_code = e.employee_code
LEFT JOIN stores s ON s.id = e.store_id
WHERE e.is_active = true
  AND (e.position IS DISTINCT FROM l.promoted_position OR e.current_position IS DISTINCT FROM l.promoted_position)
ORDER BY s.store_code, e.employee_code;

-- ==== 第二段：階段比對（需要 store_employees.newbie_level 欄位，請先執行 backfill_employee_stage.sql 步驟 A）====
-- 欄位 stage_mismatch_kind：missing（主檔階段空白，升職異動有階段）、different（兩邊階段不同）、should_be_empty（主檔職位不是新人／行政卻有階段）。
WITH ranked AS (
  SELECT h.id, h.employee_code, h.movement_date, h.new_value AS promoted_position,
         substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；
]+)') AS stage,
         h.created_at,
         CASE h.new_value
           WHEN '新人' THEN CASE WHEN h.notes LIKE '%二階%' THEN 2 WHEN h.notes LIKE '%一階%' THEN 1 ELSE 0 END
           WHEN '行政' THEN 100 + CASE WHEN h.notes LIKE '%未過階%' THEN 0 WHEN h.notes LIKE '%過階%' THEN 1 ELSE 0 END
           WHEN '專員' THEN 3 WHEN '組長' THEN 4 WHEN '主任' THEN 5 WHEN '副店長' THEN 6
           WHEN '店長' THEN 7 WHEN '督導' THEN 8 WHEN '經理' THEN 9
           ELSE NULL END AS rank_no
  FROM employee_movement_history h
  WHERE h.movement_type = 'promotion'
    AND h.new_value IS NOT NULL
    AND h.new_value <> '代理店長'
    AND h.movement_date <= (now() AT TIME ZONE 'Asia/Taipei')::date
), latest_day AS (
  SELECT r.* FROM ranked r
  WHERE r.movement_date = (SELECT max(x.movement_date) FROM ranked x WHERE x.employee_code = r.employee_code)
), latest AS (
  SELECT DISTINCT ON (employee_code) employee_code, movement_date, promoted_position, stage
  FROM latest_day l
  ORDER BY employee_code,
           CASE WHEN (SELECT bool_and(y.rank_no IS NOT NULL AND y.rank_no / 100 = l.rank_no / 100)
                        FROM latest_day y WHERE y.employee_code = l.employee_code) THEN l.rank_no END DESC NULLS LAST,
           created_at ASC, id ASC
)
SELECT e.employee_code,
       e.employee_name,
       s.store_code,
       e.is_active,
       e.current_position      AS master_current_position,
       e.newbie_level          AS master_stage,
       l.promoted_position     AS latest_promotion_position,
       l.stage                 AS latest_promotion_stage,
       l.movement_date         AS latest_promotion_date,
       CASE WHEN e.current_position NOT IN ('新人','行政') AND e.newbie_level IS NOT NULL THEN 'should_be_empty'
            WHEN e.newbie_level IS NULL THEN 'missing'
            ELSE 'different' END AS stage_mismatch_kind
FROM store_employees e
LEFT JOIN latest l ON l.employee_code = e.employee_code
LEFT JOIN stores s ON s.id = e.store_id
WHERE e.is_active = true
  AND (
    (e.current_position NOT IN ('新人','行政') AND e.newbie_level IS NOT NULL)
    OR (l.promoted_position IN ('新人','行政') AND e.current_position = l.promoted_position
        AND e.newbie_level IS DISTINCT FROM l.stage)
  )
ORDER BY s.store_code, e.employee_code;
