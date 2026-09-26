-- ============================================================
-- Supervisor Management Daily Plans Foundation
-- Scope:
--   - Daily management planning table for the supervisor management log.
--   - Validation trigger, visibility helpers, soft-delete RPC, RLS and grants.
-- Not in scope:
--   - Today read-model API implementation.
--   - Record quick-create API / RPC.
--   - Voice / AI draft.
--   - Changes to cases, records, followups or existing applied migrations.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.profiles';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.stores';
  END IF;

  IF to_regclass('public.store_employees') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.store_employees';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.store_managers';
  END IF;

  IF to_regclass('public.supervisor_management_categories') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.supervisor_management_categories';
  END IF;

  IF to_regclass('public.supervisor_management_cases') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.supervisor_management_cases';
  END IF;

  IF to_regclass('public.supervisor_management_records') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.supervisor_management_records';
  END IF;

  IF to_regprocedure('public.supervisor_management_current_user_has_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.supervisor_management_current_user_has_permission(text)';
  END IF;

  IF to_regprocedure('public.supervisor_management_current_user_manages_store(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.supervisor_management_current_user_manages_store(uuid)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.supervisor_management_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date date NOT NULL DEFAULT current_date,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  target_type text NOT NULL DEFAULT 'STORE',
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.store_employees(id) ON DELETE SET NULL,
  target_name_snapshot text NOT NULL,
  category_id uuid REFERENCES public.supervisor_management_categories(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  started_at timestamptz,
  completed_at timestamptz,
  linked_case_id uuid REFERENCES public.supervisor_management_cases(id) ON DELETE SET NULL,
  linked_record_id uuid REFERENCES public.supervisor_management_records(id) ON DELETE SET NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT supervisor_management_daily_plans_target_type_check CHECK (target_type IN ('STORE', 'EMPLOYEE', 'AREA', 'CROSS_DEPARTMENT', 'OTHER')),
  CONSTRAINT supervisor_management_daily_plans_status_check CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  CONSTRAINT supervisor_management_daily_plans_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT supervisor_management_daily_plans_target_snapshot_check CHECK (btrim(target_name_snapshot) <> ''),
  CONSTRAINT supervisor_management_daily_plans_store_target_check CHECK (target_type <> 'STORE' OR store_id IS NOT NULL),
  CONSTRAINT supervisor_management_daily_plans_employee_target_check CHECK (target_type <> 'EMPLOYEE' OR employee_id IS NOT NULL),
  CONSTRAINT supervisor_management_daily_plans_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT supervisor_management_daily_plans_started_status_check CHECK (
    status NOT IN ('IN_PROGRESS', 'DONE')
    OR started_at IS NOT NULL
  ),
  CONSTRAINT supervisor_management_daily_plans_completed_status_check CHECK (
    status <> 'DONE'
    OR completed_at IS NOT NULL
  ),
  CONSTRAINT supervisor_management_daily_plans_linked_record_case_check CHECK (
    linked_record_id IS NULL
    OR linked_case_id IS NOT NULL
  ),
  CONSTRAINT supervisor_management_daily_plans_soft_delete_fields CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_owner_date
ON public.supervisor_management_daily_plans(owner_user_id, plan_date)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_date_status
ON public.supervisor_management_daily_plans(plan_date, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_store_date
ON public.supervisor_management_daily_plans(store_id, plan_date)
WHERE deleted_at IS NULL AND store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_employee_date
ON public.supervisor_management_daily_plans(employee_id, plan_date)
WHERE deleted_at IS NULL AND employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_linked_case
ON public.supervisor_management_daily_plans(linked_case_id)
WHERE deleted_at IS NULL AND linked_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_daily_plans_linked_record
ON public.supervisor_management_daily_plans(linked_record_id)
WHERE deleted_at IS NULL AND linked_record_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.supervisor_management_daily_plan_is_visible(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supervisor_management_daily_plans p
    WHERE p.id = p_plan_id
      AND p.deleted_at IS NULL
      AND (
        public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
        OR (
          (
            public.supervisor_management_current_user_has_permission('supervisor.management_log.view_own')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.update_own')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
          )
          AND p.owner_user_id = auth.uid()
        )
        OR (
          public.supervisor_management_current_user_has_permission('supervisor.management_log.view_team')
          AND p.store_id IS NOT NULL
          AND public.supervisor_management_current_user_manages_store(p.store_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_daily_plan_is_manageable(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supervisor_management_daily_plans p
    WHERE p.id = p_plan_id
      AND p.deleted_at IS NULL
      AND (
        public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
        OR (
          p.owner_user_id = auth.uid()
          AND p.status NOT IN ('DONE', 'CANCELLED')
          AND (
            public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.update_own')
            OR public.supervisor_management_current_user_has_permission('supervisor.management_log.follow_up')
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_validate_daily_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_soft_delete_allowed boolean := COALESCE(current_setting('app.supervisor_management_soft_delete_daily_plan', true), '') = 'on';
  v_linked_record_case_id uuid;
BEGIN
  NEW.target_type := upper(btrim(NEW.target_type));
  NEW.target_name_snapshot := btrim(NEW.target_name_snapshot);
  NEW.title := btrim(NEW.title);
  NEW.status := upper(btrim(NEW.status));
  NEW.notes := NULLIF(btrim(COALESCE(NEW.notes, '')), '');
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);

  IF NEW.status IN ('IN_PROGRESS', 'DONE') AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;

  IF NEW.status = 'DONE' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  END IF;

  IF NEW.linked_record_id IS NOT NULL THEN
    SELECT r.case_id
    INTO v_linked_record_case_id
    FROM public.supervisor_management_records r
    WHERE r.id = NEW.linked_record_id
      AND r.deleted_at IS NULL;

    IF v_linked_record_case_id IS NULL THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_LINKED_RECORD_INVALID: 關聯管理紀錄不存在或已刪除';
    END IF;

    IF NEW.linked_case_id IS NULL THEN
      NEW.linked_case_id := v_linked_record_case_id;
    ELSIF NEW.linked_case_id IS DISTINCT FROM v_linked_record_case_id THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_LINKED_RECORD_CASE_MISMATCH: 關聯案件與管理紀錄不一致';
    END IF;
  END IF;

  IF NEW.linked_case_id IS NOT NULL AND NOT public.supervisor_management_case_is_visible(NEW.linked_case_id) THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_LINKED_CASE_NOT_VISIBLE: 關聯案件不存在、已刪除或無權限';
  END IF;

  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.supervisor_management_categories c
    WHERE c.id = NEW.category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_CATEGORY_INVALID: 分類不存在、停用或已刪除';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := auth.uid();
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;

    IF public.supervisor_management_current_user_has_permission('supervisor.management_log.manage') THEN
      RETURN NEW;
    END IF;

    IF NOT public.supervisor_management_current_user_has_permission('supervisor.management_log.create') THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_PERMISSION_DENIED: 沒有建立今日管理規劃權限';
    END IF;

    IF NEW.owner_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_OWNER_MISMATCH: 規劃擁有人必須是目前登入使用者';
    END IF;
  ELSE
    IF NOT v_soft_delete_allowed AND (
      NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
      OR NEW.deletion_reason IS DISTINCT FROM OLD.deletion_reason
    ) THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_SYSTEM_FIELDS_IMMUTABLE: 今日管理規劃系統欄位不可由 Client 修改';
    END IF;

    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();

    IF NOT public.supervisor_management_daily_plan_is_manageable(OLD.id) THEN
      RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_PERMISSION_DENIED: 沒有編輯今日管理規劃權限';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supervisor_management_daily_plans_validate ON public.supervisor_management_daily_plans;
CREATE TRIGGER trg_supervisor_management_daily_plans_validate
BEFORE INSERT OR UPDATE ON public.supervisor_management_daily_plans
FOR EACH ROW EXECUTE FUNCTION public.supervisor_management_validate_daily_plan();

CREATE OR REPLACE FUNCTION public.supervisor_management_soft_delete_daily_plan(
  p_plan_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_deleted_at timestamptz := now();
  v_user_id uuid := auth.uid();
  v_row public.supervisor_management_daily_plans%ROWTYPE;
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_DELETE_REASON_REQUIRED: 請輸入刪除原因';
  END IF;

  SELECT * INTO v_row
  FROM public.supervisor_management_daily_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_NOT_FOUND: 今日管理規劃不存在';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_ALREADY_DELETED: 此今日管理規劃已被刪除';
  END IF;

  IF NOT public.supervisor_management_daily_plan_is_manageable(p_plan_id) THEN
    RAISE EXCEPTION 'SUPERVISOR_DAILY_PLAN_PERMISSION_DENIED: 沒有刪除今日管理規劃權限';
  END IF;

  PERFORM set_config('app.supervisor_management_soft_delete_daily_plan', 'on', true);

  UPDATE public.supervisor_management_daily_plans
  SET deleted_at = v_deleted_at,
      deleted_by = v_user_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at,
      updated_by = v_user_id
  WHERE id = p_plan_id
    AND deleted_at IS NULL;

  PERFORM set_config('app.supervisor_management_soft_delete_daily_plan', '', true);

  RETURN jsonb_build_object('success', true, 'id', p_plan_id);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.supervisor_management_soft_delete_daily_plan', '', true);
    RAISE;
END;
$$;

ALTER TABLE public.supervisor_management_daily_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supervisor_management_daily_plans_read ON public.supervisor_management_daily_plans;
CREATE POLICY supervisor_management_daily_plans_read ON public.supervisor_management_daily_plans
FOR SELECT TO authenticated
USING (public.supervisor_management_daily_plan_is_visible(id));

DROP POLICY IF EXISTS supervisor_management_daily_plans_insert ON public.supervisor_management_daily_plans;
CREATE POLICY supervisor_management_daily_plans_insert ON public.supervisor_management_daily_plans
FOR INSERT TO authenticated
WITH CHECK (
  public.supervisor_management_current_user_has_permission('supervisor.management_log.manage')
  OR (
    public.supervisor_management_current_user_has_permission('supervisor.management_log.create')
    AND owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS supervisor_management_daily_plans_update ON public.supervisor_management_daily_plans;
CREATE POLICY supervisor_management_daily_plans_update ON public.supervisor_management_daily_plans
FOR UPDATE TO authenticated
USING (public.supervisor_management_daily_plan_is_manageable(id))
WITH CHECK (public.supervisor_management_daily_plan_is_manageable(id));

-- No DELETE policy. Hard delete is intentionally unavailable to client roles.

REVOKE ALL ON TABLE public.supervisor_management_daily_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.supervisor_management_daily_plans TO authenticated;

REVOKE ALL ON FUNCTION public.supervisor_management_daily_plan_is_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_daily_plan_is_manageable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_daily_plan() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_soft_delete_daily_plan(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.supervisor_management_daily_plan_is_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_daily_plan_is_manageable(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_soft_delete_daily_plan(uuid, text) TO authenticated;
