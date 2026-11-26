-- ============================================================================
-- 65_transfer_confirm_correct_batch.rollback.sql  （還原 65_transfer_confirm_correct_batch.sql）
--
-- 做什麼
--   1. 移除 3 支函式（正式區原本就沒有這些 workspace_transfer_* 函式）。
--   2. 把 store_employees.newbie_level 還原成備份當時的值（需先有 65_transfer_confirm_correct_batch.backup.sql 建的備份表；沒有備份表就略過並提示）。
--   3. 兩張新表（store_transfer_confirmations、workspace_transfer_corrections）：只有「完全沒有資料」才會移除；有資料就保留並提示，避免遺失確認／更正紀錄。
-- 刻意不做
--   - 不移除 store_transfer_requests 與 store_employees 新增的欄位、也不移除 store_transfer_confirmations 的檢查條件與唯一索引
--     （欄位可能已有資料，留著不影響舊版；真的要移除請人工確認後另行執行）。
--   - 不把主檔刪除的重複確認列補回（新唯一索引不允許重複）；那些列在備份表 m9_bak_20261124_transfer_confirmations。
--   - 不移除、不更動任何權限碼與授權。
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid);
DROP FUNCTION IF EXISTS public.workspace_transfer_confirm(uuid,uuid,date,text);
DROP FUNCTION IF EXISTS public.workspace_transfer_snapshot(uuid);

DO $$
DECLARE n bigint;
BEGIN
 -- 階段欄位還原到備份值（備份當時欄位不存在則值為 NULL）
 IF to_regclass('public.m9_bak_20261124_store_employees') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level') THEN
  UPDATE public.store_employees e SET newbie_level=nullif(b.row_data->>'newbie_level','')
   FROM public.m9_bak_20261124_store_employees b
   WHERE b.id=e.id AND e.newbie_level IS DISTINCT FROM nullif(b.row_data->>'newbie_level','');
 ELSE
  RAISE NOTICE '找不到備份表 m9_bak_20261124_store_employees，略過 newbie_level 還原';
 END IF;

 IF to_regclass('public.workspace_transfer_corrections') IS NOT NULL THEN
  SELECT count(*) INTO n FROM public.workspace_transfer_corrections;
  IF n=0 THEN DROP TABLE public.workspace_transfer_corrections;
  ELSE RAISE NOTICE 'workspace_transfer_corrections 有 % 筆更正紀錄，已保留', n; END IF;
 END IF;
 IF to_regclass('public.store_transfer_confirmations') IS NOT NULL THEN
  SELECT count(*) INTO n FROM public.store_transfer_confirmations;
  IF n=0 THEN DROP TABLE public.store_transfer_confirmations;
  ELSE RAISE NOTICE 'store_transfer_confirmations 有 % 筆確認紀錄，已保留', n; END IF;
 END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
