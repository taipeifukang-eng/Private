-- 32-b4-request-rules-rollback.sql
-- 撤回 32：移除第 4 批 A 新增的 2 張表與 9 個欄位。會刪除：流程設定與變更紀錄、處理單待交付時間、單據作廢紀錄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記。需求單、處理單、單據、留言、事件、報價本身不動。要先撤回 33（採購單函式會讀設定表）。
-- 撤回前備份（只備份會被刪掉的欄位與表）：
--   CREATE TABLE public.zz_bak_b4_32_settings AS SELECT * FROM public.ga_workflow_settings;
--   CREATE TABLE public.zz_bak_b4_32_setting_events AS SELECT * FROM public.ga_workflow_setting_events;
--   CREATE TABLE public.zz_bak_b4_32_request_cols AS SELECT id, cancel_reason, reopened_count FROM public.ga_service_requests WHERE cancel_reason IS NOT NULL OR reopened_count > 0;
BEGIN;

DROP TABLE IF EXISTS public.ga_workflow_setting_events;
DROP TABLE IF EXISTS public.ga_workflow_settings;
ALTER TABLE public.ga_part_fulfillments DROP COLUMN IF EXISTS ready_to_deliver_at;
ALTER TABLE public.ga_part_fulfillment_documents DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS voided_by;
ALTER TABLE public.ga_service_request_comments DROP COLUMN IF EXISTS original_body;
ALTER TABLE public.ga_service_request_events DROP COLUMN IF EXISTS proxy_for_store;
ALTER TABLE public.ga_service_requests DROP CONSTRAINT IF EXISTS ga_service_requests_reopened_count_check;
ALTER TABLE public.ga_service_requests DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS reopened_count;
ALTER TABLE public.ga_purchase_review_quotes DROP COLUMN IF EXISTS superseded_at;
NOTIFY pgrst, 'reload schema';

COMMIT;
