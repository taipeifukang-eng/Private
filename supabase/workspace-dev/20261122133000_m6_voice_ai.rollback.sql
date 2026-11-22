-- 還原 20261122133000_m6_voice_ai.sql：移除 W33 的函式與資料表（不動督導日誌的任何資料表與資料）。
DROP FUNCTION IF EXISTS public.workspace_ai_reserve(text, text, text, bigint, uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS public.workspace_ai_month_spent(text);
DROP TABLE IF EXISTS public.workspace_supervisor_voice_transcripts;
DROP TABLE IF EXISTS public.workspace_ai_consents;
DROP TABLE IF EXISTS public.workspace_ai_alerts;
DROP TABLE IF EXISTS public.workspace_ai_usage_ledger;
DROP TABLE IF EXISTS public.workspace_ai_settings;
NOTIFY pgrst, 'reload schema';
