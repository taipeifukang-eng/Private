-- Ensure first-phase organization management appears for existing admin-like
-- roles after organization permissions are introduced.

do $$
begin
  if to_regclass('public.permissions') is null then
    raise exception 'Missing prerequisite table: public.permissions';
  end if;
  if to_regclass('public.roles') is null then
    raise exception 'Missing prerequisite table: public.roles';
  end if;
  if to_regclass('public.role_permissions') is null then
    raise exception 'Missing prerequisite table: public.role_permissions';
  end if;
end $$;

insert into public.permissions (module, feature, code, action, description, is_active) values
  ('組織管理', '公司組織', 'organization.organization.view', 'view', '可查看公司組織架構。', true),
  ('組織管理', '部門管理', 'organization.department.view', 'view', '可查看部門列表。', true),
  ('組織管理', '部門管理', 'organization.department.create', 'create', '可新增部門。', true),
  ('組織管理', '部門管理', 'organization.department.edit', 'edit', '可編輯與啟停部門。', true),
  ('組織管理', '部門成員', 'organization.member.view', 'view', '可查看部門成員。', true),
  ('組織管理', '部門成員', 'organization.member.manage', 'edit', '可設定部門成員。', true),
  ('組織管理', '部門主管', 'organization.manager.view', 'view', '可查看部門主管。', true),
  ('組織管理', '部門主管', 'organization.manager.manage', 'assign', '可設定部門主管與副主管。', true)
on conflict (code) do update set
  module = excluded.module,
  feature = excluded.feature,
  action = excluded.action,
  description = excluded.description,
  is_active = excluded.is_active;

insert into public.role_permissions (role_id, permission_id, is_allowed)
select distinct r.id, org_permission.id, true
from public.roles r
cross join public.permissions org_permission
where org_permission.code like 'organization.%'
  and org_permission.is_active = true
  and (
    r.code in (
      'admin',
      'system_admin',
      'admin_role',
      'full_admin',
      'full_admin_role',
      'dev_full_admin',
      'owner',
      'owner_role'
    )
    or exists (
      select 1
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = r.id
        and rp.is_allowed = true
        and p.code in (
          'store.manage',
          'role.permission.assign',
          'role.user_role.assign'
        )
    )
  )
on conflict (role_id, permission_id) do update set is_allowed = true;

notify pgrst, 'reload schema';
