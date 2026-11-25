-- 還原 07_legacy_supervisor_management.sql：移除督導管理日誌 6 張表（連同索引、觸發器、政策）與 14 個 supervisor_management_* 函式。
-- 安全規則：只要任何一張表已經有資料列，整份中止、什麼都不刪（避免誤刪日誌）。要強制移除請先自行備份再手動 DROP。
-- 順序：若已套用「語音與 AI」（m6 的 workspace_supervisor_voice_transcripts 有外鍵參照 supervisor_management_records），要先還原語音那一步，否則 DROP TABLE 會因外鍵而失敗（DEV 實測）。
-- 不動：權限碼（06 建立）、舊版 current_user_has_permission(varchar)、任何角色授權。
-- 可重複執行。
BEGIN;

DO $$
DECLARE
  v_t text;
  v_n bigint;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'supervisor_management_daily_plans','supervisor_management_case_events','supervisor_management_followups',
    'supervisor_management_records','supervisor_management_cases','supervisor_management_categories'
  ] LOOP
    IF to_regclass('public.'||v_t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'ROLLBACK ABORTED: public.% 已有 % 筆資料，不自動刪除。請先備份並人工處理。', v_t, v_n;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.supervisor_management_daily_plans;
DROP TABLE IF EXISTS public.supervisor_management_case_events;
DROP TABLE IF EXISTS public.supervisor_management_followups;
DROP TABLE IF EXISTS public.supervisor_management_records;
DROP TABLE IF EXISTS public.supervisor_management_cases;
DROP TABLE IF EXISTS public.supervisor_management_categories;

DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_daily_plan(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_record(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_case(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_validate_daily_plan();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_followup();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_record();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_case();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_category();
DROP FUNCTION IF EXISTS public.supervisor_management_daily_plan_is_manageable(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_daily_plan_is_visible(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_case_is_manageable(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_case_is_visible(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_current_user_has_permission(text);
DROP FUNCTION IF EXISTS public.supervisor_management_current_user_manages_store(uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
