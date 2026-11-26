-- M9 草稿 30 還原：移除門市升遷申請與生效佇列的所有資料庫物件。可重複執行。
-- 注意
--   * 只移除本草稿建立的排程、觸發器、函式、兩張表（收據與佇列紀錄會一併消失，需要的話先自行匯出）。
--   * 不會還原已被函式改過的 store_employees / monthly_staff_status，也不會刪除 employee_movement_history 內已新增的升遷紀錄；
--     要回到套用前請用 30_store_promotions_queue.backup.sql 的備份表手動還原（還原範例在該檔檔尾）。
--   * 備份表 backup_m9_30_* 不在此檔刪除，確認不需要後由人手動 DROP。
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='workspace-promotion-activation';
  END IF;
END $$;
DROP TRIGGER IF EXISTS workspace_queue_promotion_activation ON public.workspace_promotion_requests;
DROP FUNCTION IF EXISTS public.workspace_apply_due_promotions(date);
DROP FUNCTION IF EXISTS public.workspace_queue_promotion_activation();
DROP FUNCTION IF EXISTS public.workspace_promotion_save(uuid,uuid,uuid,jsonb,text);
DROP FUNCTION IF EXISTS public.workspace_promotion_snapshot(uuid,jsonb);
DROP TABLE IF EXISTS public.workspace_promotion_activation;
DROP TABLE IF EXISTS public.workspace_promotion_requests;
NOTIFY pgrst,'reload schema';
COMMIT;
