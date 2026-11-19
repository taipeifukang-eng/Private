-- 55-b45-permissions-rollback.sql
-- 撤回 55：移除兩個請款權限碼與角色對它們的授權（若已授權，授權一併移除）。
-- 撤回前備份：
--   CREATE TABLE public.zz_bak_b45_55_role_permissions AS SELECT rp.* FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'general_affairs.purchase_payment.%';
BEGIN;

DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage'));
DELETE FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage');

COMMIT;
