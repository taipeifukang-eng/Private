-- 還原 20261112150000_m7m8_b4_dev_roles.sql：移除 DEV 專用的兩個測試角色（掛用它們的帳號指派一併移除）。
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga_purchaser', 'vue_workspace_ga_po_approver'));
DELETE FROM public.user_roles WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga_purchaser', 'vue_workspace_ga_po_approver'));
DELETE FROM public.roles WHERE code IN ('vue_workspace_ga_purchaser', 'vue_workspace_ga_po_approver');
