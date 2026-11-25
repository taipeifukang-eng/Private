-- 還原 08_legacy_qr_revoke_trigger.sql：移除 2 個觸發器與 1 個函式。
-- 不動任何資料列（包含已經被作廢的 qr_token_revoked_at；若曾另外執行回填 UPDATE，作廢時間會保留，需要的話請人工處理）。
-- 可重複執行。
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ga_equipment_qr_auto_revoke ON public.ga_equipment;
  END IF;
  IF to_regclass('public.ga_facilities') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ga_facilities_qr_auto_revoke ON public.ga_facilities;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.ga_revoke_asset_qr_on_terminal_status();
NOTIFY pgrst, 'reload schema';
COMMIT;
