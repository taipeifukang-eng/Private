-- Align employee movement RBAC with table-level RLS used by formal onboarding flows.

DO $$
BEGIN
  IF to_regprocedure('public.has_permission(uuid, character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.has_permission(uuid, varchar)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_code character varying)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT public.has_permission(auth.uid(), p_permission_code);
$$;

COMMENT ON FUNCTION public.current_user_has_permission(character varying)
IS 'Checks whether the current authenticated user has an active RBAC permission.';

GRANT EXECUTE ON FUNCTION public.current_user_has_permission(character varying) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_permission(character varying) TO service_role;

DROP POLICY IF EXISTS p1c_store_employees_insert_manage ON public.store_employees;
CREATE POLICY p1c_store_employees_insert_manage ON public.store_employees
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('employee.manage'::character varying)
  OR public.current_user_has_permission('store.manage'::character varying)
  OR public.current_user_has_permission('employee.movement.manage'::character varying)
  OR public.current_user_has_permission('employee.promotion.batch'::character varying)
);

DROP POLICY IF EXISTS p1c_store_employees_update_manage ON public.store_employees;
CREATE POLICY p1c_store_employees_update_manage ON public.store_employees
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('employee.manage'::character varying)
  OR public.current_user_has_permission('store.manage'::character varying)
  OR public.current_user_has_permission('employee.movement.manage'::character varying)
  OR public.current_user_has_permission('employee.promotion.batch'::character varying)
)
WITH CHECK (
  public.current_user_has_permission('employee.manage'::character varying)
  OR public.current_user_has_permission('store.manage'::character varying)
  OR public.current_user_has_permission('employee.movement.manage'::character varying)
  OR public.current_user_has_permission('employee.promotion.batch'::character varying)
);

DROP POLICY IF EXISTS p1c_employee_movement_manage ON public.employee_movement_history;
CREATE POLICY p1c_employee_movement_manage ON public.employee_movement_history
TO authenticated
USING (
  public.current_user_has_permission('employee.movement.manage'::character varying)
  OR public.current_user_has_permission('employee.manage'::character varying)
  OR public.current_user_has_permission('employee.promotion.batch'::character varying)
)
WITH CHECK (
  public.current_user_has_permission('employee.movement.manage'::character varying)
  OR public.current_user_has_permission('employee.manage'::character varying)
  OR public.current_user_has_permission('employee.promotion.batch'::character varying)
);

NOTIFY pgrst, 'reload schema';
