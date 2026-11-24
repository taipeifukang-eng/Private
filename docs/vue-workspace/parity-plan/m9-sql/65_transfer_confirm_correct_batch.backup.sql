-- ============================================================================
-- 65_transfer_confirm_correct_batch.backup.sql  （套用 65_transfer_confirm_correct_batch.sql 之前先執行）
--
-- 為什麼要備份：主檔會（1）刪除 store_transfer_confirmations 內的重複列（若該表已存在）、
-- （2）回填 store_employees.newbie_level。備份用「整列轉 jsonb」存，不管欄位有沒有存在都能存。
-- 備份表只新增、不會覆蓋：可重複執行，第二次執行不會動到第一次的備份（CREATE TABLE IF NOT EXISTS ... AS）。
-- 備份表放在 public，名稱 m9_bak_20261124_*；確認上線穩定後可自行 DROP。
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.m9_bak_20261124_store_employees AS
 SELECT e.id, to_jsonb(e) AS row_data, now() AS backed_up_at FROM public.store_employees e;

CREATE TABLE IF NOT EXISTS public.m9_bak_20261124_transfer_requests AS
 SELECT r.id, to_jsonb(r) AS row_data, now() AS backed_up_at FROM public.store_transfer_requests r;

-- store_transfer_confirmations 正式區可能還沒有這張表：有才備份，沒有就建立空的備份表。
DO $$
BEGIN
 IF to_regclass('public.store_transfer_confirmations') IS NOT NULL THEN
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.m9_bak_20261124_transfer_confirmations AS SELECT c.id, to_jsonb(c) AS row_data, now() AS backed_up_at FROM public.store_transfer_confirmations c';
 ELSE
  EXECUTE 'CREATE TABLE IF NOT EXISTS public.m9_bak_20261124_transfer_confirmations (id uuid, row_data jsonb, backed_up_at timestamptz)';
 END IF;
END $$;

-- 備份表不開放給前端角色
ALTER TABLE public.m9_bak_20261124_store_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m9_bak_20261124_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m9_bak_20261124_transfer_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_bak_20261124_store_employees, public.m9_bak_20261124_transfer_requests, public.m9_bak_20261124_transfer_confirmations FROM PUBLIC,anon,authenticated;

-- 備份筆數對照（請與來源表筆數相同）
SELECT 'store_employees' AS 表, (SELECT count(*) FROM public.store_employees) AS 來源筆數, (SELECT count(*) FROM public.m9_bak_20261124_store_employees) AS 備份筆數
UNION ALL SELECT 'store_transfer_requests', (SELECT count(*) FROM public.store_transfer_requests), (SELECT count(*) FROM public.m9_bak_20261124_transfer_requests)
UNION ALL SELECT 'store_transfer_confirmations', CASE WHEN to_regclass('public.store_transfer_confirmations') IS NULL THEN 0 ELSE (SELECT count(*) FROM public.store_transfer_confirmations) END, (SELECT count(*) FROM public.m9_bak_20261124_transfer_confirmations);
