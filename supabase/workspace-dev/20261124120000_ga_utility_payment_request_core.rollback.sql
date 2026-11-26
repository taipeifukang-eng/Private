-- 還原 20261124120000_ga_utility_payment_request_core.sql（水電話費請款階段 3：請款單核心）。
-- 先決：130000、140000 已先撤回（加掛函式不能再引用這裡的函式）。
-- 注意：撤回後，已送出或已付款的水電請款單不會再自動標記或回復帳單；撤回前請先依階段 1 的安全規則處理水電請款單。
DROP TRIGGER IF EXISTS trg_ga_pay_ub_sync ON public.ga_payment_requests;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_submit_check ON public.ga_payment_requests;
DROP FUNCTION IF EXISTS public.ga_pay_ub_sync();
DROP FUNCTION IF EXISTS public.ga_pay_ub_submit_check();
DROP FUNCTION IF EXISTS public.ga_ws_pay_export_ub(jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_pay_ub_update(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_pay_ub_create(jsonb, text);
DROP FUNCTION IF EXISTS public.ga_ws_pay_ub_candidates(jsonb);
DROP FUNCTION IF EXISTS public.ga_pay_ub_json_ext(uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_pay_ub_apply_bills(uuid, uuid, date, uuid[]);
DROP FUNCTION IF EXISTS public.ga_pay_ub_excluded_stats(uuid, date);
DROP FUNCTION IF EXISTS public.ga_pay_ub_eligible(public.ga_utility_bills, uuid, date, uuid);
NOTIFY pgrst, 'reload schema';
