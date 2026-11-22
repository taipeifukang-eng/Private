-- 29-b3-inventory-transfers-rollback.sql
-- 撤回 29：移除 G13 新增的函式、2 張表（時間軸與逾期天數設定）與調撥表／明細的新欄位。
-- 會刪除新欄位與時間軸裡的資料（店長回報、未收註記、異常類型、取消退回流水關聯）；調撥單本體、明細、庫存流水與餘額完全不動。撤回後新版 G13 頁面無法使用；舊版畫面不受影響。
-- 若已有「取消並退回來源庫存」的調撥單，退回的庫存流水仍保留（流水不可刪），只是不再連結到明細。
BEGIN;
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
COMMIT;
