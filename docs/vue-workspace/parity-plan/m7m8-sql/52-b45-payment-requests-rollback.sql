-- 52-b45-payment-requests-rollback.sql
-- 撤回 52：移除請款單三張表（整張 DROP，包含不可改刪的操作紀錄）、取號函式、事件觸發器函式與 pay_tolerance_amount、買受人設定列。會刪除：全部請款單、明細與操作紀錄——**撤回前務必先備份**。
-- 要先撤回 56 至 58（函式參照這些表）與 54（附件守門觸發器參照請款明細）。
-- 撤回前備份（請款資料與操作紀錄，這是付款依據）：
--   CREATE TABLE public.zz_bak_b45_52_requests AS SELECT * FROM public.ga_payment_requests;
--   CREATE TABLE public.zz_bak_b45_52_lines AS SELECT * FROM public.ga_payment_request_lines;
--   CREATE TABLE public.zz_bak_b45_52_events AS SELECT * FROM public.ga_payment_request_events;
--   CREATE TABLE public.zz_bak_b45_52_settings AS SELECT * FROM public.ga_workflow_settings WHERE key LIKE 'pay\_%';
BEGIN;

DROP TABLE IF EXISTS public.ga_payment_request_events;
DROP TABLE IF EXISTS public.ga_payment_request_lines;
DROP TABLE IF EXISTS public.ga_payment_requests;
DROP FUNCTION IF EXISTS public.ga_pay_events_immutable();
DROP FUNCTION IF EXISTS public.ga_next_pr_no();
DELETE FROM public.ga_workflow_settings WHERE key IN ('pay_tolerance_amount', 'pay_buyer_title', 'pay_buyer_tax_id');
NOTIFY pgrst, 'reload schema';

COMMIT;
