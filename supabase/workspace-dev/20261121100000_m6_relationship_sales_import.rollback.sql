-- 還原 20261121100000_m6_relationship_sales_import.sql：移除去重匯入函式（不動任何資料）。
DROP FUNCTION IF EXISTS public.workspace_import_relationship_sales(text, uuid, jsonb);
