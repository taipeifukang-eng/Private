-- 39-b5-work-order-parts-rollback.sql
-- 撤回 39：移除領用料件函式。已經過帳的庫存流水與 PART_ISSUED 事件不動（流水有不可改刪觸發器，庫存餘額不會被回沖）。
-- 撤回前不需要備份（只有函式；已過帳的流水本來就不會被刪）。
BEGIN;

DROP FUNCTION IF EXISTS public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz);
NOTIFY pgrst, 'reload schema';

COMMIT;
