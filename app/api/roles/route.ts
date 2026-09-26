// ============================================
// 角色管理 API - 列表與建立
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission, requirePermission } from '@/lib/permissions/check';
import { ROLE_LIST_PAGE_PERMISSION_CODES } from '@/lib/permissions/rbac-management';

export const dynamic = 'force-dynamic';

const DEV_ROLE_CODE_PATTERNS = [
  /^dev_/,
  /^dev-/,
  /_temp$/,
  /^no_access$/
];

function isDevVerificationRole(role: { code?: string | null; name?: string | null; description?: string | null }) {
  const code = (role.code || '').toLowerCase();
  const name = (role.name || '').toLowerCase();
  const description = (role.description || '').toLowerCase();

  return (
    DEV_ROLE_CODE_PATTERNS.some(pattern => pattern.test(code)) ||
    name.startsWith('dev ') ||
    name.startsWith('dev_') ||
    description.includes('temporary dev verification role') ||
    description.includes('dev-only')
  );
}

// 取得角色列表
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查查看權限
    const canViewRoles = await hasAnyPermission(user.id, ROLE_LIST_PAGE_PERMISSION_CODES);
    if (!canViewRoles) {
      return NextResponse.json(
        { error: `權限不足: 需要 ${ROLE_LIST_PAGE_PERMISSION_CODES.join(' 或 ')} 權限` },
        { status: 403 }
      );
    }

    // 取得角色列表。角色管理資料在完成 RBAC 驗證後由 server-only admin client 讀取，
    // 避免正式環境舊 RLS 規則讓 full admin 看不到剛建立的角色。
    const adminSupabase = createAdminClient();
    const { data: roles, error } = await adminSupabase
      .from('roles')
      .select(`
        *,
        permission_count:role_permissions(count),
        user_count:user_roles(count)
      `)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('取得角色列表錯誤:', error);
      return NextResponse.json(
        { error: '取得角色列表失敗' },
        { status: 500 }
      );
    }

    const roleIds = (roles || []).map(role => role.id);
    const now = Date.now();
    const usersByRole = new Map<string, Array<{
      id: string;
      email: string;
      name: string;
      employee_code: string;
    }>>();

    if (roleIds.length > 0) {
      const { data: roleUsers, error: roleUsersError } = await adminSupabase
        .from('user_roles')
        .select('role_id, user_id, is_active, expires_at')
        .in('role_id', roleIds)
        .eq('is_active', true);

      if (roleUsersError) {
        console.error('取得角色使用者摘要錯誤:', roleUsersError);
      } else {
        const activeRoleUsers = (roleUsers || []).filter((row: any) => {
          const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
          return expiresAt === null || expiresAt > now;
        });
        const userIds = Array.from(new Set(activeRoleUsers.map((row: any) => row.user_id)));

        const profilesById = new Map<string, {
          email: string;
          full_name: string | null;
          employee_code: string | null;
        }>();

        if (userIds.length > 0) {
          const { data: profiles, error: profilesError } = await adminSupabase
            .from('profiles')
            .select('id, email, full_name, employee_code')
            .in('id', userIds);

          if (profilesError) {
            console.error('取得角色使用者 profile 摘要錯誤:', profilesError);
          } else {
            (profiles || []).forEach((profile: any) => {
              profilesById.set(profile.id, {
                email: profile.email || '',
                full_name: profile.full_name || null,
                employee_code: profile.employee_code || null
              });
            });
          }
        }

        activeRoleUsers.forEach((row: any) => {
          const profile = profilesById.get(row.user_id);
          const users = usersByRole.get(row.role_id) || [];
          users.push({
            id: row.user_id,
            email: profile?.email || '',
            name: profile?.full_name || '',
            employee_code: profile?.employee_code || ''
          });
          usersByRole.set(row.role_id, users);
        });
      }
    }

    const includeDevRoles = request.nextUrl.searchParams.get('includeDevRoles') === 'true';
    const visibleRoles = includeDevRoles
      ? roles
      : roles.filter(role => !isDevVerificationRole(role));
    const hiddenDevRoleCount = roles.length - visibleRoles.length;

    // 格式化數量
    const formattedRoles = visibleRoles.map(role => ({
      ...role,
      is_dev_verification_role: isDevVerificationRole(role),
      permission_count: role.permission_count?.[0]?.count || 0,
      user_count: usersByRole.get(role.id)?.length || 0,
      assigned_users: (usersByRole.get(role.id) || [])
        .sort((a, b) => {
          const aKey = a.employee_code || a.name || a.email;
          const bKey = b.employee_code || b.name || b.email;
          return aKey.localeCompare(bKey);
        })
        .slice(0, 3)
    }));

    return NextResponse.json(
      {
        roles: formattedRoles,
        meta: {
          total_count: roles.length,
          visible_count: formattedRoles.length,
          hidden_dev_role_count: hiddenDevRoleCount,
          include_dev_roles: includeDevRoles
        }
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('取得角色列表異常:', error);
    return NextResponse.json(
      { error: '取得角色列表失敗' },
      { status: 500 }
    );
  }
}

// 建立新角色
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查建立權限
    const permission = await requirePermission(user.id, 'role.role.create');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, code, description } = body;

    // 驗證必填欄位
    if (!name || !code) {
      return NextResponse.json(
        { error: '角色名稱和代碼為必填' },
        { status: 400 }
      );
    }

    // 驗證代碼格式 (只允許英文、數字、底線)
    if (!/^[a-z0-9_]+$/.test(code)) {
      return NextResponse.json(
        { error: '角色代碼只能包含小寫英文、數字和底線' },
        { status: 400 }
      );
    }

    // 建立角色。角色管理的 RLS 仍沿用舊 profiles.role 規則，
    // 因此 API 先完成 RBAC 驗證後，再用 server-only admin client 寫入。
    const adminSupabase = createAdminClient();
    const { data: newRole, error } = await adminSupabase
      .from('roles')
      .insert({
        name,
        code,
        description,
        is_system: false,
        is_active: true,
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: '角色代碼已存在' },
          { status: 409 }
        );
      }
      console.error('建立角色錯誤:', error);
      return NextResponse.json(
        { error: '建立角色失敗' },
        { status: 500 }
      );
    }

    return NextResponse.json({ role: newRole }, { status: 201 });
  } catch (error) {
    console.error('建立角色異常:', error);
    return NextResponse.json(
      { error: '建立角色失敗' },
      { status: 500 }
    );
  }
}
