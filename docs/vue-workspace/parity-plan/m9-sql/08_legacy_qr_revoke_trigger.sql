-- M9 正式區草稿 08：舊版「設備報廢／設施退役／刪除時自動作廢 QR」觸發器補建（2026-11-25 正式區 00b 檢查發現沒進正式區）。尚未套用，需人確認後才轉正式 migration。
-- 對應舊版 supabase/migrations/20260826030000_general_affairs_asset_qr_auto_revoke.sql，也等於 DEV 的 supabase/workspace-dev/20261109120000_m7m8_g01_asset_qr_auto_revoke.sql（最終狀態）。
-- 白話說明：
--   新增 1 個函式 ga_revoke_asset_qr_on_terminal_status()（不是 SECURITY DEFINER，search_path = public, pg_temp）與 2 個觸發器：
--     trg_ga_equipment_qr_auto_revoke（設備資料表）、trg_ga_facilities_qr_auto_revoke（設施資料表），都是 BEFORE INSERT OR UPDATE OF status, deleted_at, qr_token_revoked_at。
--   規則：設備 SCRAPPED、設施 RETIRED、或 deleted_at 不為空時，把 qr_token_revoked_at 設成現在（已有作廢時間就不動）。
--   與舊版 migration 的差異：刻意「不含」回填既有資料的兩段 UPDATE（會改正式區既有設備與設施資料），和 DEV 版一致。
--     要不要回填，先跑 08_legacy_qr_revoke_trigger.preview.sql 看有多少筆「已報廢／已退役／已刪除但還沒作廢」，由老闆決定；回填 SQL 附在 preview 檔最後（註解）。
--   本檔不改任何既有資料列；只對「之後」的新增與更新生效。
-- 前置：ga_equipment、ga_facilities 兩表，且兩表都要有 status、deleted_at、qr_token_revoked_at 三欄（缺一就中止）。
-- 備份：不需要（只新增函式與觸發器，不動資料）。可重複執行（CREATE OR REPLACE、DROP TRIGGER IF EXISTS 後重建）。
-- 還原：08_legacy_qr_revoke_trigger.rollback.sql；驗證：08_legacy_qr_revoke_trigger.verify.sql（只有 SELECT）。
BEGIN;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.ga_equipment') IS NULL THEN 'table public.ga_equipment' END,
    CASE WHEN to_regclass('public.ga_facilities') IS NULL THEN 'table public.ga_facilities' END
  ], NULL) INTO v_missing;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Missing prerequisite: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT array_remove(ARRAY[
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_equipment' AND column_name='status') THEN 'ga_equipment.status' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_equipment' AND column_name='deleted_at') THEN 'ga_equipment.deleted_at' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_equipment' AND column_name='qr_token_revoked_at') THEN 'ga_equipment.qr_token_revoked_at' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_facilities' AND column_name='status') THEN 'ga_facilities.status' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_facilities' AND column_name='deleted_at') THEN 'ga_facilities.deleted_at' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_facilities' AND column_name='qr_token_revoked_at') THEN 'ga_facilities.qr_token_revoked_at' END
  ], NULL) INTO v_missing;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Missing prerequisite column: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_revoke_asset_qr_on_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.qr_token_revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ga_equipment' AND NEW.status::text = 'SCRAPPED' THEN
    NEW.qr_token_revoked_at := NOW();
  ELSIF TG_TABLE_NAME = 'ga_facilities' AND NEW.status::text = 'RETIRED' THEN
    NEW.qr_token_revoked_at := NOW();
  ELSIF NEW.deleted_at IS NOT NULL THEN
    NEW.qr_token_revoked_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_equipment_qr_auto_revoke ON public.ga_equipment;
CREATE TRIGGER trg_ga_equipment_qr_auto_revoke
BEFORE INSERT OR UPDATE OF status, deleted_at, qr_token_revoked_at ON public.ga_equipment
FOR EACH ROW
EXECUTE FUNCTION public.ga_revoke_asset_qr_on_terminal_status();

DROP TRIGGER IF EXISTS trg_ga_facilities_qr_auto_revoke ON public.ga_facilities;
CREATE TRIGGER trg_ga_facilities_qr_auto_revoke
BEFORE INSERT OR UPDATE OF status, deleted_at, qr_token_revoked_at ON public.ga_facilities
FOR EACH ROW
EXECUTE FUNCTION public.ga_revoke_asset_qr_on_terminal_status();

COMMENT ON FUNCTION public.ga_revoke_asset_qr_on_terminal_status()
IS 'Revokes asset QR scan tokens when equipment is scrapped, facilities are retired, or assets are soft-deleted.';

NOTIFY pgrst, 'reload schema';
COMMIT;
