-- 還原 ga-ub-scan-upload：移除權杖資料表與五支函式（已上傳的附件紀錄與檔案不受影響）。
DROP FUNCTION IF EXISTS public.ga_ub_scan_token_commit(text, jsonb);
DROP FUNCTION IF EXISTS public.ga_ub_scan_token_status(text);
DROP FUNCTION IF EXISTS public.ga_ws_ub_scan_token_revoke(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ub_scan_token_create(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ub_scan_bill_state(uuid);
DROP TABLE IF EXISTS public.ga_ub_scan_tokens;
NOTIFY pgrst, 'reload schema';
