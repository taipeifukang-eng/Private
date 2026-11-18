-- 還原 20261118150000：把八個述詞函式的 search_path 設回 public, pg_temp（套用前狀態）。
BEGIN;
ALTER FUNCTION public.ga_po_today() SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_att_request_intake(text) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_att_store_wait(text) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_att_po_overdue(text,date) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_att_po(text,date,boolean) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_att_transfer_overdue(text,timestamp with time zone,integer) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_ub_is_overdue(date,date,timestamp with time zone) SET search_path TO 'public', 'pg_temp';
ALTER FUNCTION public.ga_wo_focus(text,text) SET search_path TO 'public', 'pg_temp';
COMMIT;
