-- monthly-speed 項目 C rollback：移除名冊頁 RPC（含先前草稿簽章）。API 會在 RPC 不存在時自動退回逐表查詢（結果相同、較慢）。
BEGIN;
DROP FUNCTION IF EXISTS public.workspace_monthly_roster_page(uuid, text);
DROP FUNCTION IF EXISTS public.workspace_monthly_roster_page(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.workspace_extract_store_code(text);
NOTIFY pgrst, 'reload schema';
COMMIT;
