-- 還原 20261119145000_m7m8_b45_dev_seed.sql：移除 DEV 專用的 vue_workspace_ga45_ 測試角色（只刪這四個角色與其權限、成員紀錄，不動既有角色）與測試資料清除函式。
DROP FUNCTION IF EXISTS public.ga_dev_cleanup_m7m8_b45(text);
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga45_clerk', 'vue_workspace_ga45_accountant', 'vue_workspace_ga45_viewer', 'vue_workspace_ga45_novendor'));
DELETE FROM public.user_roles WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga45_clerk', 'vue_workspace_ga45_accountant', 'vue_workspace_ga45_viewer', 'vue_workspace_ga45_novendor'));
DELETE FROM public.roles WHERE code IN ('vue_workspace_ga45_clerk', 'vue_workspace_ga45_accountant', 'vue_workspace_ga45_viewer', 'vue_workspace_ga45_novendor');
