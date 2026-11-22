-- 還原 20261118130000_m7m8_b6_dev_seed.sql：移除 DEV 專用的 vue_workspace_ga6_ 測試角色（掛用它們的帳號指派一併移除）。
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE code LIKE 'vue\_workspace\_ga6\_%');
DELETE FROM public.user_roles WHERE role_id IN (SELECT id FROM public.roles WHERE code LIKE 'vue\_workspace\_ga6\_%');
DELETE FROM public.roles WHERE code LIKE 'vue\_workspace\_ga6\_%';
