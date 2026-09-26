DO $$
DECLARE
  missing_objects text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.stores') IS NULL THEN 'table public.stores' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END
  ], NULL)
  INTO missing_objects;

  IF array_length(missing_objects, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for general affairs service requests: %', array_to_string(missing_objects, ', ');
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('general_affairs', 'request', 'general_affairs.request.create', 'create', '建立總務需求單：門市建立維修或添購補充需求單', true),
  ('general_affairs', 'request', 'general_affairs.request.view_own_store', 'view_own_store', '查看本門市總務需求單：查看自己管理門市的總務需求與進度', true),
  ('general_affairs', 'request', 'general_affairs.request.view_all', 'view_all', '查看全部總務需求單：總務、工務或主管查看全部門市需求與處理進度', true),
  ('general_affairs', 'request', 'general_affairs.request.manage', 'manage', '管理總務需求單：總務/工務受理、駁回、補資料、轉派與更新需求單', true),
  ('general_affairs', 'request', 'general_affairs.request.comment_own_store', 'comment_own_store', '回覆本門市總務需求單：門市於自己的總務需求單留言與補充附件', true),
  ('general_affairs', 'request', 'general_affairs.request.comment_all', 'comment_all', '回覆全部總務需求單：總務/工務於總務需求單公開回覆或留下內部備註', true),
  ('general_affairs', 'request', 'general_affairs.request.confirm_own_store', 'confirm_own_store', '確認本門市總務需求完成：門市確認總務需求完成、收貨或回報有問題', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

CREATE TABLE IF NOT EXISTS public.ga_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no text NOT NULL UNIQUE DEFAULT ('GA-' || to_char(NOW(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  created_by uuid NOT NULL,
  created_by_name text,
  request_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  resource_type text,
  equipment_id uuid REFERENCES public.ga_equipment(id),
  facility_id uuid REFERENCES public.ga_facilities(id),
  part_id uuid REFERENCES public.ga_parts(id),
  desired_quantity numeric(12, 2),
  desired_unit text,
  desired_spec text,
  impact_description text,
  temporary_workaround text,
  contact_name text,
  contact_phone text,
  main_status text NOT NULL DEFAULT 'PENDING_INTAKE',
  intake_route text,
  assignee_role text,
  assignee_user_id uuid,
  assignee_name text,
  rejection_reason text,
  rejection_note text,
  supplement_type text,
  supplement_note text,
  public_progress text NOT NULL DEFAULT '門市已送出需求，等待總務受理。',
  internal_note text,
  completed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz,
  CONSTRAINT ga_service_requests_request_type_check
    CHECK (request_type IN ('REPAIR', 'PURCHASE_SUPPLEMENT', 'ASSIGNED_RESPONSE')),
  CONSTRAINT ga_service_requests_resource_type_check
    CHECK (resource_type IS NULL OR resource_type IN ('EQUIPMENT', 'FACILITY', 'PART', 'GENERAL_SUPPLY', 'OTHER_PURCHASE')),
  CONSTRAINT ga_service_requests_main_status_check
    CHECK (main_status IN ('PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_STORE_CONFIRMATION', 'COMPLETED', 'REJECTED', 'CANCELED')),
  CONSTRAINT ga_service_requests_intake_route_check
    CHECK (intake_route IS NULL OR intake_route IN ('REPAIR_DISPATCH', 'PURCHASE_REVIEW', 'STOCK_ISSUE', 'TRANSFER', 'ASSET_TASK')),
  CONSTRAINT ga_service_requests_assignee_role_check
    CHECK (assignee_role IS NULL OR assignee_role IN ('GENERAL_AFFAIRS', 'WORKS')),
  CONSTRAINT ga_service_requests_repair_bound_resource_check
    CHECK (
      request_type <> 'REPAIR'
      OR (
        (resource_type = 'EQUIPMENT' AND equipment_id IS NOT NULL AND facility_id IS NULL)
        OR (resource_type = 'FACILITY' AND facility_id IS NOT NULL AND equipment_id IS NULL)
      )
    ),
  CONSTRAINT ga_service_requests_purchase_quantity_check
    CHECK (desired_quantity IS NULL OR desired_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_store_status
ON public.ga_service_requests (store_id, main_status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_type_status
ON public.ga_service_requests (request_type, main_status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_equipment
ON public.ga_service_requests (equipment_id)
WHERE deleted_at IS NULL AND equipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_facility
ON public.ga_service_requests (facility_id)
WHERE deleted_at IS NULL AND facility_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_service_requests_part
ON public.ga_service_requests (part_id)
WHERE deleted_at IS NULL AND part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_service_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ga_service_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  visibility text NOT NULL DEFAULT 'PUBLIC',
  title text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT ga_service_request_events_visibility_check
    CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  CONSTRAINT ga_service_request_events_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_ga_service_request_events_request
ON public.ga_service_request_events (request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ga_service_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ga_service_requests(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'PUBLIC',
  body text NOT NULL,
  created_by uuid NOT NULL,
  created_by_name text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT ga_service_request_comments_visibility_check
    CHECK (visibility IN ('PUBLIC', 'INTERNAL'))
);

CREATE INDEX IF NOT EXISTS idx_ga_service_request_comments_request
ON public.ga_service_request_comments (request_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_touch_service_request_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_service_requests_updated_at ON public.ga_service_requests;
CREATE TRIGGER trg_ga_service_requests_updated_at
BEFORE UPDATE ON public.ga_service_requests
FOR EACH ROW
EXECUTE FUNCTION public.ga_touch_service_request_updated_at();

DROP TRIGGER IF EXISTS trg_ga_service_request_comments_updated_at ON public.ga_service_request_comments;
CREATE TRIGGER trg_ga_service_request_comments_updated_at
BEFORE UPDATE ON public.ga_service_request_comments
FOR EACH ROW
EXECUTE FUNCTION public.ga_touch_service_request_updated_at();

CREATE OR REPLACE FUNCTION public.ga_log_service_request_create()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.ga_service_request_events (
    request_id,
    event_type,
    new_status,
    visibility,
    title,
    description,
    created_by,
    created_by_name
  )
  VALUES (
    NEW.id,
    'REQUEST_CREATED',
    NEW.main_status,
    'PUBLIC',
    '門市送出需求',
    NEW.public_progress,
    NEW.created_by,
    NEW.created_by_name
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_service_requests_create_event ON public.ga_service_requests;
CREATE TRIGGER trg_ga_service_requests_create_event
AFTER INSERT ON public.ga_service_requests
FOR EACH ROW
EXECUTE FUNCTION public.ga_log_service_request_create();

ALTER TABLE public.ga_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_service_request_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_service_requests_select ON public.ga_service_requests;
CREATE POLICY ga_service_requests_select ON public.ga_service_requests
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('general_affairs.request.view_all')
    OR public.current_user_has_permission('general_affairs.request.manage')
    OR (
      public.current_user_has_permission('general_affairs.request.view_own_store')
      AND EXISTS (
        SELECT 1
        FROM public.store_managers sm
        WHERE sm.store_id = ga_service_requests.store_id
          AND sm.user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS ga_service_requests_insert ON public.ga_service_requests;
CREATE POLICY ga_service_requests_insert ON public.ga_service_requests
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.current_user_has_permission('general_affairs.request.create')
  AND EXISTS (
    SELECT 1
    FROM public.store_managers sm
    WHERE sm.store_id = ga_service_requests.store_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS ga_service_requests_update_manage ON public.ga_service_requests;
CREATE POLICY ga_service_requests_update_manage ON public.ga_service_requests
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND public.current_user_has_permission('general_affairs.request.manage')
)
WITH CHECK (public.current_user_has_permission('general_affairs.request.manage'));

DROP POLICY IF EXISTS ga_service_request_events_select ON public.ga_service_request_events;
CREATE POLICY ga_service_request_events_select ON public.ga_service_request_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ga_service_requests request
    WHERE request.id = ga_service_request_events.request_id
      AND request.deleted_at IS NULL
      AND (
        public.current_user_has_permission('general_affairs.request.view_all')
        OR public.current_user_has_permission('general_affairs.request.manage')
        OR (
          ga_service_request_events.visibility = 'PUBLIC'
          AND public.current_user_has_permission('general_affairs.request.view_own_store')
          AND EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = request.store_id
              AND sm.user_id = auth.uid()
          )
        )
      )
  )
);

DROP POLICY IF EXISTS ga_service_request_events_insert_manage ON public.ga_service_request_events;
CREATE POLICY ga_service_request_events_insert_manage ON public.ga_service_request_events
FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.request.manage'));

DROP POLICY IF EXISTS ga_service_request_comments_select ON public.ga_service_request_comments;
CREATE POLICY ga_service_request_comments_select ON public.ga_service_request_comments
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.ga_service_requests request
    WHERE request.id = ga_service_request_comments.request_id
      AND request.deleted_at IS NULL
      AND (
        public.current_user_has_permission('general_affairs.request.view_all')
        OR public.current_user_has_permission('general_affairs.request.manage')
        OR (
          ga_service_request_comments.visibility = 'PUBLIC'
          AND public.current_user_has_permission('general_affairs.request.view_own_store')
          AND EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = request.store_id
              AND sm.user_id = auth.uid()
          )
        )
      )
  )
);

DROP POLICY IF EXISTS ga_service_request_comments_insert_store ON public.ga_service_request_comments;
CREATE POLICY ga_service_request_comments_insert_store ON public.ga_service_request_comments
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND visibility = 'PUBLIC'
  AND public.current_user_has_permission('general_affairs.request.comment_own_store')
  AND EXISTS (
    SELECT 1
    FROM public.ga_service_requests request
    JOIN public.store_managers sm ON sm.store_id = request.store_id
    WHERE request.id = ga_service_request_comments.request_id
      AND request.deleted_at IS NULL
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS ga_service_request_comments_insert_manage ON public.ga_service_request_comments;
CREATE POLICY ga_service_request_comments_insert_manage ON public.ga_service_request_comments
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.current_user_has_permission('general_affairs.request.comment_all')
    OR public.current_user_has_permission('general_affairs.request.manage')
  )
);

DROP POLICY IF EXISTS ga_service_request_comments_update_own ON public.ga_service_request_comments;
CREATE POLICY ga_service_request_comments_update_own ON public.ga_service_request_comments
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND created_by = auth.uid()
)
WITH CHECK (created_by = auth.uid());

REVOKE ALL ON TABLE public.ga_service_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_service_request_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_service_request_comments FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.ga_service_requests TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ga_service_request_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ga_service_request_comments TO authenticated;
GRANT ALL ON TABLE public.ga_service_requests TO service_role;
GRANT ALL ON TABLE public.ga_service_request_events TO service_role;
GRANT ALL ON TABLE public.ga_service_request_comments TO service_role;

ALTER TABLE public.ga_resource_attachments
  DROP CONSTRAINT IF EXISTS ga_resource_attachments_resource_type_check;

ALTER TABLE public.ga_resource_attachments
  ADD CONSTRAINT ga_resource_attachments_resource_type_check
  CHECK (resource_type IN ('EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'SERVICE_REQUEST'));

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_read(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'SERVICE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_requests request
      WHERE request.id = p_resource_id
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.view_all')
          OR public.current_user_has_permission('general_affairs.request.manage')
          OR (
            public.current_user_has_permission('general_affairs.request.view_own_store')
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = request.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = p_resource_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.equipment.view')
          OR public.current_user_has_permission('general_affairs.equipment.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = e.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_facilities f
      WHERE f.id = p_resource_id
        AND f.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.facility.view')
          OR public.current_user_has_permission('general_affairs.facility.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = f.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'PART' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_parts p
      WHERE p.id = p_resource_id
        AND p.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.part.view')
          OR public.current_user_has_permission('general_affairs.part.manage')
          OR (
            p.is_active = true
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = mr.store_id
              AND sm.user_id = auth.uid()
              AND (
                public.current_user_has_permission('general_affairs.maintenance_request.create')
                OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
                OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
                OR public.current_user_has_permission('cross_dept.maintenance.submit')
              )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          COALESCE(mu.visibility, 'PUBLIC') = 'PUBLIC'
          OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
        )
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'SERVICE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_requests request
      WHERE request.id = p_resource_id
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.manage')
          OR (
            public.current_user_has_permission('general_affairs.request.create')
            AND request.created_by = auth.uid()
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = request.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN public.current_user_has_permission('general_affairs.equipment.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_equipment e
        WHERE e.id = p_resource_id
          AND e.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN public.current_user_has_permission('general_affairs.facility.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_facilities f
        WHERE f.id = p_resource_id
          AND f.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'PART' THEN
    RETURN public.current_user_has_permission('general_affairs.part.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_parts p
        WHERE p.id = p_resource_id
          AND p.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR (
            (
              public.current_user_has_permission('general_affairs.maintenance_request.create')
              OR public.current_user_has_permission('cross_dept.maintenance.submit')
            )
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = mr.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mu.updated_by = auth.uid()
        )
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
