-- 驗證 05-backfill-payee（只有 SELECT，可重複執行）。每列一個檢查項目：status 是 pass 或 fail；全部 pass 才算這一階段到位。
-- 套用後執行；撤回後執行則應該大部分是 fail（代表已撤回）。不含任何寫入。
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'fail' END AS status
  FROM (
  SELECT 1 AS n, '備份表存在' AS check_name, (to_regclass('public.ga_utility_bills_payee_backfill_bak') IS NOT NULL) AS ok
  UNION ALL
  SELECT 2 AS n, '備份表內每筆帳單都有繳費單位' AS check_name, (to_regclass('public.ga_utility_bills_payee_backfill_bak') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ga_utility_bills_payee_backfill_bak k JOIN ga_utility_bills b ON b.id = k.bill_id WHERE b.payee_vendor_id IS NULL)) AS ok
  UNION ALL
  SELECT 3 AS n, '帳單觸發器仍在且啟用' AS check_name, (EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ga_utility_bills_before_write' AND NOT tgisinternal AND tgenabled <> 'D')) AS ok
  ) c
 ORDER BY n;
