-- 還原 20261112100000_m7m8_b4_request_rules.sql：移除第 4 批 A 新增的資料表與欄位。
-- 會刪除：流程設定與變更紀錄（採購核准門檻、稅率等設定會回到「沒有設定」）、處理單待交付時間、單據作廢紀錄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記。
-- 需求單、處理單、單據、留言、事件、報價本身不動。要先還原 20261112110000（採購單函式會讀設定表）。
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
