-- 還原：移除 DEV 的 QR 自動作廢觸發器與函式（已被作廢的資料列不會復原，DEV 目前沒有設備與設施資料）。
DROP TRIGGER IF EXISTS trg_ga_equipment_qr_auto_revoke ON public.ga_equipment;
DROP TRIGGER IF EXISTS trg_ga_facilities_qr_auto_revoke ON public.ga_facilities;
DROP FUNCTION IF EXISTS public.ga_revoke_asset_qr_on_terminal_status();
NOTIFY pgrst, 'reload schema';
