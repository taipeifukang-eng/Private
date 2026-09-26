-- ============================================================
-- Supervisor Management Log Permission Helper Fix
-- Fix:
--   API permission guards can allow admin-like users through
--   compatibility logic, while SML RLS used the legacy
--   current_user_has_permission() helper directly. This caused
--   INSERT to fail with RLS even after API guard passed.
-- Scope:
--   - Add a module-local SECURITY DEFINER permission helper.
--   - Rebuild only SML helper/trigger functions and SML policies
--     to use the module-local helper.
--   - Do not change tables, constraints, indexes or data.
-- ============================================================

CREATE OR REPLACE FUNCTION public.supervisor_management_current_user_has_permission(p_permission_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.is_active = true
      AND r.code IN (
        'admin',
        'system_admin',
        'admin_role',
        'full_admin',
        'full_admin_role',
        'dev_full_admin',
        'owner',
        'owner_role'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions perm ON perm.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND r.is_active = true
      AND rp.is_allowed = true
      AND perm.is_active = true
      AND perm.code = p_permission_code
  );
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_case_is_visible(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supervisor_management_cases c
    WHERE c.id = p_case_id
      AND c.deleted_at IS NULL
      AND (
        public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.view_own')
          AND (c.owner_user_id = auth.uid() OR c.assigned_user_id = auth.uid())
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.view_team')
          AND c.store_id IS NOT NULL
          AND public.supervisor_management_current_user_manages_store(c.store_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_case_is_manageable(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supervisor_management_cases c
    WHERE c.id = p_case_id
      AND c.deleted_at IS NULL
      AND (
        public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.update_own')
          AND c.status NOT IN ('CLOSED', 'CANCELLED')
          AND c.owner_user_id = auth.uid()
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
          AND c.status NOT IN ('CLOSED', 'CANCELLED')
          AND (
            c.assigned_user_id = auth.uid()
            OR (
              c.store_id IS NOT NULL
              AND public.supervisor_management_current_user_manages_store(c.store_id)
            )
          )
        )
      )
  );
$$;

-- 5. Validation triggers
CREATE OR REPLACE FUNCTION public.supervisor_management_validate_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed boolean := COALESCE(current_setting('app.supervisor_management_soft_delete_category', true), '') = 'on';
BEGIN
  NEW.code := upper(btrim(NEW.code));
  NEW.name := btrim(NEW.name);
  NEW.description := NULLIF(btrim(COALESCE(NEW.description, '')), '');

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'SUPERVISOR_CATEGORY_SYSTEM_FIELDS_IMMUTABLE: 分類系統欄位不可由 Client 修改';
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  IF NOT public.supervisor_management_current_user_has_permission('supervisor.management_category.manage')
     AND NOT public.supervisor_management_current_user_has_permission('supervisor.management_log.manage') THEN
    RAISE EXCEPTION 'SUPERVISOR_CATEGORY_PERMISSION_DENIED: 沒有督導管理分類權限';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_validate_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed boolean := COALESCE(current_setting('app.supervisor_management_soft_delete_case', true), '') = 'on';
BEGIN
  NEW.case_no := NULLIF(upper(btrim(COALESCE(NEW.case_no, ''))), '');
  NEW.title := btrim(NEW.title);
  NEW.target_type := upper(btrim(NEW.target_type));
  NEW.target_name_snapshot := btrim(NEW.target_name_snapshot);
  NEW.status := upper(btrim(NEW.status));
  NEW.priority := upper(btrim(NEW.priority));
  NEW.summary := NULLIF(btrim(COALESCE(NEW.summary, '')), '');
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_SYSTEM_FIELDS_IMMUTABLE: 案件系統欄位不可由 Client 修改';
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
       AND NOT public.supervisor_management_current_user_has_permission('supervisor.management_log.manage') THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_PERMISSION_DENIED: 沒有建立督導管理日誌權限';
    END IF;
  ELSE
    IF NOT public.supervisor_management_case_is_manageable(OLD.id) THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_PERMISSION_DENIED: 沒有編輯督導管理日誌權限';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_validate_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed boolean := COALESCE(current_setting('app.supervisor_management_soft_delete_record', true), '') = 'on';
BEGIN
  NEW.record_type := upper(btrim(NEW.record_type));
  NEW.target_name_snapshot := btrim(NEW.target_name_snapshot);
  NEW.observation := btrim(NEW.observation);
  NEW.judgment := btrim(NEW.judgment);
  NEW.action_summary := btrim(NEW.action_summary);
  NEW.expected_result := NULLIF(btrim(COALESCE(NEW.expected_result, '')), '');
  NEW.follow_up_method := NULLIF(upper(btrim(COALESCE(NEW.follow_up_method, ''))), '');
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'SUPERVISOR_RECORD_SYSTEM_FIELDS_IMMUTABLE: 紀錄系統欄位不可由 Client 修改';
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  IF NOT public.supervisor_management_case_is_manageable(NEW.case_id) THEN
    RAISE EXCEPTION 'SUPERVISOR_RECORD_PERMISSION_DENIED: 沒有新增或編輯督導管理紀錄權限';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_validate_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed boolean := COALESCE(current_setting('app.supervisor_management_soft_delete_followup', true), '') = 'on';
BEGIN
  NEW.result_status := upper(btrim(NEW.result_status));
  NEW.result_notes := btrim(NEW.result_notes);
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'SUPERVISOR_FOLLOWUP_SYSTEM_FIELDS_IMMUTABLE: 追蹤系統欄位不可由 Client 修改';
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
  END IF;

  IF NOT public.supervisor_management_case_is_manageable(NEW.case_id) THEN
    RAISE EXCEPTION 'SUPERVISOR_FOLLOWUP_PERMISSION_DENIED: 沒有新增或編輯督導追蹤紀錄權限';
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS supervisor_management_categories_read ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_read ON public.supervisor_management_categories
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.supervisor_management_current_user_has_permission('supervisor.management_log.view_own')
    OR public.supervisor_management_current_user_has_permission('supervisor.management_log.view_team')
    OR public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
    OR public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
    OR public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
  )
);

DROP POLICY IF EXISTS supervisor_management_categories_insert ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_insert ON public.supervisor_management_categories
FOR INSERT TO authenticated
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_category.manage')
  OR public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
);

