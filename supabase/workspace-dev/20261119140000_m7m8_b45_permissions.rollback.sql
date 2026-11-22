-- 還原 20261119140000_m7m8_b45_permissions.sql：移除兩個請款權限碼與角色對它們的授權。
DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage'));
DELETE FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage');
