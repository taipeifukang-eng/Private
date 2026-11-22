-- 還原 20261122110000_m6_stockout_rpc.sql：移除兩個函式（不動任何資料）。
DROP FUNCTION IF EXISTS public.workspace_stockout_respond(text, text, text, date, uuid);
DROP FUNCTION IF EXISTS public.workspace_stockout_delete_report(uuid, uuid, boolean);