DROP POLICY IF EXISTS supervisor_management_categories_update ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_update ON public.supervisor_management_categories
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.supervisor_management_current_user_has_permission('supervisor.management_category.manage')
    OR public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
  )
)
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_category.manage')
  OR public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
);

DROP POLICY IF EXISTS supervisor_management_cases_read ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_read ON public.supervisor_management_cases
FOR SELECT TO authenticated
USING (public.supervisor_management_case_is_visible(id));

DROP POLICY IF EXISTS supervisor_management_cases_insert ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_insert ON public.supervisor_management_cases
FOR INSERT TO authenticated
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
  OR public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
);

DROP POLICY IF EXISTS supervisor_management_cases_update ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_update ON public.supervisor_management_cases
FOR UPDATE TO authenticated
USING (public.supervisor_management_case_is_manageable(id))
WITH CHECK (public.supervisor_management_case_is_manageable(id));

DROP POLICY IF EXISTS supervisor_management_records_read ON public.supervisor_management_records;
CREATE POLICY supervisor_management_records_read ON public.supervisor_management_records
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.supervisor_management_case_is_visible(case_id)
);

DROP POLICY IF EXISTS supervisor_management_records_insert ON public.supervisor_management_records;
CREATE POLICY supervisor_management_records_insert ON public.supervisor_management_records
FOR INSERT TO authenticated
WITH CHECK (public.supervisor_management_case_is_manageable(case_id));

DROP POLICY IF EXISTS supervisor_management_records_update ON public.supervisor_management_records;
CREATE POLICY supervisor_management_records_update ON public.supervisor_management_records
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND public.supervisor_management_case_is_manageable(case_id)
)
WITH CHECK (public.supervisor_management_case_is_manageable(case_id));

DROP POLICY IF EXISTS supervisor_management_followups_read ON public.supervisor_management_followups;
CREATE POLICY supervisor_management_followups_read ON public.supervisor_management_followups
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.supervisor_management_case_is_visible(case_id)
);

DROP POLICY IF EXISTS supervisor_management_followups_insert ON public.supervisor_management_followups;
CREATE POLICY supervisor_management_followups_insert ON public.supervisor_management_followups
FOR INSERT TO authenticated
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
  AND public.supervisor_management_case_is_manageable(case_id)
);

DROP POLICY IF EXISTS supervisor_management_followups_update ON public.supervisor_management_followups;
CREATE POLICY supervisor_management_followups_update ON public.supervisor_management_followups
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND public.supervisor_management_case_is_manageable(case_id)
)
WITH CHECK (public.supervisor_management_case_is_manageable(case_id));

DROP POLICY IF EXISTS supervisor_management_case_events_read ON public.supervisor_management_case_events;
CREATE POLICY supervisor_management_case_events_read ON public.supervisor_management_case_events
FOR SELECT TO authenticated
USING (public.supervisor_management_case_is_visible(case_id));

DROP POLICY IF EXISTS supervisor_management_case_events_insert ON public.supervisor_management_case_events;
CREATE POLICY supervisor_management_case_events_insert ON public.supervisor_management_case_events
FOR INSERT TO authenticated
WITH CHECK (public.supervisor_management_case_is_manageable(case_id));

-- No DELETE policies. Hard delete is intentionally unavailable to client roles.

-- Function grants
REVOKE ALL ON FUNCTION public.supervisor_management_current_user_has_permission(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_current_user_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_current_user_has_permission(text) TO service_role;

NOTIFY pgrst, 'reload schema';
