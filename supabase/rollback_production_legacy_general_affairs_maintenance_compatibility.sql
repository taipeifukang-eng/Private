-- Rollback P1-E Production legacy General Affairs / Maintenance compatibility schema.
-- Use only in DEV with explicit approval.

DROP TABLE IF EXISTS public.maintenance_update_photos;
DROP TABLE IF EXISTS public.maintenance_ticket_events;
DROP TABLE IF EXISTS public.maintenance_updates;
DROP TABLE IF EXISTS public.maintenance_photos;
DROP TABLE IF EXISTS public.maintenance_requests;
DROP TABLE IF EXISTS public.maintenance_progress_stages;
DROP TABLE IF EXISTS public.maintenance_categories;
DROP TABLE IF EXISTS public.ga_vendors;
DROP TABLE IF EXISTS public.ga_service_regions;
DROP TABLE IF EXISTS public.ga_service_categories;

-- Keep public.update_updated_at_column because other legacy parity batches may reuse it.
