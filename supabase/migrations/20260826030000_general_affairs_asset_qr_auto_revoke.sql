-- Automatically revoke QR scan tokens when assets enter terminal statuses.

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_facilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_facilities';
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

UPDATE public.ga_equipment
SET qr_token_revoked_at = NOW()
WHERE qr_token_revoked_at IS NULL
  AND (
    status::text = 'SCRAPPED'
    OR deleted_at IS NOT NULL
  );

UPDATE public.ga_facilities
SET qr_token_revoked_at = NOW()
WHERE qr_token_revoked_at IS NULL
  AND (
    status::text = 'RETIRED'
    OR deleted_at IS NOT NULL
  );

COMMENT ON FUNCTION public.ga_revoke_asset_qr_on_terminal_status()
IS 'Revokes asset QR scan tokens when equipment is scrapped, facilities are retired, or assets are soft-deleted.';

NOTIFY pgrst, 'reload schema';
