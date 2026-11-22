-- M2 H.4 回填步驟 C：回填。
-- 【重要】請只單獨執行本檔，且本檔以 BEGIN; 開頭，不會自動提交：
--   執行完後，必須再另外執行 COMMIT;（確認回填）或 ROLLBACK;（放棄）。忘了的話連線結束時會自動回滾，等於沒有回填。
--   請先完成步驟 A（新增欄位），並看過步驟 B 的預覽。

-- 步驟 C：回填（確認步驟 B 的結果沒問題後執行；看完更新筆數再決定 COMMIT 或 ROLLBACK）
BEGIN;
-- BACKFILL-BEGIN
WITH ranked AS (
  SELECT h.id, h.employee_code, h.movement_date, h.new_value AS pos,
         substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS lvl, h.created_at,
         CASE h.new_value
           WHEN '新人' THEN CASE WHEN h.notes LIKE '%二階%' THEN 2 WHEN h.notes LIKE '%一階%' THEN 1 ELSE 0 END
           WHEN '行政' THEN 100 + CASE WHEN h.notes LIKE '%未過階%' THEN 0 WHEN h.notes LIKE '%過階%' THEN 1 ELSE 0 END
           WHEN '專員' THEN 3 WHEN '組長' THEN 4 WHEN '主任' THEN 5 WHEN '副店長' THEN 6
           WHEN '店長' THEN 7 WHEN '督導' THEN 8 WHEN '經理' THEN 9
           ELSE NULL END AS rank_no
  FROM employee_movement_history h
  WHERE h.movement_type = 'promotion' AND h.new_value IS NOT NULL AND h.new_value <> '代理店長'
    AND h.movement_date <= (now() AT TIME ZONE 'Asia/Taipei')::date
), latest_day AS (
  SELECT r.* FROM ranked r
  WHERE r.movement_date = (SELECT max(x.movement_date) FROM ranked x WHERE x.employee_code = r.employee_code)
), latest AS (
  SELECT DISTINCT ON (l.employee_code) l.employee_code, l.pos, l.lvl
  FROM latest_day l
  ORDER BY l.employee_code,
           CASE WHEN (SELECT bool_and(y.rank_no IS NOT NULL AND y.rank_no / 100 = l.rank_no / 100)
                        FROM latest_day y WHERE y.employee_code = l.employee_code) THEN l.rank_no END DESC NULLS LAST,
           l.created_at ASC, l.id ASC
), proposed AS (
  SELECT e.id,
         CASE WHEN l.pos IS NOT NULL THEN CASE WHEN l.pos IN ('新人','行政') AND e.current_position = l.pos THEN l.lvl END
              WHEN e.current_position IN ('新人','行政') THEN
                (SELECT m.newbie_level FROM monthly_staff_status m
                  WHERE m.employee_code = e.employee_code AND m.position = e.current_position AND m.newbie_level IS NOT NULL
                  ORDER BY m.year_month DESC LIMIT 1)
         END AS lvl
  FROM store_employees e LEFT JOIN latest l ON l.employee_code = e.employee_code
)
UPDATE store_employees e SET newbie_level = p.lvl
FROM proposed p
WHERE e.id = p.id AND e.newbie_level IS NULL AND p.lvl IS NOT NULL;
-- BACKFILL-END
-- 檢視：回填後仍沒有階段的新人／行政員工（需要人工補，或等下一筆升職異動自動更新）
SELECT employee_code, employee_name, current_position FROM store_employees
WHERE current_position IN ('新人','行政') AND newbie_level IS NULL AND is_active = true ORDER BY employee_code;
-- 沒問題就執行 COMMIT;，不對就執行 ROLLBACK;
