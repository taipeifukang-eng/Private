-- 37-b5-work-order-rules-rollback.sql
-- 撤回 37：移除第 5 批工單函式（沒有資料表變更，不影響既有資料）。要先撤回 39（領用料件）與 38（第 4 批兩個函式會呼叫這裡的內部函式）。撤回後新版工單中心無法使用；舊版畫面完全不受影響。
-- 撤回前不需要備份（只有函式）。
BEGIN;

DROP FUNCTION IF EXISTS public.ga_ws_wo_category(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_wo_create_legacy(jsonb, text);
DROP FUNCTION IF EXISTS public.ga_ws_wo_delete(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_wo_reply_supplement(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_wo_report_unresolved(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_wo_store_confirm(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_wo_transition(uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_wo_print(uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_ws_wo_summary(jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_wo_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_wo_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_wo_abilities(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_wo_row(uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_wo_sync_skipped(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_wo_sync_request(uuid, text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_wo_apply_supplement_reply(uuid, uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.ga_wo_apply_supplement_request(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_wo_apply_completion_request(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_wo_apply_fields(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_wo_event(uuid, text, text, text, text, text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_wo_log(uuid, text, text, text, text, uuid, date);
DROP FUNCTION IF EXISTS public.ga_wo_perm_error(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_store_actor(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_wo_can_see(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_wo_ga_side(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_can_enter(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_can_delete_perm(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_has_own_perm(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_can_view_all(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_can_update(uuid);
DROP FUNCTION IF EXISTS public.ga_wo_try_uuid(text);
DROP FUNCTION IF EXISTS public.ga_wo_focus(text, text);
DROP FUNCTION IF EXISTS public.ga_wo_is_exec_stage(text);
DROP FUNCTION IF EXISTS public.ga_wo_status_label(text);
DROP FUNCTION IF EXISTS public.ga_wo_stage_label(text);
DROP FUNCTION IF EXISTS public.ga_wo_stage_codes();
DROP FUNCTION IF EXISTS public.ga_wo_no(uuid);
NOTIFY pgrst, 'reload schema';

COMMIT;
