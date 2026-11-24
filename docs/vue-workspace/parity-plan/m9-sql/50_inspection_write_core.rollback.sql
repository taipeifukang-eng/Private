-- 還原 50_inspection_write_core.sql：移除函式與觸發器。可重複執行。
-- 欄位預設「保留」：欄位內已有新版寫入的版本與數量資料，直接刪除會遺失。確定要刪欄位時，先備份再取消下方註解：
--   CREATE TABLE public.bak_inspection_masters_ws_20261124 AS SELECT id,workspace_version,workspace_write_id,workspace_write_hash FROM public.inspection_masters;
--   CREATE TABLE public.bak_inspection_results_ws_20261124 AS SELECT id,workspace_quantities FROM public.inspection_results;
--   ALTER TABLE public.inspection_masters DROP COLUMN IF EXISTS workspace_version, DROP COLUMN IF EXISTS workspace_write_id, DROP COLUMN IF EXISTS workspace_write_hash;
--   ALTER TABLE public.inspection_results DROP COLUMN IF EXISTS workspace_quantities;
-- 還原後新版巡店新增／編輯無法使用；舊版頁面與既有巡店資料不受影響。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb);
DROP TRIGGER IF EXISTS trg_workspace_inspection_version ON public.inspection_masters;
DROP FUNCTION IF EXISTS public.workspace_inspection_version();
NOTIFY pgrst,'reload schema';
COMMIT;
