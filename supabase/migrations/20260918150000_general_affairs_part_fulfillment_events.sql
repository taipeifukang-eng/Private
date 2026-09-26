DO $$ BEGIN
  IF to_regclass('public.ga_part_fulfillments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_part_fulfillments';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_part_fulfillment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES public.ga_part_fulfillments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_part_fulfillment_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_ga_part_fulfillment_events_fulfillment ON public.ga_part_fulfillment_events(fulfillment_id, created_at DESC);
ALTER TABLE public.ga_part_fulfillment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_part_fulfillment_events_read ON public.ga_part_fulfillment_events;
CREATE POLICY ga_part_fulfillment_events_read ON public.ga_part_fulfillment_events FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view') OR public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.view_all') OR public.current_user_has_permission('general_affairs.request.manage'));
DROP POLICY IF EXISTS ga_part_fulfillment_events_manage ON public.ga_part_fulfillment_events;
CREATE POLICY ga_part_fulfillment_events_manage ON public.ga_part_fulfillment_events FOR INSERT TO authenticated WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage') OR public.current_user_has_permission('general_affairs.request.manage'));
GRANT SELECT, INSERT ON public.ga_part_fulfillment_events TO authenticated;
NOTIFY pgrst, 'reload schema';
