-- M7/M8 第 1 批（G01 準備）：DEV 補上「報廢／退役／刪除自動作廢 QR」觸發器。
-- 來源：supabase/migrations/20260826030000_general_affairs_asset_qr_auto_revoke.sql（只讀參考，內容相同）。
-- DEV 原本沒有這個函式與觸發器（readiness check：ga_revoke_asset_qr_on_terminal_status MISSING）。
-- 第 1 批不依賴它，但第 2 批（設備、設施、QR）會用到，所以一併補齊 DEV，與正式區 migration 對齊。
-- 與 migration 的差異：不含「回填既有資料」的兩個 UPDATE（DEV 設備與設施目前 0 筆，且不主動改資料）。
-- 可重複執行。還原：20261109120000_m7m8_g01_asset_qr_auto_revoke.rollback.sql
DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_facilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_equipment / public.ga_facilities';
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
