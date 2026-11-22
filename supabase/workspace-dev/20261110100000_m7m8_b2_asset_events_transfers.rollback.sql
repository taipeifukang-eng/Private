-- 還原 20261110100000_m7m8_b2_asset_events_transfers.sql：移除轉移單、異動紀錄、轉移照片三張表與 ga_ws_* 函式。
-- 注意：會刪除這三張表裡的所有紀錄（DEV 測試資料或正式區已登錄的轉移與異動紀錄）；正式區執行前請先備份。
-- 不影響設備／設施本身的資料（轉移完成後已換店的結果保留，只是看不到當時的紀錄）。
DROP FUNCTION IF EXISTS public.ga_ws_transfer_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_transfer_confirm_receive(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_transfer_confirm_handover(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_transfer_create(text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_transfer_add_photos(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_restore_asset(text, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_delete_asset(text, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_asset_open_orders(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_asset_view_code(text);
DROP FUNCTION IF EXISTS public.ga_ws_asset_manage_code(text);
DROP FUNCTION IF EXISTS public.ga_ws_open_order_count(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_lock_asset(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_actor_name(uuid);
DROP TABLE IF EXISTS public.ga_asset_events;
DROP FUNCTION IF EXISTS public.ga_asset_events_immutable();
DROP TABLE IF EXISTS public.ga_asset_transfer_photos;
DROP TABLE IF EXISTS public.ga_asset_transfers;
DROP SEQUENCE IF EXISTS public.ga_asset_transfer_no_seq;
NOTIFY pgrst, 'reload schema';
