-- 還原 20261110120000_m7m8_b2_import_history.sql：移除匯入與維修紀錄函式，並刪除匯入批次紀錄表（正式區執行前請先確認不需要批次紀錄）。
-- 已匯入的設備與設施資料不會被刪除（它們是正常資料列；若要整批撤銷請依批次編號 specs->>'import_batch_id' 另行處理）。
DROP FUNCTION IF EXISTS public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_history_scope(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_import_assets(jsonb, text, text, boolean);
DROP TABLE IF EXISTS public.ga_asset_import_batches;
NOTIFY pgrst, 'reload schema';
