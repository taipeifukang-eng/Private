-- P1-E Production legacy General Affairs / Maintenance compatibility schema.
-- DEV schema-only compatibility. Do not copy Production business data.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ga_service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  parent_id uuid REFERENCES public.ga_service_categories(id) ON DELETE SET NULL,
  description text,
  icon_key text DEFAULT 'wrench'::text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  sort_order integer NOT NULL DEFAULT 10,
  common_items text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ga_service_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  parent_id uuid REFERENCES public.ga_service_regions(id) ON DELETE SET NULL,
  region_type text NOT NULL DEFAULT 'city' CHECK (region_type IN ('country', 'region', 'city', 'district')),
  description text,
  included_locations text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ga_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_type text NOT NULL DEFAULT 'company' CHECK (vendor_type IN ('company', 'studio', 'personal')),
  tax_id text,
  alias text,
  founded_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  phone text,
  fax text,
  website text,
  city text,
  district text,
  address text,
  service_city text,
  service_district text,
  service_address text,
  same_service_address boolean NOT NULL DEFAULT true,
  contact_name text,
  contact_phone text,
  line_id text,
  email text,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  brands text[] NOT NULL DEFAULT '{}',
  equipment_types text[] NOT NULL DEFAULT '{}',
  service_category_ids uuid[] NOT NULL DEFAULT '{}',
  service_region_ids uuid[] NOT NULL DEFAULT '{}',
  rating numeric(3,1) NOT NULL DEFAULT 0,
  review_count integer NOT NULL DEFAULT 0,
  work_order_count integer NOT NULL DEFAULT 0,
  monthly_order_count integer NOT NULL DEFAULT 0,
  total_amount numeric(12,0) NOT NULL DEFAULT 0,
  avg_days numeric(4,1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.maintenance_progress_stages (
  code text PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  reported_by uuid NOT NULL REFERENCES auth.users(id),
  reporter_name text NOT NULL,
  status text NOT NULL DEFAULT 'UNACCEPTED' CHECK (status IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category_id uuid REFERENCES public.maintenance_categories(id) ON DELETE SET NULL,
  resource_type text,
  issue_type text,
  contact_name text,
  contact_phone text,
  progress_stage text REFERENCES public.maintenance_progress_stages(code) ON UPDATE CASCADE ON DELETE SET NULL,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_name text,
  handling_method text,
  vendor_id uuid REFERENCES public.ga_vendors(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completion_method text CHECK (completion_method IS NULL OR completion_method IN ('STORE_CONFIRMED', 'ADMIN_FORCE_CLOSED')),
  completion_requested_at timestamptz,
  completion_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unresolved_reason text
);

CREATE TABLE IF NOT EXISTS public.maintenance_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  photo_type text DEFAULT 'before' CHECK (photo_type IN ('before', 'progress', 'after', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('UNACCEPTED', 'ACCEPTED', 'PROCESSING', 'COMPLETED')),
  notes text NOT NULL,
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  progress_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Taipei'::text))::date,
  category_id uuid REFERENCES public.maintenance_categories(id) ON DELETE SET NULL,
  progress_stage text REFERENCES public.maintenance_progress_stages(code) ON UPDATE CASCADE ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'INTERNAL'))
);

CREATE TABLE IF NOT EXISTS public.maintenance_update_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id uuid NOT NULL REFERENCES public.maintenance_updates(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.maintenance_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  previous_progress_stage text,
  new_progress_stage text,
  description text NOT NULL,
  visibility text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ga_service_categories_parent ON public.ga_service_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_service_categories_status ON public.ga_service_categories(status);
CREATE INDEX IF NOT EXISTS idx_ga_service_regions_parent ON public.ga_service_regions(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_service_regions_status ON public.ga_service_regions(status);
CREATE INDEX IF NOT EXISTS idx_ga_vendors_name ON public.ga_vendors(name);
CREATE INDEX IF NOT EXISTS idx_ga_vendors_status ON public.ga_vendors(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_categories_active_order ON public.maintenance_categories(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_maintenance_photos_request_id ON public.maintenance_photos(request_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_accepted_by ON public.maintenance_requests(accepted_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_category_id ON public.maintenance_requests(category_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_completed_by ON public.maintenance_requests(completed_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_created_at ON public.maintenance_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_progress_stage ON public.maintenance_requests(progress_stage);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_reported_by ON public.maintenance_requests(reported_by);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_resource_type ON public.maintenance_requests(resource_type);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_status ON public.maintenance_requests(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_store_id ON public.maintenance_requests(store_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_ticket_id_created_at ON public.maintenance_ticket_events(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_visibility ON public.maintenance_ticket_events(visibility);
CREATE INDEX IF NOT EXISTS idx_maintenance_update_photos_update_id ON public.maintenance_update_photos(update_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_updates_category_id ON public.maintenance_updates(category_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_updates_progress_date ON public.maintenance_updates(progress_date DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_updates_progress_stage ON public.maintenance_updates(progress_stage);
CREATE INDEX IF NOT EXISTS idx_maintenance_updates_request_id ON public.maintenance_updates(request_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_updates_visibility ON public.maintenance_updates(visibility);

DROP TRIGGER IF EXISTS trg_ga_service_categories_updated_at ON public.ga_service_categories;
CREATE TRIGGER trg_ga_service_categories_updated_at
BEFORE UPDATE ON public.ga_service_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ga_service_regions_updated_at ON public.ga_service_regions;
CREATE TRIGGER trg_ga_service_regions_updated_at
BEFORE UPDATE ON public.ga_service_regions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ga_vendors_updated_at ON public.ga_vendors;
CREATE TRIGGER trg_ga_vendors_updated_at
BEFORE UPDATE ON public.ga_vendors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_maintenance_categories_updated_at ON public.maintenance_categories;
CREATE TRIGGER trg_maintenance_categories_updated_at
BEFORE UPDATE ON public.maintenance_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_maintenance_progress_stages_updated_at ON public.maintenance_progress_stages;
CREATE TRIGGER trg_maintenance_progress_stages_updated_at
BEFORE UPDATE ON public.maintenance_progress_stages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_maintenance_requests_updated_at ON public.maintenance_requests;
CREATE TRIGGER trg_maintenance_requests_updated_at
BEFORE UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ga_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_progress_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_update_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p1e_ga_service_categories_read ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_read ON public.ga_service_categories
FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_ga_service_categories_write ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_write ON public.ga_service_categories
TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_ga_service_regions_read ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_read ON public.ga_service_regions
FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_ga_service_regions_write ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_write ON public.ga_service_regions
TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_ga_vendors_read ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_read ON public.ga_vendors
FOR SELECT TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_ga_vendors_write ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_write ON public.ga_vendors
TO authenticated
USING (public.current_user_has_permission('general_affairs.service_center.access'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_center.access'));

DROP POLICY IF EXISTS p1e_maintenance_categories_read ON public.maintenance_categories;
CREATE POLICY p1e_maintenance_categories_read ON public.maintenance_categories
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.maintenance.submit')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR public.current_user_has_permission('cross_dept.maintenance.category.edit')
);

DROP POLICY IF EXISTS p1e_maintenance_categories_write ON public.maintenance_categories;
CREATE POLICY p1e_maintenance_categories_write ON public.maintenance_categories
TO authenticated
USING (public.current_user_has_permission('cross_dept.maintenance.category.edit'))
WITH CHECK (public.current_user_has_permission('cross_dept.maintenance.category.edit'));

DROP POLICY IF EXISTS p1e_maintenance_progress_stages_read ON public.maintenance_progress_stages;
CREATE POLICY p1e_maintenance_progress_stages_read ON public.maintenance_progress_stages
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.maintenance.submit')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR public.current_user_has_permission('cross_dept.maintenance.category.edit')
);

DROP POLICY IF EXISTS p1e_maintenance_progress_stages_write ON public.maintenance_progress_stages;
CREATE POLICY p1e_maintenance_progress_stages_write ON public.maintenance_progress_stages
TO authenticated
USING (public.current_user_has_permission('cross_dept.maintenance.category.edit'))
WITH CHECK (public.current_user_has_permission('cross_dept.maintenance.category.edit'));

DROP POLICY IF EXISTS p1e_maintenance_requests_read ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_read ON public.maintenance_requests
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR reported_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.store_managers sm
    WHERE sm.store_id = maintenance_requests.store_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS p1e_maintenance_requests_insert ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_insert ON public.maintenance_requests
FOR INSERT TO authenticated
WITH CHECK (
  reported_by = auth.uid()
  AND (
    public.current_user_has_permission('cross_dept.maintenance.view_all')
    OR (
      public.current_user_has_permission('cross_dept.maintenance.submit')
      AND EXISTS (
        SELECT 1
        FROM public.store_managers sm
        WHERE sm.store_id = maintenance_requests.store_id
          AND sm.user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_requests_update ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_update ON public.maintenance_requests
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_requests_delete ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_delete ON public.maintenance_requests
FOR DELETE TO authenticated
USING (
  public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR reported_by = auth.uid()
);

DROP POLICY IF EXISTS p1e_maintenance_photos_read ON public.maintenance_photos;
CREATE POLICY p1e_maintenance_photos_read ON public.maintenance_photos
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.maintenance_requests mr
    WHERE mr.id = maintenance_photos.request_id
      AND (
        public.current_user_has_permission('cross_dept.maintenance.view_all')
        OR mr.reported_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.store_managers sm
          WHERE sm.store_id = mr.store_id
            AND sm.user_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_photos_write ON public.maintenance_photos;
CREATE POLICY p1e_maintenance_photos_write ON public.maintenance_photos
TO authenticated
USING (uploaded_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'))
WITH CHECK (uploaded_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'));

DROP POLICY IF EXISTS p1e_maintenance_updates_read ON public.maintenance_updates;
CREATE POLICY p1e_maintenance_updates_read ON public.maintenance_updates
FOR SELECT TO authenticated
USING (
  visibility = 'PUBLIC'
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_updates_write ON public.maintenance_updates;
CREATE POLICY p1e_maintenance_updates_write ON public.maintenance_updates
TO authenticated
USING (
  updated_by = auth.uid()
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  updated_by = auth.uid()
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_update_photos_read ON public.maintenance_update_photos;
CREATE POLICY p1e_maintenance_update_photos_read ON public.maintenance_update_photos
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.maintenance_updates mu
    WHERE mu.id = maintenance_update_photos.update_id
      AND (
        mu.visibility = 'PUBLIC'
        OR public.current_user_has_permission('cross_dept.maintenance.view_all')
        OR public.current_user_has_permission('cross_dept.maintenance.update')
      )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_update_photos_write ON public.maintenance_update_photos;
CREATE POLICY p1e_maintenance_update_photos_write ON public.maintenance_update_photos
TO authenticated
USING (uploaded_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'))
WITH CHECK (uploaded_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'));

DROP POLICY IF EXISTS p1e_maintenance_ticket_events_read ON public.maintenance_ticket_events;
CREATE POLICY p1e_maintenance_ticket_events_read ON public.maintenance_ticket_events
FOR SELECT TO authenticated
USING (
  visibility = 'PUBLIC'
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_ticket_events_write ON public.maintenance_ticket_events;
CREATE POLICY p1e_maintenance_ticket_events_write ON public.maintenance_ticket_events
TO authenticated
USING (created_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'))
WITH CHECK (created_by = auth.uid() OR public.current_user_has_permission('cross_dept.maintenance.update'));

REVOKE ALL ON TABLE public.ga_service_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_service_regions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_vendors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_progress_stages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_updates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_update_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.maintenance_ticket_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ga_service_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ga_service_regions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ga_vendors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_progress_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_updates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_update_photos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_ticket_events TO authenticated;

GRANT ALL ON TABLE public.ga_service_categories TO service_role;
GRANT ALL ON TABLE public.ga_service_regions TO service_role;
GRANT ALL ON TABLE public.ga_vendors TO service_role;
GRANT ALL ON TABLE public.maintenance_categories TO service_role;
GRANT ALL ON TABLE public.maintenance_progress_stages TO service_role;
GRANT ALL ON TABLE public.maintenance_requests TO service_role;
GRANT ALL ON TABLE public.maintenance_photos TO service_role;
GRANT ALL ON TABLE public.maintenance_updates TO service_role;
GRANT ALL ON TABLE public.maintenance_update_photos TO service_role;
GRANT ALL ON TABLE public.maintenance_ticket_events TO service_role;
