-- ============================================================
-- Rollback - Supervisor Management Log Foundation
-- Drops only objects introduced by migration_supervisor_management_log_foundation.sql.
-- Does not delete users, roles, stores, store employees, or unrelated RBAC objects.
-- ============================================================

DROP POLICY IF EXISTS supervisor_management_case_events_insert ON public.supervisor_management_case_events;
DROP POLICY IF EXISTS supervisor_management_case_events_read ON public.supervisor_management_case_events;
DROP POLICY IF EXISTS supervisor_management_followups_update ON public.supervisor_management_followups;
DROP POLICY IF EXISTS supervisor_management_followups_insert ON public.supervisor_management_followups;
DROP POLICY IF EXISTS supervisor_management_followups_read ON public.supervisor_management_followups;
DROP POLICY IF EXISTS supervisor_management_records_update ON public.supervisor_management_records;
DROP POLICY IF EXISTS supervisor_management_records_insert ON public.supervisor_management_records;
DROP POLICY IF EXISTS supervisor_management_records_read ON public.supervisor_management_records;
DROP POLICY IF EXISTS supervisor_management_cases_update ON public.supervisor_management_cases;
DROP POLICY IF EXISTS supervisor_management_cases_insert ON public.supervisor_management_cases;
DROP POLICY IF EXISTS supervisor_management_cases_read ON public.supervisor_management_cases;
DROP POLICY IF EXISTS supervisor_management_categories_update ON public.supervisor_management_categories;
DROP POLICY IF EXISTS supervisor_management_categories_insert ON public.supervisor_management_categories;
DROP POLICY IF EXISTS supervisor_management_categories_read ON public.supervisor_management_categories;

DROP TRIGGER IF EXISTS trg_supervisor_management_followups_validate ON public.supervisor_management_followups;
DROP TRIGGER IF EXISTS trg_supervisor_management_records_validate ON public.supervisor_management_records;
DROP TRIGGER IF EXISTS trg_supervisor_management_cases_validate ON public.supervisor_management_cases;
DROP TRIGGER IF EXISTS trg_supervisor_management_categories_validate ON public.supervisor_management_categories;

DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_record(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_case(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_validate_followup();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_record();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_case();
DROP FUNCTION IF EXISTS public.supervisor_management_validate_category();
DROP FUNCTION IF EXISTS public.supervisor_management_case_is_manageable(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_case_is_visible(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_current_user_has_permission(text);
DROP FUNCTION IF EXISTS public.supervisor_management_current_user_manages_store(uuid);

DROP TABLE IF EXISTS public.supervisor_management_case_events;
DROP TABLE IF EXISTS public.supervisor_management_followups;
DROP TABLE IF EXISTS public.supervisor_management_records;
DROP TABLE IF EXISTS public.supervisor_management_cases;
DROP TABLE IF EXISTS public.supervisor_management_categories;

DELETE FROM public.permissions
WHERE code IN (
  'supervisor.management_log.view_own',
  'supervisor.management_log.view_team',
  'supervisor.management_log.create',
  'supervisor.management_log.update_own',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
  'supervisor.management_category.manage'
);
