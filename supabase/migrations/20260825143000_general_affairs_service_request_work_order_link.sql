DO $$
DECLARE
  missing_objects text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.ga_service_requests') IS NULL THEN 'table public.ga_service_requests' END,
    CASE WHEN to_regclass('public.maintenance_requests') IS NULL THEN 'table public.maintenance_requests' END,
    CASE WHEN to_regclass('public.maintenance_ticket_events') IS NULL THEN 'table public.maintenance_ticket_events' END
  ], NULL)
  INTO missing_objects;

  IF array_length(missing_objects, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for service request work order link: %', array_to_string(missing_objects, ', ');
  END IF;
END $$;

ALTER TABLE public.ga_service_requests
  ADD COLUMN IF NOT EXISTS maintenance_request_id uuid REFERENCES public.maintenance_requests(id) ON DELETE SET NULL;

ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS ga_service_request_id uuid REFERENCES public.ga_service_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_service_requests_maintenance_request
ON public.ga_service_requests (maintenance_request_id)
WHERE deleted_at IS NULL AND maintenance_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_requests_ga_service_request
ON public.maintenance_requests (ga_service_request_id)
WHERE ga_service_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_intake_route_work_order
ON public.ga_service_requests (intake_route, maintenance_request_id, created_at DESC)
WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
