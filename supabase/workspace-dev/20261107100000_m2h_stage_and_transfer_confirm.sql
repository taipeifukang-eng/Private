-- M2 後續問卷（survey/m2-followup，2026-11-06）H 組的資料表與資料變更（DEV 專用，可重複套用）。
--  H.4 員工主檔新增「階段」欄位 store_employees.newbie_level（值與每月人員狀態同一套：未過階新人／一階新人／二階新人、未過階行政／過階行政），
--      並依升職異動回填既有員工（只填目前為空的列；DEV 可直接套用，正式區改交給使用者執行 docs/vue-workspace/parity-plan/m2-sql/backfill_employee_stage.sql）。
--  H.1／H.5 調店確認改為任一方督導確認即成立：確認紀錄只留一筆（side 允許 from／to／both／admin），申請多一個 acting_ended 欄位。
-- 函式（職等同步、名冊重算、調店確認、修改刪除異動、手動新增員編守衛）的新定義直接放在各自原本的檔案
--   （20261105200000_w05、20261106100000_w06、20261106110000_w06_c、20261106200000_p02_d），重跑任何一支 apply 都不會倒退。
-- 本檔不含函式，沒有套用順序問題；rollback 檔會把上述函式還原成 H 組之前的定義。
BEGIN;

-- H.4 階段欄位
ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20);

-- H.5 調店時原為代理店長
ALTER TABLE public.store_transfer_requests ADD COLUMN IF NOT EXISTS acting_ended boolean NOT NULL DEFAULT false;

-- H.1 調店確認紀錄：一個申請只留一筆。舊版（D.2 雙方確認）留下的多筆紀錄只保留最早的一筆。
DELETE FROM public.store_transfer_confirmations c USING public.store_transfer_confirmations d
 WHERE c.request_id=d.request_id AND (c.created_at,c.id)>(d.created_at,d.id);
ALTER TABLE public.store_transfer_confirmations DROP CONSTRAINT IF EXISTS store_transfer_confirmations_side_check;
ALTER TABLE public.store_transfer_confirmations ADD CONSTRAINT store_transfer_confirmations_side_check CHECK(side IN('from','to','both','admin'));
ALTER TABLE public.store_transfer_confirmations DROP CONSTRAINT IF EXISTS store_transfer_confirmations_request_id_side_key;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.store_transfer_confirmations'::regclass AND i.indisunique AND i.indnatts=1
   AND i.indkey[0]=(SELECT a.attnum FROM pg_attribute a WHERE a.attrelid=i.indrelid AND a.attname='request_id')) THEN
  CREATE UNIQUE INDEX store_transfer_confirmations_request_uidx ON public.store_transfer_confirmations(request_id);
 END IF;
END $$;

-- H.4 回填既有員工階段（只填目前為空的列；與 docs/vue-workspace/parity-plan/m2-sql/backfill_employee_stage.sql 的 UPDATE 相同）。
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

NOTIFY pgrst,'reload schema';
COMMIT;
