-- M9 D3：正式區角色與權限盤點（唯讀，只有 SELECT，不會改任何資料）
-- 用法：在 Supabase 正式區 SQL Editor 整段貼上執行，結果只有一格 JSON，
--       點那一格、複製全部內容，貼回給 Claude，用來產生「新權限勾選頁」。
-- 內容：只有角色代碼、名稱、人數、權限代碼，不含任何人的姓名、Email 或員編。
SELECT json_build_object(
  'generated_at', now(),
  'profile_admin_count', (SELECT count(*) FROM public.profiles WHERE role = 'admin'),
  'roles', (
    SELECT coalesce(json_agg(r ORDER BY r.code), '[]'::json) FROM (
      SELECT ro.code, ro.name, ro.is_active, ro.is_system,
        (SELECT count(DISTINCT ur.user_id) FROM public.user_roles ur
          WHERE ur.role_id = ro.id AND ur.is_active
            AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS active_members,
        (SELECT coalesce(json_agg(p.code ORDER BY p.code), '[]'::json)
           FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ro.id AND rp.is_allowed) AS allowed_codes
      FROM public.roles ro
    ) r
  ),
  'permission_codes', (
    SELECT coalesce(json_agg(json_build_object('code', code, 'active', is_active, 'desc', description) ORDER BY code), '[]'::json)
    FROM public.permissions
  )
) AS role_inventory;
