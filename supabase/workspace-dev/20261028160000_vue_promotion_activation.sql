BEGIN;
-- Queue only promotions created through the new workspace, never unrelated legacy history.
CREATE TABLE IF NOT EXISTS public.workspace_promotion_activation (
 history_id uuid PRIMARY KEY REFERENCES public.employee_movement_history(id) ON DELETE CASCADE,
 request_id uuid NOT NULL REFERENCES public.workspace_promotion_requests(request_id) ON DELETE CASCADE,
 queued_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 applied_history_id uuid REFERENCES public.employee_movement_history(id) ON DELETE SET NULL
);
ALTER TABLE public.workspace_promotion_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_promotion_activation FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_promotion_activation TO service_role;
CREATE INDEX IF NOT EXISTS workspace_promotion_activation_pending ON public.workspace_promotion_activation(history_id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.workspace_queue_promotion_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO workspace_promotion_activation(history_id,request_id)
 SELECT h.id,NEW.request_id FROM employee_movement_history h
 WHERE h.id IN (SELECT value::uuid FROM jsonb_array_elements_text(NEW.result->'ids'))
 AND h.movement_type='promotion' AND h.movement_date>(now() AT TIME ZONE 'Asia/Taipei')::date
 ON CONFLICT(history_id) DO NOTHING;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workspace_queue_promotion_activation ON public.workspace_promotion_requests;
CREATE TRIGGER workspace_queue_promotion_activation AFTER INSERT ON public.workspace_promotion_requests
FOR EACH ROW EXECUTE FUNCTION public.workspace_queue_promotion_activation();
INSERT INTO workspace_promotion_activation(history_id,request_id)
 SELECT h.id,r.request_id FROM workspace_promotion_requests r CROSS JOIN LATERAL jsonb_array_elements_text(r.result->'ids') item
 JOIN employee_movement_history h ON h.id=item.value::uuid
 WHERE h.movement_type='promotion' AND h.movement_date>(r.created_at AT TIME ZONE 'Asia/Taipei')::date
 ON CONFLICT(history_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.workspace_apply_due_promotions(p_as_of date DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $$
DECLARE code text; latest record; first_month text; master_count integer:=0; monthly_count integer:=0; processed_count integer:=0; changed integer;
BEGIN
 IF p_as_of IS NULL THEN RAISE EXCEPTION 'WORKSPACE_INVALID_DATE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of) THEN
  RETURN jsonb_build_object('processed',0,'mastersUpdated',0,'monthlyUpdated',0);
 END IF;
 LOCK TABLE stores,store_employees,employee_movement_history,monthly_staff_status IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE workspace_promotion_activation IN SHARE ROW EXCLUSIVE MODE;
 FOR code IN SELECT DISTINCT h.employee_code FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.movement_date<=p_as_of ORDER BY h.employee_code LIMIT 500 LOOP
  SELECT min(to_char(h.movement_date,'YYYY-MM')) INTO first_month FROM workspace_promotion_activation q JOIN employee_movement_history h ON h.id=q.history_id WHERE q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  SELECT h.id,h.new_value,h.movement_date INTO latest FROM employee_movement_history h
   WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND h.movement_date<=p_as_of
   ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1;
  IF FOUND THEN
   UPDATE store_employees SET position=latest.new_value,current_position=latest.new_value,last_promotion_date=latest.movement_date,updated_at=now()
    WHERE employee_code=code AND (position,current_position,last_promotion_date) IS DISTINCT FROM (latest.new_value,latest.new_value,latest.movement_date);
   GET DIAGNOSTICS changed=ROW_COUNT;master_count:=master_count+changed;
  END IF;
  -- Include months created after the original save, and preserve all later official promotions.
  WITH desired AS (
   SELECT m.id,h.new_value,substring(h.notes FROM '(?:新人等級|行政階級)[:：]([^；\n]+)') AS new_level,
    EXISTS(SELECT 1 FROM employee_movement_history a WHERE a.employee_code=code AND (a.movement_type='acting_manager' OR (a.movement_type='promotion' AND a.new_value='代理店長')) AND to_char(a.movement_date,'YYYY-MM')<=m.year_month) AS acting
   FROM monthly_staff_status m LEFT JOIN LATERAL (
    SELECT h.new_value,h.notes FROM employee_movement_history h WHERE h.employee_code=code AND h.movement_type='promotion' AND h.new_value<>'代理店長' AND to_char(h.movement_date,'YYYY-MM')<=m.year_month
    ORDER BY h.movement_date DESC,CASE WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:二階新人%' THEN 2 WHEN h.new_value='新人' AND h.notes LIKE '%新人等級:一階新人%' THEN 1 ELSE 0 END DESC,h.created_at DESC,h.id DESC LIMIT 1
   ) h ON true WHERE m.employee_code=code AND m.year_month>=first_month
  ) UPDATE monthly_staff_status m SET position=coalesce(d.new_value,m.position),newbie_level=CASE WHEN d.new_value IS NULL THEN m.newbie_level WHEN d.new_value IN ('新人','行政') THEN d.new_level ELSE NULL END,
    is_acting_manager=CASE WHEN d.acting THEN true ELSE m.is_acting_manager END,updated_at=now()
    FROM desired d WHERE d.id=m.id;
  GET DIAGNOSTICS changed=ROW_COUNT;monthly_count:=monthly_count+changed;
  UPDATE workspace_promotion_activation q SET processed_at=now(),applied_history_id=latest.id
   FROM employee_movement_history h WHERE h.id=q.history_id AND q.processed_at IS NULL AND h.employee_code=code AND h.movement_date<=p_as_of;
  GET DIAGNOSTICS changed=ROW_COUNT;processed_count:=processed_count+changed;
 END LOOP;
 RETURN jsonb_build_object('processed',processed_count,'mastersUpdated',master_count,'monthlyUpdated',monthly_count);
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_queue_promotion_activation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.workspace_apply_due_promotions(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_apply_due_promotions(date) TO service_role;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule('workspace-dev-promotion-activation','* * * * *','SELECT public.workspace_apply_due_promotions();');
NOTIFY pgrst,'reload schema';
COMMIT;
