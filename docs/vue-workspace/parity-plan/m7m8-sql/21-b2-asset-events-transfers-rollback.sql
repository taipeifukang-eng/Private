-- 21-b2-asset-events-transfers-rollback.sql
-- 撤回 21：移除轉移單、異動紀錄、轉移照片三張表與 ga_ws_* 函式。會寫入。
-- 注意：會刪除這三張表裡的所有紀錄（正式區已登錄的轉移與異動紀錄）。執行前請先備份：
--   CREATE TABLE ga_asset_transfers_bak AS SELECT * FROM ga_asset_transfers;
--   CREATE TABLE ga_asset_events_bak AS SELECT * FROM ga_asset_events;
--   CREATE TABLE ga_asset_transfer_photos_bak AS SELECT * FROM ga_asset_transfer_photos;
-- 不影響設備／設施本身的資料（已換店的結果保留，只是看不到當時的紀錄）。
-- 若 23 已套用，請先撤回 23（23 依賴本檔的函式 ga_ws_actor_name）。
BEGIN;

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
COMMIT;

-- 核對：應回 0 列
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (p.proname LIKE 'ga_ws_transfer_%' OR p.proname IN ('ga_ws_asset_open_orders', 'ga_ws_correct_asset_store', 'ga_ws_delete_asset', 'ga_ws_restore_asset'));
