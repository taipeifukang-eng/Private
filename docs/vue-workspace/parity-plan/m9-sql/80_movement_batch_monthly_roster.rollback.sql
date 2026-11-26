-- M9 草稿 80 還原：把 80_movement_batch_monthly_roster.sql 建立的東西移除（尚未套用到正式區）。
-- 還原前請知道：
--   1. 本檔只還原「結構」。套用期間函式改寫過的資料（名冊、員工主檔、異動歷史、調店申請）不會自動還原；
--      要還原資料請依 80_movement_batch_monthly_roster.backup.sql 檔尾的還原範例手動處理。
--   2. 先還原依賴本檔的草稿：65_transfer_confirm_correct_batch 內有呼叫 workspace_roster_recompute 的函式（確認、更正；30 的 workspace_apply_due_promotions 由本檔取代，見下方還原），
--      本檔移除後它們會在執行時失敗（資料庫不會阻擋移除，因為函式是後期繫結）。
--   3. 有資料的表／欄位不會硬刪：monthly_staff_adjustment_log、workspace_movement_requests 只有空表才移除；
--      monthly_staff_status.movement_hint 只有全部為空才移除。有資料時只提示（NOTICE），請先備份再人工 DROP。
--   4. store_employees.newbie_level 由草稿 65／M2 階段回填共用，本檔不移除。
--   5. 區塊計算（calculate_bonus_block 等）本檔未替換，所以不需還原。
--   6. 異動產生、仍待處理的 monthly_staff_recheck 列保留（屬草稿 15 的表），需要時另行結案。
BEGIN;

-- 呼叫者先移除
DROP FUNCTION IF EXISTS public.workspace_monthly_roster_page(uuid, text);
DROP FUNCTION IF EXISTS public.workspace_extract_store_code(text);
DROP FUNCTION IF EXISTS public.workspace_movement_delete(uuid, uuid);
DROP FUNCTION IF EXISTS public.workspace_movement_update(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_employee_master_resync(text);
DROP FUNCTION IF EXISTS public.workspace_movement_preview(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.workspace_movement_save(uuid, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.workspace_movement_snapshot(jsonb);
DROP FUNCTION IF EXISTS public.workspace_roster_apply_store_month(uuid, uuid, text, boolean, boolean, text);

-- 到期升職：改回備份當時的版本（草稿 30 的簡化版）；沒有備份就提示手動重跑草稿 30
DO $$
DECLARE d text;
BEGIN
  IF to_regclass('public.backup_m9_80_definitions') IS NOT NULL THEN
    SELECT definition INTO d FROM public.backup_m9_80_definitions
    WHERE kind = 'function' AND name LIKE 'workspace_apply_due_promotions%' ORDER BY backed_up_at LIMIT 1;
  END IF;
  IF d IS NOT NULL THEN
    EXECUTE d;
    RAISE NOTICE 'workspace_apply_due_promotions 已還原為備份當時的版本';
  ELSE
    RAISE NOTICE '沒有 workspace_apply_due_promotions 的備份：請重新執行 30_store_promotions_queue.sql 以還原簡化版（目前版本仍會呼叫已被移除的 workspace_roster_recompute）';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.workspace_roster_recompute(uuid, text, text, text, uuid, boolean, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.workspace_acting_active(text, uuid, date);
DROP FUNCTION IF EXISTS public.workspace_acting_end_event(text, text);
DROP FUNCTION IF EXISTS public.workspace_employee_master_position_sync(text);
DROP FUNCTION IF EXISTS public.workspace_effective_promotion(text, date);
DROP FUNCTION IF EXISTS public.workspace_position_rank(text, text);
DROP FUNCTION IF EXISTS public.workspace_add_monthly_employee(uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.workspace_save_monthly_summary(uuid, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.workspace_save_monthly_allowance(uuid, uuid, text, text, jsonb, jsonb);

-- 資料表／欄位：沒資料才移除
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.monthly_staff_adjustment_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.monthly_staff_adjustment_log;
    IF n = 0 THEN DROP TABLE public.monthly_staff_adjustment_log;
    ELSE RAISE NOTICE 'monthly_staff_adjustment_log 有 % 筆調整紀錄，已保留；請先備份再人工 DROP', n; END IF;
  END IF;
  IF to_regclass('public.workspace_movement_requests') IS NOT NULL THEN
    SELECT count(*) INTO n FROM public.workspace_movement_requests;
    IF n = 0 THEN DROP TABLE public.workspace_movement_requests;
    ELSE RAISE NOTICE 'workspace_movement_requests 有 % 筆回執，已保留；請先備份再人工 DROP', n; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_staff_status' AND column_name='movement_hint') THEN
    EXECUTE 'SELECT count(*) FROM public.monthly_staff_status WHERE movement_hint IS NOT NULL' INTO n;
    IF n = 0 THEN ALTER TABLE public.monthly_staff_status DROP COLUMN movement_hint;
    ELSE RAISE NOTICE 'monthly_staff_status.movement_hint 有 % 列有值，已保留欄位；請先備份再人工 DROP COLUMN', n; END IF;
  END IF;
END $$;

-- 異動類型約束：還原成正式區原本的 7 種；若已有 acting_manager 資料就保留較寬版本（硬還原會失敗）
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.employee_movement_history WHERE movement_type = 'acting_manager';
  IF n = 0 THEN
    ALTER TABLE public.employee_movement_history DROP CONSTRAINT IF EXISTS valid_movement_type;
    ALTER TABLE public.employee_movement_history ADD CONSTRAINT valid_movement_type CHECK (movement_type IN
      ('onboarding','promotion','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer'));
  ELSE
    RAISE NOTICE 'employee_movement_history 已有 % 筆 acting_manager，valid_movement_type 保留較寬版本（若要還原，需先把這些列改成 promotion + new_value=代理店長）', n;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
