-- ============================================================================
-- 【處方箋 Google Sheet 匯入】正式區復原用 SQL
-- 做什麼：刪除整批匯入函式與簡稱對照表（對照表裡的簡稱會一併消失）。處方箋月報資料完全不動。
-- 執行：整份貼到正式區 SQL Editor 按 Run；可重複執行。復原前請先把新版程式退回舊版，否則匯入功能會報錯。
-- ============================================================================
-- 回復「處方箋 Google Sheet 匯入」：移除整批匯入函式與簡稱對照表。可重複執行。
-- 注意：簡稱對照表的內容會一併刪除；處方箋月報（monthly_prescription_reports）完全不動。
BEGIN;
DROP FUNCTION IF EXISTS public.import_prescription_report_batch(text, jsonb, jsonb, uuid);
DROP TABLE IF EXISTS public.prescription_store_aliases;
NOTIFY pgrst, 'reload schema';
COMMIT;
