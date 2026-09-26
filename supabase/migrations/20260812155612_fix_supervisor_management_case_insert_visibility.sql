-- ============================================================
-- Supervisor Management Log Case Insert Visibility Fix
-- Fix:
--   API view guard allows create/update/follow-up roles to open the
--   workbench, but DB case visibility still only allowed view_own,
--   view_team and manage. INSERT ... RETURNING can therefore fail
--   RLS for create-only users after the INSERT row is checked.
-- Scope:
--   - Rebuild case visibility helper.
--   - Rebuild case validation trigger function to require owner_user_id
--     equals auth.uid() unless the user has manage.
--   - Rebuild case INSERT policy with the same owner guard.
--   - Do not change tables, indexes, constraints or data.
-- ============================================================

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
          (
            public.supervisor_management_current_user_has_permission('supervisor.management_log.view_own')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
          )
          AND (c.owner_user_id = auth.uid() OR c.assigned_user_id = auth.uid())
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.update_own')
          AND c.owner_user_id = auth.uid()
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
          AND (
            c.assigned_user_id = auth.uid()
            OR (
              c.store_id IS NOT NULL
              AND public.supervisor_management_current_user_manages_store(c.store_id)
            )
          )
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.view_team')
          AND c.store_id IS NOT NULL
          AND public.supervisor_management_current_user_manages_store(c.store_id)
        )
      )
  );
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
    IF public.supervisor_management_current_user_has_permission('supervisor.management_log.manage') THEN
      RETURN NEW;
    END IF;

    IF NOT public.supervisor_management_current_user_has_permission('supervisor.management_log.create') THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_PERMISSION_DENIED: 沒有建立督導管理日誌權限';
    END IF;

    IF NEW.owner_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_OWNER_MISMATCH: 建立者必須是目前登入使用者';
    END IF;
  ELSE
    IF NOT public.supervisor_management_case_is_manageable(OLD.id) THEN
      RAISE EXCEPTION 'SUPERVISOR_CASE_PERMISSION_DENIED: 沒有編輯督導管理日誌權限';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS supervisor_management_cases_insert ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_insert ON public.supervisor_management_cases
FOR INSERT TO authenticated
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
  OR (
    public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
    AND owner_user_id = auth.uid()
  )
);

REVOKE ALL ON FUNCTION public.supervisor_management_case_is_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_case() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.supervisor_management_case_is_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_validate_case() TO service_role;

NOTIFY pgrst, 'reload schema';
