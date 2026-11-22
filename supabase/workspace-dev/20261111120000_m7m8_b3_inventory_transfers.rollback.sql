-- 還原 20261111120000_m7m8_b3_inventory_transfers.sql：移除第 3 批 C（G13）新增的函式、資料表與欄位。
-- 會刪除：時間軸資料（ga_inventory_transfer_events）、逾期天數設定、店長回報／未收註記／異常類型／取消退回流水關聯／建單識別。
-- 調撥單本體、明細、庫存流水與餘額完全不動（已經退回來源庫存的流水仍保留在流水表）。還原後新版 G13 頁面無法使用；舊版畫面與過帳核心不受影響。
DROP FUNCTION IF EXISTS public.ga_ws_inv_transfer_set_overdue_days(integer, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_inv_transfer_store_report(uuid, text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.ga_ws_inv_transfer_action(uuid, text, timestamptz, text, text, text, boolean, text);
DROP FUNCTION IF EXISTS public.ga_ws_inv_transfer_create(uuid, uuid, uuid, numeric, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.ga_inv_tr_data(uuid);
DROP FUNCTION IF EXISTS public.ga_inv_tr_sync_fulfillment(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.ga_inv_tr_perm_error(uuid);
DROP FUNCTION IF EXISTS public.ga_inv_tr_err(integer, text, text, jsonb);
DROP TABLE IF EXISTS public.ga_inventory_transfer_events;
DROP TABLE IF EXISTS public.ga_inventory_transfer_settings;
DROP INDEX IF EXISTS public.uq_ga_inventory_transfers_create_key;
ALTER TABLE public.ga_inventory_transfers DROP CONSTRAINT IF EXISTS ga_inventory_transfers_exception_type_check;
ALTER TABLE public.ga_inventory_transfers DROP CONSTRAINT IF EXISTS ga_inventory_transfers_store_report_type_check;
ALTER TABLE public.ga_inventory_transfers
  DROP COLUMN IF EXISTS exception_type, DROP COLUMN IF EXISTS unreceived_note, DROP COLUMN IF EXISTS unreceived_marked_at, DROP COLUMN IF EXISTS unreceived_marked_by,
  DROP COLUMN IF EXISTS store_report_type, DROP COLUMN IF EXISTS store_report_note, DROP COLUMN IF EXISTS store_reported_at, DROP COLUMN IF EXISTS store_reported_by,
  DROP COLUMN IF EXISTS create_key;
ALTER TABLE public.ga_inventory_transfer_items DROP COLUMN IF EXISTS return_transaction_id;
NOTIFY pgrst, 'reload schema';
