-- 還原 20261124140000_ga_utility_payment_dev_seed.sql：刪除 vue_workspace_gaup_ 四個測試角色（含成員紀錄與角色權限）與清除函式。不動既有角色。
DROP FUNCTION IF EXISTS public.ga_dev_cleanup_ga_utility_payment(text);
DELETE FROM public.user_roles WHERE role_id IN (SELECT id FROM public.roles WHERE code LIKE 'vue\_workspace\_gaup\_%');
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE code LIKE 'vue\_workspace\_gaup\_%');
DELETE FROM public.roles WHERE code LIKE 'vue\_workspace\_gaup\_%';
NOTIFY pgrst, 'reload schema';
