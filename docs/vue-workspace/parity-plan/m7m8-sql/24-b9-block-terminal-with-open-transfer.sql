-- 【正式區草稿，尚未套用；使用者核可後才執行】DEV 版本：supabase/workspace-dev/20261110130000_m7m8_b9_block_terminal_with_open_transfer.sql
-- 先決條件：已套用 21（轉移單表）。只新增 1 個函式與 2 個觸發器，不改任何資料；撤回用 24-b9-block-terminal-with-open-transfer-rollback.sql。
-- M7/M8 第 2 批驗收 B9：設備／設施有進行中的轉移單（待交出、待收到）時，不能改成報廢／退役，要先取消轉移單。
-- 資料庫層用觸發器擋（任何路徑都適用：新版 API、資料庫函式、舊版頁面直接更新），伺服端 API 另有同訊息的預先檢查（409，code=OPEN_TRANSFER）。
-- 設備：RETIRED（退役）、SCRAPPED（報廢）；設施：RETIRED（退役）。只在狀態「改變」且新狀態是上述值時才檢查，不影響其他欄位更新與轉移單換店。
-- confirm_receive 對「已報廢／QR 已作廢」的既有防線不變。
-- 可重複執行。還原：20261110130000_m7m8_b9_block_terminal_with_open_transfer.rollback.sql
DO $$
BEGIN
  IF to_regclass('public.ga_asset_transfers') IS NULL OR to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_facilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table (apply 20261110100000_m7m8_b2_asset_events_transfers first)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_block_terminal_status_with_open_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_type text;
  v_noun text;
  v_verb text;
  v_no text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'ga_equipment' THEN
    IF NEW.status::text NOT IN ('RETIRED', 'SCRAPPED') THEN RETURN NEW; END IF;
    v_type := 'EQUIPMENT'; v_noun := '設備'; v_verb := CASE WHEN NEW.status::text = 'SCRAPPED' THEN '報廢' ELSE '退役' END;
  ELSE
    IF NEW.status::text <> 'RETIRED' THEN RETURN NEW; END IF;
    v_type := 'FACILITY'; v_noun := '設施'; v_verb := '退役';
  END IF;
  SELECT transfer_no INTO v_no FROM public.ga_asset_transfers
   WHERE asset_type = v_type AND asset_id = NEW.id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE')
   LIMIT 1;
  IF v_no IS NOT NULL THEN
    RAISE EXCEPTION 'OPEN_TRANSFER: 這台%有進行中的轉移單 %，請先取消轉移單再%', v_noun, v_no, v_verb;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_block_terminal_status_with_open_transfer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ga_equipment_block_terminal_open_transfer ON public.ga_equipment;
CREATE TRIGGER trg_ga_equipment_block_terminal_open_transfer
BEFORE UPDATE OF status ON public.ga_equipment
FOR EACH ROW EXECUTE FUNCTION public.ga_block_terminal_status_with_open_transfer();

DROP TRIGGER IF EXISTS trg_ga_facilities_block_terminal_open_transfer ON public.ga_facilities;
CREATE TRIGGER trg_ga_facilities_block_terminal_open_transfer
BEFORE UPDATE OF status ON public.ga_facilities
FOR EACH ROW EXECUTE FUNCTION public.ga_block_terminal_status_with_open_transfer();

NOTIFY pgrst, 'reload schema';
