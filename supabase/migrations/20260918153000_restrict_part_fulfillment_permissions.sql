DO $$ BEGIN
  IF to_regclass('public.ga_part_fulfillments') IS NULL
    OR to_regclass('public.ga_part_fulfillment_documents') IS NULL
    OR to_regclass('public.ga_part_fulfillment_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for part fulfillment permission restriction';
  END IF;
END $$;

DROP POLICY IF EXISTS ga_part_fulfillments_read ON public.ga_part_fulfillments;
CREATE POLICY ga_part_fulfillments_read ON public.ga_part_fulfillments
FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view')
  OR public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

DROP POLICY IF EXISTS ga_part_fulfillments_manage ON public.ga_part_fulfillments;
CREATE POLICY ga_part_fulfillments_manage ON public.ga_part_fulfillments
FOR ALL TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage')
) WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

DROP POLICY IF EXISTS ga_part_fulfillment_documents_read ON public.ga_part_fulfillment_documents;
CREATE POLICY ga_part_fulfillment_documents_read ON public.ga_part_fulfillment_documents
FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view')
  OR public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

DROP POLICY IF EXISTS ga_part_fulfillment_documents_manage ON public.ga_part_fulfillment_documents;
CREATE POLICY ga_part_fulfillment_documents_manage ON public.ga_part_fulfillment_documents
FOR ALL TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage')
) WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

DROP POLICY IF EXISTS ga_part_fulfillment_events_read ON public.ga_part_fulfillment_events;
CREATE POLICY ga_part_fulfillment_events_read ON public.ga_part_fulfillment_events
FOR SELECT TO authenticated USING (
  public.current_user_has_permission('general_affairs.part_fulfillment.view')
  OR public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

DROP POLICY IF EXISTS ga_part_fulfillment_events_manage ON public.ga_part_fulfillment_events;
CREATE POLICY ga_part_fulfillment_events_manage ON public.ga_part_fulfillment_events
FOR INSERT TO authenticated WITH CHECK (
  public.current_user_has_permission('general_affairs.part_fulfillment.manage')
);

NOTIFY pgrst, 'reload schema';
