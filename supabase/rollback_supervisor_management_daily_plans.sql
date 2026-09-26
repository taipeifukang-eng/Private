-- ============================================================
-- Rollback - Supervisor Management Daily Plans Foundation
-- Drops only objects introduced by migration_supervisor_management_daily_plans.sql.
-- Does not delete supervisor management cases, records, followups, users, stores or RBAC objects.
-- ============================================================

DROP POLICY IF EXISTS supervisor_management_daily_plans_update ON public.supervisor_management_daily_plans;
DROP POLICY IF EXISTS supervisor_management_daily_plans_insert ON public.supervisor_management_daily_plans;
DROP POLICY IF EXISTS supervisor_management_daily_plans_read ON public.supervisor_management_daily_plans;

DROP TRIGGER IF EXISTS trg_supervisor_management_daily_plans_validate ON public.supervisor_management_daily_plans;

DROP FUNCTION IF EXISTS public.supervisor_management_soft_delete_daily_plan(uuid, text);
DROP FUNCTION IF EXISTS public.supervisor_management_validate_daily_plan();
DROP FUNCTION IF EXISTS public.supervisor_management_daily_plan_is_manageable(uuid);
DROP FUNCTION IF EXISTS public.supervisor_management_daily_plan_is_visible(uuid);

DROP TABLE IF EXISTS public.supervisor_management_daily_plans;
