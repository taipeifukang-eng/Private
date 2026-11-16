-- 回復「處方箋 Google Sheet 匯入」：移除整批匯入函式與簡稱對照表。可重複執行。
-- 注意：簡稱對照表的內容會一併刪除；處方箋月報（monthly_prescription_reports）完全不動。
BEGIN;
DROP FUNCTION IF EXISTS public.import_prescription_report_batch(text, jsonb, jsonb, uuid);
DROP TABLE IF EXISTS public.prescription_store_aliases;
NOTIFY pgrst, 'reload schema';
COMMIT;
