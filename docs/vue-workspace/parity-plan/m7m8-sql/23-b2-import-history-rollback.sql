-- 23-b2-import-history-rollback.sql
-- 撤回 23：移除匯入與維修紀錄函式，並刪除匯入批次紀錄表。會寫入。
-- 已匯入的設備與設施資料不會被刪除（它們是正常資料列；若要整批撤銷請依 specs->>'import_batch_id' 另行處理）。
-- 執行前如需保留批次紀錄：CREATE TABLE ga_asset_import_batches_bak AS SELECT * FROM ga_asset_import_batches;
BEGIN;

DROP FUNCTION IF EXISTS public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_history_scope(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_import_assets(jsonb, text, text, boolean);
DROP TABLE IF EXISTS public.ga_asset_import_batches;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 核對：應回 0 列
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_import_assets', 'ga_ws_asset_maintenance_history', 'ga_ws_asset_repair_summary', 'ga_ws_history_scope');
