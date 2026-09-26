-- P1-C Production core compatibility rollback draft.
-- Run only on confirmed DEV and only after explicit approval.

DROP TABLE IF EXISTS public.logs;
DROP TABLE IF EXISTS public.assignment_collaborators;
DROP TABLE IF EXISTS public.assignments;
DROP TABLE IF EXISTS public.templates;
DROP TABLE IF EXISTS public.store_transfer_requests;
DROP TABLE IF EXISTS public.store_relocation_history;
DROP TABLE IF EXISTS public.employee_movement_history;
DROP TABLE IF EXISTS public.store_employees;
DROP TABLE IF EXISTS public.permission_logs;

DROP FUNCTION IF EXISTS public.p1c_assignment_is_visible(uuid);
DROP FUNCTION IF EXISTS public.p1c_touch_updated_at();

WITH p1c_codes(code) AS (
  VALUES
    ('dashboard.view'),
    ('role.permission.view'),
    ('role.permission.assign'),
    ('role.role.view'),
    ('role.role.create'),
    ('role.role.edit'),
    ('role.role.delete'),
    ('role.user_role.view'),
    ('role.user_role.assign'),
    ('role.user_role.revoke'),
    ('user.user.view'),
    ('user.user.create'),
    ('user.user.edit'),
    ('user.user.delete'),
    ('user.user.change_role'),
    ('store.manage'),
    ('store.manager.assign'),
    ('store.supervisor.assign'),
    ('store.store.create'),
    ('store.store.clone'),
    ('store.products_master.manage'),
    ('store.clinic_selfpay.margin'),
    ('store.clinic_selfpay.calculator.use'),
    ('store.clinic_selfpay.mapping.manage'),
    ('store.clinic_selfpay.batch.delete'),
    ('task.view_own'),
    ('task.manage'),
    ('task.view_archived'),
    ('task.template.edit'),
    ('task.template.delete'),
    ('employee.manage'),
    ('employee.employee.create'),
    ('employee.employee.edit'),
    ('employee.import'),
    ('employee.movement.manage'),
    ('employee.promotion.batch'),
    ('employee.promotion.delete'),
    ('employee.store_transfer.create'),
    ('employee.store_transfer.confirm'),
    ('monthly.status.view_own'),
    ('monthly.status.view_all'),
    ('monthly.status.export'),
    ('monthly.status.confirm'),
    ('monthly.status.unconfirm'),
    ('monthly.status.revert'),
    ('monthly.status.view_stats'),
    ('monthly.status.view_performance'),
    ('monthly.status.bonus_detail.view'),
    ('monthly.allowance.view_support_hours'),
    ('monthly.allowance.edit_support_hours'),
    ('monthly.export.download'),
    ('inspection.view_own'),
    ('inspection.view_store'),
    ('inspection.view_all'),
    ('inspection.create'),
    ('inspection.delete'),
    ('inspection.export'),
    ('inspection.compare'),
    ('inspection.manager_tab'),
    ('inspection.view_store_status'),
    ('inspection.template.manage'),
    ('inspection.improvement.view_all'),
    ('inspection.improvement.view_own_store'),
    ('inspection.improvement.submit'),
    ('inventory.manage'),
    ('inventory.inventory.access'),
    ('inventory.inventory.view'),
    ('inventory.result_analysis.view_own'),
    ('inventory.result_analysis.import'),
    ('inventory.result_analysis.delete'),
    ('activity.manage'),
    ('activity.management.access'),
    ('activity.campaign.view'),
    ('activity.campaign.view_all'),
    ('activity.campaign.edit'),
    ('activity.store_detail.edit'),
    ('activity.equipment_trip.edit'),
    ('activity.checklist.edit'),
    ('activity.support_request.edit'),
    ('activity.support_assign.edit'),
    ('activity.marketing.publish'),
    ('activity.merchandise.publish'),
    ('activity.staff_overview.view'),
    ('cross_dept.stockout.view_all'),
    ('cross_dept.stockout.submit'),
    ('cross_dept.stockout.respond'),
    ('cross_dept.maintenance.view_all'),
    ('cross_dept.maintenance.submit'),
    ('cross_dept.maintenance.update'),
    ('cross_dept.maintenance.category.edit'),
    ('performance.view'),
    ('performance.edit'),
    ('performance.bonus.view'),
    ('performance.bonus.import'),
    ('pharmacist.management.view'),
    ('pharmacist.management.edit'),
    ('pharmacist.management.master.view'),
    ('pharmacist.management.master.edit'),
    ('relationship_member.view'),
    ('relationship_member.edit'),
    ('relationship_member.delete'),
    ('relationship_member.approve'),
    ('general_affairs.service_center.force_close')
),
deleted_role_permissions AS (
  DELETE FROM public.role_permissions rp
  USING public.permissions p, p1c_codes c
  WHERE rp.permission_id = p.id
    AND p.code = c.code
  RETURNING rp.id
)
DELETE FROM public.permissions p
USING p1c_codes c
WHERE p.code = c.code;

DELETE FROM public.roles
WHERE code IN ('dev_full_admin')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.role_id = roles.id
  );

