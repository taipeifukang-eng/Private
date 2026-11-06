-- M2 H.4：員工主檔新增「階段」欄位並回填既有員工（正式區 Production 專用，請由使用者自行執行）。
-- 範圍：只有一個欄位 store_employees.newbie_level（varchar(20)，可為空）與一次性的回填 UPDATE，不改動其他欄位、不刪資料。
-- 階段值與每月人員狀態 monthly_staff_status.newbie_level 同一套：未過階新人／一階新人／二階新人（職位＝新人）、未過階行政／過階行政（職位＝行政）；其他職位沒有階段（空值）。
--
-- 執行順序（請在正式區依序執行，每一步都可以先看結果再往下）：
--   1. 本檔步驟 A：新增欄位（冪等，重複執行不會出錯）。
--   2. 本檔步驟 B：預覽「會被回填」的員工與階段（只有 SELECT）。
--   3. 本檔步驟 C：回填（交易包起來，只填目前為空的列，不覆蓋已有值；確認筆數合理再 COMMIT，不合理就 ROLLBACK）。
--   4. check_position_mismatch.sql：職位／階段比對（唯讀），回填後應只剩真正需要人工處理的員工。
-- 回填規則：
--   * 取「今天（台北時間）以前、最新有效的升職異動」（生效日較晚者優先；同日取職等最高者；代理店長不算），
--     升職職位是新人或行政、且員工主檔目前職位與它相同時，階段＝該筆升職備註的「新人等級／行政階級」。
--   * 沒有任何升職異動、但目前職位是新人或行政者，沿用「最近一個月」每月人員狀態的階段。
--   * 其他情況維持空值（不猜測）。
-- 回復方式：ALTER TABLE store_employees DROP COLUMN newbie_level;（只有這個欄位是新增的）。

-- 步驟 A：新增欄位
ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20);

-- 步驟 B：預覽（只有 SELECT；欄位 proposed_stage 就是步驟 C 會填入的值）
WITH ranked AS (
  SELECT h.id, h.employee_code, h.movement_date, h.new_value AS pos,
         substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；
]+)') AS lvl, h.created_at,
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
SELECT e.employee_code, e.employee_name, e.current_position, e.is_active, e.newbie_level AS current_stage, p.lvl AS proposed_stage
FROM store_employees e JOIN proposed p ON p.id = e.id
WHERE e.newbie_level IS NULL AND p.lvl IS NOT NULL
ORDER BY e.employee_code;

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
