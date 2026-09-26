-- ============================================================
-- Supervisor Management Log Foundation
--
-- Scope:
--   - RBAC permission codes for the independent supervisor management log module.
--   - Core case / record / follow-up / event tables.
--   - Validation triggers, visibility helpers, soft-delete RPCs, RLS and grants.
--
-- Not in scope:
--   - Production data import.
--   - AI voice transcription pipeline.
--   - API routes or UI write flows.
--   - Inspection module coupling.
-- ============================================================

-- 0. Prerequisite checks
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.profiles') IS NULL THEN 'table public.profiles' END,
    CASE WHEN to_regclass('public.stores') IS NULL THEN 'table public.stores' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regclass('public.store_employees') IS NULL THEN 'table public.store_employees' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Supervisor management log prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- 1. Permissions
INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
  ('supervisor', 'management_log', 'supervisor.management_log.view_own', 'view_own', '查看自己建立或指派給自己的督導管理日誌', true),
  ('supervisor', 'management_log', 'supervisor.management_log.view_team', 'view_team', '查看自己管理門市範圍內的督導管理日誌', true),
  ('supervisor', 'management_log', 'supervisor.management_log.create', 'create', '建立督導管理日誌案件與管理紀錄', true),
  ('supervisor', 'management_log', 'supervisor.management_log.update_own', 'update_own', '編輯自己建立且未結案的督導管理日誌', true),
  ('supervisor', 'management_log', 'supervisor.management_log.follow_up', 'follow_up', '建立督導管理日誌追蹤紀錄', true),
  ('supervisor', 'management_log', 'supervisor.management_log.manage', 'manage', '管理全部督導管理日誌與分類設定', true),
  ('supervisor', 'management_category', 'supervisor.management_category.manage', 'manage', '管理督導管理日誌分類', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.supervisor_management_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT supervisor_management_categories_code_check CHECK (btrim(code) <> '' AND code = upper(btrim(code))),
  CONSTRAINT supervisor_management_categories_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT supervisor_management_categories_sort_order_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT supervisor_management_categories_soft_delete_fields CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.supervisor_management_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_no text,
  title text NOT NULL,
  category_id uuid REFERENCES public.supervisor_management_categories(id),
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL DEFAULT 'STORE',
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.store_employees(id) ON DELETE SET NULL,
  target_name_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  priority text NOT NULL DEFAULT 'NORMAL',
  opened_at timestamptz NOT NULL DEFAULT now(),
  next_follow_up_at date,
  resolved_at timestamptz,
  closed_at timestamptz,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT supervisor_management_cases_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT supervisor_management_cases_target_type_check CHECK (target_type IN ('STORE', 'EMPLOYEE', 'AREA', 'CROSS_DEPARTMENT', 'OTHER')),
  CONSTRAINT supervisor_management_cases_status_check CHECK (status IN ('OPEN', 'FOLLOW_UP', 'IMPROVING', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT supervisor_management_cases_priority_check CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  CONSTRAINT supervisor_management_cases_target_snapshot_check CHECK (btrim(target_name_snapshot) <> ''),
  CONSTRAINT supervisor_management_cases_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT supervisor_management_cases_store_target_check CHECK (target_type <> 'STORE' OR store_id IS NOT NULL),
  CONSTRAINT supervisor_management_cases_employee_target_check CHECK (target_type <> 'EMPLOYEE' OR employee_id IS NOT NULL),
  CONSTRAINT supervisor_management_cases_resolution_pair CHECK (
    (status NOT IN ('RESOLVED', 'CLOSED') AND resolved_at IS NULL)
    OR (status IN ('RESOLVED', 'CLOSED') AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT supervisor_management_cases_closed_pair CHECK (
    (status <> 'CLOSED' AND closed_at IS NULL)
    OR (status = 'CLOSED' AND closed_at IS NOT NULL)
  ),
  CONSTRAINT supervisor_management_cases_soft_delete_fields CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.supervisor_management_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supervisor_management_cases(id) ON DELETE RESTRICT,
  record_type text NOT NULL DEFAULT 'MANAGEMENT',
  record_date date NOT NULL DEFAULT current_date,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.store_employees(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.supervisor_management_categories(id),
  target_name_snapshot text NOT NULL,
  observation text NOT NULL,
  judgment text NOT NULL,
  action_summary text NOT NULL,
  action_options text[] NOT NULL DEFAULT ARRAY[]::text[],
  requires_follow_up boolean NOT NULL DEFAULT false,
  follow_up_date date,
  follow_up_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expected_result text,
  follow_up_method text,
  ai_generated boolean NOT NULL DEFAULT false,
  ai_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT supervisor_management_records_type_check CHECK (record_type IN ('MANAGEMENT', 'FOLLOW_UP', 'RESULT', 'NOTE')),
  CONSTRAINT supervisor_management_records_target_snapshot_check CHECK (btrim(target_name_snapshot) <> ''),
  CONSTRAINT supervisor_management_records_observation_check CHECK (btrim(observation) <> ''),
  CONSTRAINT supervisor_management_records_judgment_check CHECK (btrim(judgment) <> ''),
  CONSTRAINT supervisor_management_records_action_summary_check CHECK (btrim(action_summary) <> ''),
  CONSTRAINT supervisor_management_records_follow_up_method_check CHECK (
    follow_up_method IS NULL OR follow_up_method IN ('ONSITE', 'PHONE', 'MESSAGE', 'MEETING', 'SYSTEM', 'OTHER')
  ),
  CONSTRAINT supervisor_management_records_follow_up_required_pair CHECK (
    requires_follow_up = false
    OR (follow_up_date IS NOT NULL AND follow_up_owner_id IS NOT NULL AND expected_result IS NOT NULL AND btrim(expected_result) <> '')
  ),
  CONSTRAINT supervisor_management_records_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT supervisor_management_records_soft_delete_fields CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.supervisor_management_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supervisor_management_cases(id) ON DELETE RESTRICT,
  source_record_id uuid REFERENCES public.supervisor_management_records(id) ON DELETE SET NULL,
  follow_up_date date NOT NULL DEFAULT current_date,
  result_status text NOT NULL,
  result_notes text NOT NULL,
  next_follow_up_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT supervisor_management_followups_status_check CHECK (result_status IN ('IMPROVED', 'IMPROVING', 'NOT_IMPROVED', 'POSTPONED', 'CLOSED')),
  CONSTRAINT supervisor_management_followups_notes_check CHECK (btrim(result_notes) <> ''),
  CONSTRAINT supervisor_management_followups_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT supervisor_management_followups_soft_delete_fields CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_reason IS NOT NULL AND btrim(deletion_reason) <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.supervisor_management_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.supervisor_management_cases(id) ON DELETE RESTRICT,
  record_id uuid REFERENCES public.supervisor_management_records(id) ON DELETE SET NULL,
  followup_id uuid REFERENCES public.supervisor_management_followups(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL,
  body text,
  actor_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT supervisor_management_case_events_type_check CHECK (btrim(event_type) <> ''),
  CONSTRAINT supervisor_management_case_events_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT supervisor_management_case_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

-- 3. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_supervisor_management_categories_code_active
ON public.supervisor_management_categories (upper(btrim(code)))
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supervisor_management_cases_case_no_active
ON public.supervisor_management_cases (upper(btrim(case_no)))
WHERE deleted_at IS NULL AND case_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_owner ON public.supervisor_management_cases(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_assigned ON public.supervisor_management_cases(assigned_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_store ON public.supervisor_management_cases(store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_employee ON public.supervisor_management_cases(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_status ON public.supervisor_management_cases(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_cases_next_follow_up ON public.supervisor_management_cases(next_follow_up_at) WHERE deleted_at IS NULL AND next_follow_up_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_records_case ON public.supervisor_management_records(case_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_records_store ON public.supervisor_management_records(store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_records_employee ON public.supervisor_management_records(employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_records_follow_up ON public.supervisor_management_records(follow_up_date) WHERE deleted_at IS NULL AND requires_follow_up;

CREATE INDEX IF NOT EXISTS idx_supervisor_management_followups_case ON public.supervisor_management_followups(case_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supervisor_management_case_events_case ON public.supervisor_management_case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_management_case_events_event_at ON public.supervisor_management_case_events(event_at DESC);

-- 4. Visibility helpers
CREATE OR REPLACE FUNCTION public.supervisor_management_current_user_manages_store(p_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = p_store_id
      AND sm.role_type IN ('store_manager', 'supervisor', 'area_manager')
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
        public.current_user_has_permission('supervisor.management_log.manage')
        OR (
          public.current_user_has_permission('supervisor.management_log.view_own')
          AND (c.owner_user_id = auth.uid() OR c.assigned_user_id = auth.uid())
        )
        OR (
          public.current_user_has_permission('supervisor.management_log.view_team')
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
        public.current_user_has_permission('supervisor.management_log.manage')
        OR (
          public.current_user_has_permission('supervisor.management_log.update_own')
          AND c.status NOT IN ('CLOSED', 'CANCELLED')
          AND c.owner_user_id = auth.uid()
        )
        OR (
          public.current_user_has_permission('supervisor.management_log.follow_up')
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

  IF NOT public.current_user_has_permission('supervisor.management_category.manage')
     AND NOT public.current_user_has_permission('supervisor.management_log.manage') THEN
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
    IF NOT public.current_user_has_permission('supervisor.management_log.create')
       AND NOT public.current_user_has_permission('supervisor.management_log.manage') THEN
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

DROP TRIGGER IF EXISTS trg_supervisor_management_categories_validate ON public.supervisor_management_categories;
CREATE TRIGGER trg_supervisor_management_categories_validate
BEFORE INSERT OR UPDATE ON public.supervisor_management_categories
FOR EACH ROW EXECUTE FUNCTION public.supervisor_management_validate_category();

DROP TRIGGER IF EXISTS trg_supervisor_management_cases_validate ON public.supervisor_management_cases;
CREATE TRIGGER trg_supervisor_management_cases_validate
BEFORE INSERT OR UPDATE ON public.supervisor_management_cases
FOR EACH ROW EXECUTE FUNCTION public.supervisor_management_validate_case();

DROP TRIGGER IF EXISTS trg_supervisor_management_records_validate ON public.supervisor_management_records;
CREATE TRIGGER trg_supervisor_management_records_validate
BEFORE INSERT OR UPDATE ON public.supervisor_management_records
FOR EACH ROW EXECUTE FUNCTION public.supervisor_management_validate_record();

DROP TRIGGER IF EXISTS trg_supervisor_management_followups_validate ON public.supervisor_management_followups;
CREATE TRIGGER trg_supervisor_management_followups_validate
BEFORE INSERT OR UPDATE ON public.supervisor_management_followups
FOR EACH ROW EXECUTE FUNCTION public.supervisor_management_validate_followup();

-- 6. Soft-delete RPCs
CREATE OR REPLACE FUNCTION public.supervisor_management_soft_delete_case(
  p_case_id uuid,
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
  v_row public.supervisor_management_cases%ROWTYPE;
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'SUPERVISOR_CASE_DELETE_REASON_REQUIRED: 請輸入刪除原因';
  END IF;

  SELECT * INTO v_row
  FROM public.supervisor_management_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPERVISOR_CASE_NOT_FOUND: 督導管理案件不存在';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPERVISOR_CASE_ALREADY_DELETED: 此督導管理案件已被刪除';
  END IF;

  IF NOT public.current_user_has_permission('supervisor.management_log.manage') THEN
    RAISE EXCEPTION 'SUPERVISOR_CASE_DELETE_PERMISSION_DENIED: 沒有刪除督導管理案件權限';
  END IF;

  PERFORM set_config('app.supervisor_management_soft_delete_case', 'on', true);
  PERFORM set_config('app.supervisor_management_soft_delete_record', 'on', true);
  PERFORM set_config('app.supervisor_management_soft_delete_followup', 'on', true);

  UPDATE public.supervisor_management_cases
  SET deleted_at = v_deleted_at,
      deleted_by = v_user_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at,
      updated_by = v_user_id
  WHERE id = p_case_id
    AND deleted_at IS NULL;

  UPDATE public.supervisor_management_records
  SET deleted_at = v_deleted_at,
      deleted_by = v_user_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at,
      updated_by = v_user_id
  WHERE case_id = p_case_id
    AND deleted_at IS NULL;

  UPDATE public.supervisor_management_followups
  SET deleted_at = v_deleted_at,
      deleted_by = v_user_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at,
      updated_by = v_user_id
  WHERE case_id = p_case_id
    AND deleted_at IS NULL;

  INSERT INTO public.supervisor_management_case_events (
    case_id, event_type, event_at, title, body, actor_user_id, metadata
  ) VALUES (
    p_case_id,
    'SOFT_DELETE',
    v_deleted_at,
    '刪除督導管理案件',
    v_reason,
    v_user_id,
    jsonb_build_object('deleted_by_rpc', true)
  );

  RETURN jsonb_build_object('ok', true, 'id', p_case_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.supervisor_management_soft_delete_record(
  p_record_id uuid,
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
  v_row public.supervisor_management_records%ROWTYPE;
BEGIN
  IF v_reason = '' THEN
    RAISE EXCEPTION 'SUPERVISOR_RECORD_DELETE_REASON_REQUIRED: 請輸入刪除原因';
  END IF;

  SELECT * INTO v_row
  FROM public.supervisor_management_records
  WHERE id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPERVISOR_RECORD_NOT_FOUND: 督導管理紀錄不存在';
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPERVISOR_RECORD_ALREADY_DELETED: 此督導管理紀錄已被刪除';
  END IF;

  IF NOT public.supervisor_management_case_is_manageable(v_row.case_id) THEN
    RAISE EXCEPTION 'SUPERVISOR_RECORD_DELETE_PERMISSION_DENIED: 沒有刪除督導管理紀錄權限';
  END IF;

  PERFORM set_config('app.supervisor_management_soft_delete_record', 'on', true);

  UPDATE public.supervisor_management_records
  SET deleted_at = v_deleted_at,
      deleted_by = v_user_id,
      deletion_reason = v_reason,
      updated_at = v_deleted_at,
      updated_by = v_user_id
  WHERE id = p_record_id
    AND deleted_at IS NULL;

  INSERT INTO public.supervisor_management_case_events (
    case_id, record_id, event_type, event_at, title, body, actor_user_id, metadata
  ) VALUES (
    v_row.case_id,
    p_record_id,
    'RECORD_SOFT_DELETE',
    v_deleted_at,
    '刪除督導管理紀錄',
    v_reason,
    v_user_id,
    jsonb_build_object('deleted_by_rpc', true)
  );

  RETURN jsonb_build_object('ok', true, 'id', p_record_id);
END;
$$;

-- 7. RLS policies
ALTER TABLE public.supervisor_management_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_management_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_management_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_management_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_management_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supervisor_management_categories_read ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_read ON public.supervisor_management_categories
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('supervisor.management_log.view_own')
    OR public.current_user_has_permission('supervisor.management_log.view_team')
    OR public.current_user_has_permission('supervisor.management_log.create')
    OR public.current_user_has_permission('supervisor.management_log.follow_up')
    OR public.current_user_has_permission('supervisor.management_log.manage')
  )
);

DROP POLICY IF EXISTS supervisor_management_categories_insert ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_insert ON public.supervisor_management_categories
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('supervisor.management_category.manage')
  OR public.current_user_has_permission('supervisor.management_log.manage')
);

DROP POLICY IF EXISTS supervisor_management_categories_update ON public.supervisor_management_categories;
CREATE POLICY supervisor_management_categories_update ON public.supervisor_management_categories
FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('supervisor.management_category.manage')
    OR public.current_user_has_permission('supervisor.management_log.manage')
  )
)
WITH CHECK (
  public.current_user_has_permission('supervisor.management_category.manage')
  OR public.current_user_has_permission('supervisor.management_log.manage')
);

DROP POLICY IF EXISTS supervisor_management_cases_read ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_read ON public.supervisor_management_cases
FOR SELECT TO authenticated
USING (public.supervisor_management_case_is_visible(id));

DROP POLICY IF EXISTS supervisor_management_cases_insert ON public.supervisor_management_cases;
CREATE POLICY supervisor_management_cases_insert ON public.supervisor_management_cases
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('supervisor.management_log.create')
  OR public.current_user_has_permission('supervisor.management_log.manage')
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
  public.current_user_has_permission('supervisor.management_log.follow_up')
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

-- 8. Grants
REVOKE ALL ON TABLE
  public.supervisor_management_categories,
  public.supervisor_management_cases,
  public.supervisor_management_records,
  public.supervisor_management_followups,
  public.supervisor_management_case_events
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.supervisor_management_categories,
  public.supervisor_management_cases,
  public.supervisor_management_records,
  public.supervisor_management_followups,
  public.supervisor_management_case_events
TO authenticated;

GRANT ALL ON TABLE
  public.supervisor_management_categories,
  public.supervisor_management_cases,
  public.supervisor_management_records,
  public.supervisor_management_followups,
  public.supervisor_management_case_events
TO service_role;

REVOKE ALL ON FUNCTION public.supervisor_management_current_user_manages_store(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_case_is_visible(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_case_is_manageable(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_category() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_case() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_validate_followup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_soft_delete_case(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supervisor_management_soft_delete_record(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.supervisor_management_soft_delete_case(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_soft_delete_record(uuid, text) TO authenticated;
