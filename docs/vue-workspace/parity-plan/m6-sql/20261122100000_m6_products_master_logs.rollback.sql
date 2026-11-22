-- 還原 20261122100000_m6_products_master_logs.sql：移除操作紀錄表（products_master 本身不動）。
DROP TABLE IF EXISTS public.products_master_operation_logs;
