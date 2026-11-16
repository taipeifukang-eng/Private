-- 還原 20261117110000_m7m8_b5_work_order_parts.sql：移除工單領用料件函式。已經過帳的庫存流水與 PART_ISSUED 事件不動（流水有不可改刪觸發器）。
DROP FUNCTION IF EXISTS public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz);
NOTIFY pgrst, 'reload schema';
