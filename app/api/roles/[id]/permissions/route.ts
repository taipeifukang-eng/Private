// ============================================
// 角色權限管理 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

// 取得角色的所有權限
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查查看權限
    const permission = await requirePermission(user.id, 'role.permission.view');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;
    const adminSupabase = createAdminClient();

    // 取得所有權限
    const { data: allPermissions, error: permError } = await adminSupabase
      .from('permissions')
      .select('*')
      .eq('is_active', true)
      .order('module')
      .order('feature')
      .order('action');

    if (permError) {
      console.error('取得權限列表錯誤:', permError);
      return NextResponse.json(
        { error: '取得權限列表失敗' },
        { status: 500 }
      );
    }

    // 取得角色已有的權限
    const { data: rolePermissions, error: rpError } = await adminSupabase
      .from('role_permissions')
      .select('permission_id, is_allowed')
      .eq('role_id', id);

    if (rpError) {
      console.error('取得角色權限錯誤:', rpError);
      return NextResponse.json(
        { error: '取得角色權限失敗' },
        { status: 500 }
      );
    }

    // 建立權限對照表
    const permissionMap = new Map(
      rolePermissions?.map(rp => [rp.permission_id, rp.is_allowed]) || []
    );

    // 合併權限資料
    const permissions = allPermissions.map(perm => ({
      ...perm,
      granted: permissionMap.get(perm.id) || false
    }));

    return NextResponse.json(
      { permissions },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('取得角色權限異常:', error);
    return NextResponse.json(
      { error: '取得角色權限失敗' },
      { status: 500 }
    );
  }
}

// 更新角色權限
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查分配權限
    const permission = await requirePermission(user.id, 'role.permission.assign');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;
    const body = await request.json();
    const { permissionIds, expectedPermissionIds } = body;

    if (!Array.isArray(permissionIds) || !Array.isArray(expectedPermissionIds)) {
      return NextResponse.json(
        { error: 'permissionIds 與 expectedPermissionIds 必須是陣列' },
        { status: 400 }
      );
    }

    const adminSupabase = createAdminClient();

    // 檢查角色是否存在
    const { data: role, error: roleError } = await adminSupabase
      .from('roles')
      .select('id, is_system')
      .eq('id', id)
      .single();

    if (roleError || !role) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    const uniquePermissionIds = Array.from(new Set(permissionIds));
    const uniqueExpectedPermissionIds = Array.from(new Set(expectedPermissionIds));
    if (
      uniquePermissionIds.some(permissionId => typeof permissionId !== 'string')
      || uniqueExpectedPermissionIds.some(permissionId => typeof permissionId !== 'string')
    ) {
      return NextResponse.json(
        { error: 'permissionIds 格式不正確' },
        { status: 400 }
      );
    }

    const { data: updatedCount, error: updateError } = await adminSupabase.rpc(
      'replace_role_permissions',
      {
        p_role_id: id,
        p_permission_ids: uniquePermissionIds,
        p_expected_permission_ids: uniqueExpectedPermissionIds,
        p_created_by: user.id
      }
    );

    if (updateError) {
      console.error('原子更新角色權限錯誤:', updateError);
      const invalidPermission = updateError.message.includes('INVALID_OR_INACTIVE_PERMISSION');
      const stalePermissions = updateError.message.includes('ROLE_PERMISSIONS_CHANGED');
      return NextResponse.json(
        {
          error: stalePermissions
            ? '這個角色的權限已被其他管理者更新，請重新載入後再調整'
            : invalidPermission
              ? '包含不存在或已停用的權限'
              : '更新權限失敗，原有設定已保留'
        },
        { status: stalePermissions ? 409 : invalidPermission ? 400 : 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: `成功更新 ${updatedCount ?? uniquePermissionIds.length} 個權限`
    });
  } catch (error) {
    console.error('更新角色權限異常:', error);
    return NextResponse.json(
      { error: '更新角色權限失敗' },
      { status: 500 }
    );
  }
}
