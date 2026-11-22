-- M2 H.4：員工主檔新增「階段」欄位並回填既有員工（正式區 Production 專用，請由使用者自行執行）。
-- 範圍：只有一個欄位 store_employees.newbie_level（varchar(20)，可為空）與一次性的回填 UPDATE，不改動其他欄位、不刪資料。
-- 階段值與每月人員狀態 monthly_staff_status.newbie_level 同一套：未過階新人／一階新人／二階新人（職位＝新人）、未過階行政／過階行政（職位＝行政）；其他職位沒有階段（空值）。
--
-- 執行順序（請在正式區依序、各自獨立執行，每一步都可以先看結果再往下）：
--   1. backfill_employee_stage_A_add_column.sql：新增欄位（冪等，重複執行不會出錯）。
--   2. backfill_employee_stage_B_preview.sql：預覽「會被回填」的員工與階段（只有 SELECT）。
--   3. backfill_employee_stage_C_backfill.sql：回填（以 BEGIN 開頭的交易，只填目前為空的列，不覆蓋已有值；執行後必須自行再執行 COMMIT; 或 ROLLBACK;，忘了的話連線結束會自動回滾＝沒有回填）。
--   4. check_position_mismatch.sql：職位／階段比對（唯讀），回填後應只剩真正需要人工處理的員工。
-- 回填規則：
--   * 取「今天（台北時間）以前、最新有效的升職異動」（生效日較晚者優先；同日取職等最高者；代理店長不算），
--     升職職位是新人或行政、且員工主檔目前職位與它相同時，階段＝該筆升職備註的「新人等級／行政階級」。
--   * 沒有任何升職異動、但目前職位是新人或行政者，沿用「最近一個月」每月人員狀態的階段。
--   * 其他情況維持空值（不猜測）。
-- 回復方式：ALTER TABLE store_employees DROP COLUMN newbie_level;（只有這個欄位是新增的）。

-- 【注意】本步驟已拆成獨立檔案，請一個檔案一個檔案分開執行，不要把 A／B／C 三個檔案貼在一起一次執行。

-- 步驟 A：新增欄位
ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20);
