-- ============================================================================
-- pharm_onboard_B_apply.sql  （正式區資料補正；請先跑 A 預覽確認是 3 人 × 7 個月）
-- 本檔只有 BEGIN，沒有 COMMIT。看完最後的核對結果：
--   * 結果正確 -> 在同一個連線/交易內自己執行  COMMIT;
--   * 有疑問   -> 執行  ROLLBACK;  （全部還原，備份表也一併消失）
-- 注意：Supabase SQL Editor 若每次 Run 是獨立連線，BEGIN 後的交易不會保留。此時請：先整段執行看核對結果（連線結束交易自動放棄），
--       確認無誤後，自行把 COMMIT; 加在本檔最後一行，再整段重跑一次。建議用能保持同一交易的連線（例如 psql）。
-- 做的事：
--   1. 備份：受影響人員的 store_employees 整列、將新增的快照列（備份表啟用 RLS 並 REVOKE anon/authenticated）
--   2. store_employees.is_pharmacist 改 true（職位文字不動）
--   3. 為範圍內「未關帳」月份新增快照列（on conflict do nothing；已關帳月份絕不改動）
--   4. SELECT 核對
-- 條件通用（不寫死員編），與 A 相同。還原見 pharm_onboard_C_rollback.sql。
-- ============================================================================
BEGIN;

CREATE TEMP TABLE onboard_params ON COMMIT DROP AS
  SELECT '2026-05'::text AS from_ym, '2026-11'::text AS to_ym;

-- 受影響人員（在更新之前先固定下來）
CREATE TEMP TABLE onboard_targets ON COMMIT DROP AS
WITH latest_onb AS (
  SELECT DISTINCT ON (upper(employee_code))
         upper(employee_code) AS code, movement_date, onboarding_is_pharmacist
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
  ORDER BY upper(employee_code), movement_date DESC, created_at DESC
)
SELECT se.id AS employee_id, upper(se.employee_code) AS code, se.employee_name, se.store_id,
       COALESCE(se.current_position, se.position) AS position, l.movement_date AS onboarding_date
FROM store_employees se
JOIN latest_onb l ON l.code = upper(se.employee_code)
WHERE se.is_active IS TRUE AND se.is_pharmacist IS NOT TRUE AND l.onboarding_is_pharmacist IS TRUE
  AND se.store_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE upper(ps.employee_code) = upper(se.employee_code));

-- 1a. 備份 store_employees（若備份表已存在會報錯，避免覆蓋舊備份）
CREATE TABLE pharm_onboard_bak_store_employees AS
  SELECT se.* FROM store_employees se WHERE se.id IN (SELECT employee_id FROM onboard_targets);
ALTER TABLE pharm_onboard_bak_store_employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pharm_onboard_bak_store_employees FROM anon, authenticated;

-- 1b. 備份將新增的快照列（空表，下面 insert 後寫入）
CREATE TABLE pharm_onboard_bak_snapshot_inserted AS
  SELECT * FROM pharmacist_monthly_snapshot WHERE false;
ALTER TABLE pharm_onboard_bak_snapshot_inserted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pharm_onboard_bak_snapshot_inserted FROM anon, authenticated;

-- 2. 主檔改成藥師（職位文字不動）
UPDATE store_employees
SET is_pharmacist = true, updated_at = now()
WHERE id IN (SELECT employee_id FROM onboard_targets);

-- 3. 補快照列：範圍內、該月底前已入職、未關帳、該員該月尚無列
WITH ins AS (
  INSERT INTO pharmacist_monthly_snapshot (year_month, store_id, employee_code, employee_name, position, is_active, source, notes)
  SELECT to_char(m, 'YYYY-MM'), t.store_id, t.code, COALESCE(t.employee_name, ''), t.position, true, 'movement',
         'backfilled: onboarding not synced'
  FROM onboard_targets t
  CROSS JOIN onboard_params p
  CROSS JOIN generate_series(to_date(p.from_ym || '-01', 'YYYY-MM-DD'), to_date(p.to_ym || '-01', 'YYYY-MM-DD'), interval '1 month') m
  WHERE (m + interval '1 month' - interval '1 day')::date >= t.onboarding_date
    AND NOT EXISTS (SELECT 1 FROM pharmacist_snapshot_locks k WHERE k.year_month = to_char(m, 'YYYY-MM'))
    AND NOT EXISTS (SELECT 1 FROM pharmacist_monthly_snapshot ps WHERE ps.year_month = to_char(m, 'YYYY-MM') AND upper(ps.employee_code) = t.code)
  ON CONFLICT (year_month, store_id, employee_code) DO NOTHING
  RETURNING *
)
INSERT INTO pharm_onboard_bak_snapshot_inserted SELECT * FROM ins;

-- 4a. 核對：每人主檔現況（is_pharmacist 應為 true、職位文字不變）與新增月份數
SELECT t.code AS employee_code, t.employee_name, se.is_pharmacist AS master_is_pharmacist_now,
       se.position, se.current_position,
       (SELECT count(*) FROM pharm_onboard_bak_snapshot_inserted b WHERE upper(b.employee_code) = t.code) AS months_added,
       (SELECT min(year_month) FROM pharm_onboard_bak_snapshot_inserted b WHERE upper(b.employee_code) = t.code) AS first_month,
       (SELECT max(year_month) FROM pharm_onboard_bak_snapshot_inserted b WHERE upper(b.employee_code) = t.code) AS last_month
FROM onboard_targets t
JOIN store_employees se ON se.id = t.employee_id
ORDER BY t.code;

-- 4b. 核對：新增的每一列（預期 21 列），以及已關帳月份被新增的列數（必須是 0）
SELECT b.year_month, s.store_code, b.employee_code, b.employee_name, b.is_active, b.notes
FROM pharm_onboard_bak_snapshot_inserted b
LEFT JOIN stores s ON s.id = b.store_id
ORDER BY b.year_month, s.store_code, b.employee_code;

SELECT count(*) AS rows_in_locked_months_must_be_0
FROM pharm_onboard_bak_snapshot_inserted b
WHERE EXISTS (SELECT 1 FROM pharmacist_snapshot_locks k WHERE k.year_month = b.year_month);

-- 看完核對結果後，請自己決定：  COMMIT;  或  ROLLBACK;
