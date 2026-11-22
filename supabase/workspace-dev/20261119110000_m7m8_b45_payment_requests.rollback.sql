-- 還原 20261119110000_m7m8_b45_payment_requests.sql：移除請款單三張表（整張 DROP，不經逐列刪除觸發器）、取號函式、事件觸發器函式與尾差預設列。
-- 注意：撤回會刪掉所有請款單與操作紀錄；正式區撤回前務必先備份。先決：150000 之後的函式已先撤回。
DROP TRIGGER IF EXISTS trg_ga_payment_request_lines_guard ON public.ga_payment_request_lines;
DROP TRIGGER IF EXISTS trg_ga_payment_requests_guard ON public.ga_payment_requests;
DROP TABLE IF EXISTS public.ga_payment_request_events;
DROP TABLE IF EXISTS public.ga_payment_request_lines;
DROP TABLE IF EXISTS public.ga_payment_requests;
DROP FUNCTION IF EXISTS public.ga_pay_request_lines_guard();
DROP FUNCTION IF EXISTS public.ga_pay_request_guard();
DROP FUNCTION IF EXISTS public.ga_pay_events_immutable();
DROP FUNCTION IF EXISTS public.ga_next_pr_no();
DELETE FROM public.ga_workflow_settings WHERE key IN ('pay_tolerance_amount', 'pay_buyer_title', 'pay_buyer_tax_id');
NOTIFY pgrst, 'reload schema';
